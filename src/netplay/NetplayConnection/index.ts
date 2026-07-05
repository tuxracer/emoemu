/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

/**
 * TCP Connection Wrapper for Netplay
 *
 * Handles buffered reads, command parsing, and connection state management.
 */

import { Socket, createConnection } from 'net';
import { EventEmitter } from 'events';
import {
  ConnectionState,
  DEFAULT_PORT,
  TCP_KEEPALIVE_MS,
  CONNECTION_HEADER_SIZE,
  CONNECTION_MAGIC_SIZE,
  CONNECTION_MAGIC,
  TIMEOUT_CLEANUP_DELAY_MS,
  HEX_PREVIEW_LENGTH,
  HEX_RADIX,
  HEX_PADDING_WIDTH_32,
  RECEIVE_BUFFER_INITIAL_SIZE,
  RECEIVE_BUFFER_GROWTH_FACTOR,
  NetplayError,
  type RawCommand,
  type ParsedCommand,
  type ClientInfo,
} from '..';
import { netplayLogger } from '../netplayLogger';
import {
  decodeCommand,
  parseCommand,
  createConnectionHeader,
  parseConnectionHeader,
  type ConnectionHeader,
} from '../protocol';

/** Connection event types */
interface ConnectionEvents {
  command: (command: ParsedCommand) => void;
  rawCommand: (command: RawCommand) => void;
  connected: () => void;
  disconnected: (reason: string) => void;
  error: (error: Error) => void;
}

/**
 * NetplayConnection wraps a TCP socket with buffered command parsing.
 */
export class NetplayConnection extends EventEmitter {
  private socket: Socket | null = null;
  /** Pre-allocated receive buffer (grows as needed, avoids per-packet allocation) */
  private receiveBuffer: Buffer = Buffer.alloc(RECEIVE_BUFFER_INITIAL_SIZE);
  /** Number of valid bytes currently in receiveBuffer */
  private receiveBufferLength: number = 0;
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  private _id: number = 0;
  private _nickname: string = '';
  private _playerNumber: number = -1;
  private _spectating: boolean = false;
  private _latency: number = 0;
  private _lastReceivedFrame: number = 0;
  private _devices: number[] = [];
  private _address: string = '';
  private _port: number = 0;
  private _draining: boolean = false;

  /** Unique client ID */
  get id(): number {
    return this._id;
  }
  set id(value: number) {
    this._id = value;
  }

  /** Client nickname */
  get nickname(): string {
    return this._nickname;
  }
  set nickname(value: string) {
    this._nickname = value;
  }

  /** Player number (-1 if spectating) */
  get playerNumber(): number {
    return this._playerNumber;
  }
  set playerNumber(value: number) {
    this._playerNumber = value;
  }

  /** Is this connection spectating? */
  get spectating(): boolean {
    return this._spectating;
  }
  set spectating(value: boolean) {
    this._spectating = value;
  }

  /** Estimated latency in ms */
  get latency(): number {
    return this._latency;
  }
  set latency(value: number) {
    this._latency = value;
  }

  /** Last frame received from this connection */
  get lastReceivedFrame(): number {
    return this._lastReceivedFrame;
  }
  set lastReceivedFrame(value: number) {
    this._lastReceivedFrame = value;
  }

  /** Input devices */
  get devices(): number[] {
    return this._devices;
  }
  set devices(value: number[]) {
    this._devices = value;
  }

  /** Remote address */
  get address(): string {
    return this._address;
  }

  /** Remote port */
  get port(): number {
    return this._port;
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /** Is the connection currently open? */
  get isConnected(): boolean {
    return (
      this._state !== ConnectionState.DISCONNECTED && this.socket !== null && !this.socket.destroyed
    );
  }

  /**
   * Create a connection from an existing socket (server accepting a client).
   */
  static fromSocket(socket: Socket, clientId: number): NetplayConnection {
    const conn = new NetplayConnection();
    conn.socket = socket;
    conn._id = clientId;
    conn._state = ConnectionState.CONNECTED;

    const addr = socket.remoteAddress ?? 'unknown';
    const port = socket.remotePort ?? 0;
    conn._address = addr;
    conn._port = port;

    conn.setupSocketHandlers();
    return conn;
  }

  /**
   * Connect to a remote server.
   */
  async connect(host: string, port: number = DEFAULT_PORT): Promise<void> {
    if (this.socket) {
      throw new NetplayError('ALREADY_CONNECTED');
    }

    return new Promise((resolve, reject) => {
      this._address = host;
      this._port = port;

      this.socket = createConnection({ host, port }, () => {
        this._state = ConnectionState.CONNECTED;
        this.setupSocketHandlers();
        this.emit('connected');
        resolve();
      });

      this.socket.once('error', (err) => {
        this._state = ConnectionState.DISCONNECTED;
        reject(err);
      });

      // Set socket options
      this.socket.setNoDelay(true);
      this.socket.setKeepAlive(true, TCP_KEEPALIVE_MS);
    });
  }

  /**
   * Close the connection.
   */
  close(reason: string = 'closed'): void {
    // Log any pending data in receive buffer before closing
    const bufferPreviewLength = HEX_PREVIEW_LENGTH * 2; // 64 bytes
    if (this.receiveBufferLength > 0) {
      const bufferPreview = this.receiveBuffer.subarray(0, Math.min(bufferPreviewLength, this.receiveBufferLength)).toString('hex');
      netplayLogger.debug('CONNECTION', `Connection closing with ${this.receiveBufferLength} bytes in buffer`, {
        reason,
        bufferedBytes: this.receiveBufferLength,
        bufferHex: bufferPreview + (this.receiveBufferLength > bufferPreviewLength ? '...' : ''),
      });
    } else {
      netplayLogger.debug('CONNECTION', `Connection closing`, { reason, bufferedBytes: 0 });
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this._state !== ConnectionState.DISCONNECTED) {
      this._state = ConnectionState.DISCONNECTED;
      this.emit('disconnected', reason);
    }
    // Reset buffer length instead of reallocating (keeps the buffer for potential reuse)
    this.receiveBufferLength = 0;
  }

  /** Is the socket buffer full and draining? */
  get draining(): boolean {
    return this._draining;
  }

  /**
   * Send raw data over the connection.
   * Returns false if socket is unavailable or buffer is full.
   */
  send(data: Buffer): boolean {
    if (!this.socket || this.socket.destroyed) {
      netplayLogger.debug('CONNECTION', `Send failed - socket not available`, {
        socketExists: !!this.socket,
        socketDestroyed: this.socket?.destroyed ?? 'N/A',
        dataSize: data.length,
      });
      return false;
    }

    // If already draining, skip non-critical data to avoid flooding
    if (this._draining) {
      return false;
    }

    const success = this.socket.write(data);
    if (!success) {
      this._draining = true;
      netplayLogger.debug('CONNECTION', `Socket buffer full, entering drain mode`, {
        dataSize: data.length,
      });
    }
    return success;
  }

  /**
   * Send the connection header.
   * @param nickname The nickname (for logging only, not sent in header)
   * @param isServer Whether this is a server sending to a client
   * @param salt Password salt (server only, 0 = no password required)
   */
  sendHeader(nickname: string = 'emoemu', isServer: boolean = false, salt: number = 0): boolean {
    const header = createConnectionHeader({ isServer, salt });
    netplayLogger.debug('CONNECTION', `Sending connection header to ${this._address}`, {
      headerHex: header.toString('hex'),
      headerSize: header.length,
      nickname,
    });
    return this.send(header);
  }

  /**
   * Wait for and parse the connection header from remote.
   * Returns the parsed header on success, or null on failure.
   */
  async waitForHeader(timeoutMs: number = 5000): Promise<ConnectionHeader | null> {
    return new Promise((resolve) => {
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          netplayLogger.debug('CONNECTION', `Header timeout waiting for ${this._address}`, {
            bufferSize: this.receiveBufferLength,
          });
          resolve(null);
        }
      }, timeoutMs);

      const checkHeader = (): void => {
        if (resolved) {
          return;
        }

        // Need at least the minimum header size to start checking
        if (this.receiveBufferLength < CONNECTION_HEADER_SIZE) {
          return;
        }

        // Try to parse the full header (includes variable nickname)
        // Create a view of only the valid data for parsing
        const validData = this.receiveBuffer.subarray(0, this.receiveBufferLength);
        const result = parseConnectionHeader(validData);
        if (result) {
          resolved = true;
          clearTimeout(timeout);
          // Shift consumed bytes out of buffer
          this.consumeBuffer(result.bytesConsumed);
          this._state = ConnectionState.HANDSHAKING;

          netplayLogger.debug('CONNECTION', `Received valid header from ${this._address}`, {
            nickname: result.header.nickname,
            platformMagic: result.header.platformMagic.toString(HEX_RADIX),
            compression: result.header.compression,
            bytesConsumed: result.bytesConsumed,
          });

          resolve(result.header);
        } else if (this.receiveBufferLength >= CONNECTION_MAGIC_SIZE) {
          // Check if magic is wrong (invalid connection)
          const magic = this.receiveBuffer.readUInt32BE(0);
          if (magic !== CONNECTION_MAGIC) {
            resolved = true;
            clearTimeout(timeout);
            netplayLogger.debug('CONNECTION', `Invalid magic from ${this._address}`, {
              expectedMagic: CONNECTION_MAGIC.toString(HEX_RADIX),
              receivedMagic: magic.toString(HEX_RADIX).padStart(HEX_PADDING_WIDTH_32, '0'),
            });
            resolve(null);
          }
          // Otherwise, magic is valid but we don't have enough data yet - wait for more
        }
      };

      // Check if we already have the header
      checkHeader();

      // Listen for more data
      const onData = (): void => {
        checkHeader();
      };

      this.socket?.on('data', onData);

      // Cleanup after resolution
      setTimeout(() => {
        this.socket?.off('data', onData);
      }, timeoutMs + TIMEOUT_CLEANUP_DELAY_MS);
    });
  }

  /**
   * Update connection state.
   */
  setState(state: ConnectionState): void {
    this._state = state;
  }

  /**
   * Get client info snapshot.
   */
  getClientInfo(): ClientInfo {
    return {
      id: this._id,
      nickname: this._nickname,
      address: this._address,
      port: this._port,
      state: this._state,
      playerNumber: this._playerNumber,
      spectating: this._spectating,
      latency: this._latency,
      lastReceivedFrame: this._lastReceivedFrame,
      devices: [...this._devices],
    };
  }

  /**
   * Process any complete commands in the receive buffer.
   */
  processBuffer(): void {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      // Create a view of only the valid data for parsing
      const validData = this.receiveBuffer.subarray(0, this.receiveBufferLength);
      const result = decodeCommand(validData);
      if (!result) {
        break;
      }

      const { command, bytesConsumed } = result;
      // Shift consumed bytes out of buffer
      this.consumeBuffer(bytesConsumed);

      // Emit raw command
      this.emit('rawCommand', command);

      // Parse and emit typed command
      try {
        const parsed = parseCommand(command);
        this.emit('command', parsed);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /**
   * Append data to the receive buffer, growing if necessary.
   * This avoids Buffer.concat allocation on every packet.
   */
  private appendToBuffer(data: Buffer): void {
    const requiredSize = this.receiveBufferLength + data.length;

    // Grow buffer if needed
    if (requiredSize > this.receiveBuffer.length) {
      let newSize = this.receiveBuffer.length;
      while (newSize < requiredSize) {
        newSize *= RECEIVE_BUFFER_GROWTH_FACTOR;
      }
      const newBuffer = Buffer.alloc(newSize);
      // Copy existing valid data
      this.receiveBuffer.copy(newBuffer, 0, 0, this.receiveBufferLength);
      this.receiveBuffer = newBuffer;
    }

    // Append new data
    data.copy(this.receiveBuffer, this.receiveBufferLength);
    this.receiveBufferLength += data.length;
  }

  /**
   * Remove consumed bytes from the front of the receive buffer.
   * Uses in-place copy to avoid allocation.
   */
  private consumeBuffer(bytesConsumed: number): void {
    if (bytesConsumed >= this.receiveBufferLength) {
      // All data consumed, just reset length
      this.receiveBufferLength = 0;
    } else {
      // Shift remaining data to front
      this.receiveBuffer.copy(
        this.receiveBuffer,
        0,
        bytesConsumed,
        this.receiveBufferLength
      );
      this.receiveBufferLength -= bytesConsumed;
    }
  }

  /**
   * Set up socket event handlers.
   */
  private setupSocketHandlers(): void {
    if (!this.socket) {
      return;
    }

    this.socket.on('data', (data: Buffer) => {
      // Log raw data received for debugging
      const hexPreview = data.subarray(0, Math.min(HEX_PREVIEW_LENGTH, data.length)).toString('hex');
      netplayLogger.debug('CONNECTION', `Received ${data.length} bytes from ${this._address}`, {
        bytesReceived: data.length,
        hexPreview: hexPreview + (data.length > HEX_PREVIEW_LENGTH ? '...' : ''),
        bufferSizeBefore: this.receiveBufferLength,
      });

      // Append to receive buffer (grows as needed, avoids per-packet allocation)
      this.appendToBuffer(data);
      // Process any complete commands
      this.processBuffer();
    });

    this.socket.on('close', () => {
      this.close('connection closed');
    });

    this.socket.on('error', (err) => {
      // Capture additional error details for debugging
      const errWithCode = err as NodeJS.ErrnoException;
      const errDetails = {
        message: err.message,
        code: errWithCode.code,
        syscall: errWithCode.syscall,
        errno: errWithCode.errno,
      };
      netplayLogger.debug('CONNECTION', `Socket error from ${this._address}`, errDetails);
      this.emit('error', err);
      this.close(`error: ${err.message}`);
    });

    this.socket.on('timeout', () => {
      this.close('timeout');
    });

    this.socket.on('drain', () => {
      if (this._draining) {
        this._draining = false;
        netplayLogger.debug('CONNECTION', `Socket drained, resuming sends to ${this._address}`);
      }
    });
  }

  // Type-safe event emitter methods
  override on<K extends keyof ConnectionEvents>(
    event: K,
    listener: ConnectionEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override off<K extends keyof ConnectionEvents>(
    event: K,
    listener: ConnectionEvents[K]
  ): this {
    return super.off(event, listener);
  }

  override emit<K extends keyof ConnectionEvents>(
    event: K,
    ...args: Parameters<ConnectionEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create a connection and connect to a server.
 */
export const createNetplayConnection = async (
  host: string,
  port: number = DEFAULT_PORT
): Promise<NetplayConnection> => {
  const conn = new NetplayConnection();
  await conn.connect(host, port);
  return conn;
};
