import {
  BIT_29,
  BIT_30,
  BIT_31,
  MASK_16BIT,
  MAX_NICK_LEN,
  UINT32_SIZE,
} from '..';

/** Offset of payload size in command header */
export const PAYLOAD_SIZE_OFFSET = 4;

/** Number of bytes to reserve for null terminator in strings */
export const NULL_TERMINATOR_SIZE = 1;

/**
 * Platform magic component sizes (we present as a little-endian 64-bit
 * platform, matching RetroArch's layout:
 * bit30 = big-endian flag, bits 29-15 = sizeof(size_t), bits 14-0 = sizeof(long)).
 */
export const SIZEOF_SIZE_T = 8;

/** sizeof(long) to report in the platform magic */
export const SIZEOF_LONG = 8;

/** Bit offset of sizeof(size_t) in the platform magic */
export const PLATFORM_SIZET_SHIFT = 15;

/** Bit offset of the big-endian flag in the platform magic */
export const PLATFORM_ENDIAN_SHIFT = 30;

/** Mask for the size fields in the platform magic (15 bits) */
export const PLATFORM_SIZE_MASK = 0x7fff;

/**
 * Protocol version to use.
 * RetroArch requires minimum version 5 (LOW_NETPLAY_PROTOCOL_VERSION).
 * Current HIGH_NETPLAY_PROTOCOL_VERSION is 7.
 * We use version 7 to support NETPLAY state format in LOAD_SAVESTATE.
 */
export const OUR_PROTOCOL_VERSION = 7;

/** Highest supported protocol version (from RetroArch) */
export const HIGH_NETPLAY_PROTOCOL_VERSION = 7;

/** Lowest RetroArch protocol version (clients propose this in the protocol word) */
export const LOW_NETPLAY_PROTOCOL_VERSION = 5;

/**
 * Compression flags.
 * 0 = no compression support, 1 = zlib compression supported.
 * We use zlib compression for LOAD_SAVESTATE.
 */
export const COMPRESSION_SUPPORTED = 1;

/**
 * Header field 3 (offset 12) meaning depends on who sends it:
 * - Server: salt value (0 = no password required, non-zero = password required)
 * - Client: highest supported protocol version (hack for backwards compatibility)
 */
export const CLIENT_PROTOCOL_FIELD = HIGH_NETPLAY_PROTOCOL_VERSION;

/** Offset of the protocol word (header[4]) in the extended header */
export const HEADER_PROTOCOL_OFFSET = 16;

/** Offset of the implementation magic (header[5]) in the extended header */
export const HEADER_IMPL_MAGIC_OFFSET = 20;

/**
 * Implementation magic (header[5]): RetroArch derives it from its package
 * version string; a mismatch is only a "different versions" warning, so a
 * constant identifies emoemu builds without affecting compatibility.
 */
export const HEADER_IMPL_MAGIC_VALUE = 0x455;

/** Mask for client number in INPUT command (lower 16 bits per RetroArch reference) */
export const INPUT_CLIENT_NUM_MASK = MASK_16BIT;

/** Size of share modes array in SYNC/MODE commands */
export const SHARE_MODES_SIZE = 16;

/** Bit flag for paused state in SYNC command */
export const NETPLAY_CMD_SYNC_BIT_PAUSED = 1 << BIT_31;

/** MODE command bits per reference */
export const NETPLAY_CMD_MODE_BIT_YOU = 1 << BIT_31;
export const NETPLAY_CMD_MODE_BIT_PLAYING = 1 << BIT_30;
export const NETPLAY_CMD_MODE_BIT_SLAVE = 1 << BIT_29;

/** Full MODE payload size: frame + flags + device_bitmap + share_modes + nick */
export const MODE_FULL_PAYLOAD_SIZE = UINT32_SIZE + UINT32_SIZE + UINT32_SIZE + SHARE_MODES_SIZE + MAX_NICK_LEN;

/** Minimum protocol version that supports NETPLAY state format */
export const NETPLAY_FORMAT_MIN_VERSION = 7;

/** PLAY command bit for slave mode */
export const NETPLAY_CMD_PLAY_BIT_SLAVE = 1 << BIT_31;
