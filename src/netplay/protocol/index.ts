/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

/**
 * RetroArch Netplay Protocol Encoding/Decoding
 *
 * All multi-byte integers are in network byte order (big-endian).
 * Command format: [cmd: uint32][size: uint32][payload: bytes]
 */

import { createHash } from 'crypto';
import { netplayLogger } from '../netplayLogger';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { ProtocolError } from './types';
import { deflateSync, inflateSync, constants as zlibConstants } from 'zlib';
import {
  NetplayCmd,
  CONNECTION_MAGIC,
  MAX_NICK_LEN,
  CORE_NAME_LEN,
  CORE_VERSION_LEN,
  MAX_INPUT_DEVICES,
  PASS_HASH_LEN,
  COMMAND_HEADER_SIZE,
  EXTENDED_HEADER_SIZE,
  CONNECTION_MAGIC_SIZE,
  HEADER_PLATFORM_OFFSET,
  HEADER_COMPRESSION_OFFSET,
  HEADER_NICK_SIZE_OFFSET,
  UINT32_SIZE,
  UINT64_SIZE,
  MASK_31BIT,
  MASK_16BIT,
  MASK_8BIT,
  SHIFT_16BIT,
  INPUT_PAYLOAD_MIN_SIZE,
  INPUT_PAYLOAD_WITH_ANALOG_SIZE,
  INPUT_CLIENT_OFFSET,
  INPUT_JOYPAD_OFFSET,
  INPUT_ANALOG_LEFT_OFFSET,
  INPUT_ANALOG_RIGHT_OFFSET,
  NETPLAYSTATE_VERSION,
  NETPLAYSTATE_HEADER_SIZE,
  NETPLAYSTATE_BLOCK_HEADER_SIZE,
  NETPLAYSTATE_ALIGNMENT,
  NETPLAYSTATE_MEM_BLOCK,
  NETPLAYSTATE_CHEEVOS_BLOCK,
  NETPLAYSTATE_END_BLOCK,
  NETPLAYSTATE_MAGIC_LEN,
  NETPLAYSTATE_BLOCK_TYPE_SIZE,
  NETPLAYSTATE_ACHV_DATA_SIZE,
  HEX_RADIX,
  SALT_HEX_LENGTH,
  SERVER_DATA_FLAG,
  type RawCommand,
  type ParsedCommand,
  type InputCommand,
  type NoInputCommand,
  type NickCommand,
  type PasswordCommand,
  type InfoCommand,
  type SyncCommand,
  type ModeCommand,
  type ModeRefusedCommand,
  type CrcCommand,
  type LoadSavestateCommand,
  type PauseCommand,
  type ResumeCommand,
  type StallCommand,
  type ResetCommand,
  type PlayerChatCommand,
  type PingRequestCommand,
  type PingResponseCommand,
  type PlayCommand,
  type SettingCommand,
} from '..';
export * from './consts';
export * from './types';
import {
  PAYLOAD_SIZE_OFFSET,
  NULL_TERMINATOR_SIZE,
  SIZEOF_SIZE_T,
  SIZEOF_LONG,
  PLATFORM_SIZET_SHIFT,
  PLATFORM_ENDIAN_SHIFT,
  PLATFORM_SIZE_MASK,
  COMPRESSION_SUPPORTED,
  CLIENT_PROTOCOL_FIELD,
  HIGH_NETPLAY_PROTOCOL_VERSION,
  LOW_NETPLAY_PROTOCOL_VERSION,
  HEADER_PROTOCOL_OFFSET,
  HEADER_IMPL_MAGIC_OFFSET,
  HEADER_IMPL_MAGIC_VALUE,
  INPUT_CLIENT_NUM_MASK,
  SHARE_MODES_SIZE,
  NETPLAY_CMD_SYNC_BIT_PAUSED,
  NETPLAY_CMD_MODE_BIT_YOU,
  NETPLAY_CMD_MODE_BIT_PLAYING,
  NETPLAY_CMD_MODE_BIT_SLAVE,
  MODE_FULL_PAYLOAD_SIZE,
  NETPLAY_FORMAT_MIN_VERSION,
  NETPLAY_CMD_PLAY_BIT_SLAVE,
} from './consts';

/**
 * Read a null-terminated string from buffer, up to maxLen bytes.
 */
const readString = (buffer: Buffer, offset: number, maxLen: number): string => {
  let end = offset;
  const limit = Math.min(offset + maxLen, buffer.length);
  while (end < limit && buffer[end] !== 0) {
    end++;
  }
  return buffer.toString('utf8', offset, end);
};

/**
 * Write a null-terminated string to buffer, padded to exactly len bytes.
 */
const writeString = (buffer: Buffer, offset: number, str: string, len: number): void => {
  const bytes = Buffer.from(str, 'utf8');
  const copyLen = Math.min(bytes.length, len - NULL_TERMINATOR_SIZE);
  bytes.copy(buffer, offset, 0, copyLen);
  // Ensure null termination and zero padding
  buffer.fill(0, offset + copyLen, offset + len);
};

/**
 * Platform magic per RetroArch: bit30 = big-endian flag,
 * bits 29-15 = sizeof(size_t), bits 14-0 = sizeof(long).
 * Only enforced by peers for endian/platform-dependent cores.
 */
const OUR_PLATFORM_MAGIC = (SIZEOF_SIZE_T << PLATFORM_SIZET_SHIFT) | SIZEOF_LONG;

/**
 * Parse a platform magic into its RetroArch components.
 */
export const parsePlatformMagic = (
  magic: number
): { isBigEndian: boolean; sizeOfSizeT: number; sizeOfLong: number } => {
  return {
    isBigEndian: ((magic >>> PLATFORM_ENDIAN_SHIFT) & 1) === 1,
    sizeOfSizeT: (magic >>> PLATFORM_SIZET_SHIFT) & PLATFORM_SIZE_MASK,
    sizeOfLong: magic & PLATFORM_SIZE_MASK,
  };
};

/**
 * Parsed connection header from remote.
 */
export interface ConnectionHeader {
  magic: number;
  platformMagic: number;
  compression: number;
  /**
   * Field 4 (offset 12) meaning differs by sender:
   * - Server: salt value (0 = no password, non-zero = password required)
   * - Client: highest supported protocol version
   */
  field4: number;
  nickname: string;
}

/** Options for creating a connection header */
export interface ConnectionHeaderOptions {
  /** Whether this header is from a server (affects field 3 meaning) */
  isServer?: boolean;
  /** Salt value for password authentication (server only, 0 = no password) */
  salt?: number;
}

/**
 * Create the connection header.
 *
 * RetroArch sends a 24-byte header with extra fields after the base 16 bytes.
 * Field 3 (offset 12) has different meanings:
 * - Server: salt (0 = no password, non-zero = password required)
 * - Client: highest supported protocol version (backwards compat hack)
 */
export const createConnectionHeader = (options: ConnectionHeaderOptions = {}): Buffer => {
  const buffer = Buffer.alloc(EXTENDED_HEADER_SIZE);
  const { isServer = false, salt = 0 } = options;

  // Write base 16-byte header
  buffer.writeUInt32BE(CONNECTION_MAGIC, 0);
  buffer.writeUInt32BE(OUR_PLATFORM_MAGIC, HEADER_PLATFORM_OFFSET);
  buffer.writeUInt32BE(COMPRESSION_SUPPORTED, HEADER_COMPRESSION_OFFSET);

  // Field 3: salt (server) or protocol version (client)
  if (isServer) {
    // Server: send salt (0 = no password required)
    buffer.writeUInt32BE(salt >>> 0, HEADER_NICK_SIZE_OFFSET);
  } else {
    // Client: send highest protocol version (for backwards compat)
    buffer.writeUInt32BE(CLIENT_PROTOCOL_FIELD, HEADER_NICK_SIZE_OFFSET);
  }

  // header[4] is THE protocol word: RetroArch clients read the server's
  // value as the negotiated protocol and gate v6+ commands on it, so the
  // server must advertise 7. Clients propose the lowest version here
  // (their highest rides in the salt word above, per RetroArch convention)
  buffer.writeUInt32BE(
    isServer ? HIGH_NETPLAY_PROTOCOL_VERSION : LOW_NETPLAY_PROTOCOL_VERSION,
    HEADER_PROTOCOL_OFFSET
  );
  buffer.writeUInt32BE(HEADER_IMPL_MAGIC_VALUE, HEADER_IMPL_MAGIC_OFFSET);

  return buffer;
};

/**
 * Check if buffer has valid connection magic (quick check).
 */
export const hasValidConnectionMagic = (buffer: Buffer): boolean => {
  if (buffer.length < CONNECTION_MAGIC_SIZE) {
    return false;
  }
  return buffer.readUInt32BE(0) === CONNECTION_MAGIC;
};

/**
 * Validate and parse a connection header.
 * RetroArch sends a 24-byte extended header. The fourth field's meaning differs:
 * - Server sends: salt (0 = no password, non-zero = password required)
 * - Client sends: highest supported protocol version
 * Nicknames are exchanged via NICK commands, not embedded in the header.
 *
 * Returns null if buffer doesn't contain a valid header.
 */
export const parseConnectionHeader = (buffer: Buffer): { header: ConnectionHeader; bytesConsumed: number } | null => {
  // Need at least 24-byte extended header
  if (buffer.length < EXTENDED_HEADER_SIZE) {
    return null;
  }

  // Validate magic
  const magic = buffer.readUInt32BE(0);
  if (magic !== CONNECTION_MAGIC) {
    return null;
  }

  // Read header fields
  const platformMagic = buffer.readUInt32BE(HEADER_PLATFORM_OFFSET);
  const compression = buffer.readUInt32BE(HEADER_COMPRESSION_OFFSET);
  const field4 = buffer.readUInt32BE(HEADER_NICK_SIZE_OFFSET);

  // Consume the full 24-byte extended header
  // Fields 5 and 6 (at offsets 16 and 20) are read but not used
  const bytesConsumed = EXTENDED_HEADER_SIZE;

  return {
    header: {
      magic,
      platformMagic,
      compression,
      field4, // For clients: protocol version. For servers: salt.
      nickname: '', // Nicknames are exchanged via NICK command
    },
    bytesConsumed,
  };
};

/**
 * Validate a connection header (legacy - checks magic only).
 * @deprecated Use parseConnectionHeader for full validation
 */
export const validateConnectionHeader = (buffer: Buffer): boolean => {
  return hasValidConnectionMagic(buffer);
};

/**
 * Hash a password using SHA-256 (RetroArch compatible).
 *
 * RetroArch prepends the connection salt formatted as exactly 8 uppercase
 * zero-padded hex chars (sprintf "%08lX") before hashing, so the hash is
 * only valid for the session whose header carried that salt.
 */
export const hashPassword = (password: string, salt: number): string => {
  const saltPrefix = (salt >>> 0)
    .toString(HEX_RADIX)
    .toUpperCase()
    .padStart(SALT_HEX_LENGTH, '0');
  return createHash('sha256').update(saltPrefix + password).digest('hex');
};

/**
 * Encode a raw command to wire format.
 */
export const encodeCommand = (cmd: NetplayCmd, payload: Buffer = Buffer.alloc(0)): Buffer => {
  const buffer = Buffer.alloc(COMMAND_HEADER_SIZE + payload.length);
  buffer.writeUInt32BE(cmd, 0);
  buffer.writeUInt32BE(payload.length, PAYLOAD_SIZE_OFFSET);
  if (payload.length > 0) {
    payload.copy(buffer, COMMAND_HEADER_SIZE);
  }
  return buffer;
};

/**
 * Attempt to decode a command from buffer.
 * Returns null if buffer doesn't contain a complete command.
 * Returns the command and bytes consumed on success.
 */
export const decodeCommand = (
  buffer: Buffer
): { command: RawCommand; bytesConsumed: number } | null => {
  if (buffer.length < COMMAND_HEADER_SIZE) {
    return null;
  }

  const cmd = buffer.readUInt32BE(0) as NetplayCmd;
  const payloadSize = buffer.readUInt32BE(PAYLOAD_SIZE_OFFSET);
  const totalSize = COMMAND_HEADER_SIZE + payloadSize;

  if (buffer.length < totalSize) {
    return null;
  }

  const payload = Buffer.alloc(payloadSize);
  buffer.copy(payload, 0, COMMAND_HEADER_SIZE, totalSize);

  return {
    command: { cmd, payload },
    bytesConsumed: totalSize,
  };
};

// ============================================================================
// Command Builders
// ============================================================================

/**
 * Build an INPUT command.
 *
 * Per RetroArch reference (send_input_frame in netplay_frontend.c):
 * The payload format is: frame (4) + client_num (4) + input_data (variable)
 *
 * The client_num field contains the client ID in the lower 16 bits.
 * When isServer is true, the SERVER_DATA_FLAG (bit 31) is set to indicate
 * the input came from the server. Receivers mask with 0xFFFF to extract
 * the client ID.
 *
 * The deviceBitmap parameter is kept for API compatibility but is not used in the wire format.
 */
export const buildInputCommand = (
  frameNumber: number,
  clientId: number,
  isServer: boolean,
  joypadState: number,
  _deviceBitmap: number = 1,  // Unused - kept for API compatibility
  analogLeft?: number,
  analogRight?: number
): Buffer => {
  // Per reference: payload is frame (4) + client_num (4) + input data
  // If analog data is present, use larger payload size
  const hasAnalog = analogLeft !== undefined || analogRight !== undefined;
  const payload = Buffer.alloc(hasAnalog ? INPUT_PAYLOAD_WITH_ANALOG_SIZE : INPUT_PAYLOAD_MIN_SIZE);

  payload.writeUInt32BE(frameNumber, 0);

  // Set SERVER_DATA_FLAG (bit 31) when this is server data
  // Receivers extract client ID with: client_num & 0xFFFF
  const clientNumWithFlag = isServer ? (clientId | SERVER_DATA_FLAG) >>> 0 : clientId >>> 0;
  payload.writeUInt32BE(clientNumWithFlag, INPUT_CLIENT_OFFSET);

  // Joypad state
  payload.writeUInt32BE(joypadState >>> 0, INPUT_JOYPAD_OFFSET);

  // Analog stick data (optional)
  if (hasAnalog) {
    payload.writeUInt32BE((analogLeft ?? 0) >>> 0, INPUT_ANALOG_LEFT_OFFSET);
    payload.writeUInt32BE((analogRight ?? 0) >>> 0, INPUT_ANALOG_RIGHT_OFFSET);
  }

  return encodeCommand(NetplayCmd.INPUT, payload);
};

/**
 * Build a NOINPUT command.
 */
export const buildNoInputCommand = (frameNumber: number): Buffer => {
  const payload = Buffer.alloc(UINT32_SIZE);
  payload.writeUInt32BE(frameNumber, 0);
  return encodeCommand(NetplayCmd.NOINPUT, payload);
};

/**
 * Build a NICK command.
 */
export const buildNickCommand = (nickname: string): Buffer => {
  const payload = Buffer.alloc(MAX_NICK_LEN);
  writeString(payload, 0, nickname, MAX_NICK_LEN);
  return encodeCommand(NetplayCmd.NICK, payload);
};

/**
 * Build a PASSWORD command.
 * Note: Password hash is exactly 64 hex characters, no null termination.
 */
export const buildPasswordCommand = (passwordHash: string): Buffer => {
  const payload = Buffer.alloc(PASS_HASH_LEN);
  const bytes = Buffer.from(passwordHash, 'utf8');
  bytes.copy(payload, 0, 0, Math.min(bytes.length, PASS_HASH_LEN));
  return encodeCommand(NetplayCmd.PASSWORD, payload);
};

/**
 * Build an INFO command.
 * Payload order per spec: content CRC, core name, core version
 */
export const buildInfoCommand = (
  coreName: string,
  coreVersion: string,
  contentCrc: number
): Buffer => {
  const payload = Buffer.alloc(UINT32_SIZE + CORE_NAME_LEN + CORE_VERSION_LEN);
  payload.writeUInt32BE(contentCrc >>> 0, 0);
  writeString(payload, UINT32_SIZE, coreName, CORE_NAME_LEN);
  writeString(payload, UINT32_SIZE + CORE_NAME_LEN, coreVersion, CORE_VERSION_LEN);
  return encodeCommand(NetplayCmd.INFO, payload);
};

/**
 * Build a SYNC command.
 * Per reference: frame, flags, devices[16], share_modes[16], device_clients[16], nick, sram
 */
export const buildSyncCommand = (
  frameNumber: number,
  paused: boolean,
  clientNumber: number,
  devices: number[],
  shareModes: number[],
  deviceClients: number[],
  clientNick: string,
  sram: Buffer
): Buffer => {
  // Frame (4) + flags (4) + devices (64) + share_modes (16) + device_clients (64) + nick (32)
  const headerSize =
    UINT32_SIZE + UINT32_SIZE +
    MAX_INPUT_DEVICES * UINT32_SIZE +
    SHARE_MODES_SIZE +
    MAX_INPUT_DEVICES * UINT32_SIZE +
    MAX_NICK_LEN;
  const payload = Buffer.alloc(headerSize + sram.length);

  let offset = 0;

  // Frame number
  payload.writeUInt32BE(frameNumber, offset);
  offset += UINT32_SIZE;

  // Flags: bit 31 = paused, bits 0-30 = client number
  const flags = (paused ? NETPLAY_CMD_SYNC_BIT_PAUSED : 0) | (clientNumber & MASK_31BIT);
  payload.writeUInt32BE(flags >>> 0, offset);
  offset += UINT32_SIZE;

  // Controller devices array (uint32[16])
  for (let i = 0; i < MAX_INPUT_DEVICES; i++) {
    payload.writeUInt32BE((devices[i] ?? 0) >>> 0, offset);
    offset += UINT32_SIZE;
  }

  // Share modes array (uint8[16])
  for (let i = 0; i < SHARE_MODES_SIZE; i++) {
    payload.writeUInt8(shareModes[i] ?? 0, offset);
    offset++;
  }

  // Controller-client mapping array (uint32[16])
  for (let i = 0; i < MAX_INPUT_DEVICES; i++) {
    payload.writeUInt32BE((deviceClients[i] ?? 0) >>> 0, offset);
    offset += UINT32_SIZE;
  }

  // Client nick
  writeString(payload, offset, clientNick, MAX_NICK_LEN);
  offset += MAX_NICK_LEN;

  // Copy SRAM/state
  sram.copy(payload, offset);

  return encodeCommand(NetplayCmd.SYNC, payload);
};

/**
 * Build a MODE command.
 * Per reference: frame, flags (you|playing|slave|client_num), device_bitmap, share_modes, nick
 */
export const buildModeCommand = (
  frameNumber: number,
  you: boolean,
  playing: boolean,
  slave: boolean,
  clientNumber: number,
  deviceBitmap: number = 0,
  shareModes: number[] = [],
  nick: string = ''
): Buffer => {
  const payload = Buffer.alloc(MODE_FULL_PAYLOAD_SIZE);
  let offset = 0;

  // Frame number
  payload.writeUInt32BE(frameNumber, offset);
  offset += UINT32_SIZE;

  // Flags: bits 31/30/29 = you/playing/slave, bits 0-15 = client number
  let flags = clientNumber & MASK_16BIT;
  if (you) {
    flags |= NETPLAY_CMD_MODE_BIT_YOU;
  }
  if (playing) {
    flags |= NETPLAY_CMD_MODE_BIT_PLAYING;
  }
  if (slave) {
    flags |= NETPLAY_CMD_MODE_BIT_SLAVE;
  }
  payload.writeUInt32BE(flags >>> 0, offset);
  offset += UINT32_SIZE;

  // Device bitmap
  payload.writeUInt32BE(deviceBitmap >>> 0, offset);
  offset += UINT32_SIZE;

  // Share modes (uint8[16])
  for (let i = 0; i < SHARE_MODES_SIZE; i++) {
    payload.writeUInt8(shareModes[i] ?? 0, offset);
    offset++;
  }

  // Nick
  writeString(payload, offset, nick, MAX_NICK_LEN);

  return encodeCommand(NetplayCmd.MODE, payload);
};

/**
 * Build a MODE_REFUSED command.
 */
export const buildModeRefusedCommand = (reason: number): Buffer => {
  const payload = Buffer.alloc(UINT32_SIZE);
  payload.writeUInt32BE(reason, 0);
  return encodeCommand(NetplayCmd.MODE_REFUSED, payload);
};

/**
 * Build a CRC command.
 */
export const buildCrcCommand = (frameNumber: number, crc: number): Buffer => {
  const payload = Buffer.alloc(UINT64_SIZE);
  payload.writeUInt32BE(frameNumber, 0);
  payload.writeUInt32BE(crc >>> 0, UINT32_SIZE);
  return encodeCommand(NetplayCmd.CRC, payload);
};

/**
 * Build a REQUEST_SAVESTATE command.
 */
export const buildRequestSavestateCommand = (): Buffer => {
  return encodeCommand(NetplayCmd.REQUEST_SAVESTATE);
};

/**
 * Wrap raw core state in NETPLAY format.
 * Format per RetroArch reference capture:
 * - Header: "NETPLAY" (7 bytes) + version (1 byte) = 8 bytes
 * - MEM block: "MEM " (4) + size_LE (4) + data + padding to 16-byte align
 * - ACHV block: "ACHV" (4) + size_LE (4) + zeros (8) = 16 bytes (achievements, optional but sent by RA)
 * - END block: "END " (4) + size_LE 0 (4) = 8 bytes
 *
 * Size fields are LITTLE-ENDIAN. Block data is aligned to 16-byte boundaries.
 */
const wrapStateInNetplayFormat = (coreState: Buffer): Buffer => {
  // MEM data ends at: header(8) + MEM header(8) + data
  const memDataEnd = NETPLAYSTATE_HEADER_SIZE + NETPLAYSTATE_BLOCK_HEADER_SIZE + coreState.length;

  // Pad to 16-byte alignment for next block
  const memPaddedEnd = Math.ceil(memDataEnd / NETPLAYSTATE_ALIGNMENT) * NETPLAYSTATE_ALIGNMENT;
  const memPadding = memPaddedEnd - memDataEnd;

  // ACHV block (achievements): header(8) + data(8) = 16 bytes (matches RetroArch)
  const achvBlockSize = NETPLAYSTATE_BLOCK_HEADER_SIZE + NETPLAYSTATE_ACHV_DATA_SIZE;

  // END block: header(8) only, size=0
  const endBlockSize = NETPLAYSTATE_BLOCK_HEADER_SIZE;

  // Total size
  const totalSize = memPaddedEnd + achvBlockSize + endBlockSize;
  const wrapped = Buffer.alloc(totalSize);

  let offset = 0;

  // Header: "NETPLAY" + version 1
  wrapped.write('NETPLAY', offset, 'ascii');
  offset += NETPLAYSTATE_MAGIC_LEN;
  wrapped.writeUInt8(NETPLAYSTATE_VERSION, offset);
  offset += 1;

  // MEM block header - size is LITTLE-ENDIAN, contains actual data size (not padded)
  wrapped.write(NETPLAYSTATE_MEM_BLOCK, offset, 'ascii');
  offset += NETPLAYSTATE_BLOCK_TYPE_SIZE;
  wrapped.writeUInt32LE(coreState.length, offset);
  offset += UINT32_SIZE;

  // MEM block data
  coreState.copy(wrapped, offset);
  offset += coreState.length;

  // MEM block padding (zeros, already done by Buffer.alloc)
  offset += memPadding;

  // ACHV block (achievements) - required by RetroArch, data is 8 zeros
  wrapped.write(NETPLAYSTATE_CHEEVOS_BLOCK, offset, 'ascii');
  offset += NETPLAYSTATE_BLOCK_TYPE_SIZE;
  wrapped.writeUInt32LE(NETPLAYSTATE_ACHV_DATA_SIZE, offset);
  offset += UINT32_SIZE;
  // ACHV data bytes (zeros, already done by Buffer.alloc)
  offset += NETPLAYSTATE_ACHV_DATA_SIZE;

  // END block
  wrapped.write(NETPLAYSTATE_END_BLOCK, offset, 'ascii');
  offset += NETPLAYSTATE_BLOCK_TYPE_SIZE;
  wrapped.writeUInt32LE(0, offset);  // Size = 0

  return wrapped;
};

/**
 * Unwrap raw core state from NETPLAY format.
 * Returns the raw core state extracted from the MEM block.
 * Returns null if the format is invalid.
 */
const unwrapNetplayState = (wrapped: Buffer): Buffer | null => {
  // Check minimum size: header (8) + MEM header (8) + at least 1 byte
  const minSize = NETPLAYSTATE_HEADER_SIZE + NETPLAYSTATE_BLOCK_HEADER_SIZE + 1;
  if (wrapped.length < minSize) {
    return null;
  }

  // Validate "NETPLAY" header
  const header = wrapped.subarray(0, NETPLAYSTATE_MAGIC_LEN).toString('ascii');
  if (header !== 'NETPLAY') {
    return null;
  }

  // Read version
  const version = wrapped.readUInt8(NETPLAYSTATE_MAGIC_LEN);
  if (version !== NETPLAYSTATE_VERSION) {
    netplayLogger.debug('PROTOCOL', `Unknown NETPLAY state version: ${version}`);
    // Try to parse anyway - format is usually compatible
  }

  // Look for MEM block
  let offset = NETPLAYSTATE_HEADER_SIZE;
  while (offset + NETPLAYSTATE_BLOCK_HEADER_SIZE <= wrapped.length) {
    const blockType = wrapped.subarray(offset, offset + NETPLAYSTATE_BLOCK_TYPE_SIZE).toString('ascii');
    const blockSize = wrapped.readUInt32LE(offset + NETPLAYSTATE_BLOCK_TYPE_SIZE);  // Size is LITTLE-ENDIAN

    if (blockType === NETPLAYSTATE_MEM_BLOCK) {
      // Found MEM block - extract data
      const dataStart = offset + NETPLAYSTATE_BLOCK_HEADER_SIZE;
      const dataEnd = dataStart + blockSize;
      if (dataEnd <= wrapped.length) {
        return Buffer.from(wrapped.subarray(dataStart, dataEnd));
      }
      return null;  // Invalid: data extends past buffer
    }

    if (blockType === NETPLAYSTATE_END_BLOCK) {
      // Reached END without finding MEM - no state data
      return null;
    }

    // Move to next block (data + padding to 16-byte alignment)
    const blockEnd = offset + NETPLAYSTATE_BLOCK_HEADER_SIZE + blockSize;
    offset = Math.ceil(blockEnd / NETPLAYSTATE_ALIGNMENT) * NETPLAYSTATE_ALIGNMENT;
  }

  return null;  // No MEM block found
};

/**
 * Build a LOAD_SAVESTATE command.
 *
 * Format per RetroArch netplay protocol:
 * - frame (4 bytes BE) - the frame number for this state
 * - uncompressed_size (4 bytes BE) - size of state when uncompressed (0 if not compressed)
 * - data (variable) - the state data wrapped in NETPLAY format
 *
 * The format of the state data depends on the client's protocol version:
 * - Protocol 7+: NETPLAY wrapper format (bypasses size validation)
 * - Protocol < 7: Raw state data (requires state_size == coremem_size)
 *
 * Per reference (netplay_frontend.c line 7481-7485), NETPLAY format is only
 * sent to protocol 7+ clients. Legacy clients receive raw format.
 */
export const buildLoadSavestateCommand = (
  frameNumber: number,
  state: Buffer,
  _clientProtocolVersion: number = NETPLAY_FORMAT_MIN_VERSION
): Buffer => {
  // Wrap raw core state in NETPLAY format (required for protocol 7+ clients)
  const netplayState = wrapStateInNetplayFormat(state);

  // Per Wireshark capture of working RetroArch connection:
  // RetroArch compresses the state using zlib and sets uncompressed_size
  // to the actual uncompressed size (NOT zero)
  // Use level 9 (best compression) to match RetroArch's zlib header (78 da)
  const compressedState = deflateSync(netplayState, { level: zlibConstants.Z_BEST_COMPRESSION });
  const uncompressedSize = netplayState.length;

  // Build payload: frame (4) + uncompressed_size (4) + compressed_state
  const payload = Buffer.alloc(UINT64_SIZE + compressedState.length);
  payload.writeUInt32BE(frameNumber, 0);
  payload.writeUInt32BE(uncompressedSize, UINT32_SIZE);
  compressedState.copy(payload, UINT64_SIZE);
  return encodeCommand(NetplayCmd.LOAD_SAVESTATE, payload);
};

/**
 * Build a PAUSE command.
 */
export const buildPauseCommand = (nickname: string): Buffer => {
  const payload = Buffer.alloc(MAX_NICK_LEN);
  writeString(payload, 0, nickname, MAX_NICK_LEN);
  return encodeCommand(NetplayCmd.PAUSE, payload);
};

/**
 * Build a RESUME command.
 */
export const buildResumeCommand = (): Buffer => {
  return encodeCommand(NetplayCmd.RESUME);
};

/**
 * Build a STALL command.
 */
export const buildStallCommand = (frames: number): Buffer => {
  const payload = Buffer.alloc(UINT32_SIZE);
  payload.writeUInt32BE(frames, 0);
  return encodeCommand(NetplayCmd.STALL, payload);
};

/**
 * Build a RESET command.
 */
export const buildResetCommand = (frameNumber: number): Buffer => {
  const payload = Buffer.alloc(UINT32_SIZE);
  payload.writeUInt32BE(frameNumber, 0);
  return encodeCommand(NetplayCmd.RESET, payload);
};

/**
 * Build a PLAYER_CHAT command.
 */
export const buildPlayerChatCommand = (nickname: string, message: string): Buffer => {
  const nickBytes = Buffer.from(nickname, 'utf8').subarray(0, MAX_NICK_LEN - NULL_TERMINATOR_SIZE);
  const msgBytes = Buffer.from(message, 'utf8');
  const payload = Buffer.alloc(MAX_NICK_LEN + msgBytes.length);
  nickBytes.copy(payload, 0);
  payload[nickBytes.length] = 0; // null terminate
  msgBytes.copy(payload, MAX_NICK_LEN);
  return encodeCommand(NetplayCmd.PLAYER_CHAT, payload);
};

/**
 * Build a PING_REQUEST command.
 * Per reference: no payload.
 */
export const buildPingRequestCommand = (): Buffer => {
  return encodeCommand(NetplayCmd.PING_REQUEST);
};

/**
 * Build a PING_RESPONSE command.
 * Per reference: no payload.
 */
export const buildPingResponseCommand = (): Buffer => {
  return encodeCommand(NetplayCmd.PING_RESPONSE);
};

/**
 * Build an ACK command.
 */
export const buildAckCommand = (): Buffer => {
  return encodeCommand(NetplayCmd.ACK);
};

/**
 * Build a NAK command.
 */
export const buildNakCommand = (): Buffer => {
  return encodeCommand(NetplayCmd.NAK);
};

/**
 * Build a DISCONNECT command.
 */
export const buildDisconnectCommand = (): Buffer => {
  return encodeCommand(NetplayCmd.DISCONNECT);
};

/**
 * Build a SPECTATE command.
 */
export const buildSpectateCommand = (): Buffer => {
  return encodeCommand(NetplayCmd.SPECTATE);
};

/**
 * Build a SETTING_ALLOW_PAUSING command.
 * Per reference capture: 4-byte payload with value 0 (pausing disabled).
 */
export const buildSettingAllowPausingCommand = (allowPausing: boolean = false): Buffer => {
  const payload = Buffer.alloc(UINT32_SIZE);
  payload.writeUInt32BE(allowPausing ? 1 : 0, 0);
  return encodeCommand(NetplayCmd.SETTING_ALLOW_PAUSING, payload);
};

/**
 * Build a SETTING_INPUT_LATENCY_FRAMES command.
 * Per reference capture: 8-byte payload with two uint32 values:
 * - frames (input latency frames)
 * - range (acceptable frame range, usually 0)
 */
export const buildSettingInputLatencyFramesCommand = (frames: number = 0, range: number = 0): Buffer => {
  const payload = Buffer.alloc(UINT64_SIZE);
  payload.writeUInt32BE(frames, 0);
  payload.writeUInt32BE(range, UINT32_SIZE);
  return encodeCommand(NetplayCmd.SETTING_INPUT_LATENCY_FRAMES, payload);
};

/**
 * Build a PLAY command.
 * Per reference: slave (1 bit), reserved (7 bits), share_mode (8 bits), devices (16 bits)
 */
export const buildPlayCommand = (
  asSlave: boolean = false,
  shareMode: number = 0,
  requestedDevices: number = 0
): Buffer => {
  const payload = Buffer.alloc(UINT32_SIZE);
  let flags = (requestedDevices & MASK_16BIT) | ((shareMode & MASK_8BIT) << SHIFT_16BIT);
  if (asSlave) {
    flags |= NETPLAY_CMD_PLAY_BIT_SLAVE;
  }
  payload.writeUInt32BE(flags >>> 0, 0);
  return encodeCommand(NetplayCmd.PLAY, payload);
};

// ============================================================================
// Command Parsers
// ============================================================================

/**
 * Parse an INPUT command payload.
 *
 * Per RetroArch reference (netplay_frontend.c), the INPUT payload format is:
 * - frame_num (4 bytes): Frame number for this input
 * - client_num (4 bytes): Plain client number (lower 16 bits used)
 * - input_data (variable): Device input data
 *
 * Note: Device assignment (which devices a client controls) is determined
 * from the SYNC state (client_devices array), not from the INPUT command.
 */
export const parseInputCommand = (payload: Buffer): InputCommand => {
  if (payload.length < INPUT_PAYLOAD_MIN_SIZE) {
    throw new ProtocolError('INVALID_INPUT_PAYLOAD', `size: ${payload.length}`);
  }

  const frameNumber = payload.readUInt32BE(0);
  // Extract client number from lower 16 bits (per RetroArch reference: client_num &= 0xFFFF)
  const clientId = payload.readUInt32BE(INPUT_CLIENT_OFFSET) & INPUT_CLIENT_NUM_MASK;
  const joypadState = payload.readUInt32BE(INPUT_JOYPAD_OFFSET);

  const result: InputCommand = {
    cmd: NetplayCmd.INPUT,
    frameNumber,
    clientId,
    joypadState,
  };

  if (payload.length >= INPUT_PAYLOAD_WITH_ANALOG_SIZE) {
    result.analogLeft = payload.readUInt32BE(INPUT_ANALOG_LEFT_OFFSET);
    result.analogRight = payload.readUInt32BE(INPUT_ANALOG_RIGHT_OFFSET);
  }

  return result;
};

/**
 * Parse a NOINPUT command payload.
 */
export const parseNoInputCommand = (payload: Buffer): NoInputCommand => {
  if (payload.length < UINT32_SIZE) {
    throw new ProtocolError('INVALID_NOINPUT_PAYLOAD', `size: ${payload.length}`);
  }
  return {
    cmd: NetplayCmd.NOINPUT,
    frameNumber: payload.readUInt32BE(0),
  };
};

/**
 * Parse a NICK command payload.
 */
export const parseNickCommand = (payload: Buffer): NickCommand => {
  return {
    cmd: NetplayCmd.NICK,
    nickname: readString(payload, 0, MAX_NICK_LEN),
  };
};

/**
 * Parse a PASSWORD command payload.
 * Note: Password hash is exactly 64 hex characters, no null termination.
 */
export const parsePasswordCommand = (payload: Buffer): PasswordCommand => {
  const len = Math.min(payload.length, PASS_HASH_LEN);
  return {
    cmd: NetplayCmd.PASSWORD,
    passwordHash: payload.subarray(0, len).toString('utf8'),
  };
};

/**
 * Parse an INFO command payload.
 * Payload order per spec: content CRC, core name, core version
 */
export const parseInfoCommand = (payload: Buffer): InfoCommand => {
  if (payload.length < UINT32_SIZE + CORE_NAME_LEN + CORE_VERSION_LEN) {
    throw new ProtocolError('INVALID_INFO_PAYLOAD', `size: ${payload.length}`);
  }
  return {
    cmd: NetplayCmd.INFO,
    contentCrc: payload.readUInt32BE(0),
    coreName: readString(payload, UINT32_SIZE, CORE_NAME_LEN),
    coreVersion: readString(payload, UINT32_SIZE + CORE_NAME_LEN, CORE_VERSION_LEN),
  };
};

/**
 * Parse a SYNC command payload.
 * Per reference: frame, flags, devices[16], share_modes[16], device_clients[16], nick, sram
 */
export const parseSyncCommand = (payload: Buffer): SyncCommand => {
  const headerSize =
    UINT32_SIZE + UINT32_SIZE +
    MAX_INPUT_DEVICES * UINT32_SIZE +
    SHARE_MODES_SIZE +
    MAX_INPUT_DEVICES * UINT32_SIZE +
    MAX_NICK_LEN;

  if (payload.length < headerSize) {
    throw new ProtocolError('INVALID_SYNC_PAYLOAD', `size: ${payload.length}`);
  }

  let offset = 0;

  // Frame number
  const frameNumber = payload.readUInt32BE(offset);
  offset += UINT32_SIZE;

  // Flags: bit 31 = paused, bits 0-30 = client number
  const flags = payload.readUInt32BE(offset);
  offset += UINT32_SIZE;
  const paused = (flags & NETPLAY_CMD_SYNC_BIT_PAUSED) !== 0;
  const clientNumber = flags & MASK_31BIT;

  // Controller devices array (uint32[16])
  const devices: number[] = [];
  for (let i = 0; i < MAX_INPUT_DEVICES; i++) {
    devices.push(payload.readUInt32BE(offset));
    offset += UINT32_SIZE;
  }

  // Share modes array (uint8[16])
  const shareModes: number[] = [];
  for (let i = 0; i < SHARE_MODES_SIZE; i++) {
    shareModes.push(payload.readUInt8(offset));
    offset++;
  }

  // Controller-client mapping array (uint32[16])
  const deviceClients: number[] = [];
  for (let i = 0; i < MAX_INPUT_DEVICES; i++) {
    deviceClients.push(payload.readUInt32BE(offset));
    offset += UINT32_SIZE;
  }

  // Client nick
  const clientNick = readString(payload, offset, MAX_NICK_LEN);
  offset += MAX_NICK_LEN;

  // SRAM/state
  const sram = payload.subarray(offset);

  return {
    cmd: NetplayCmd.SYNC,
    frameNumber,
    paused,
    clientNumber,
    devices,
    shareModes,
    deviceClients,
    clientNick,
    sram: Buffer.from(sram),
  };
};

/**
 * Parse a MODE command payload.
 * Per reference: frame, flags (you|playing|slave|client_num), device_bitmap, share_modes, nick
 */
export const parseModeCommand = (payload: Buffer): ModeCommand => {
  if (payload.length < MODE_FULL_PAYLOAD_SIZE) {
    throw new ProtocolError('INVALID_MODE_PAYLOAD', `size: ${payload.length}`);
  }

  let offset = 0;

  // Frame number
  const frameNumber = payload.readUInt32BE(offset);
  offset += UINT32_SIZE;

  // Flags: bits 31/30/29 = you/playing/slave, bits 0-15 = client number
  const flags = payload.readUInt32BE(offset);
  offset += UINT32_SIZE;
  const you = (flags & NETPLAY_CMD_MODE_BIT_YOU) !== 0;
  const playing = (flags & NETPLAY_CMD_MODE_BIT_PLAYING) !== 0;
  const slave = (flags & NETPLAY_CMD_MODE_BIT_SLAVE) !== 0;
  const clientNumber = flags & MASK_16BIT;

  // Device bitmap
  const deviceBitmap = payload.readUInt32BE(offset);
  offset += UINT32_SIZE;

  // Share modes (uint8[16])
  const shareModes: number[] = [];
  for (let i = 0; i < SHARE_MODES_SIZE; i++) {
    shareModes.push(payload.readUInt8(offset));
    offset++;
  }

  // Nick
  const nick = readString(payload, offset, MAX_NICK_LEN);

  return {
    cmd: NetplayCmd.MODE,
    frameNumber,
    you,
    playing,
    slave,
    clientNumber,
    deviceBitmap,
    shareModes,
    nick,
  };
};

/**
 * Parse a MODE_REFUSED command payload.
 */
export const parseModeRefusedCommand = (payload: Buffer): ModeRefusedCommand => {
  return {
    cmd: NetplayCmd.MODE_REFUSED,
    reason: payload.length >= UINT32_SIZE ? payload.readUInt32BE(0) : 0,
  };
};

/**
 * Parse a CRC command payload.
 */
export const parseCrcCommand = (payload: Buffer): CrcCommand => {
  if (payload.length < UINT64_SIZE) {
    throw new ProtocolError('INVALID_CRC_PAYLOAD', `size: ${payload.length}`);
  }
  return {
    cmd: NetplayCmd.CRC,
    frameNumber: payload.readUInt32BE(0),
    crc: payload.readUInt32BE(UINT32_SIZE),
  };
};

/**
 * Parse a LOAD_SAVESTATE command payload.
 * Handles zlib decompression and NETPLAY format unwrapping.
 */
export const parseLoadSavestateCommand = (payload: Buffer): LoadSavestateCommand => {
  if (payload.length < UINT64_SIZE) {
    throw new ProtocolError('INVALID_SAVESTATE_PAYLOAD', `size: ${payload.length}`);
  }

  const frameNumber = payload.readUInt32BE(0);
  const uncompressedSize = payload.readUInt32BE(UINT32_SIZE);
  let stateData = payload.subarray(UINT64_SIZE);

  // Decompress if needed (uncompressedSize > 0 indicates compression)
  if (uncompressedSize > 0) {
    try {
      stateData = inflateSync(stateData);
      netplayLogger.debug('PROTOCOL', 'Decompressed LOAD_SAVESTATE', {
        compressedSize: payload.length - UINT64_SIZE,
        decompressedSize: stateData.length,
        expectedSize: uncompressedSize,
      });
    } catch (err) {
      netplayLogger.error('PROTOCOL', 'Failed to decompress LOAD_SAVESTATE', {
        error: getErrorMessage(err),
      });
      throw new ProtocolError('DECOMPRESS_FAILED', getErrorMessage(err));
    }
  }

  // Unwrap NETPLAY format if present (protocol 7+ uses NETPLAY wrapper)
  const unwrapped = unwrapNetplayState(stateData);
  if (unwrapped) {
    netplayLogger.debug('PROTOCOL', 'Unwrapped NETPLAY state format', {
      wrappedSize: stateData.length,
      coreStateSize: unwrapped.length,
    });
    stateData = unwrapped;
  } else {
    // Not in NETPLAY format - use as raw state (legacy protocol)
    netplayLogger.debug('PROTOCOL', 'Using raw state format (no NETPLAY wrapper)', {
      stateSize: stateData.length,
    });
  }

  return {
    cmd: NetplayCmd.LOAD_SAVESTATE,
    frameNumber,
    uncompressedSize,
    state: Buffer.from(stateData),
  };
};

/**
 * Parse a PAUSE command payload.
 */
export const parsePauseCommand = (payload: Buffer): PauseCommand => {
  return {
    cmd: NetplayCmd.PAUSE,
    nickname: readString(payload, 0, MAX_NICK_LEN),
  };
};

/**
 * Parse a RESUME command payload.
 */
export const parseResumeCommand = (): ResumeCommand => {
  return { cmd: NetplayCmd.RESUME };
};

/**
 * Parse a STALL command payload.
 */
export const parseStallCommand = (payload: Buffer): StallCommand => {
  return {
    cmd: NetplayCmd.STALL,
    frames: payload.length >= UINT32_SIZE ? payload.readUInt32BE(0) : 0,
  };
};

/**
 * Parse a RESET command payload.
 */
export const parseResetCommand = (payload: Buffer): ResetCommand => {
  return {
    cmd: NetplayCmd.RESET,
    frameNumber: payload.length >= UINT32_SIZE ? payload.readUInt32BE(0) : 0,
  };
};

/**
 * Parse a PLAYER_CHAT command payload.
 */
export const parsePlayerChatCommand = (payload: Buffer): PlayerChatCommand => {
  const nickname = readString(payload, 0, MAX_NICK_LEN);
  const message = payload.subarray(MAX_NICK_LEN).toString('utf8');
  return {
    cmd: NetplayCmd.PLAYER_CHAT,
    nickname,
    message,
  };
};

/**
 * Parse a PING_REQUEST command payload.
 * Per reference: no payload.
 */
export const parsePingRequestCommand = (): PingRequestCommand => {
  return { cmd: NetplayCmd.PING_REQUEST };
};

/**
 * Parse a PING_RESPONSE command payload.
 * Per reference: no payload.
 */
export const parsePingResponseCommand = (): PingResponseCommand => {
  return { cmd: NetplayCmd.PING_RESPONSE };
};

/**
 * Parse a PLAY command payload.
 * Per reference: slave (1 bit), reserved (7 bits), share_mode (8 bits), devices (16 bits)
 */
export const parsePlayCommand = (payload: Buffer): PlayCommand => {
  // Payload may be empty (older clients) or 4 bytes
  if (payload.length === 0) {
    return {
      cmd: NetplayCmd.PLAY,
      asSlave: false,
      shareMode: 0,
      requestedDevices: 0,
    };
  }

  const flags = payload.readUInt32BE(0);
  return {
    cmd: NetplayCmd.PLAY,
    asSlave: (flags & NETPLAY_CMD_PLAY_BIT_SLAVE) !== 0,
    shareMode: (flags >>> SHIFT_16BIT) & MASK_8BIT,
    requestedDevices: flags & MASK_16BIT,
  };
};

/**
 * Parse a setting command (SETTING_ALLOW_PAUSING, SETTING_INPUT_LATENCY_FRAMES, etc.)
 * These are server configuration notifications sent to clients.
 */
const parseSettingCommand = (cmd: NetplayCmd.SETTING_ALLOW_PAUSING | NetplayCmd.SETTING_INPUT_LATENCY_FRAMES, payload: Buffer): SettingCommand => {
  // Settings typically have a uint32 value
  const value = payload.length >= UINT32_SIZE ? payload.readUInt32BE(0) : 0;
  return { cmd, value };
};

/**
 * Parse a raw command into a typed command object.
 */
export const parseCommand = (raw: RawCommand): ParsedCommand => {
  switch (raw.cmd) {
    case NetplayCmd.INPUT:
      return parseInputCommand(raw.payload);
    case NetplayCmd.NOINPUT:
      return parseNoInputCommand(raw.payload);
    case NetplayCmd.NICK:
      return parseNickCommand(raw.payload);
    case NetplayCmd.PASSWORD:
      return parsePasswordCommand(raw.payload);
    case NetplayCmd.INFO:
      return parseInfoCommand(raw.payload);
    case NetplayCmd.SYNC:
      return parseSyncCommand(raw.payload);
    case NetplayCmd.MODE:
      return parseModeCommand(raw.payload);
    case NetplayCmd.MODE_REFUSED:
      return parseModeRefusedCommand(raw.payload);
    case NetplayCmd.CRC:
      return parseCrcCommand(raw.payload);
    case NetplayCmd.LOAD_SAVESTATE:
      return parseLoadSavestateCommand(raw.payload);
    case NetplayCmd.PAUSE:
      return parsePauseCommand(raw.payload);
    case NetplayCmd.RESUME:
      return parseResumeCommand();
    case NetplayCmd.STALL:
      return parseStallCommand(raw.payload);
    case NetplayCmd.RESET:
      return parseResetCommand(raw.payload);
    case NetplayCmd.PLAYER_CHAT:
      return parsePlayerChatCommand(raw.payload);
    case NetplayCmd.PING_REQUEST:
      return parsePingRequestCommand();
    case NetplayCmd.PING_RESPONSE:
      return parsePingResponseCommand();
    case NetplayCmd.ACK:
      return { cmd: NetplayCmd.ACK };
    case NetplayCmd.NAK:
      return { cmd: NetplayCmd.NAK };
    case NetplayCmd.DISCONNECT:
      return { cmd: NetplayCmd.DISCONNECT };
    case NetplayCmd.REQUEST_SAVESTATE:
      return { cmd: NetplayCmd.REQUEST_SAVESTATE };
    case NetplayCmd.SPECTATE:
      return { cmd: NetplayCmd.SPECTATE };
    case NetplayCmd.PLAY:
      return parsePlayCommand(raw.payload);
    case NetplayCmd.SETTING_ALLOW_PAUSING:
      return parseSettingCommand(raw.cmd, raw.payload);
    case NetplayCmd.SETTING_INPUT_LATENCY_FRAMES:
      return parseSettingCommand(raw.cmd, raw.payload);
    default:
      // Log unknown commands but don't throw - allows forward compatibility
      netplayLogger.debug('PROTOCOL', `Ignoring unknown command: 0x${raw.cmd.toString(HEX_RADIX)}`, {
        payloadSize: raw.payload.length,
      });
      return { cmd: raw.cmd };
  }
};
