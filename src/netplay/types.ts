/**
 * TypeScript interfaces for netplay
 */

import { NetplayCmd, type ConnectionState } from './consts';
import { createTypedError } from '../utils/typedError';

/** Raw netplay command before parsing */
export interface RawCommand {
  cmd: NetplayCmd;
  payload: Buffer;
}

/**
 * Parsed INPUT command.
 *
 * Per RetroArch reference, the INPUT payload contains only frame number, client number,
 * and device input data. Device assignment (which devices a client controls) is
 * determined from the SYNC state, not embedded in INPUT commands.
 */
export interface InputCommand {
  cmd: NetplayCmd.INPUT;
  frameNumber: number;
  clientId: number;
  joypadState: number;
  analogLeft?: number;
  analogRight?: number;
}

/** Parsed NOINPUT command */
export interface NoInputCommand {
  cmd: NetplayCmd.NOINPUT;
  frameNumber: number;
}

/** Parsed NICK command */
export interface NickCommand {
  cmd: NetplayCmd.NICK;
  nickname: string;
}

/** Parsed PASSWORD command */
export interface PasswordCommand {
  cmd: NetplayCmd.PASSWORD;
  passwordHash: string;
}

/** Parsed INFO command */
export interface InfoCommand {
  cmd: NetplayCmd.INFO;
  coreName: string;
  coreVersion: string;
  contentCrc: number;
}

/** Parsed SYNC command */
export interface SyncCommand {
  cmd: NetplayCmd.SYNC;
  frameNumber: number;
  paused: boolean;
  clientNumber: number;
  devices: number[];
  shareModes: number[];
  deviceClients: number[];
  clientNick: string;
  sram: Buffer;
}

/** Parsed MODE command */
export interface ModeCommand {
  cmd: NetplayCmd.MODE;
  frameNumber: number;
  you: boolean;
  playing: boolean;
  slave: boolean;
  clientNumber: number;
  deviceBitmap: number;
  shareModes: number[];
  nick: string;
}

/** Parsed MODE_REFUSED command */
export interface ModeRefusedCommand {
  cmd: NetplayCmd.MODE_REFUSED;
  reason: number;
}

/** Parsed CRC command */
export interface CrcCommand {
  cmd: NetplayCmd.CRC;
  frameNumber: number;
  crc: number;
}

/** Parsed LOAD_SAVESTATE command */
export interface LoadSavestateCommand {
  cmd: NetplayCmd.LOAD_SAVESTATE;
  frameNumber: number;
  uncompressedSize: number;
  state: Buffer;
}

/** Parsed PAUSE command */
export interface PauseCommand {
  cmd: NetplayCmd.PAUSE;
  nickname: string;
}

/** Parsed RESUME command */
export interface ResumeCommand {
  cmd: NetplayCmd.RESUME;
}

/** Parsed STALL command */
export interface StallCommand {
  cmd: NetplayCmd.STALL;
  frames: number;
}

/** Parsed RESET command */
export interface ResetCommand {
  cmd: NetplayCmd.RESET;
  frameNumber: number;
}

/** Parsed PLAYER_CHAT command */
export interface PlayerChatCommand {
  cmd: NetplayCmd.PLAYER_CHAT;
  nickname: string;
  message: string;
}

/** Parsed PING_REQUEST command */
export interface PingRequestCommand {
  cmd: NetplayCmd.PING_REQUEST;
}

/** Parsed PING_RESPONSE command */
export interface PingResponseCommand {
  cmd: NetplayCmd.PING_RESPONSE;
}

/** Parsed ACK command */
export interface AckCommand {
  cmd: NetplayCmd.ACK;
}

/** Parsed NAK command */
export interface NakCommand {
  cmd: NetplayCmd.NAK;
}

/** Parsed DISCONNECT command */
export interface DisconnectCommand {
  cmd: NetplayCmd.DISCONNECT;
}

/** Parsed REQUEST_SAVESTATE command */
export interface RequestSavestateCommand {
  cmd: NetplayCmd.REQUEST_SAVESTATE;
}

/** Parsed SPECTATE command */
export interface SpectateCommand {
  cmd: NetplayCmd.SPECTATE;
}

/** Parsed PLAY command */
export interface PlayCommand {
  cmd: NetplayCmd.PLAY;
  asSlave: boolean;
  shareMode: number;
  requestedDevices: number;
}

/** Setting command (server configuration notifications) */
export interface SettingCommand {
  cmd: NetplayCmd.SETTING_ALLOW_PAUSING | NetplayCmd.SETTING_INPUT_LATENCY_FRAMES;
  value: number;
}

/** Unknown command (for forward compatibility) */
export interface UnknownCommand {
  cmd: number;
}

/**
 * Union of all known parsed commands.
 * Forms a proper discriminated union on the `cmd` field, enabling
 * TypeScript to narrow the type in switch statements.
 */
export type KnownCommand =
  | InputCommand
  | NoInputCommand
  | NickCommand
  | PasswordCommand
  | InfoCommand
  | SyncCommand
  | ModeCommand
  | ModeRefusedCommand
  | CrcCommand
  | LoadSavestateCommand
  | PauseCommand
  | ResumeCommand
  | StallCommand
  | ResetCommand
  | PlayerChatCommand
  | PingRequestCommand
  | PingResponseCommand
  | AckCommand
  | NakCommand
  | DisconnectCommand
  | RequestSavestateCommand
  | SpectateCommand
  | PlayCommand
  | SettingCommand;

/** Union of all parsed commands, including unknown for forward compatibility */
export type ParsedCommand = KnownCommand | UnknownCommand;

/**
 * Known command codes. Used to distinguish known commands from unknown ones
 * at runtime. Uses const enum values (inlined by TypeScript at compile time).
 */
const KNOWN_COMMAND_CODES = new Set<number>([
  NetplayCmd.ACK, NetplayCmd.NAK, NetplayCmd.DISCONNECT,
  NetplayCmd.INPUT, NetplayCmd.NOINPUT,
  NetplayCmd.NICK, NetplayCmd.PASSWORD, NetplayCmd.INFO,
  NetplayCmd.SYNC, NetplayCmd.SPECTATE, NetplayCmd.PLAY,
  NetplayCmd.MODE, NetplayCmd.MODE_REFUSED,
  NetplayCmd.CRC, NetplayCmd.REQUEST_SAVESTATE,
  NetplayCmd.LOAD_SAVESTATE, NetplayCmd.PAUSE,
  NetplayCmd.RESUME, NetplayCmd.STALL, NetplayCmd.RESET,
  NetplayCmd.PLAYER_CHAT,
  NetplayCmd.PING_REQUEST, NetplayCmd.PING_RESPONSE,
  NetplayCmd.SETTING_ALLOW_PAUSING,
  NetplayCmd.SETTING_INPUT_LATENCY_FRAMES,
]);

/** Type guard to check if a parsed command is a known command type */
export const isKnownCommand = (cmd: ParsedCommand): cmd is KnownCommand => {
  return KNOWN_COMMAND_CODES.has(cmd.cmd);
};


/** Frame state stored in ring buffer */
export interface FrameState {
  /** Frame number */
  frameNumber: number;
  /** Serialized core state (may be null if not captured) */
  serializedState: Buffer | null;
  /** Local player input for this frame */
  localInput: number[];
  /** Remote player input (clientId -> input per device) */
  remoteInput: Map<number, number[]>;
  /** Whether remote input is real (vs simulated) */
  remoteInputReal: Map<number, boolean>;
  /** CRC32 of the crc basis (or full state) for desync detection */
  crc: number | null;
  /**
   * Stable region to hash for desync detection (e.g. system RAM).
   * Some cores normalize volatile bytes on savestate load, so hashing the
   * full state falsely desyncs any peer that ever loaded a state.
   */
  crcBasis: Buffer | null;
}

/** Per-client connection info */
export interface ClientInfo {
  /** Unique client ID (0 = server) */
  id: number;
  /** Client nickname */
  nickname: string;
  /** Remote address */
  address: string;
  /** Remote port */
  port: number;
  /** Current connection state */
  state: ConnectionState;
  /** Player number (-1 if spectating) */
  playerNumber: number;
  /** Is this client spectating? */
  spectating: boolean;
  /** Estimated latency in ms */
  latency: number;
  /** Last frame we received from this client */
  lastReceivedFrame: number;
  /** Input devices this client is using */
  devices: number[];
}

/** Netplay server options */
export interface NetplayServerOptions {
  /** TCP port to listen on */
  port: number;
  /** Optional password (will be hashed) */
  password?: string;
  /** Require password authentication */
  requirePassword: boolean;
  /** Maximum number of clients */
  maxClients: number;
  /** Input delay frames (0-16) */
  inputDelayFrames: number;
  /** Server nickname */
  nickname: string;
  /** Declare ANALOG controller ports so stick input syncs (default true) */
  analogEnabled?: boolean;
}

/** Netplay client options */
export interface NetplayClientOptions {
  /** Server hostname or IP */
  host: string;
  /** Server port */
  port: number;
  /** Optional password */
  password?: string;
  /** Client nickname */
  nickname: string;
  /** Input delay frames (0-16) */
  inputDelayFrames: number;
  /** Start as spectator */
  spectate: boolean;
}

/** Core info for compatibility checking */
export interface CoreInfo {
  /** Core name (e.g., "bsnes") */
  name: string;
  /** Core version */
  version: string;
  /** Content CRC32 */
  contentCrc: number;
}

/** Netplay session state */
export interface SessionState {
  /** Current frame number */
  frameNumber: number;
  /** Is the game paused? */
  paused: boolean;
  /** Who paused (nickname) */
  pausedBy: string | null;
  /** Connected players bitmap */
  connectedPlayers: number;
  /** Our client ID */
  localClientId: number;
  /** Our player number (-1 if spectating) */
  localPlayerNumber: number;
}

/** Netplay statistics */
export interface NetplayStats {
  /** Round-trip time in ms */
  rtt: number;
  /** Frames behind remote */
  framesBehind: number;
  /** Number of rollbacks performed */
  rollbackCount: number;
  /** Average rollback depth (frames) */
  avgRollbackDepth: number;
  /** Bytes sent */
  bytesSent: number;
  /** Bytes received */
  bytesReceived: number;
}

/** Events emitted by netplay server/client */
export interface NetplayEvents {
  /** Client connected (server only) */
  'client-connected': (client: ClientInfo) => void;
  /** Client disconnected */
  'client-disconnected': (client: ClientInfo, reason: string) => void;
  /** Connected to server (client only) */
  connected: () => void;
  /** Disconnected from server (client only) */
  disconnected: (reason: string) => void;
  /** Desync detected */
  desync: (frameNumber: number, localCrc: number, remoteCrc: number) => void;
  /** Rollback performed */
  rollback: (frames: number) => void;
  /** Mode changed (play/spectate) */
  'mode-changed': (playing: boolean, playerNumber: number) => void;
  /** Game paused */
  paused: (by: string) => void;
  /** Game resumed */
  resumed: () => void;
  /** Chat message received */
  chat: (from: string, message: string) => void;
}

/** Netplay error codes */
export type NetplayErrorCode =
  | 'ALREADY_CONNECTED'
  | 'ALREADY_RUNNING'
  | 'ALREADY_ACTIVE'
  | 'INVALID_HEADER'
  | 'NO_HOSTS_FOUND';

const { TypedError: NetplayErrorClass, isTypedError: isNetplayErrorGuard } = createTypedError<NetplayErrorCode>('NetplayError');
export const NetplayError = NetplayErrorClass;
export type NetplayError = InstanceType<typeof NetplayErrorClass>;
export const isNetplayError = isNetplayErrorGuard;
