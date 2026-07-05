import { MAX_NICK_LEN, TIMING, UINT32_SIZE } from '..';

/** Discovery query magic: "RANQ" (RetroArch Netplay Query) */
export const DISCOVERY_QUERY_MAGIC = 0x52414e51;

/** Discovery response magic: "RANS" (RetroArch Netplay Server) */
export const DISCOVERY_RESPONSE_MAGIC = 0x52414e53;

/** Size of a query packet (just the magic header) */
export const QUERY_PACKET_SIZE = 4;

/** String length constants from RetroArch */
export const NETPLAY_HOST_STR_LEN = 32;
export const NETPLAY_HOST_LONGSTR_LEN = 256;

/** Microseconds to milliseconds conversion */
export const MS_PER_USEC = 1000;

/** Byte mask for broadcast address calculation */
export const BYTE_MASK = 255;

/** Broadcast interval in milliseconds (5 seconds) */
export const BROADCAST_INTERVAL_MS = TIMING.ANNOUNCE_AFTER_USEC / MS_PER_USEC;

/** Password bitmask values */
export const PASSWORD_FLAG = 1;
export const SPECTATE_PASSWORD_FLAG = 2;

/**
 * Discovery packet structure field count (header, content_crc, port, has_password)
 */
export const DISCOVERY_HEADER_FIELDS = 4;

export const DISCOVERY_PACKET_SIZE = (UINT32_SIZE * DISCOVERY_HEADER_FIELDS) +
  MAX_NICK_LEN +                    // nick[32]
  NETPLAY_HOST_STR_LEN +            // frontend[32]
  NETPLAY_HOST_STR_LEN +            // core[32]
  NETPLAY_HOST_STR_LEN +            // core_version[32]
  NETPLAY_HOST_STR_LEN +            // retroarch_version[32]
  NETPLAY_HOST_LONGSTR_LEN +        // content[256]
  NETPLAY_HOST_LONGSTR_LEN;         // subsystem_name[256]
