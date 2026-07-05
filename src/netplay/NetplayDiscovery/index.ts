/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

/**
 * RetroArch-compatible LAN Discovery
 *
 * Broadcasts UDP packets on the local network so other RetroArch clients
 * can discover hosted netplay sessions via "Scan Local Network".
 *
 * Protocol based on RetroArch's netplay_discovery.c
 */

import { createSocket, type Socket as DatagramSocket, type RemoteInfo } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { pipe, flatMap, filter, isDefined, map } from 'remeda';
import { safeClose } from '../../utils/safeClose';
import { VERSION } from '../../consts';
import { DEFAULT_PORT, MAX_NICK_LEN, UINT32_SIZE, HEX_RADIX } from '..';
import { netplayLogger } from '../netplayLogger';

export * from './consts';

import {
  DISCOVERY_QUERY_MAGIC,
  DISCOVERY_RESPONSE_MAGIC,
  QUERY_PACKET_SIZE,
  NETPLAY_HOST_STR_LEN,
  NETPLAY_HOST_LONGSTR_LEN,
  BYTE_MASK,
  BROADCAST_INTERVAL_MS,
  PASSWORD_FLAG,
  SPECTATE_PASSWORD_FLAG,
  DISCOVERY_PACKET_SIZE,
} from './consts';

/** Information about a hosted netplay session for discovery */
export interface DiscoverySessionInfo {
  /** TCP port the server is listening on */
  port: number;
  /** Host's nickname */
  nickname: string;
  /** Core name (e.g., "bsnes") */
  coreName: string;
  /** Core version */
  coreVersion: string;
  /** Content/game name */
  contentName: string;
  /** Content CRC32 */
  contentCrc: number;
  /** Whether password is required */
  hasPassword: boolean;
  /** Whether spectate password is required */
  hasSpectatePassword: boolean;
}

/**
 * Get all broadcast addresses for the local network interfaces.
 */
const getBroadcastAddresses = (): string[] => {
  const interfaces = networkInterfaces();

  const addresses = pipe(
    Object.values(interfaces),
    filter(isDefined),
    flatMap((iface) =>
      pipe(
        iface,
        filter((info) => info.family === 'IPv4' && !info.internal),
        map((info) => {
          const ipParts = info.address.split('.').map(Number);
          const maskParts = info.netmask.split('.').map(Number);
          return ipParts.map((ip, i) => (ip | (~maskParts[i] & BYTE_MASK))).join('.');
        }),
      )
    ),
  );

  // Fallback to generic broadcast if no interfaces found
  return addresses.length > 0 ? addresses : ['255.255.255.255'];
};

/**
 * Write a fixed-length string to a buffer (null-padded).
 */
const writeFixedString = (buffer: Buffer, str: string, offset: number, length: number): number => {
  const strBuffer = Buffer.from(str.slice(0, length - 1), 'utf8');
  strBuffer.copy(buffer, offset);
  // Null terminate and pad
  buffer.fill(0, offset + strBuffer.length, offset + length);
  return offset + length;
};

/**
 * Create a discovery announcement packet.
 * Matches RetroArch's struct ad_packet format.
 */
const createDiscoveryPacket = (info: DiscoverySessionInfo): Buffer => {
  const buffer = Buffer.alloc(DISCOVERY_PACKET_SIZE);
  let offset = 0;

  // header (magic)
  buffer.writeUInt32BE(DISCOVERY_RESPONSE_MAGIC, offset);
  offset += UINT32_SIZE;

  // content_crc (int32, network byte order)
  buffer.writeInt32BE(info.contentCrc | 0, offset);
  offset += UINT32_SIZE;

  // port (int32, network byte order)
  buffer.writeInt32BE(info.port, offset);
  offset += UINT32_SIZE;

  // has_password (uint32 bitmask: 1=password, 2=spectate_password)
  let hasPasswordFlags = 0;
  if (info.hasPassword) { hasPasswordFlags |= PASSWORD_FLAG; }
  if (info.hasSpectatePassword) { hasPasswordFlags |= SPECTATE_PASSWORD_FLAG; }
  buffer.writeUInt32BE(hasPasswordFlags, offset);
  offset += UINT32_SIZE;

  // nick[32]
  offset = writeFixedString(buffer, info.nickname, offset, MAX_NICK_LEN);

  // frontend[32] - platform and architecture (matches RetroArch convention)
  const frontend = `${process.platform} ${process.arch}`;
  offset = writeFixedString(buffer, frontend, offset, NETPLAY_HOST_STR_LEN);

  // core[32]
  offset = writeFixedString(buffer, info.coreName, offset, NETPLAY_HOST_STR_LEN);

  // core_version[32]
  offset = writeFixedString(buffer, info.coreVersion, offset, NETPLAY_HOST_STR_LEN);

  // retroarch_version[32] - we identify as emoemu with our version
  offset = writeFixedString(buffer, `emoemu ${VERSION}`, offset, NETPLAY_HOST_STR_LEN);

  // content[256]
  offset = writeFixedString(buffer, info.contentName, offset, NETPLAY_HOST_LONGSTR_LEN);

  // subsystem_name[256]
  writeFixedString(buffer, 'N/A', offset, NETPLAY_HOST_LONGSTR_LEN);

  return buffer;
};

/**
 * LAN Discovery Broadcaster
 *
 * Handles LAN discovery in two ways:
 * 1. Periodically broadcasts UDP packets to announce the session
 * 2. Listens for RANQ query packets and responds directly to querying clients
 *
 * RetroArch clients can discover sessions either by receiving broadcasts
 * or by sending queries to the discovery port.
 */
export class DiscoveryBroadcaster {
  /** Socket for broadcasting announcements */
  private broadcastSocket: DatagramSocket | null = null;
  /** Socket for listening to queries on the discovery port */
  private querySocket: DatagramSocket | null = null;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private sessionInfo: DiscoverySessionInfo;
  private broadcastAddresses: string[];
  private running = false;

  constructor(sessionInfo: DiscoverySessionInfo) {
    this.sessionInfo = sessionInfo;
    this.broadcastAddresses = getBroadcastAddresses();
  }

  /**
   * Start broadcasting discovery packets and listening for queries.
   */
  start(): void {
    if (this.running) { return; }

    // Create broadcast socket (for sending announcements)
    this.broadcastSocket = createSocket({ type: 'udp4', reuseAddr: true });

    this.broadcastSocket.on('error', (err) => {
      netplayLogger.discoveryError(`Broadcast socket error: ${err.message}`);
      this.stop();
    });

    this.broadcastSocket.bind(() => {
      if (!this.broadcastSocket) { return; }

      // Enable broadcast
      this.broadcastSocket.setBroadcast(true);

      // Start query listener after broadcast socket is ready
      this.startQueryListener();
    });
  }

  /**
   * Start listening for discovery queries on the discovery port.
   */
  private startQueryListener(): void {
    this.querySocket = createSocket({ type: 'udp4', reuseAddr: true });

    this.querySocket.on('error', (err) => {
      // Don't fail completely if query socket has issues
      netplayLogger.discoveryError(`Query socket error: ${err.message}`);
      if (this.querySocket) {
        safeClose(this.querySocket);
        this.querySocket = null;
      }
    });

    this.querySocket.on('message', (msg, rinfo) => {
      this.handleQuery(msg, rinfo);
    });

    // Bind to the discovery port to receive queries
    this.querySocket.bind(DEFAULT_PORT, () => {
      this.running = true;
      netplayLogger.discoveryStarted(this.sessionInfo.port, this.broadcastAddresses);

      // Send initial broadcast
      this.sendBroadcast();

      // Set up periodic broadcasts
      this.broadcastInterval = setInterval(() => {
        this.sendBroadcast();
      }, BROADCAST_INTERVAL_MS);
    });
  }

  /**
   * Handle an incoming discovery query.
   */
  private handleQuery(msg: Buffer, rinfo: RemoteInfo): void {
    // Query should be exactly 4 bytes (the RANQ magic)
    if (msg.length !== QUERY_PACKET_SIZE) {
      return;
    }

    const magic = msg.readUInt32BE(0);
    if (magic !== DISCOVERY_QUERY_MAGIC) {
      return;
    }

    // Respond directly to the querying client
    const packet = createDiscoveryPacket(this.sessionInfo);

    // Debug: log packet details
    const packetMagic = packet.readUInt32BE(0).toString(HEX_RADIX);
    const packetCrc = packet.readInt32BE(UINT32_SIZE);
    const packetPort = packet.readInt32BE(UINT32_SIZE * 2);
    const hasPasswordOffset = 3;
    const packetHasPassword = packet.readUInt32BE(UINT32_SIZE * hasPasswordOffset);
    netplayLogger.debug('DISCOVERY', `Received query from ${rinfo.address}:${rinfo.port}, responding with packet`, {
      packetSize: packet.length,
      magic: packetMagic,
      contentCrc: packetCrc,
      port: packetPort,
      hasPassword: packetHasPassword,
      sessionHasPassword: this.sessionInfo.hasPassword,
    });

    if (this.broadcastSocket) {
      this.broadcastSocket.send(packet, rinfo.port, rinfo.address, (err) => {
        if (err) {
          netplayLogger.discoveryError(`Failed to respond to query from ${rinfo.address}: ${err.message}`);
        }
      });
    }
  }

  /**
   * Stop broadcasting and listening.
   */
  stop(): void {
    const wasRunning = this.running;

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.broadcastSocket) {
      safeClose(this.broadcastSocket);
      this.broadcastSocket = null;
    }

    if (this.querySocket) {
      safeClose(this.querySocket);
      this.querySocket = null;
    }

    this.running = false;

    if (wasRunning) {
      netplayLogger.discoveryStopped();
    }
  }

  /**
   * Update session info (e.g., when password changes).
   */
  updateSessionInfo(info: Partial<DiscoverySessionInfo>): void {
    this.sessionInfo = { ...this.sessionInfo, ...info };
  }

  /**
   * Send a broadcast packet to all network interfaces.
   */
  private sendBroadcast(): void {
    if (!this.broadcastSocket) { return; }

    const packet = createDiscoveryPacket(this.sessionInfo);

    for (const address of this.broadcastAddresses) {
      this.broadcastSocket.send(packet, DEFAULT_PORT, address, (err) => {
        if (err) {
          netplayLogger.discoveryError(`Failed to broadcast to ${address}: ${err.message}`);
        }
      });
    }
  }

  /**
   * Check if the broadcaster is running.
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * LAN Discovery Listener
 *
 * Listens for discovery broadcasts from other netplay hosts on the LAN.
 * Used for scanning and displaying available sessions.
 */
export class DiscoveryListener {
  private socket: DatagramSocket | null = null;
  private running = false;
  private discoveredHosts: Map<string, DiscoverySessionInfo & { address: string; lastSeen: number }> = new Map();
  private broadcastAddresses: string[] = [];

  /**
   * Start listening for discovery broadcasts.
   */
  start(onHostFound?: (host: DiscoverySessionInfo & { address: string }) => void): void {
    if (this.running) { return; }

    // Get broadcast addresses for sending queries
    this.broadcastAddresses = getBroadcastAddresses();

    this.socket = createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      netplayLogger.discoveryError(`Listener error: ${err.message}`);
      this.stop();
    });

    this.socket.on('message', (msg, rinfo) => {
      const host = this.parseDiscoveryPacket(msg, rinfo.address);
      if (host) {
        const key = `${rinfo.address}:${host.port}`;
        const isNew = !this.discoveredHosts.has(key);
        this.discoveredHosts.set(key, { ...host, address: rinfo.address, lastSeen: Date.now() });

        if (isNew) {
          netplayLogger.info('DISCOVERY', `Discovered host: ${host.nickname} at ${rinfo.address}:${host.port}`, {
            coreName: host.coreName,
            contentName: host.contentName,
            hasPassword: host.hasPassword,
          });
        }

        if (onHostFound) {
          onHostFound({ ...host, address: rinfo.address });
        }
      }
    });

    this.socket.bind(DEFAULT_PORT, () => {
      if (!this.socket) { return; }
      // Enable broadcast so we can send queries
      this.socket.setBroadcast(true);
      this.running = true;
      netplayLogger.info('DISCOVERY', 'LAN discovery listener started', { port: DEFAULT_PORT });
    });
  }

  /**
   * Stop listening.
   */
  stop(): void {
    if (this.socket) {
      safeClose(this.socket);
      this.socket = null;
    }
    this.running = false;
    this.discoveredHosts.clear();
  }

  /**
   * Send a discovery query to trigger hosts to respond.
   * This broadcasts a RANQ packet to all local network broadcast addresses.
   * Responses come back to our listener socket on DEFAULT_PORT.
   */
  sendQuery(): void {
    if (!this.running || !this.socket) { return; }

    // Create RANQ query packet (just the magic number)
    const queryPacket = Buffer.alloc(QUERY_PACKET_SIZE);
    queryPacket.writeUInt32BE(DISCOVERY_QUERY_MAGIC, 0);

    // Send to all broadcast addresses using the listener socket
    // Hosts will respond directly to our address:DEFAULT_PORT
    for (const address of this.broadcastAddresses) {
      this.socket.send(queryPacket, 0, queryPacket.length, DEFAULT_PORT, address, (err) => {
        if (err) {
          netplayLogger.debug('DISCOVERY', `Query send error to ${address}: ${err.message}`);
        }
      });
    }

    netplayLogger.debug('DISCOVERY', 'Sent discovery query', {
      broadcastAddresses: this.broadcastAddresses,
    });
  }

  /**
   * Get list of discovered hosts (filtered by recency).
   */
  getDiscoveredHosts(maxAgeMs: number = 30000): Array<DiscoverySessionInfo & { address: string }> {
    const now = Date.now();
    const hosts: Array<DiscoverySessionInfo & { address: string }> = [];

    for (const [key, host] of this.discoveredHosts) {
      if (now - host.lastSeen <= maxAgeMs) {
        const { lastSeen: _, ...hostInfo } = host;
        hosts.push(hostInfo);
      } else {
        // Remove stale entries
        this.discoveredHosts.delete(key);
      }
    }

    return hosts;
  }

  /**
   * Parse a discovery packet from the network.
   * Matches RetroArch's struct ad_packet format.
   */
  private parseDiscoveryPacket(buffer: Buffer, _address: string): DiscoverySessionInfo | null {
    if (buffer.length < DISCOVERY_PACKET_SIZE) {
      return null;
    }

    let offset = 0;

    // Read fixed-length string helper
    const readFixedString = (length: number): string => {
      const strBuffer = buffer.subarray(offset, offset + length);
      offset += length;
      const nullIndex = strBuffer.indexOf(0);
      return strBuffer.subarray(0, nullIndex === -1 ? length : nullIndex).toString('utf8');
    };

    // header (magic)
    const magic = buffer.readUInt32BE(offset);
    offset += UINT32_SIZE;

    if (magic !== DISCOVERY_RESPONSE_MAGIC) {
      return null;
    }

    // content_crc (int32)
    const contentCrc = buffer.readInt32BE(offset);
    offset += UINT32_SIZE;

    // port (int32)
    const port = buffer.readInt32BE(offset);
    offset += UINT32_SIZE;

    // has_password (uint32 bitmask)
    const hasPasswordFlags = buffer.readUInt32BE(offset);
    offset += UINT32_SIZE;

    const hasPassword = (hasPasswordFlags & PASSWORD_FLAG) !== 0;
    const hasSpectatePassword = (hasPasswordFlags & SPECTATE_PASSWORD_FLAG) !== 0;

    // nick[32]
    const nickname = readFixedString(MAX_NICK_LEN);

    // frontend[32] - skip
    readFixedString(NETPLAY_HOST_STR_LEN);

    // core[32]
    const coreName = readFixedString(NETPLAY_HOST_STR_LEN);

    // core_version[32]
    const coreVersion = readFixedString(NETPLAY_HOST_STR_LEN);

    // retroarch_version[32] - skip
    readFixedString(NETPLAY_HOST_STR_LEN);

    // content[256]
    const contentName = readFixedString(NETPLAY_HOST_LONGSTR_LEN);

    // subsystem_name[256] - skip
    readFixedString(NETPLAY_HOST_LONGSTR_LEN);

    return {
      port,
      nickname,
      coreName,
      coreVersion,
      contentName,
      contentCrc,
      hasPassword,
      hasSpectatePassword,
    };
  }

  /**
   * Check if the listener is running.
   */
  isRunning(): boolean {
    return this.running;
  }
}
