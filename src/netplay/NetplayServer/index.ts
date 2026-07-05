/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

/**
 * NetplayServer - RetroArch-compatible netplay server
 *
 * Implements the server (host) side of the netplay protocol:
 * - Accepts TCP connections from clients
 * - Handles handshake (magic, nick, password, info exchange)
 * - Broadcasts input to all connected clients
 * - Sends periodic CRC checks for desync detection
 * - Manages client state and player assignment
 */

import { createServer, type Server, type Socket } from 'net';
import { EventEmitter } from 'events';
import {
  DEFAULT_PORT,
  MAX_CLIENTS,
  MAX_INPUT_DEVICES,
  NetplayCmd,
  ConnectionState,
  RetroDevice,
  STALL_AHEAD_THRESHOLD_FRAMES,
  STALL_MIN_INTERVAL_FRAMES,
  PING_INTERVAL_MS,
  HEX_RADIX,
  HEX_PADDING_WIDTH,
  HEX_PADDING_WIDTH_32,
  MASK_31BIT,
  HEX_PREVIEW_LENGTH,
  SERVER_INPUT_LOG_INTERVAL_FRAMES,
  DESYNC_RECOVERY_COOLDOWN_FRAMES,
  NetplayError,
  isKnownCommand,
  type NetplayServerOptions,
  type ParsedCommand,
  type KnownCommand,
  type NickCommand,
  type PasswordCommand,
  type InfoCommand,
  type InputCommand,
  type CrcCommand,
  type PauseCommand,
  type PlayerChatCommand,
} from '..';
import {
  encodeCommand,
  buildNickCommand,
  buildInfoCommand,
  buildSyncCommand,
  buildModeCommand,
  buildInputCommand,
  buildCrcCommand,
  buildPingResponseCommand,
  buildPingRequestCommand,
  buildLoadSavestateCommand,
  buildSettingAllowPausingCommand,
  buildSettingInputLatencyFramesCommand,
  buildPauseCommand,
  buildResumeCommand,
  buildPlayerChatCommand,
  buildResetCommand,
  buildStallCommand,
  parsePlatformMagic,
  hashPassword,
} from '../protocol';
import { NetplayConnection } from '../NetplayConnection';
import { SyncManager, createSyncManager } from '../SyncManager';
import { DiscoveryBroadcaster } from '../NetplayDiscovery';
import { netplayLogger } from '../netplayLogger';
import { getErrorMessage } from '../../utils/getErrorMessage';
import {
  notifyNetplayClientConnected,
  notifyNetplayClientDisconnected,
  notifyNetplaySpectatorConnected,
  notifyNetplayConnectionFailed,
} from '../../frontend/notifications';

/** Client session information */
interface ClientSession {
  /** Unique client ID (0-31) */
  clientId: number;

  /** Connection wrapper */
  connection: NetplayConnection;

  /** Client nickname */
  nickname: string;

  /** Connection state */
  state: ConnectionState;

  /** Is client playing (vs spectating)? */
  isPlaying: boolean;

  /** Assigned device/port indices */
  deviceIndices: number[];

  /** Last frame number received from this client */
  lastInputFrame: number;

  /** Timestamp of last received data */
  lastActivity: number;

  /** Timestamp when connection was established */
  connectedAt: number;

  /** Handshake steps completed */
  handshakeSteps: string[];

  /** Frame number sent in SYNC command (used to calculate MODE frame) */
  syncFrame: number;

  /** Client's protocol version (from platform magic in header) */
  protocolVersion: number;

  /** Whether MODE has been sent to this client (deferred until after LOAD_SAVESTATE) */
  modeSent: boolean;

  /** Password salt sent in this connection's header (0 = no password required) */
  salt: number;

  /** SYNC has been sent: the session must receive the per-frame server input stream */
  syncSent: boolean;

  /** PLAY accepted; MODE announcement deferred to the next frame boundary */
  pendingJoin: boolean;

  /** Frame of the last STALL sent to this client (throttling) */
  lastStallFrame: number;

  /** Timestamp of the outstanding latency ping (null = none in flight) */
  pingSentAt: number | null;

  /** Measured round-trip latency in ms (null until the first ping returns) */
  latency: number | null;
}

/** Server events */
interface ServerEvents {
  'client-connected': (session: ClientSession) => void;
  'client-disconnected': (session: ClientSession, reason: string) => void;
  'client-playing': (session: ClientSession) => void;
  reset: (frameNumber: number) => void;
  desync: (clientId: number, frameNumber: number) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
  paused: (by: string) => void;
  resumed: () => void;
  chat: (from: string, message: string) => void;
}

/**
 * NetplayServer handles hosting a netplay session.
 */
export class NetplayServer extends EventEmitter {
  private server: Server | null = null;
  private readonly clients: Map<number, ClientSession> = new Map();
  private readonly config: Required<NetplayServerOptions>;
  private readonly syncManager: SyncManager;
  private discoveryBroadcaster: DiscoveryBroadcaster | null = null;

  /** Core/ROM info for handshake */
  private coreInfo = {
    coreName: 'unknown',
    coreVersion: '',
    contentCrc: 0,
  };

  /** Content/game name for discovery */
  private contentName = 'Unknown Game';

  /** Reads the core's current battery RAM for the SYNC payload */
  private sramProvider: (() => Uint8Array | null) | null = null;

  /** Server player's input for current frame */
  private serverInput: number[] = [];

  /** Is the server running? */
  private _running = false;

  /** Flag to send savestate in next postFrame (per RetroArch protocol) */
  private forceSendSavestate = false;

  /** Flag to broadcast a core reset at the next frame boundary */
  private pendingReset = false;

  /** Periodic latency ping timer */
  private pingTimer: NodeJS.Timeout | null = null;

  /** Frame number when last desync recovery was triggered (for cooldown) */
  private lastRecoveryFrame = -Infinity;

  /** Current frame number */
  private _currentFrame = 0;

  /** Is the game paused? */
  private _isPaused = false;

  /** Who paused the game (nickname) */
  private _pausedBy = '';

  constructor(options: Partial<NetplayServerOptions> = {}) {
    super();

    this.config = {
      port: options.port ?? DEFAULT_PORT,
      password: options.password ?? '',
      maxClients: Math.min(options.maxClients ?? MAX_CLIENTS, MAX_CLIENTS),
      inputDelayFrames: options.inputDelayFrames ?? 0,
      requirePassword: options.requirePassword ?? !!options.password,
      nickname: options.nickname ?? 'Server',
      analogEnabled: options.analogEnabled ?? true,
    };

    // Create sync manager (server is client 0)
    // Server is authoritative - doesn't stall waiting for client input
    this.syncManager = createSyncManager({
      localClientId: 0,
      inputDelayFrames: this.config.inputDelayFrames,
      isServer: true,
    });
  }

  /** Is the server running? */
  get running(): boolean {
    return this._running;
  }

  /** Get current frame number */
  get currentFrame(): number {
    return this._currentFrame;
  }

  /** Is the game paused? */
  get isPaused(): boolean {
    return this._isPaused;
  }

  /** Who paused the game (nickname, empty if not paused) */
  get pausedBy(): string {
    return this._pausedBy;
  }

  /** Get all connected client sessions */
  get sessions(): ReadonlyMap<number, ClientSession> {
    return this.clients;
  }

  /** Get the sync manager */
  getSyncManager(): SyncManager {
    return this.syncManager;
  }

  /**
   * Request a synchronized core reset. Broadcast to all clients at the
   * next frame boundary (resets are server-frame-synchronized events);
   * the 'reset' event fires with the frame at which the host core should
   * reset too.
   */
  requestReset(): void {
    this.pendingReset = true;
  }

  /**
   * Provide the core's battery RAM for SYNC payloads. Read at handshake
   * time so joining clients receive the host's current save data.
   */
  setSramProvider(provider: () => Uint8Array | null): void {
    this.sramProvider = provider;
  }

  /** Get the number of connected clients (including server as player 1) */
  getClientCount(): number {
    // Count server + connected clients who are playing
    let count = 1;  // Server is always player 1
    for (const session of this.clients.values()) {
      if (session.isPlaying) {
        count++;
      }
    }
    return count;
  }

  /** Check if LAN discovery broadcasting is active */
  isDiscoveryActive(): boolean {
    return this.discoveryBroadcaster?.isRunning() ?? false;
  }

  /**
   * Set core information for handshake and discovery.
   */
  setCoreInfo(coreName: string, coreVersion: string, contentCrc: number, contentName?: string): void {
    this.coreInfo = { coreName, coreVersion, contentCrc };
    if (contentName) {
      this.contentName = contentName;
    }

    // Update discovery broadcaster if already running
    if (this.discoveryBroadcaster) {
      this.discoveryBroadcaster.updateSessionInfo({
        coreName,
        coreVersion,
        contentCrc,
        contentName: contentName ?? this.contentName,
      });
    }
  }

  /**
   * Start the netplay server.
   */
  async start(): Promise<void> {
    if (this._running) {
      throw new NetplayError('ALREADY_RUNNING');
    }

    // Start session logging
    netplayLogger.startSession({
      nickname: this.config.nickname,
      mode: 'host',
      port: this.config.port,
    });

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleNewConnection(socket);
      });

      this.server.on('error', (err) => {
        netplayLogger.serverError(`Server error: ${err.message}`);
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.config.port, () => {
        this._running = true;
        this.syncManager.initialize(0);

        netplayLogger.serverStarted(this.config.port, this.config.nickname, this.config.requirePassword);

        // Start LAN discovery broadcaster
        this.discoveryBroadcaster = new DiscoveryBroadcaster({
          port: this.config.port,
          nickname: this.config.nickname,
          coreName: this.coreInfo.coreName,
          coreVersion: this.coreInfo.coreVersion,
          contentName: this.contentName,
          contentCrc: this.coreInfo.contentCrc,
          hasPassword: this.config.requirePassword,
          hasSpectatePassword: false,
        });
        this.discoveryBroadcaster.start();

        // Refresh per-client latency measurements periodically
        this.pingTimer = setInterval(() => {
          for (const session of this.clients.values()) {
            if (session.syncSent) {
              this.pingSession(session);
            }
          }
        }, PING_INTERVAL_MS);
        this.pingTimer.unref();

        this.emit('started');
        resolve();
      });
    });
  }

  /**
   * Stop the netplay server.
   */
  stop(): void {
    if (!this._running) {
      return;
    }

    this._running = false;
    this.lastRecoveryFrame = -Infinity;

    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    // Stop LAN discovery broadcaster
    if (this.discoveryBroadcaster) {
      this.discoveryBroadcaster.stop();
      this.discoveryBroadcaster = null;
    }

    // Disconnect all clients
    for (const session of this.clients.values()) {
      session.connection.close('server stopped');
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    netplayLogger.serverStopped();
    netplayLogger.endSession('Server stopped');
    this.emit('stopped');
  }

  /**
   * Kick a client.
   */
  kick(clientId: number, reason = 'Kicked by server'): void {
    const session = this.clients.get(clientId);
    if (!session) {
      return;
    }

    // Send disconnect command before closing
    const disconnectCmd = encodeCommand(NetplayCmd.DISCONNECT, Buffer.alloc(0));
    session.connection.send(disconnectCmd);

    this.disconnectClient(session, reason);
  }

  /**
   * Called before running a frame.
   * Processes incoming input and prepares merged input.
   * shouldCatchUp indicates we're behind and should disable frame limiter.
   */
  preFrame(localInput: number[]): { input: number[]; shouldStall: boolean; shouldCatchUp: boolean } | null {
    this.serverInput = [...localInput];

    // Let sync manager prepare the frame
    return this.syncManager.preFrame(localInput);
  }

  /**
   * Called after running a frame.
   * Broadcasts input to all clients.
   */
  postFrame(serializedState: Buffer, crcBasis?: Uint8Array): void {
    this._currentFrame++;

    // Store state in sync manager
    this.syncManager.postFrame(serializedState, crcBasis);

    // Broadcast our INPUT for this frame first: it is the synchronization
    // point — RetroArch clients advance their tracked server frame on it,
    // and every join/savestate event below is tagged for the NEXT frame
    this.broadcastServerInput();

    // Announce deferred joins at the frame boundary (after our INPUT for
    // this frame, before our INPUT for the next), so the join frame equals
    // each client's tracked server frame
    this.processPendingJoins();

    // Broadcast a pending core reset at the same boundary: RetroArch
    // clients require the reset frame to equal their tracked server frame
    if (this.pendingReset) {
      this.pendingReset = false;
      const resetFrame = this._currentFrame + 1;
      const resetCmd = buildResetCommand(resetFrame);
      for (const session of this.clients.values()) {
        if (session.syncSent) {
          session.connection.send(resetCmd);
        }
      }
      netplayLogger.info('SERVER', `Broadcast core reset at frame ${resetFrame}`);
      this.emit('reset', resetFrame);
    }

    // Handle deferred savestate sending (per RetroArch protocol). The
    // state captured after this frame is the state at the START of the
    // next frame, which is also what its LOAD_SAVESTATE tag says
    if (this.forceSendSavestate) {
      this.broadcastSavestate(serializedState);
      this.forceSendSavestate = false;
    }

    // Stall clients that have run too far ahead of us (RetroArch rule:
    // more than 3 frames ahead, throttled to one STALL per 120 frames)
    this.stallRunawayClients();

    // Send CRC check periodically
    if (this.syncManager.shouldSendCrc()) {
      this.broadcastCrc();
    }

    // Check for rollback
    this.syncManager.performRollbackIfNeeded();
  }

  /**
   * Broadcast current savestate to all connected clients.
   * Called when forceSendSavestate flag is set.
   */
  private broadcastSavestate(state: Buffer): void {
    // The state was captured AFTER running _currentFrame, and the
    // LOAD_SAVESTATE frame number is the frame the client should START
    // running (RetroArch serializes at frame start, so post-frame-N here
    // is start-of-frame-N+1 in protocol terms). Tagging _currentFrame
    // instead put the client one emulated frame ahead of the server at
    // every frame label, failing every CRC check.
    const frame = this._currentFrame + 1;

    netplayLogger.debug('SERVER', `Broadcasting savestate to all clients`, {
      frame,
      stateSize: state.length,
      clientCount: this.clients.size,
    });

    for (const session of this.clients.values()) {
      if (session.syncSent) {
        // Use client's protocol version to determine format
        const loadCmd = buildLoadSavestateCommand(frame, state, session.protocolVersion);
        session.connection.send(loadCmd);

        netplayLogger.debug('SERVER', `Sent LOAD_SAVESTATE to client ${session.clientId}`, {
          frame,
          stateSize: state.length,
          clientProtocolVersion: session.protocolVersion,
        });
      }
    }
  }

  /**
   * Handle a new TCP connection.
   */
  private handleNewConnection(socket: Socket): void {
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    const remotePort = socket.remotePort ?? 0;

    // Find available client ID
    const clientId = this.findAvailableClientId();
    if (clientId < 0) {
      // No slots available
      netplayLogger.warn('SERVER', `Connection rejected from ${remoteAddress}:${remotePort} - no slots available`);
      socket.end();
      return;
    }

    netplayLogger.connectionAttempt(clientId, remoteAddress, remotePort);

    const connection = NetplayConnection.fromSocket(socket, clientId);
    const now = Date.now();
    const session: ClientSession = {
      clientId,
      connection,
      nickname: '',
      state: ConnectionState.CONNECTED,
      isPlaying: false,
      deviceIndices: [],
      lastInputFrame: -1,
      lastActivity: now,
      connectedAt: now,
      handshakeSteps: [],
      syncFrame: 0,
      protocolVersion: 0,
      modeSent: false,
      salt: 0,
      syncSent: false,
      pendingJoin: false,
      lastStallFrame: -Infinity,
      pingSentAt: null,
      latency: null,
    };

    this.clients.set(clientId, session);

    connection.on('disconnected', (reason: string) => {
      this.disconnectClient(session, reason);
    });

    connection.on('error', (err: Error) => {
      netplayLogger.serverError(`Connection error for client ${clientId}`, { error: err.message });
      this.disconnectClient(session, `Connection error: ${err.message}`);
    });

    // Perform header exchange asynchronously
    this.performHeaderExchange(session).catch((err: unknown) => {
      const errorMsg = getErrorMessage(err);
      netplayLogger.serverError(`Header exchange failed for client ${clientId}`, { error: errorMsg });
      this.disconnectClient(session, `Header exchange failed: ${errorMsg}`);
    });
  }

  /**
   * Perform the header exchange with a client.
   *
   * Handshake flow per RetroArch docs:
   * 1. Both: Send/receive connection header
   * 2. Both: Send/receive NICK
   * 3. Server: Receive PASSWORD (if required)
   * 4. Server: Send INFO
   * 5. Server: Receive INFO
   * 6. Server: Send SYNC (after client sends PLAY/SPECTATE)
   */
  private async performHeaderExchange(session: ClientSession): Promise<void> {
    const { connection, clientId } = session;

    // Step 1a: Send our connection header
    netplayLogger.debug('SERVER', `Sending connection header to client ${clientId}`, {
      nickname: this.config.nickname,
    });
    // Send header with salt=0 if no password required. The salt is stored
    // per session because the client hashes sha256(saltHex + password) and
    // we must verify against the exact salt this connection was given.
    session.salt = this.config.requirePassword ? this.generateSalt() : 0;
    connection.sendHeader(this.config.nickname, true, session.salt);

    // Step 1b: Wait for client's header
    netplayLogger.debug('SERVER', `Waiting for header from client ${clientId}`);
    const clientHeader = await connection.waitForHeader();

    if (!clientHeader) {
      throw new NetplayError('INVALID_HEADER', 'Invalid or missing client header');
    }

    // Store nickname from header (may be overwritten by NICK command later)
    session.nickname = clientHeader.nickname || 'unknown';
    session.handshakeSteps.push('header-received');

    // For CLIENT headers, field4 contains the protocol version
    // (For server headers, field4 would be the salt for password auth)
    const clientProtocolVersion = clientHeader.field4;
    session.protocolVersion = clientProtocolVersion;

    // Platform magic contains platform info, not protocol version for clients
    const { sizeOfSizeT } = parsePlatformMagic(clientHeader.platformMagic);

    // Log detailed header parsing for debugging
    const platformMagicHex = clientHeader.platformMagic.toString(HEX_RADIX).padStart(HEX_PADDING_WIDTH_32, '0');
    netplayLogger.debug('SERVER', `Header received from client ${clientId}`, {
      nickname: clientHeader.nickname,
      platformMagicRaw: clientHeader.platformMagic,
      platformMagicHex: `0x${platformMagicHex}`,
      protocolVersion: clientProtocolVersion,
      sizeOfSizeT,
      compression: clientHeader.compression,
    });

    // Set up command handlers for the handshake phase
    connection.on('rawCommand', (cmd) => {
      netplayLogger.debug('SERVER', `Raw command from client ${clientId}`, {
        cmd: cmd.cmd,
        cmdHex: `0x${cmd.cmd.toString(HEX_RADIX).padStart(HEX_PADDING_WIDTH, '0')}`,
        payloadSize: cmd.payload.length,
      });
    });

    connection.on('command', (cmd: ParsedCommand) => {
      this.handleClientCommand(session, cmd);
    });

    // Step 2a: Send our NICK (before sending INFO, per protocol spec)
    netplayLogger.debug('SERVER', `Sending NICK to client ${clientId}`, {
      nickname: this.config.nickname,
    });
    connection.send(buildNickCommand(this.config.nickname));
    session.handshakeSteps.push('sent-nick');

    // INFO is sent after receiving client's NICK (in handleNick)
    // This follows the documented handshake order

    // Process any commands that arrived with the header
    connection.processBuffer();
  }

  /**
   * Handle a command from a client.
   */
  private handleClientCommand(session: ClientSession, cmd: ParsedCommand): void {
    session.lastActivity = Date.now();

    if (!isKnownCommand(cmd)) {
      return;
    }

    switch (session.state) {
      case ConnectionState.CONNECTED:
      case ConnectionState.HANDSHAKING:
        this.handleHandshakeCommand(session, cmd);
        break;
      case ConnectionState.PLAYING:
      case ConnectionState.SPECTATING:
        this.handlePlayingCommand(session, cmd);
        break;
    }
  }

  /**
   * Handle a handshake command.
   */
  private handleHandshakeCommand(session: ClientSession, cmd: KnownCommand): void {
    switch (cmd.cmd) {
      case NetplayCmd.NICK:
        this.handleNick(session, cmd);
        break;

      case NetplayCmd.PASSWORD:
        this.handlePassword(session, cmd);
        break;

      case NetplayCmd.INFO:
        this.handleInfo(session, cmd);
        break;

      case NetplayCmd.PLAY:
        this.handlePlayRequest(session);
        break;

      case NetplayCmd.SPECTATE:
        this.handleSpectateRequest(session);
        break;

      case NetplayCmd.PING_REQUEST:
        // Respond to ping during handshake too
        session.connection.send(buildPingResponseCommand());
        break;
    }
  }

  /**
   * Handle NICK command.
   * After receiving client NICK, we send INFO (per protocol spec).
   */
  private handleNick(session: ClientSession, cmd: NickCommand): void {
    session.nickname = cmd.nickname;
    session.state = ConnectionState.HANDSHAKING;
    session.handshakeSteps.push('received-nick');

    netplayLogger.handshakeStep(session.clientId, 'NICK received', { nickname: cmd.nickname });

    // Step 4: After receiving NICK, send INFO (per protocol spec)
    // We already sent our NICK in performHeaderExchange, so don't send it again
    session.connection.send(
      buildInfoCommand(this.coreInfo.coreName, this.coreInfo.coreVersion, this.coreInfo.contentCrc)
    );
    session.handshakeSteps.push('sent-info');

    netplayLogger.debug('SERVER', `Sent INFO to client ${session.clientId}`, {
      coreName: this.coreInfo.coreName,
      contentCrc: this.coreInfo.contentCrc.toString(HEX_RADIX),
    });
  }

  /**
   * Handle PASSWORD command.
   */
  private handlePassword(session: ClientSession, cmd: PasswordCommand): void {
    session.handshakeSteps.push('PASSWORD');

    if (!this.config.requirePassword) {
      netplayLogger.handshakeStep(session.clientId, 'PASSWORD received (not required)');
      return;
    }

    // Verify against the salt this connection's header carried
    const expectedHash = hashPassword(this.config.password, session.salt);
    const success = cmd.passwordHash === expectedHash;
    netplayLogger.passwordAuth(session.clientId, success);

    if (!success) {
      // Invalid password - disconnect
      netplayLogger.handshakeFailed(session.clientId, 'Invalid password');
      notifyNetplayConnectionFailed(session.nickname || 'Client', 'Invalid password');
      this.disconnectClient(session, 'Invalid password');
    }
  }

  /**
   * Handle INFO command from client.
   * At this point we've already sent our INFO (after receiving NICK),
   * so we just validate the client's info matches ours.
   */
  private handleInfo(session: ClientSession, cmd: InfoCommand): void {
    session.handshakeSteps.push('received-info');

    netplayLogger.handshakeStep(session.clientId, 'INFO received', {
      coreName: cmd.coreName,
      contentCrc: cmd.contentCrc.toString(HEX_RADIX),
    });

    // Validate core/content match
    if (cmd.coreName !== this.coreInfo.coreName) {
      netplayLogger.mismatch(session.clientId, 'core', this.coreInfo.coreName, cmd.coreName);
      netplayLogger.handshakeFailed(session.clientId, `Core mismatch: ${cmd.coreName} vs ${this.coreInfo.coreName}`);
      notifyNetplayConnectionFailed(session.nickname || 'Client', `Wrong core: ${cmd.coreName}`);
      this.disconnectClient(session, `Core mismatch: ${cmd.coreName} vs ${this.coreInfo.coreName}`);
      return;
    }

    if (cmd.contentCrc !== this.coreInfo.contentCrc) {
      netplayLogger.mismatch(session.clientId, 'crc', this.coreInfo.contentCrc, cmd.contentCrc);
      netplayLogger.handshakeFailed(session.clientId, 'Content CRC mismatch');
      notifyNetplayConnectionFailed(session.nickname || 'Client', 'ROM mismatch');
      this.disconnectClient(session, 'Content CRC mismatch');
      return;
    }

    netplayLogger.handshakeStep(session.clientId, 'INFO validated - core and CRC match');

    // Per protocol: Server sends SYNC immediately after INFO exchange
    // Store the frame number used in SYNC so MODE can use frame+1
    session.handshakeSteps.push('info-validated');

    // Send SYNC with SRAM (not full save state - that's what LOAD_SAVESTATE is for)
    // SYNC synchronizes SRAM and assigns the client number
    this.sendSyncToClient(session);
    session.handshakeSteps.push('sent-sync');

    netplayLogger.handshakeStep(session.clientId, 'SYNC sent - awaiting PLAY/SPECTATE');
  }

  /**
   * Handle PLAY request.
   *
   * Flow:
   * 1. Send MODE to confirm player assignment
   * 2. Queue savestate to be sent on next frame (proactive, like RetroArch)
   * 3. Also handle REQUEST_SAVESTATE for mid-game resyncs
   *
   * Per RetroArch protocol: the server sends LOAD_SAVESTATE automatically
   * after a client joins, without waiting for REQUEST_SAVESTATE.
   */
  private handlePlayRequest(session: ClientSession): void {
    session.handshakeSteps.push('PLAY');
    netplayLogger.handshakeStep(session.clientId, 'PLAY request received');

    // Assign device indices
    const deviceIndex = this.findAvailableDeviceIndex();
    if (deviceIndex < 0) {
      // No device slots available - refuse with MODE showing not playing
      netplayLogger.warn('SERVER', `PLAY request rejected for client ${session.clientId} - no device slots`, {
        nickname: session.nickname,
      });
      notifyNetplayConnectionFailed(session.nickname || 'Client', 'Game is full');
      session.connection.send(
        buildModeCommand(this._currentFrame, true, false, false, session.clientId, 0, [], session.nickname)
      );
      return;
    }

    session.deviceIndices = [deviceIndex];
    session.isPlaying = true;
    session.state = ConnectionState.PLAYING;

    // Register with sync manager
    this.syncManager.addRemoteClient(session.clientId, session.deviceIndices);

    // Device bitmap: set the bit for the assigned device
    const deviceBitmap = 1 << deviceIndex;

    // Defer the MODE announcement to the next frame boundary: RetroArch
    // clients require the join frame to equal their tracked server frame,
    // which only holds when MODE is sent right after our INPUT for the
    // current frame (the synchronization point). The proactive savestate
    // (RetroArch sends LOAD_SAVESTATE without waiting for
    // REQUEST_SAVESTATE) goes out at the same boundary.
    session.pendingJoin = true;
    this.forceSendSavestate = true;

    netplayLogger.debug('SERVER', `Queued MODE + LOAD_SAVESTATE for client ${session.clientId}`, {
      currentFrame: this._currentFrame,
      deviceBitmap,
    });

    netplayLogger.clientConnected(session.clientId, session.nickname, true, deviceIndex);

    // Notify user about new player (deviceIndex + 1 because server is player 1)
    notifyNetplayClientConnected(session.nickname, deviceIndex + 1);

    this.emit('client-connected', session);
    this.emit('client-playing', session);
  }

  /**
   * Handle SPECTATE request.
   */
  private handleSpectateRequest(session: ClientSession): void {
    session.handshakeSteps.push('SPECTATE');
    netplayLogger.handshakeStep(session.clientId, 'SPECTATE request received');

    session.isPlaying = false;
    session.state = ConnectionState.SPECTATING;

    // MODE frame must match SYNC frame (client's server_frame_count)
    const modeFrame = session.syncFrame;

    // Send MODE to client (YOU flag, no PLAYING flag)
    // Note: SYNC was already sent after INFO exchange
    session.connection.send(
      buildModeCommand(modeFrame, true, false, false, session.clientId, 0, [], session.nickname)
    );

    // Notify user about new spectator
    notifyNetplaySpectatorConnected(session.nickname);

    netplayLogger.clientConnected(session.clientId, session.nickname, false, -1);

    this.emit('client-connected', session);
  }

  /**
   * Send SYNC command to a client.
   * Per protocol, SYNC sends SRAM (battery save), not full save state.
   * Full save states are sent via LOAD_SAVESTATE when needed.
   */
  private sendSyncToClient(session: ClientSession): void {
    const frame = this._currentFrame;
    const devices = this.buildDeviceArray();
    const deviceClients = this.buildDeviceClientsArray();
    const shareModes = new Array<number>(MAX_INPUT_DEVICES).fill(0);

    // SYNC carries SRAM (battery-backed save RAM), not a full save state.
    // Joining with different local save data would diverge immediately.
    const providedSram = this.sramProvider?.();
    const sram = providedSram ? Buffer.from(providedSram) : Buffer.alloc(0);

    // Store frame for MODE command (MODE uses syncFrame + 1)
    session.syncFrame = frame;

    netplayLogger.debug('SERVER', `Sending SYNC to client ${session.clientId}`, {
      frame,
      clientNumber: session.clientId,
      sramSize: sram.length,
      devices: devices.filter(d => d !== 0),
      deviceClients: deviceClients.filter(d => d !== 0),
    });

    const syncCmd = buildSyncCommand(
      frame,
      false, // paused
      session.clientId, // client number being assigned
      devices,
      shareModes,
      deviceClients,
      session.nickname || this.config.nickname,
      sram
    );

    session.connection.send(syncCmd);
    const syncHex = syncCmd.subarray(0, Math.min(HEX_PREVIEW_LENGTH, syncCmd.length)).toString('hex');
    netplayLogger.debug('SERVER', `SYNC command hex (first ${HEX_PREVIEW_LENGTH} bytes)`, {
      cmdHex: syncHex + (syncCmd.length > HEX_PREVIEW_LENGTH ? '...' : ''),
      totalSize: syncCmd.length,
    });

    // Send SETTING commands after SYNC (per reference capture)
    // SETTING_ALLOW_PAUSING: 0 = pausing disabled
    const pauseCmd = buildSettingAllowPausingCommand(false);
    session.connection.send(pauseCmd);

    // SETTING_INPUT_LATENCY_FRAMES: frames=0, range=0 (no input latency)
    const latencyCmd = buildSettingInputLatencyFramesCommand(0, 0);
    session.connection.send(latencyCmd);

    netplayLogger.debug('SERVER', `Sent SETTING commands to client ${session.clientId}`, {
      allowPausing: false,
      inputLatencyFrames: 0,
      pauseCmdHex: pauseCmd.toString('hex'),
      latencyCmdHex: latencyCmd.toString('hex'),
    });

    // Send INPUT for the SYNC frame (per reference capture analysis)
    // This INPUT at frame 1512 (SYNC frame) appears BEFORE the client sends PLAY
    const syncInputCmd = this.config.analogEnabled
      ? buildInputCommand(frame, 0, true, 0, 1, 0, 0) // 3 words for ANALOG
      : buildInputCommand(frame, 0, true, 0, 1);
    session.connection.send(syncInputCmd);

    netplayLogger.debug('SERVER', `Sent INPUT for SYNC frame to client ${session.clientId}`, {
      frame,
      inputCmdHex: syncInputCmd.toString('hex'),
    });

    // From here on this session receives the per-frame server input stream,
    // continuing consecutively from the SYNC-frame INPUT above
    session.syncSent = true;

    // First latency ping right away; the periodic timer keeps it fresh
    this.pingSession(session);
  }

  /** Send a latency ping to a session if none is outstanding */
  private pingSession(session: ClientSession): void {
    if (session.pingSentAt !== null) {
      return;
    }
    session.pingSentAt = Date.now();
    session.connection.send(buildPingRequestCommand());
  }

  /**
   * Build controller-client mapping array for SYNC command.
   * Each entry maps a device index to the client bitmap using it.
   */
  private buildDeviceClientsArray(): number[] {
    const deviceClients: number[] = new Array<number>(MAX_INPUT_DEVICES).fill(0);
    // Server (client 0) uses device 0
    deviceClients[0] = 1 << 0;

    for (const session of this.clients.values()) {
      if (session.isPlaying) {
        for (const deviceIdx of session.deviceIndices) {
          if (deviceIdx >= 0 && deviceIdx < MAX_INPUT_DEVICES) {
            deviceClients[deviceIdx] |= 1 << session.clientId;
          }
        }
      }
    }

    return deviceClients;
  }

  /**
   * Handle a command from a playing client.
   */
  private handlePlayingCommand(session: ClientSession, cmd: KnownCommand): void {
    netplayLogger.debug('SERVER', `Playing command from client ${session.clientId}`, {
      cmd: cmd.cmd,
      cmdHex: `0x${cmd.cmd.toString(HEX_RADIX).padStart(HEX_PADDING_WIDTH, '0')}`,
    });

    switch (cmd.cmd) {
      case NetplayCmd.INPUT:
        this.handleClientInput(session, cmd);
        break;

      case NetplayCmd.NOINPUT:
        // Client indicates no input for a frame - just acknowledge
        netplayLogger.debug('SERVER', `NOINPUT from client ${session.clientId}`);
        break;

      case NetplayCmd.DISCONNECT:
        this.disconnectClient(session, 'Client disconnected');
        break;

      case NetplayCmd.CRC:
        this.handleClientCrc(session, cmd);
        break;

      case NetplayCmd.PING_REQUEST:
        // Respond to ping immediately to keep connection alive
        netplayLogger.debug('SERVER', `PING_REQUEST from client ${session.clientId}, sending response`);
        session.connection.send(buildPingResponseCommand());
        break;

      case NetplayCmd.PING_RESPONSE:
        if (session.pingSentAt !== null) {
          session.latency = Date.now() - session.pingSentAt;
          session.pingSentAt = null;
        }
        break;

      case NetplayCmd.REQUEST_SAVESTATE:
        // Client requests savestate - send immediately to prevent timeout
        // Note: RetroArch defers this to next frame, but clients may timeout
        // if the emulator isn't running frames quickly enough
        this.handleRequestSavestate(session);
        break;

      case NetplayCmd.NAK:
        // Client rejected something we sent (e.g., LOAD_SAVESTATE failed validation)
        netplayLogger.error('SERVER', `NAK received from client ${session.clientId} - client rejected a command`);
        break;

      case NetplayCmd.ACK:
        // Client acknowledged a command
        netplayLogger.debug('SERVER', `ACK received from client ${session.clientId}`);
        break;

      case NetplayCmd.PAUSE:
        this.handlePause(session, cmd);
        break;

      case NetplayCmd.RESUME:
        this.handleResume(session);
        break;

      case NetplayCmd.PLAYER_CHAT:
        this.handlePlayerChat(session, cmd);
        break;

      default:
        netplayLogger.warn('SERVER', `Unhandled playing command from client ${session.clientId}`, {
          cmd: cmd.cmd,
          cmdHex: `0x${cmd.cmd.toString(HEX_RADIX).padStart(HEX_PADDING_WIDTH, '0')}`,
        });
        break;
    }
  }

  /**
   * Handle REQUEST_SAVESTATE from client.
   *
   * This is used for mid-game resyncs (e.g., after desync detection).
   * Initial sync is handled proactively in handlePlayRequest().
   *
   * Defer to next frame like RetroArch does - set flag to send in postFrame.
   */
  private handleRequestSavestate(session: ClientSession): void {
    netplayLogger.debug('SERVER', `REQUEST_SAVESTATE from client ${session.clientId} (resync request)`, {
      syncFrame: session.syncFrame,
      currentFrame: this._currentFrame,
    });

    this.triggerDesyncRecovery(this._currentFrame, 'client-request');
  }

  /**
   * Handle CRC command from client.
   * Compares the client's CRC against server's CRC for the same frame
   * and triggers desync recovery if they don't match.
   */
  private handleClientCrc(session: ClientSession, cmd: CrcCommand): void {
    netplayLogger.debug('SERVER', `CRC from client ${session.clientId}`, {
      frame: cmd.frameNumber,
      clientCrc: cmd.crc.toString(HEX_RADIX),
    });

    const localCrc = this.syncManager.getCrcForFrame(cmd.frameNumber);
    if (localCrc === null) {
      return;
    }

    if (localCrc !== cmd.crc) {
      netplayLogger.desyncDetected(cmd.frameNumber, localCrc, cmd.crc);
      this.emit('desync', session.clientId, cmd.frameNumber);
      this.triggerDesyncRecovery(cmd.frameNumber, 'client-request');
    }
  }

  /**
   * Trigger desync recovery by sending a fresh savestate to all clients.
   * Rate-limited by DESYNC_RECOVERY_COOLDOWN_FRAMES to avoid flooding.
   */
  private triggerDesyncRecovery(frameNumber: number, trigger: 'server' | 'client-request'): void {
    if (this._currentFrame - this.lastRecoveryFrame < DESYNC_RECOVERY_COOLDOWN_FRAMES) {
      netplayLogger.debug('SERVER', `Desync recovery skipped (cooldown)`, {
        frame: frameNumber,
        lastRecovery: this.lastRecoveryFrame,
        cooldown: DESYNC_RECOVERY_COOLDOWN_FRAMES,
      });
      return;
    }

    this.forceSendSavestate = true;
    this.lastRecoveryFrame = this._currentFrame;
    netplayLogger.desyncRecovery(frameNumber, trigger);
  }

  /**
   * Handle INPUT command from client.
   */
  private handleClientInput(session: ClientSession, cmd: InputCommand): void {
    if (!session.isPlaying) {
      netplayLogger.debug('SERVER', `Ignoring INPUT from non-playing client ${session.clientId}`);
      return;
    }

    session.lastInputFrame = cmd.frameNumber;

    netplayLogger.debug('SERVER', `Processing INPUT from client ${session.clientId}`, {
      clientFrame: cmd.frameNumber,
      serverFrame: this._currentFrame,
      frameDiff: cmd.frameNumber - this._currentFrame,
      joypad: cmd.joypadState,
    });

    // Feed to sync manager
    const input = [cmd.joypadState, cmd.analogLeft ?? 0, cmd.analogRight ?? 0];
    this.syncManager.receiveRemoteInput(session.clientId, cmd.frameNumber, input);

    // Relay to other clients
    this.relayInput(session, cmd);
  }

  /**
   * Handle PAUSE command from client.
   * Broadcasts pause to all other clients.
   */
  private handlePause(session: ClientSession, cmd: PauseCommand): void {
    // Use the nickname from the command, or fall back to session nickname
    const nickname = cmd.nickname || session.nickname;

    netplayLogger.info('SERVER', `Game paused by ${nickname}`);

    this._isPaused = true;
    this._pausedBy = nickname;

    // Broadcast pause to all other clients
    const pauseCmd = buildPauseCommand(nickname);
    for (const [clientId, clientSession] of this.clients) {
      if (clientId !== session.clientId) {
        clientSession.connection.send(pauseCmd);
      }
    }

    this.emit('paused', nickname);
  }

  /**
   * Handle RESUME command from client.
   * Broadcasts resume to all other clients.
   */
  private handleResume(session: ClientSession): void {
    netplayLogger.info('SERVER', `Game resumed by ${session.nickname}`);

    this._isPaused = false;
    this._pausedBy = '';

    // Broadcast resume to all other clients
    const resumeCmd = buildResumeCommand();
    for (const [clientId, clientSession] of this.clients) {
      if (clientId !== session.clientId) {
        clientSession.connection.send(resumeCmd);
      }
    }

    this.emit('resumed');
  }

  /**
   * Handle PLAYER_CHAT command from client.
   * Broadcasts chat message to all other clients.
   */
  private handlePlayerChat(session: ClientSession, cmd: PlayerChatCommand): void {
    // Use session nickname if command nickname is empty
    const nickname = cmd.nickname || session.nickname;
    netplayLogger.info('SERVER', `Chat from ${nickname}: ${cmd.message}`);

    // Broadcast chat to all other clients
    const chatCmd = buildPlayerChatCommand(nickname, cmd.message);
    for (const [clientId, clientSession] of this.clients) {
      if (clientId !== session.clientId) {
        clientSession.connection.send(chatCmd);
      }
    }

    this.emit('chat', nickname, cmd.message);
  }

  /**
   * Relay input from one client to all others.
   */
  private relayInput(source: ClientSession, cmd: InputCommand): void {
    // Build device bitmap from client's assigned device indices
    const deviceBitmap = source.deviceIndices.reduce((acc, idx) => acc | (1 << idx), 0);

    const inputCmd = buildInputCommand(
      cmd.frameNumber,
      source.clientId,
      false, // Not server data
      cmd.joypadState,
      deviceBitmap,
      cmd.analogLeft,
      cmd.analogRight
    );

    let relayCount = 0;
    for (const [clientId, session] of this.clients) {
      // Send to every synced session (players, spectators, and clients
      // still deciding) so their input streams stay complete
      if (clientId !== source.clientId && session.syncSent) {
        session.connection.send(inputCmd);
        relayCount++;
      }
    }

    // Log relay activity periodically to avoid spam
    if (cmd.frameNumber % SERVER_INPUT_LOG_INTERVAL_FRAMES === 0) {
      netplayLogger.debug('SERVER', `Relayed input from client ${source.clientId}`, {
        frame: cmd.frameNumber,
        joypadState: cmd.joypadState,
        recipients: relayCount,
        hasAnalog: cmd.analogLeft !== undefined || cmd.analogRight !== undefined,
      });
    }
  }

  /**
   * Broadcast server's input to all clients.
   */
  private broadcastServerInput(): void {
    // Server uses device 0 (bitmap = 1). ANALOG ports send exactly 3 input
    // words (joypad + 2 sticks) — RetroArch validates the size per device
    const inputCmd = this.config.analogEnabled
      ? buildInputCommand(
          this._currentFrame,
          0, // Server is client 0
          true, // Is server data
          this.serverInput[0] ?? 0,
          1,
          this.serverInput[1] ?? 0,
          this.serverInput[2] ?? 0
        )
      : buildInputCommand(
          this._currentFrame,
          0,
          true,
          this.serverInput[0] ?? 0,
          1
        );

    let sentCount = 0;
    for (const session of this.clients.values()) {
      // Every synced session gets the stream, including clients that have
      // not requested PLAY/SPECTATE yet — their tracked server frame must
      // keep advancing or later MODE/LOAD_SAVESTATE frames won't match
      if (session.syncSent) {
        session.connection.send(inputCmd);
        sentCount++;
      }
    }

    // Log periodically to avoid spam
    if (this._currentFrame % SERVER_INPUT_LOG_INTERVAL_FRAMES === 0 || sentCount > 0) {
      netplayLogger.debug('SERVER', `broadcastServerInput`, {
        frame: this._currentFrame,
        clientsCount: this.clients.size,
        sentCount,
      });
    }
  }

  /**
   * Broadcast CRC check to all clients.
   */
  private broadcastCrc(): void {
    const crc = this.syncManager.getCurrentCrc();
    if (crc === null) {
      return;
    }

    const crcCmd = buildCrcCommand(this._currentFrame, crc);

    for (const session of this.clients.values()) {
      if (session.state === ConnectionState.PLAYING) {
        session.connection.send(crcCmd);
      }
    }
  }

  /**
   * Broadcast mode change to all clients.
   */
  /**
   * Send STALL to playing clients running too far ahead of the server,
   * matching RetroArch's post-frame rule: stall count covers how far
   * ahead they are, throttled per client.
   */
  private stallRunawayClients(): void {
    for (const session of this.clients.values()) {
      if (!session.isPlaying) {
        continue;
      }
      const framesAhead = session.lastInputFrame - this._currentFrame;
      if (
        framesAhead > STALL_AHEAD_THRESHOLD_FRAMES &&
        session.lastStallFrame + STALL_MIN_INTERVAL_FRAMES < this._currentFrame
      ) {
        session.lastStallFrame = this._currentFrame;
        session.connection.send(buildStallCommand(framesAhead + 1));
        netplayLogger.debug('SERVER', `Sent STALL to client ${session.clientId}`, {
          framesAhead,
          stallFrames: framesAhead + 1,
        });
      }
    }
  }

  /**
   * Announce accepted PLAY requests at the frame boundary. Runs right
   * after this frame's server INPUT broadcast, so the join frame
   * (currentFrame + 1: the first frame the new player's input is
   * expected) equals every client's tracked server frame.
   */
  private processPendingJoins(): void {
    for (const session of this.clients.values()) {
      if (!session.pendingJoin) {
        continue;
      }
      session.pendingJoin = false;

      const joinFrame = this._currentFrame + 1;
      const deviceBitmap = session.deviceIndices.reduce((acc, idx) => acc | (1 << idx), 0);
      const modeCmd = buildModeCommand(
        joinFrame,
        true,
        true,
        false,
        session.clientId,
        deviceBitmap,
        [],
        session.nickname
      );
      session.connection.send(modeCmd);
      session.modeSent = true;

      netplayLogger.debug('SERVER', `Sent MODE to client ${session.clientId}`, {
        joinFrame,
        deviceBitmap,
      });

      // Notify other clients about the new player at the same join frame
      this.broadcastModeChange(session, joinFrame);
    }
  }

  private broadcastModeChange(changedSession: ClientSession, frame: number = this._currentFrame): void {
    const deviceBitmap = changedSession.deviceIndices.reduce((acc, idx) => acc | (1 << idx), 0);
    const modeCmd = buildModeCommand(
      frame,
      false, // Not "you" for other clients
      changedSession.isPlaying,
      false,
      changedSession.clientId,
      deviceBitmap,
      [],
      changedSession.nickname
    );

    for (const [clientId, session] of this.clients) {
      if (clientId !== changedSession.clientId) {
        session.connection.send(modeCmd);
      }
    }
  }

  /**
   * Disconnect a client.
   */
  private disconnectClient(session: ClientSession, reason: string): void {
    if (!this.clients.has(session.clientId)) {
      return;
    }

    const nickname = session.nickname || 'unknown';
    const wasConnected = session.state === ConnectionState.PLAYING || session.state === ConnectionState.SPECTATING;
    const connectedDuration = Date.now() - session.connectedAt;

    // Get human-readable state name
    const stateNames: Record<ConnectionState, string> = {
      [ConnectionState.DISCONNECTED]: 'DISCONNECTED',
      [ConnectionState.CONNECTED]: 'CONNECTED (no handshake started)',
      [ConnectionState.HANDSHAKING]: 'HANDSHAKING',
      [ConnectionState.PLAYING]: 'PLAYING',
      [ConnectionState.SPECTATING]: 'SPECTATING',
    };

    netplayLogger.clientDisconnected(session.clientId, nickname, reason, {
      state: stateNames[session.state],
      handshakeCompleted: wasConnected,
      commandsReceived: session.handshakeSteps.length > 0 ? session.handshakeSteps : ['none'],
      connectedDuration,
    });

    // Notify user about disconnection (only if they completed handshake)
    if (wasConnected && session.nickname) {
      notifyNetplayClientDisconnected(session.nickname);
    }

    this.clients.delete(session.clientId);
    session.connection.close(reason);

    // Remove from sync manager
    this.syncManager.removeRemoteClient(session.clientId);

    // Notify other clients that this player disconnected (not playing anymore)
    const modeCmd = buildModeCommand(
      this._currentFrame,
      false, // not "you" for other clients
      false, // not playing (disconnected)
      false, // not slave
      session.clientId,
      0, // no devices
      [],
      session.nickname
    );
    for (const otherSession of this.clients.values()) {
      otherSession.connection.send(modeCmd);
    }

    this.emit('client-disconnected', session, reason);
  }

  /**
   * Find an available client ID.
   */
  private findAvailableClientId(): number {
    // Server is always client 0
    for (let i = 1; i < this.config.maxClients; i++) {
      if (!this.clients.has(i)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Find an available device index.
   */
  private findAvailableDeviceIndex(): number {
    const usedDevices = new Set<number>([0]); // Server uses device 0

    for (const session of this.clients.values()) {
      for (const d of session.deviceIndices) {
        usedDevices.add(d);
      }
    }

    for (let i = 1; i < MAX_CLIENTS; i++) {
      if (!usedDevices.has(i)) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Build device array for SYNC command.
   * The devices array tells clients what TYPE of device is at each port (not who owns it).
   * We pre-configure devices for potential player ports so clients joining later can use them.
   */
  private buildDeviceArray(): number[] {
    const devices: number[] = new Array<number>(MAX_INPUT_DEVICES).fill(0);

    // Pre-configure devices for potential player ports
    // Device index 0 = Player 1 (server), Device index 1 = Player 2, etc.
    // We support up to maxClients + 1 players (server + clients)
    const maxPlayers = Math.min(this.config.maxClients + 1, MAX_INPUT_DEVICES);
    // ANALOG (a joypad plus two sticks, 3 input words) unless disabled;
    // plain JOYPAD ports (1 input word) cannot carry stick input at all
    const deviceType = this.config.analogEnabled ? RetroDevice.ANALOG : RetroDevice.JOYPAD;
    for (let i = 0; i < maxPlayers; i++) {
      devices[i] = deviceType;
    }

    return devices;
  }

  /**
   * Generate a random salt for password authentication.
   */
  private generateSalt(): number {
    // Generate a random non-zero 32-bit value
    // Use MASK_31BIT * 2 to get close to max uint32 while avoiding overflow
    const salt = Math.floor(Math.random() * (MASK_31BIT * 2)) + 1;
    return salt;
  }

  // Type-safe event emitter methods
  override on<K extends keyof ServerEvents>(event: K, listener: ServerEvents[K]): this {
    return super.on(event, listener);
  }

  override off<K extends keyof ServerEvents>(event: K, listener: ServerEvents[K]): this {
    return super.off(event, listener);
  }

  override emit<K extends keyof ServerEvents>(
    event: K,
    ...args: Parameters<ServerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create a new netplay server.
 */
export const createNetplayServer = (
  options?: Partial<NetplayServerOptions>
): NetplayServer => {
  return new NetplayServer(options);
};
