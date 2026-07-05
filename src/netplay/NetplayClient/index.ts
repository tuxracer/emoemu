/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

/**
 * NetplayClient - RetroArch-compatible netplay client
 *
 * Implements the client side of the netplay protocol:
 * - Connects to a netplay server
 * - Handles handshake (magic, nick, password, info, sync)
 * - Sends local input every frame
 * - Receives and buffers remote input
 * - Integrates with sync manager for rollback
 */

import { EventEmitter } from 'events';
import {
  DEFAULT_PORT,
  NetplayCmd,
  ConnectionState,
  ModeRefusedReason,
  RetroDevice,
  PING_INTERVAL_MS,
  HEX_RADIX,
  DESYNC_RECOVERY_COOLDOWN_FRAMES,
  HANDSHAKE_TIMEOUT_MS,
  NetplayError,
  isKnownCommand,
  type NetplayClientOptions,
  type ParsedCommand,
  type KnownCommand,
  type NickCommand,
  type InfoCommand,
  type SyncCommand,
  type ModeCommand,
  type ModeRefusedCommand,
  type InputCommand,
  type NoInputCommand,
  type CrcCommand,
  type LoadSavestateCommand,
  type PauseCommand,
  type PlayerChatCommand,
  type StallCommand,
  type ResetCommand,
  type SettingCommand,
  type RequestSavestateCommand,
} from '..';
import {
  buildNickCommand,
  buildPasswordCommand,
  buildInfoCommand,
  buildInputCommand,
  buildCrcCommand,
  buildPlayCommand,
  buildSpectateCommand,
  buildPingResponseCommand,
  buildPingRequestCommand,
  buildAckCommand,
  buildRequestSavestateCommand,
  hashPassword,
} from '../protocol';
import { NetplayConnection, createNetplayConnection } from '../NetplayConnection';
import { SyncManager, createSyncManager } from '../SyncManager';
import { netplayLogger } from '../netplayLogger';
import { getErrorMessage } from '../../utils/getErrorMessage';

/** Client events */
interface ClientEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  synced: (frameNumber: number) => void;
  'mode-changed': (playing: boolean, playerNumber: number) => void;
  'mode-refused': (reason: string) => void;
  'state-load': (frameNumber: number, state: Buffer) => void;
  'sram-load': (sram: Buffer) => void;
  'savestate-requested': () => void;
  desync: (frameNumber: number, localCrc: number, remoteCrc: number) => void;
  rollback: (frames: number) => void;
  paused: (by: string) => void;
  resumed: () => void;
  chat: (from: string, message: string) => void;
  error: (error: Error) => void;
  reset: (frameNumber: number) => void;
  'setting-changed': (setting: string, value: number) => void;
}

/** Server info received during handshake */
interface ServerInfo {
  coreName: string;
  coreVersion: string;
  contentCrc: number;
  nickname: string;
}

/**
 * NetplayClient handles connecting to and playing on a netplay server.
 */
export class NetplayClient extends EventEmitter {
  private connection: NetplayConnection | null = null;
  private readonly config: Required<NetplayClientOptions>;
  private readonly syncManager: SyncManager;

  /** Server info from handshake */
  private _serverInfo: ServerInfo | null = null;

  /** Local core info for validation */
  private coreInfo = {
    coreName: 'unknown',
    coreVersion: '',
    contentCrc: 0,
  };

  /** Client ID assigned by server */
  private _clientId = -1;

  /** Player number assigned by server (-1 if spectating) */
  private _playerNumber = -1;

  /** Are we currently playing (vs spectating)? */
  private _isPlaying = false;

  /** Is the game paused? */
  private _isPaused = false;

  /** Who paused the game */
  private _pausedBy = '';

  /** Device bitmap assigned to this client */
  private _deviceBitmap = 0;

  /** Controller device types per port, as declared by the server's SYNC */
  private syncDevices: number[] = [];

  /** Current frame number */
  private _currentFrame = 0;

  /** Server's frame count (for spectating, tracks NOINPUT frames) */
  private _serverFrame = 0;

  /** Local input for current frame */
  private localInput: number[] = [];

  /** Server setting: is pausing allowed? */
  private _allowPausing = true;

  /** Server setting: input latency frames */
  private _serverInputLatencyFrames = 0;

  /** Frame number when last desync recovery was requested (for cooldown) */
  private lastRecoveryRequestFrame = -Infinity;

  /** Measured round-trip latency in ms (null until the first ping returns) */
  private _latency: number | null = null;

  /** Timestamp of the outstanding ping request (null = none in flight) */
  private pingSentAt: number | null = null;

  /** Periodic ping timer */
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(options: Partial<NetplayClientOptions> = {}) {
    super();

    this.config = {
      host: options.host ?? 'localhost',
      port: options.port ?? DEFAULT_PORT,
      password: options.password ?? '',
      nickname: options.nickname ?? 'Player',
      inputDelayFrames: options.inputDelayFrames ?? 0,
      spectate: options.spectate ?? false,
    };

    // Create sync manager (client ID will be assigned by server)
    this.syncManager = createSyncManager({
      localClientId: 0, // Will be updated after server assigns ID
      inputDelayFrames: this.config.inputDelayFrames,
    });

    // Listen for desync events from sync manager and request recovery from server
    this.syncManager.on('desync', (frameNumber, localCrc, remoteCrc) => {
      this.emit('desync', frameNumber, localCrc, remoteCrc);
      this.requestDesyncRecovery(frameNumber);
    });
  }

  /** Is connected to server? */
  get connected(): boolean {
    return this.connection?.isConnected ?? false;
  }

  /** Server info from handshake */
  get serverInfo(): ServerInfo | null {
    return this._serverInfo;
  }

  /** Client ID assigned by server */
  get clientId(): number {
    return this._clientId;
  }

  /** Player number (-1 if spectating) */
  get playerNumber(): number {
    return this._playerNumber;
  }

  /** Are we playing? */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Is the game paused? */
  get isPaused(): boolean {
    return this._isPaused;
  }

  /** Who paused the game (empty if not paused) */
  get pausedBy(): string {
    return this._pausedBy;
  }

  /** Current frame number */
  get currentFrame(): number {
    return this._currentFrame;
  }

  /** Server's frame count (for spectating) */
  get serverFrame(): number {
    return this._serverFrame;
  }

  /** Is pausing allowed by server? */
  get allowPausing(): boolean {
    return this._allowPausing;
  }

  /** Server's input latency frames setting */
  get serverInputLatencyFrames(): number {
    return this._serverInputLatencyFrames;
  }

  /** Measured round-trip latency in ms (null until the first ping returns) */
  get latency(): number | null {
    return this._latency;
  }

  /** Get the sync manager */
  getSyncManager(): SyncManager {
    return this.syncManager;
  }

  /**
   * Set local core information for validation.
   */
  setCoreInfo(coreName: string, coreVersion: string, contentCrc: number): void {
    this.coreInfo = { coreName, coreVersion, contentCrc };
  }

  /**
   * Connect to a netplay server.
   * Waits for SYNC and MODE commands before returning, ensuring client is ready to run frames.
   */
  async connect(): Promise<void> {
    if (this.connection) {
      throw new NetplayError('ALREADY_CONNECTED');
    }

    // Start session logging
    netplayLogger.startSession({
      nickname: this.config.nickname,
      mode: 'client',
      host: this.config.host,
      port: this.config.port,
    });

    netplayLogger.clientConnecting(this.config.host, this.config.port);

    // Create promise that resolves when we're fully synced (SYNC + MODE received)
    const readyPromise = new Promise<void>((resolve, reject) => {
      // Track which essential commands we've received
      let syncReceived = false;
      let modeReceived = false;

      const checkReady = (): void => {
        if (syncReceived && modeReceived) {
          netplayLogger.debug('CLIENT', 'Fully synced - ready to run frames');
          this.off('synced', onSynced);
          this.off('mode-changed', onMode);
          this.off('error', onError);
          this.off('disconnected', onDisconnect);
          resolve();
        }
      };

      const onSynced = (): void => {
        syncReceived = true;
        checkReady();
      };

      const onMode = (): void => {
        modeReceived = true;
        checkReady();
      };

      const onError = (err: Error): void => {
        this.off('synced', onSynced);
        this.off('mode-changed', onMode);
        this.off('error', onError);
        this.off('disconnected', onDisconnect);
        reject(err);
      };

      const onDisconnect = (reason: string): void => {
        this.off('synced', onSynced);
        this.off('mode-changed', onMode);
        this.off('error', onError);
        this.off('disconnected', onDisconnect);
        reject(new Error(`Disconnected during handshake: ${reason}`));
      };

      this.on('synced', onSynced);
      this.on('mode-changed', onMode);
      this.on('error', onError);
      this.on('disconnected', onDisconnect);

      // Timeout after waiting for handshake
      setTimeout(() => {
        if (!syncReceived || !modeReceived) {
          this.off('synced', onSynced);
          this.off('mode-changed', onMode);
          this.off('error', onError);
          this.off('disconnected', onDisconnect);
          reject(new Error(`Handshake timeout: SYNC=${syncReceived}, MODE=${modeReceived}`));
        }
      }, HANDSHAKE_TIMEOUT_MS);
    });

    try {
      this.connection = await createNetplayConnection(this.config.host, this.config.port);

      // Set up event handlers
      this.connection.on('command', (cmd: ParsedCommand) => {
        if (isKnownCommand(cmd)) {
          this.handleCommand(cmd);
        }
      });

      this.connection.on('disconnected', (reason: string) => {
        this.handleDisconnect(reason);
      });

      this.connection.on('error', (err: Error) => {
        netplayLogger.clientError(`Connection error: ${err.message}`);
        this.emit('error', err);
      });

      // Per protocol: both sides send header before reading
      // "Note that both the server and the client send the connection header
      // before reading it."
      netplayLogger.debug('CLIENT', 'Sending client header');
      this.connection.sendHeader(this.config.nickname);

      // Now wait for server's header
      netplayLogger.debug('CLIENT', 'Waiting for server header');
      const serverHeader = await this.connection.waitForHeader();
      if (!serverHeader) {
        netplayLogger.connectionFailed(this.config.host, this.config.port, 'Invalid server header');
        throw new NetplayError('INVALID_HEADER', 'Invalid server header');
      }

      netplayLogger.debug('CLIENT', 'Server header received', {
        serverNickname: serverHeader.nickname,
        platformMagic: serverHeader.platformMagic.toString(HEX_RADIX),
      });

      // Store server nickname if available
      if (serverHeader.nickname && this._serverInfo) {
        this._serverInfo.nickname = serverHeader.nickname;
      }

      // Start handshake - send nickname
      this.connection.send(buildNickCommand(this.config.nickname));

      // Send password if server requires it, hashed with the salt from the
      // server's connection header (non-zero salt = password demanded)
      if (this.config.password) {
        netplayLogger.debug('CLIENT', 'Sending password');
        const hash = hashPassword(this.config.password, serverHeader.field4);
        this.connection.send(buildPasswordCommand(hash));
      }

      // Send our INFO
      netplayLogger.debug('CLIENT', 'Sending INFO', {
        coreName: this.coreInfo.coreName,
        contentCrc: this.coreInfo.contentCrc.toString(HEX_RADIX),
      });
      this.connection.send(
        buildInfoCommand(
          this.coreInfo.coreName,
          this.coreInfo.coreVersion,
          this.coreInfo.contentCrc
        )
      );

      // Request to play or spectate
      if (this.config.spectate) {
        netplayLogger.debug('CLIENT', 'Requesting SPECTATE');
        this.connection.send(buildSpectateCommand());
      } else {
        netplayLogger.debug('CLIENT', 'Requesting PLAY');
        this.connection.send(buildPlayCommand());
      }

      // Wait for SYNC and MODE before considering connection complete
      await readyPromise;

      // Measure latency: ping now and every PING_INTERVAL_MS thereafter
      this.sendPing();
      this.pingTimer = setInterval(() => {
        this.sendPing();
      }, PING_INTERVAL_MS);
      this.pingTimer.unref();

    } catch (err) {
      const errorMsg = getErrorMessage(err);
      netplayLogger.connectionFailed(this.config.host, this.config.port, errorMsg);
      this.connection?.close('connection failed');
      this.connection = null;
      throw err;
    }
  }

  /**
   * Disconnect from server.
   */
  disconnect(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.connection) {
      this.connection.close('client disconnect');
      this.connection = null;
    }
    this._serverInfo = null;
    this._clientId = -1;
    this._isPlaying = false;
    this._playerNumber = -1;
  }

  /** Send a latency ping if none is outstanding */
  private sendPing(): void {
    if (!this.connection || this.pingSentAt !== null) {
      return;
    }
    this.pingSentAt = Date.now();
    this.connection.send(buildPingRequestCommand());
  }

  private handlePingResponse(): void {
    if (this.pingSentAt === null) {
      return;
    }
    this._latency = Date.now() - this.pingSentAt;
    this.pingSentAt = null;
  }

  /**
   * Called before running a frame.
   * Returns merged input to use, or null if we should stall.
   * shouldCatchUp indicates the client is behind and should disable frame limiter.
   */
  preFrame(localInput: number[]): { input: number[]; shouldStall: boolean; shouldCatchUp: boolean } | null {
    if (!this.connected || !this._isPlaying || this._isPaused) {
      netplayLogger.debug('CLIENT', 'preFrame returning null', {
        connected: this.connected,
        isPlaying: this._isPlaying,
        isPaused: this._isPaused,
      });
      return null;
    }

    this.localInput = [...localInput];

    // Let sync manager prepare the frame
    const result = this.syncManager.preFrame(localInput);
    if (result?.shouldStall) {
      netplayLogger.debug('CLIENT', 'preFrame stalling', {
        selfFrame: this.syncManager.selfFrame,
        unreadFrame: this.syncManager.unreadFrame,
      });
    }
    return result;
  }

  /**
   * Called after running a frame.
   * Sends input to server.
   */
  postFrame(serializedState: Buffer, crcBasis?: Uint8Array): void {
    this._currentFrame++;
    netplayLogger.debug('CLIENT', 'postFrame', {
      currentFrame: this._currentFrame,
      stateSize: serializedState.length,
    });

    // Store state in sync manager
    this.syncManager.postFrame(serializedState, crcBasis);

    // Send our input to server
    this.sendLocalInput();

    // Send CRC check periodically
    if (this.syncManager.shouldSendCrc()) {
      this.sendCrc();
    }

    // Check for rollback
    if (this.syncManager.performRollbackIfNeeded()) {
      const stats = this.syncManager.statistics;
      this.emit('rollback', stats.totalFramesReplayed);
    }
  }

  /**
   * Handle a command from the server.
   */
  private handleCommand(cmd: KnownCommand): void {
    switch (cmd.cmd) {
      case NetplayCmd.NICK:
        this.handleNick(cmd);
        break;

      case NetplayCmd.INFO:
        this.handleInfo(cmd);
        break;

      case NetplayCmd.SYNC:
        this.handleSync(cmd);
        break;

      case NetplayCmd.MODE:
        this.handleMode(cmd);
        break;

      case NetplayCmd.INPUT:
        this.handleInput(cmd);
        break;

      case NetplayCmd.CRC:
        this.handleCrc(cmd);
        break;

      case NetplayCmd.LOAD_SAVESTATE:
        this.handleLoadSavestate(cmd);
        break;

      case NetplayCmd.PAUSE:
        this.handlePause(cmd);
        break;

      case NetplayCmd.RESUME:
        this.handleResume();
        break;

      case NetplayCmd.PLAYER_CHAT:
        this.handleChat(cmd);
        break;

      case NetplayCmd.DISCONNECT:
        this.handleDisconnect('Server disconnected');
        break;

      case NetplayCmd.PING_RESPONSE:
        this.handlePingResponse();
        break;

      case NetplayCmd.PING_REQUEST:
        this.handlePingRequest();
        break;

      case NetplayCmd.STALL:
        this.handleStall(cmd);
        break;

      case NetplayCmd.RESET:
        this.handleReset(cmd);
        break;

      case NetplayCmd.MODE_REFUSED:
        this.handleModeRefused(cmd);
        break;

      case NetplayCmd.SETTING_ALLOW_PAUSING:
        this.handleSettingAllowPausing(cmd);
        break;

      case NetplayCmd.SETTING_INPUT_LATENCY_FRAMES:
        this.handleSettingInputLatencyFrames(cmd);
        break;

      case NetplayCmd.NOINPUT:
        this.handleNoInput(cmd);
        break;

      case NetplayCmd.REQUEST_SAVESTATE:
        this.handleRequestSavestate(cmd);
        break;
    }
  }

  /**
   * Handle NICK command (server's nickname).
   */
  private handleNick(cmd: NickCommand): void {
    // Update server info with nickname
    if (this._serverInfo) {
      this._serverInfo.nickname = cmd.nickname;
    }
  }

  /**
   * Handle INFO command (server's core info).
   */
  private handleInfo(cmd: InfoCommand): void {
    netplayLogger.debug('CLIENT', 'Received server INFO', {
      coreName: cmd.coreName,
      contentCrc: cmd.contentCrc.toString(HEX_RADIX),
    });

    this._serverInfo = {
      coreName: cmd.coreName,
      coreVersion: cmd.coreVersion,
      contentCrc: cmd.contentCrc,
      nickname: '',
    };

    // Validate compatibility
    if (cmd.coreName !== this.coreInfo.coreName) {
      netplayLogger.clientError(`Core mismatch: server=${cmd.coreName}, local=${this.coreInfo.coreName}`);
      this.disconnect();
      this.emit('error', new Error(`Core mismatch: ${cmd.coreName} vs ${this.coreInfo.coreName}`));
      return;
    }

    if (cmd.contentCrc !== this.coreInfo.contentCrc) {
      netplayLogger.clientError(`CRC mismatch: server=${cmd.contentCrc.toString(HEX_RADIX)}, local=${this.coreInfo.contentCrc.toString(HEX_RADIX)}`);
      this.disconnect();
      this.emit('error', new Error('Content CRC mismatch'));
    }

    netplayLogger.debug('CLIENT', 'Server INFO validated - core and CRC match');
  }

  /**
   * Handle SYNC command (initial state from server).
   */
  private handleSync(cmd: SyncCommand): void {
    this._currentFrame = cmd.frameNumber;
    this._serverFrame = cmd.frameNumber;
    this.syncDevices = [...cmd.devices];

    netplayLogger.info('CLIENT', 'Received SYNC from server', {
      frameNumber: cmd.frameNumber,
      stateSize: cmd.sram.length,
      paused: cmd.paused,
      clientNumber: cmd.clientNumber,
    });

    // Initialize sync manager at server's frame. The SYNC payload's
    // trailing data is battery RAM (SRAM), NOT a savestate — hand it to
    // the emulator to load into the core; the actual state arrives via
    // the proactive LOAD_SAVESTATE that follows
    this.syncManager.initialize(cmd.frameNumber);
    if (cmd.sram.length > 0) {
      this.emit('sram-load', cmd.sram);
    }

    // Update connection state
    if (this.connection) {
      this.connection.setState(
        this._isPlaying ? ConnectionState.PLAYING : ConnectionState.SPECTATING
      );
    }

    // Register server as remote client (server is always client 0)
    this.syncManager.addRemoteClient(0, [0]);

    netplayLogger.connectedToServer(this.config.host, this.config.port);

    this.emit('synced', cmd.frameNumber);
    this.emit('connected');
  }

  /**
   * Handle MODE command (player assignment).
   */
  private handleMode(cmd: ModeCommand): void {
    if (cmd.you) {
      // This is about us
      this._clientId = cmd.clientNumber >= 0 ? cmd.clientNumber : this._clientId;
      this._isPlaying = cmd.playing;
      this._playerNumber = cmd.clientNumber;
      this._deviceBitmap = cmd.deviceBitmap;

      // Update sync manager's local client ID to our assigned number
      // This must be done BEFORE updateLocalDevices to avoid conflicts with
      // the server (which is registered as client 0)
      if (cmd.clientNumber >= 0) {
        this.syncManager.updateLocalClientId(cmd.clientNumber);
      }

      // Update sync manager's local device mapping based on assigned deviceBitmap
      // This tells the sync manager which controller slot(s) our input should go to
      this.syncManager.updateLocalDevices(cmd.deviceBitmap);

      netplayLogger.info('CLIENT', `Mode assigned: ${cmd.playing ? 'PLAYING' : 'SPECTATING'}`, {
        clientNumber: cmd.clientNumber,
        playing: cmd.playing,
        deviceBitmap: cmd.deviceBitmap,
      });

      this.emit('mode-changed', cmd.playing, cmd.clientNumber);
    } else {
      // This is about another player
      if (cmd.playing) {
        netplayLogger.info('CLIENT', `Remote player ${cmd.clientNumber} joined`);
        this.syncManager.addRemoteClient(cmd.clientNumber, [cmd.clientNumber]);
      } else {
        netplayLogger.info('CLIENT', `Remote player ${cmd.clientNumber} left`);
        this.syncManager.removeRemoteClient(cmd.clientNumber);
      }
    }
  }

  /**
   * Handle INPUT command (remote player input).
   */
  private handleInput(cmd: InputCommand): void {
    const input = [cmd.joypadState, cmd.analogLeft ?? 0, cmd.analogRight ?? 0];

    // Feed to sync manager
    const needsRollback = this.syncManager.receiveRemoteInput(
      cmd.clientId,
      cmd.frameNumber,
      input
    );

    if (needsRollback) {
      // Rollback will be performed in next postFrame
    }
  }

  /**
   * Handle CRC command (desync check from server).
   */
  private handleCrc(cmd: CrcCommand): void {
    netplayLogger.debug('CLIENT', `CRC check received for frame ${cmd.frameNumber}`, {
      remoteCrc: cmd.crc.toString(HEX_RADIX),
    });
    this.syncManager.receiveCrcCheck(cmd.frameNumber, cmd.crc);
  }

  /**
   * Handle LOAD_SAVESTATE command (resync from server).
   *
   * The LOAD_SAVESTATE frame number indicates the frame the client should start
   * running. The state data represents the game state BEFORE that frame is run
   * (i.e., state at the end of frame N-1).
   *
   * We set _currentFrame to frameNumber - 1 so that when postFrame increments it,
   * the first INPUT we send is for the correct frame (matching the MODE command).
   */
  private handleLoadSavestate(cmd: LoadSavestateCommand): void {
    netplayLogger.info('CLIENT', 'Received LOAD_SAVESTATE from server', {
      frameNumber: cmd.frameNumber,
      stateSize: cmd.state.length,
      uncompressedSize: cmd.uncompressedSize,
    });

    // Set _currentFrame to frameNumber - 1 so first INPUT is for frameNumber
    // (postFrame increments before sending)
    this._currentFrame = cmd.frameNumber - 1;

    // Initialize sync manager at frameNumber - 1 (state is before frame N)
    this.syncManager.initialize(cmd.frameNumber - 1, cmd.state);

    // Emit event so emulator can load the state into the core
    this.emit('state-load', cmd.frameNumber, cmd.state);

    // Send ACK to confirm successful savestate load (per RetroArch protocol)
    this.connection?.send(buildAckCommand());
  }

  /**
   * Handle PAUSE command.
   */
  private handlePause(cmd: PauseCommand): void {
    this._isPaused = true;
    this._pausedBy = cmd.nickname;
    this.emit('paused', cmd.nickname);
  }

  /**
   * Handle RESUME command.
   */
  private handleResume(): void {
    this._isPaused = false;
    this._pausedBy = '';
    this.emit('resumed');
  }

  /**
   * Handle PLAYER_CHAT command.
   */
  private handleChat(cmd: PlayerChatCommand): void {
    this.emit('chat', cmd.nickname, cmd.message);
  }

  /**
   * Handle PING_REQUEST from server.
   * Per RetroArch protocol, we must respond with PING_RESPONSE for latency measurement.
   */
  private handlePingRequest(): void {
    if (!this.connection) {
      return;
    }
    netplayLogger.debug('CLIENT', 'Received PING_REQUEST from server, sending PING_RESPONSE');
    this.connection.send(buildPingResponseCommand());
  }

  /**
   * Handle STALL command from server.
   * Server requests we slow down by a certain number of frames.
   */
  private handleStall(cmd: StallCommand): void {
    netplayLogger.info('CLIENT', `Server requested stall for ${cmd.frames} frames`);
    this.syncManager.requestStall(cmd.frames);
  }

  /**
   * Handle RESET command from server.
   * Server is requesting a core reset at a specific frame.
   */
  private handleReset(cmd: ResetCommand): void {
    netplayLogger.info('CLIENT', `Server requested core reset at frame ${cmd.frameNumber}`);
    this._currentFrame = cmd.frameNumber;
    this.emit('reset', cmd.frameNumber);
  }

  /**
   * Handle MODE_REFUSED command from server.
   * Server refused our request to change mode (play/spectate).
   */
  private handleModeRefused(cmd: ModeRefusedCommand): void {
    const reasonText = this.getModeRefusedReasonText(cmd.reason);
    netplayLogger.info('CLIENT', `Mode change refused: ${reasonText}`);
    this.emit('mode-refused', reasonText);
  }

  /**
   * Convert MODE_REFUSED reason code to human-readable text.
   */
  private getModeRefusedReasonText(reason: number): string {
    switch (reason) {
      case ModeRefusedReason.NO_SLOTS:
        return 'No slots available';
      case ModeRefusedReason.NOT_ALLOWED:
        return 'Not allowed';
      case ModeRefusedReason.TOO_FAST:
        return 'Too fast (rate limited)';
      default:
        return 'Unknown reason';
    }
  }

  /**
   * Handle SETTING_ALLOW_PAUSING command from server.
   * Indicates whether pausing is allowed in this session.
   */
  private handleSettingAllowPausing(cmd: SettingCommand): void {
    this._allowPausing = cmd.value !== 0;
    netplayLogger.info('CLIENT', `Server setting: allow_pausing = ${this._allowPausing}`);
    this.emit('setting-changed', 'allow_pausing', cmd.value);
  }

  /**
   * Handle SETTING_INPUT_LATENCY_FRAMES command from server.
   * Indicates the server's configured input latency frames.
   */
  private handleSettingInputLatencyFrames(cmd: SettingCommand): void {
    this._serverInputLatencyFrames = cmd.value;
    netplayLogger.info('CLIENT', `Server setting: input_latency_frames = ${cmd.value}`);
    this.emit('setting-changed', 'input_latency_frames', cmd.value);
  }

  /**
   * Handle NOINPUT command from server.
   * Server sends this when spectating to indicate frame advancement without input.
   * Per RetroArch protocol, clients should never send NOINPUT - only servers.
   */
  private handleNoInput(cmd: NoInputCommand): void {
    // Validate frame sequence - should match expected server frame
    if (cmd.frameNumber < this._serverFrame) {
      // Already processed this frame, ignore
      return;
    }

    if (cmd.frameNumber !== this._serverFrame) {
      netplayLogger.debug('CLIENT', `NOINPUT frame mismatch: expected ${this._serverFrame}, got ${cmd.frameNumber}`);
    }

    // Advance server frame counter
    this._serverFrame = cmd.frameNumber + 1;

    // Notify sync manager that this frame has no input but should be considered synced
    // This prevents spectators from stalling while waiting for input that won't come
    // Server is always client ID 0
    this.syncManager.advanceFrameWithoutInput(0, cmd.frameNumber);

    netplayLogger.debug('CLIENT', `Server NOINPUT: advanced to frame ${this._serverFrame}`);
  }

  /**
   * Handle REQUEST_SAVESTATE command.
   * The peer is requesting we send our current savestate (typically for desync recovery).
   * Emits 'savestate-requested' event so the emulator can respond with LOAD_SAVESTATE.
   */
  private handleRequestSavestate(_cmd: RequestSavestateCommand): void {
    netplayLogger.info('CLIENT', 'Peer requested savestate');
    this.emit('savestate-requested');
  }

  /**
   * Handle disconnect from server.
   */
  private handleDisconnect(reason: string): void {
    netplayLogger.disconnectedFromServer(reason);
    netplayLogger.endSession(reason);

    this.connection = null;
    this._serverInfo = null;
    this._clientId = -1;
    this._isPlaying = false;
    this._playerNumber = -1;
    this.emit('disconnected', reason);
  }

  /**
   * Send local input to server.
   */
  /**
   * Whether our assigned port is declared as an ANALOG device in SYNC.
   * Determines the INPUT payload size (3 words vs 1).
   */
  private isAssignedAnalogDevice(): boolean {
    if (this._deviceBitmap === 0) {
      return false;
    }
    // Lowest set bit = our (single) assigned device index
    const deviceIndex = Math.log2(this._deviceBitmap & -this._deviceBitmap);
    return this.syncDevices[deviceIndex] === RetroDevice.ANALOG;
  }

  private sendLocalInput(): void {
    if (!this.connection || !this._isPlaying) {
      netplayLogger.debug('CLIENT', 'sendLocalInput skipped', {
        hasConnection: !!this.connection,
        isPlaying: this._isPlaying,
      });
      return;
    }

    // Size the INPUT by our assigned device type: ANALOG ports carry
    // exactly 3 words (joypad + 2 sticks), JOYPAD ports exactly 1 —
    // RetroArch validates the payload size against the declared device
    const inputCmd = this.isAssignedAnalogDevice()
      ? buildInputCommand(
          this._currentFrame,
          this._clientId,
          false, // Not server data
          this.localInput[0] ?? 0,
          this._deviceBitmap,
          this.localInput[1] ?? 0,
          this.localInput[2] ?? 0
        )
      : buildInputCommand(
          this._currentFrame,
          this._clientId,
          false, // Not server data
          this.localInput[0] ?? 0
        );

    netplayLogger.debug('CLIENT', 'sendLocalInput', {
      frame: this._currentFrame,
      clientId: this._clientId,
      input: this.localInput[0] ?? 0,
      deviceBitmap: this._deviceBitmap,
    });
    this.connection.send(inputCmd);
  }

  /**
   * Send CRC check to server.
   */
  private sendCrc(): void {
    if (!this.connection) {
      return;
    }

    const crc = this.syncManager.getCurrentCrc();
    if (crc === null) {
      return;
    }

    this.connection.send(buildCrcCommand(this._currentFrame, crc));
  }

  /**
   * Request desync recovery from the server by sending REQUEST_SAVESTATE.
   * Rate-limited by DESYNC_RECOVERY_COOLDOWN_FRAMES to avoid flooding.
   */
  private requestDesyncRecovery(frameNumber: number): void {
    if (!this.connection) {
      return;
    }

    if (this._currentFrame - this.lastRecoveryRequestFrame < DESYNC_RECOVERY_COOLDOWN_FRAMES) {
      netplayLogger.debug('CLIENT', `Desync recovery request skipped (cooldown)`, {
        frame: frameNumber,
        lastRequest: this.lastRecoveryRequestFrame,
        cooldown: DESYNC_RECOVERY_COOLDOWN_FRAMES,
      });
      return;
    }

    this.lastRecoveryRequestFrame = this._currentFrame;
    netplayLogger.desyncRecovery(frameNumber, 'client-request');
    this.connection.send(buildRequestSavestateCommand());
  }

  // Type-safe event emitter methods
  override on<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): this {
    return super.on(event, listener);
  }

  override off<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): this {
    return super.off(event, listener);
  }

  override emit<K extends keyof ClientEvents>(
    event: K,
    ...args: Parameters<ClientEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create a new netplay client.
 */
export const createNetplayClient = (
  options?: Partial<NetplayClientOptions>
): NetplayClient => {
  return new NetplayClient(options);
};
