/** Default netplay port (TCP) */
export const DEFAULT_PORT = 55435;

/** Connection magic bytes: "RANP" (RetroArch Netplay) */
export const CONNECTION_MAGIC = 0x52414e50;

/** Protocol version - must match for compatibility */
export const PROTOCOL_VERSION = 7;

/** Maximum number of clients (0-31, used in bitmaps) */
export const MAX_CLIENTS = 32;

/** Maximum number of input devices */
export const MAX_INPUT_DEVICES = 16;

/** Maximum nickname length */
export const MAX_NICK_LEN = 32;

/** Password hash length (SHA-256 hex string) */
export const PASS_HASH_LEN = 64;

/** Maximum password length before hashing */
export const MAX_PASS_LEN = 128;

/** Salt prefix length in the hashed password (sprintf "%08lX" -> 8 hex chars) */
export const SALT_HEX_LENGTH = 8;

/** Core name field length in INFO command */
export const CORE_NAME_LEN = 32;

/** Core version field length in INFO command */
export const CORE_VERSION_LEN = 32;

// ============================================================================
// Protocol Wire Format Constants
// ============================================================================

/** Size of command header (cmd: 4 bytes + size: 4 bytes) */
export const COMMAND_HEADER_SIZE = 8;

/** Size of connection magic only (legacy, for quick validation) */
export const CONNECTION_MAGIC_SIZE = 4;

/** Size of base connection header (magic + platform + compression + nick_size) */
export const CONNECTION_HEADER_SIZE = 16;

/** Size of extended connection header with additional fields (used by RetroArch) */
export const EXTENDED_HEADER_SIZE = 24;

/** Offset of platform magic in connection header */
export const HEADER_PLATFORM_OFFSET = 4;

/** Offset of compression flags in connection header */
export const HEADER_COMPRESSION_OFFSET = 8;

/** Offset of nick size in connection header */
export const HEADER_NICK_SIZE_OFFSET = 12;

/** Size of a uint32 in bytes */
export const UINT32_SIZE = 4;

/** Size of a uint64 in bytes (for timestamps) */
export const UINT64_SIZE = 8;

/** Bit mask for server data flag in INPUT command */
export const SERVER_DATA_FLAG = 0x80000000;

/** Bit mask for 31-bit values */
export const MASK_31BIT = 0x7fffffff;

/** Bit mask for 16-bit values */
export const MASK_16BIT = 0xffff;

/** Bit mask for 8-bit values */
export const MASK_8BIT = 0xff;

/** Bit mask for 26-bit values (device bitmap in INPUT command, bits 5-30) */
export const MASK_26BIT = 0x3ffffff;

/** Bit shift for 16-bit packing */
export const SHIFT_16BIT = 16;

/** Bit positions for protocol flags */
export const BIT_31 = 31;
export const BIT_30 = 30;
export const BIT_29 = 29;

/** Multiplier for converting 64-bit high word */
export const UINT32_MAX_PLUS_ONE = 0x100000000;

export { HEX_RADIX } from '../utils';

/** Maximum bytes to show in hex preview for debug logging */
export const HEX_PREVIEW_LENGTH = 32;

/** Padding width for hex command codes in logging (4 hex chars = 2 bytes) */
export const HEX_PADDING_WIDTH = 4;

/** Padding width for 32-bit hex values in logging (8 hex chars = 4 bytes) */
export const HEX_PADDING_WIDTH_32 = 8;

// ============================================================================
// INPUT Command Layout
// ============================================================================

/** Minimum INPUT payload size (no analog) */
export const INPUT_PAYLOAD_MIN_SIZE = 12;

/** INPUT payload size with analog data */
export const INPUT_PAYLOAD_WITH_ANALOG_SIZE = 20;

/** Offset of client field in INPUT payload */
export const INPUT_CLIENT_OFFSET = 4;

/** Offset of joypad state in INPUT payload */
export const INPUT_JOYPAD_OFFSET = 8;

/** Offset of analog left in INPUT payload */
export const INPUT_ANALOG_LEFT_OFFSET = 12;

/** Offset of analog right in INPUT payload */
export const INPUT_ANALOG_RIGHT_OFFSET = 16;

// ============================================================================
// NETPLAY State Format (for LOAD_SAVESTATE)
// ============================================================================

/** NETPLAY state format version */
export const NETPLAYSTATE_VERSION = 1;

/** Length of "NETPLAY" magic string */
export const NETPLAYSTATE_MAGIC_LEN = 7;

/** Block type field size (4 ASCII characters) */
export const NETPLAYSTATE_BLOCK_TYPE_SIZE = 4;

/** Block type marker for core memory block */
export const NETPLAYSTATE_MEM_BLOCK = "MEM ";

/** Block type marker for achievements block */
export const NETPLAYSTATE_CHEEVOS_BLOCK = "ACHV";

/** Block type marker for end block */
export const NETPLAYSTATE_END_BLOCK = "END ";

/** NETPLAY state header size (magic + version) */
export const NETPLAYSTATE_HEADER_SIZE = 8;

/** Block header size (type + size) */
export const NETPLAYSTATE_BLOCK_HEADER_SIZE = 8;

/** Alignment for state data blocks */
export const NETPLAYSTATE_ALIGNMENT = 16;

/** ACHV (achievements) block data size */
export const NETPLAYSTATE_ACHV_DATA_SIZE = 8;

// ============================================================================
// SYNC Command Layout
// ============================================================================

/** Offset of flags in SYNC payload */
export const SYNC_FLAGS_OFFSET = 4;

/** Offset of flip frame in SYNC payload */
export const SYNC_FLIP_OFFSET = 8;

/** Offset of devices array in SYNC payload */
export const SYNC_DEVICES_OFFSET = 12;

// ============================================================================
// MODE Command Layout
// ============================================================================

/** Size of MODE payload */
export const MODE_PAYLOAD_SIZE = 8;

/** Offset of mode field in MODE payload */
export const MODE_FIELD_OFFSET = 4;

// ============================================================================
// Connection Constants
// ============================================================================

/** TCP keep-alive interval in milliseconds */
export const TCP_KEEPALIVE_MS = 30_000;

/** Timeout cleanup delay in milliseconds */
export const TIMEOUT_CLEANUP_DELAY_MS = 100;

/** Initial receive buffer capacity in bytes */
export const RECEIVE_BUFFER_INITIAL_SIZE = 4096;

/** Growth factor when receive buffer needs expansion */
export const RECEIVE_BUFFER_GROWTH_FACTOR = 2;

/** Handshake timeout in milliseconds (initial connection sync) */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** LAN host discovery timeout in milliseconds */
export const DISCOVERY_TIMEOUT_MS = 5_000;

/** Discovery query delay in milliseconds (wait for listener to be ready) */
export const DISCOVERY_QUERY_DELAY_MS = 100;

/** Frames between server input log messages (1 second at 60fps) */
export const SERVER_INPUT_LOG_INTERVAL_FRAMES = 60;

/** Default frame buffer size (frames of history for rollback) */
export const DEFAULT_FRAME_BUFFER_SIZE = 120;

/** Maximum frames of input delay */
export const MAX_INPUT_DELAY_FRAMES = 16;

/** Maximum frames behind before stalling (matches RetroArch NETPLAY_MAX_STALL_FRAMES) */
export const MAX_FRAMES_BEHIND = 60;

/** Minimum frames between desync recovery attempts (~5 seconds at 60fps) */
export const DESYNC_RECOVERY_COOLDOWN_FRAMES = 300;

/** Interval between latency pings (RetroArch NETPLAY_PING_TIME, 3s) */
export const PING_INTERVAL_MS = 3000;

/** A client this many frames ahead of the server gets a STALL (RetroArch: 3) */
export const STALL_AHEAD_THRESHOLD_FRAMES = 3;

/** Minimum frames between STALLs to the same client (RetroArch NETPLAY_MAX_REQ_STALL_FREQUENCY) */
export const STALL_MIN_INTERVAL_FRAMES = 120;

/** Maximum stall a client honors per request (RetroArch NETPLAY_MAX_REQ_STALL_TIME) */
export const MAX_REQUESTED_STALL_FRAMES = 60;

/** Frames behind remote before enabling catch-up mode (disable frame limiter) */
export const CATCH_UP_THRESHOLD = 3;

/** Minimum rollback frames to show notification (below this is considered normal) */
export const ROLLBACK_NOTIFICATION_THRESHOLD = 3;

/** Timing constants (microseconds) */
export const TIMING = {
  /** Time between lobby announcements */
  ANNOUNCE_AFTER_USEC: 5_000_000,
  /** Time between ping requests */
  PING_AFTER_USEC: 3_000_000,
  /** Maximum server stall time before disconnect */
  MAX_SERVER_STALL_USEC: 5_000_000,
  /** Maximum client stall time before disconnect */
  MAX_CLIENT_STALL_USEC: 10_000_000,
  /** Interval for CRC sync checks (frames) */
  CRC_CHECK_INTERVAL_FRAMES: 120,
} as const;

/** Netplay command IDs */
export const enum NetplayCmd {
  /** Acknowledgment */
  ACK = 0x0000,
  /** Negative acknowledgment */
  NAK = 0x0001,
  /** Graceful disconnect */
  DISCONNECT = 0x0002,
  /** Input state for a frame */
  INPUT = 0x0003,
  /** Server frame advance without input (spectating) */
  NOINPUT = 0x0004,

  /** Nickname exchange */
  NICK = 0x0020,
  /** Password authentication */
  PASSWORD = 0x0021,
  /** Core/content info exchange */
  INFO = 0x0022,
  /** Initial state synchronization */
  SYNC = 0x0023,
  /** Request to spectate */
  SPECTATE = 0x0024,
  /** Request to play */
  PLAY = 0x0025,
  /** Mode change notification */
  MODE = 0x0026,
  /** Mode change refused */
  MODE_REFUSED = 0x0027,

  /** Frame CRC for desync detection */
  CRC = 0x0040,
  /** Request savestate from server */
  REQUEST_SAVESTATE = 0x0041,
  /** Load savestate (resync) */
  LOAD_SAVESTATE = 0x0042,
  /** Pause notification */
  PAUSE = 0x0043,
  /** Resume notification */
  RESUME = 0x0044,
  /** Request stall (slow down) */
  STALL = 0x0045,
  /** Reset core */
  RESET = 0x0046,
  /** Cheats sync (not implemented) */
  CHEATS = 0x0047,
  /** Custom netpacket (core-specific) */
  NETPACKET = 0x0048,

  /** Configuration */
  CFG = 0x0061,
  /** Configuration acknowledgment */
  CFG_ACK = 0x0062,

  /** Player chat message */
  PLAYER_CHAT = 0x1000,

  /** Ping request */
  PING_REQUEST = 0x1100,
  /** Ping response */
  PING_RESPONSE = 0x1101,

  /** Setting: allow pausing */
  SETTING_ALLOW_PAUSING = 0x2000,
  /** Setting: input latency frames */
  SETTING_INPUT_LATENCY_FRAMES = 0x2001,
}

/** Libretro device types for input */
export const enum RetroDevice {
  NONE = 0,
  JOYPAD = 1,
  MOUSE = 2,
  KEYBOARD = 3,
  LIGHTGUN = 4,
  ANALOG = 5,
  POINTER = 6,
}

/** Libretro joypad button IDs */
export const enum RetroJoypadButton {
  B = 0,
  Y = 1,
  SELECT = 2,
  START = 3,
  UP = 4,
  DOWN = 5,
  LEFT = 6,
  RIGHT = 7,
  A = 8,
  X = 9,
  L = 10,
  R = 11,
  L2 = 12,
  R2 = 13,
  L3 = 14,
  R3 = 15,
}

/** Mode flags for MODE command */
export const enum ModeFlag {
  /** This mode change is about the receiving client */
  YOU = 1 << 0,
  /** Client is now playing (vs spectating) */
  PLAYING = 1 << 1,
  /** Client is in slave mode */
  SLAVE = 1 << 2,
}

/** Reasons for MODE_REFUSED */
export const enum ModeRefusedReason {
  /** No reason given */
  NONE = 0,
  /** Not enough slots */
  NO_SLOTS = 1,
  /** Not allowed */
  NOT_ALLOWED = 2,
  /** Too fast (rate limited) */
  TOO_FAST = 3,
}

/** Connection state */
export const enum ConnectionState {
  /** Not connected */
  DISCONNECTED = 0,
  /** TCP connected, waiting for header */
  CONNECTED = 1,
  /** Header exchanged, exchanging info */
  HANDSHAKING = 2,
  /** Fully synchronized and playing */
  PLAYING = 3,
  /** Spectating (receiving but not sending input) */
  SPECTATING = 4,
}
