import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  NetplayCmd,
  CONNECTION_MAGIC,
  EXTENDED_HEADER_SIZE,
  MAX_NICK_LEN,
  CORE_NAME_LEN,
  MAX_INPUT_DEVICES,
} from '..';
import {
  // Protocol functions
  createConnectionHeader,
  validateConnectionHeader,
  parseConnectionHeader,
  parsePlatformMagic,
  hasValidConnectionMagic,
  hashPassword,
  encodeCommand,
  decodeCommand,
  parseCommand,

  // Command builders
  buildInputCommand,
  buildNoInputCommand,
  buildNickCommand,
  buildPasswordCommand,
  buildInfoCommand,
  buildSyncCommand,
  buildModeCommand,
  buildModeRefusedCommand,
  buildCrcCommand,
  buildLoadSavestateCommand,
  buildPauseCommand,
  buildResumeCommand,
  buildStallCommand,
  buildResetCommand,
  buildPlayerChatCommand,
  buildPingRequestCommand,
  buildPingResponseCommand,
  buildAckCommand,
  buildNakCommand,
  buildDisconnectCommand,
  buildSpectateCommand,
  buildPlayCommand,
  buildRequestSavestateCommand,

  // Command parsers
  parseInputCommand,
  parseNoInputCommand,
  parseNickCommand,
  parsePasswordCommand,
  parseInfoCommand,
  parseSyncCommand,
  parseModeCommand,
  parseModeRefusedCommand,
  parseCrcCommand,
  parseLoadSavestateCommand,
  parsePauseCommand,
  parseStallCommand,
  parseResetCommand,
  parsePlayerChatCommand,
} from '.';

describe('Netplay Protocol', () => {
  describe('Connection Header', () => {
    it('should create valid 24-byte connection header', () => {
      const header = createConnectionHeader();
      // Extended header is 24 bytes to match RetroArch format
      expect(header.length).toBe(24);
      expect(header.readUInt32BE(0)).toBe(CONNECTION_MAGIC);
    });

    it('should create header with options (nickname sent via NICK command)', () => {
      const header = createConnectionHeader({ isServer: false });
      // Header is still 24 bytes
      expect(header.length).toBe(24);
      expect(header.readUInt32BE(0)).toBe(CONNECTION_MAGIC);
    });

    it('should validate correct header magic', () => {
      const header = createConnectionHeader();
      expect(hasValidConnectionMagic(header)).toBe(true);
      // Legacy validation also works
      expect(validateConnectionHeader(header)).toBe(true);
    });

    it('should parse connection header', () => {
      const header = createConnectionHeader();
      const result = parseConnectionHeader(header);
      // Parses the full 24-byte extended header
      expect(result).not.toBeNull();
      expect(result?.header.magic).toBe(CONNECTION_MAGIC);
      expect(result?.bytesConsumed).toBe(EXTENDED_HEADER_SIZE);
      expect(result?.header.nickname).toBe(''); // No embedded nickname
    });

    it('should advertise protocol 7 in the server header protocol word', () => {
      // RetroArch clients read word 4 of the server header as THE
      // negotiated protocol and gate v6+ commands (SETTINGs, chat, ping)
      // on it — advertising less would make them NAK our post-SYNC traffic
      const header = createConnectionHeader({ isServer: true, salt: 0 });
      expect(header.readUInt32BE(16)).toBe(7);
    });

    it('should propose low protocol with the highest in the salt word for clients', () => {
      // RetroArch client convention: header word 3 = highest supported
      // protocol (the "salt field hack"), word 4 = lowest
      const header = createConnectionHeader({ isServer: false });
      expect(header.readUInt32BE(12)).toBe(7);
      expect(header.readUInt32BE(16)).toBe(5);
    });

    it('should encode the platform magic per RetroArch layout', () => {
      // bit30 = big-endian flag, bits 29-15 = sizeof(size_t),
      // bits 14-0 = sizeof(long); we present as little-endian 64-bit
      const header = createConnectionHeader();
      const platformMagic = header.readUInt32BE(4);
      expect(platformMagic).toBe((8 << 15) | 8);

      const parsed = parsePlatformMagic(platformMagic);
      expect(parsed.isBigEndian).toBe(false);
      expect(parsed.sizeOfSizeT).toBe(8);
      expect(parsed.sizeOfLong).toBe(8);
    });

    it('should reject invalid header magic', () => {
      const invalid = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      expect(hasValidConnectionMagic(invalid)).toBe(false);
      expect(validateConnectionHeader(invalid)).toBe(false);
    });

    it('should reject too-short header', () => {
      const short = Buffer.from([0x52, 0x41]);
      expect(hasValidConnectionMagic(short)).toBe(false);
      expect(parseConnectionHeader(short)).toBeNull();
    });

    it('should return null for incomplete header', () => {
      // Only magic, no other fields
      const partial = Buffer.alloc(4);
      partial.writeUInt32BE(CONNECTION_MAGIC, 0);
      expect(hasValidConnectionMagic(partial)).toBe(true);
      expect(parseConnectionHeader(partial)).toBeNull();
    });
  });

  describe('Password Hashing', () => {
    // RetroArch hashes sha256(sprintf("%08lX", salt) + password): the salt
    // as exactly 8 uppercase zero-padded hex chars, prepended to the password
    it('should hash the salt-prefixed password like RetroArch', () => {
      const hash = hashPassword('secret', 0x2a);
      expect(hash).toBe(createHash('sha256').update('0000002Asecret').digest('hex'));
      expect(hash.length).toBe(64);
    });

    it('should uppercase the salt hex digits', () => {
      expect(hashPassword('pw', 0xabcdef12)).toBe(
        createHash('sha256').update('ABCDEF12pw').digest('hex')
      );
    });

    it('should zero-pad the salt to 8 hex chars', () => {
      expect(hashPassword('pw', 1)).toBe(
        createHash('sha256').update('00000001pw').digest('hex')
      );
    });

    it('should treat the salt as unsigned 32-bit', () => {
      // Salts above 0x7FFFFFFF must not render with a sign
      expect(hashPassword('pw', 0xfffffffe)).toBe(
        createHash('sha256').update('FFFFFFFEpw').digest('hex')
      );
    });

    it('should produce different hashes for different salts', () => {
      expect(hashPassword('password', 1)).not.toBe(hashPassword('password', 2));
    });

    it('should produce different hashes for different passwords', () => {
      expect(hashPassword('password1', 1)).not.toBe(hashPassword('password2', 1));
    });
  });

  describe('Command Encoding/Decoding', () => {
    it('should encode command with empty payload', () => {
      const encoded = encodeCommand(NetplayCmd.ACK);
      expect(encoded.length).toBe(8); // 4 bytes cmd + 4 bytes size
      expect(encoded.readUInt32BE(0)).toBe(NetplayCmd.ACK);
      expect(encoded.readUInt32BE(4)).toBe(0);
    });

    it('should encode command with payload', () => {
      const payload = Buffer.from([1, 2, 3, 4]);
      const encoded = encodeCommand(NetplayCmd.INPUT, payload);
      expect(encoded.length).toBe(12); // 8 header + 4 payload
      expect(encoded.readUInt32BE(0)).toBe(NetplayCmd.INPUT);
      expect(encoded.readUInt32BE(4)).toBe(4);
      expect(encoded.subarray(8)).toEqual(payload);
    });

    it('should decode complete command', () => {
      const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      const encoded = encodeCommand(NetplayCmd.CRC, payload);

      const result = decodeCommand(encoded);
      expect(result).not.toBeNull();
      expect(result!.command.cmd).toBe(NetplayCmd.CRC);
      expect(result!.command.payload).toEqual(payload);
      expect(result!.bytesConsumed).toBe(12);
    });

    it('should return null for incomplete command', () => {
      const partial = Buffer.from([0x00, 0x00, 0x00, 0x03]); // Only cmd, no size
      expect(decodeCommand(partial)).toBeNull();
    });

    it('should return null when payload is incomplete', () => {
      const buffer = Buffer.alloc(10);
      buffer.writeUInt32BE(NetplayCmd.INPUT, 0);
      buffer.writeUInt32BE(100, 4); // Claims 100 bytes but only 2 available
      expect(decodeCommand(buffer)).toBeNull();
    });

    it('should handle multiple commands in buffer', () => {
      const cmd1 = encodeCommand(NetplayCmd.ACK);
      const cmd2 = encodeCommand(NetplayCmd.NAK);
      const combined = Buffer.concat([cmd1, cmd2]);

      const result1 = decodeCommand(combined);
      expect(result1).not.toBeNull();
      expect(result1!.command.cmd).toBe(NetplayCmd.ACK);

      const remaining = combined.subarray(result1!.bytesConsumed);
      const result2 = decodeCommand(remaining);
      expect(result2).not.toBeNull();
      expect(result2!.command.cmd).toBe(NetplayCmd.NAK);
    });
  });

  describe('INPUT Command', () => {
    it('should build INPUT command without analog', () => {
      const encoded = buildInputCommand(1000, 1, false, 0x00ff);
      const result = decodeCommand(encoded)!;
      const parsed = parseInputCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.INPUT);
      expect(parsed.frameNumber).toBe(1000);
      expect(parsed.clientId).toBe(1);
      expect(parsed.joypadState).toBe(0x00ff);
      expect(parsed.analogLeft).toBeUndefined();
    });

    it('should build INPUT command with isServer parameter (ignored per RetroArch spec)', () => {
      // Per RetroArch reference (send_input_frame), the isServer flag is NOT sent in the wire format
      // The receiver determines server origin from the connection, not from the INPUT packet
      // The isServer parameter is kept for API compatibility but ignored
      const encoded = buildInputCommand(500, 0, true, 0x1234);
      const result = decodeCommand(encoded)!;
      const parsed = parseInputCommand(result.command.payload);

      expect(parsed.clientId).toBe(0);
      expect(parsed.joypadState).toBe(0x1234);
    });

    it('should build INPUT command with deviceBitmap parameter (ignored per RetroArch spec)', () => {
      // Per RetroArch reference (send_input_frame), the device bitmap is NOT sent in the wire format
      // The receiver looks up client_devices[client_num] from SYNC state to know which devices
      // The deviceBitmap parameter is kept for API compatibility but ignored
      const encoded = buildInputCommand(100, 2, false, 0xabcd, 0x6);
      const result = decodeCommand(encoded)!;
      const parsed = parseInputCommand(result.command.payload);

      expect(parsed.joypadState).toBe(0xabcd);
      expect(parsed.clientId).toBe(2);
    });

    it('should round-trip through parseCommand', () => {
      const encoded = buildInputCommand(999, 5, true, 0x5555);
      const result = decodeCommand(encoded)!;
      const parsed = parseCommand(result.command);

      expect(parsed.cmd).toBe(NetplayCmd.INPUT);
      if ('frameNumber' in parsed) {
        expect(parsed.frameNumber).toBe(999);
      }
      if ('clientId' in parsed) {
        expect(parsed.clientId).toBe(5);
      }
    });
  });

  describe('NOINPUT Command', () => {
    it('should build and parse NOINPUT', () => {
      const encoded = buildNoInputCommand(12345);
      const result = decodeCommand(encoded)!;
      const parsed = parseNoInputCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.NOINPUT);
      expect(parsed.frameNumber).toBe(12345);
    });
  });

  describe('NICK Command', () => {
    it('should build and parse NICK', () => {
      const encoded = buildNickCommand('Player1');
      const result = decodeCommand(encoded)!;
      const parsed = parseNickCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.NICK);
      expect(parsed.nickname).toBe('Player1');
    });

    it('should truncate long nicknames', () => {
      const longNick = 'A'.repeat(100);
      const encoded = buildNickCommand(longNick);
      const result = decodeCommand(encoded)!;
      const parsed = parseNickCommand(result.command.payload);

      expect(parsed.nickname.length).toBeLessThanOrEqual(MAX_NICK_LEN - 1);
    });

    it('should handle empty nickname', () => {
      const encoded = buildNickCommand('');
      const result = decodeCommand(encoded)!;
      const parsed = parseNickCommand(result.command.payload);

      expect(parsed.nickname).toBe('');
    });
  });

  describe('PASSWORD Command', () => {
    it('should build and parse PASSWORD', () => {
      const hash = hashPassword('secret', 0x1234abcd);
      const encoded = buildPasswordCommand(hash);
      const result = decodeCommand(encoded)!;
      const parsed = parsePasswordCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.PASSWORD);
      expect(parsed.passwordHash).toBe(hash);
    });
  });

  describe('INFO Command', () => {
    it('should build and parse INFO', () => {
      const encoded = buildInfoCommand('bsnes', '115.1', 0xdeadbeef);
      const result = decodeCommand(encoded)!;
      const parsed = parseInfoCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.INFO);
      expect(parsed.coreName).toBe('bsnes');
      expect(parsed.coreVersion).toBe('115.1');
      expect(parsed.contentCrc).toBe(0xdeadbeef);
    });

    it('should truncate long core names', () => {
      const longName = 'X'.repeat(100);
      const encoded = buildInfoCommand(longName, '1.0', 0);
      const result = decodeCommand(encoded)!;
      const parsed = parseInfoCommand(result.command.payload);

      expect(parsed.coreName.length).toBeLessThanOrEqual(CORE_NAME_LEN - 1);
    });
  });

  describe('SYNC Command', () => {
    it('should build and parse SYNC', () => {
      const devices = [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const shareModes = new Array(MAX_INPUT_DEVICES).fill(0);
      const deviceClients = new Array(MAX_INPUT_DEVICES).fill(0);
      const sram = Buffer.from([1, 2, 3, 4, 5]);
      const encoded = buildSyncCommand(1000, false, 2, devices, shareModes, deviceClients, 'Host', sram);
      const result = decodeCommand(encoded)!;
      const parsed = parseSyncCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.SYNC);
      expect(parsed.frameNumber).toBe(1000);
      expect(parsed.paused).toBe(false);
      expect(parsed.clientNumber).toBe(2);
      expect(parsed.devices.slice(0, 2)).toEqual([1, 1]);
      expect(parsed.clientNick).toBe('Host');
      expect(parsed.sram).toEqual(sram);
    });

    it('should handle paused state', () => {
      const devices = new Array(MAX_INPUT_DEVICES).fill(0);
      const shareModes = new Array(MAX_INPUT_DEVICES).fill(0);
      const deviceClients = new Array(MAX_INPUT_DEVICES).fill(0);
      const encoded = buildSyncCommand(500, true, 1, devices, shareModes, deviceClients, 'Pauser', Buffer.alloc(0));
      const result = decodeCommand(encoded)!;
      const parsed = parseSyncCommand(result.command.payload);

      expect(parsed.paused).toBe(true);
      expect(parsed.clientNumber).toBe(1);
    });
  });

  describe('MODE Command', () => {
    it('should build and parse MODE for playing', () => {
      const shareModes = new Array(MAX_INPUT_DEVICES).fill(0);
      const encoded = buildModeCommand(5000, true, true, false, 1, 0b11, shareModes, 'Player1');
      const result = decodeCommand(encoded)!;
      const parsed = parseModeCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.MODE);
      expect(parsed.frameNumber).toBe(5000);
      expect(parsed.you).toBe(true);
      expect(parsed.playing).toBe(true);
      expect(parsed.slave).toBe(false);
      expect(parsed.clientNumber).toBe(1);
      expect(parsed.deviceBitmap).toBe(0b11);
      expect(parsed.nick).toBe('Player1');
    });

    it('should build and parse MODE for spectating', () => {
      const shareModes = new Array(MAX_INPUT_DEVICES).fill(0);
      const encoded = buildModeCommand(100, true, false, false, 0, 0, shareModes, 'Spectator');
      const result = decodeCommand(encoded)!;
      const parsed = parseModeCommand(result.command.payload);

      expect(parsed.playing).toBe(false);
    });

    it('should handle slave mode', () => {
      const shareModes = new Array(MAX_INPUT_DEVICES).fill(0);
      const encoded = buildModeCommand(200, false, true, true, 2, 0b01, shareModes, 'Slave');
      const result = decodeCommand(encoded)!;
      const parsed = parseModeCommand(result.command.payload);

      expect(parsed.slave).toBe(true);
    });
  });

  describe('MODE_REFUSED Command', () => {
    it('should build and parse MODE_REFUSED', () => {
      const encoded = buildModeRefusedCommand(1); // NO_SLOTS
      const result = decodeCommand(encoded)!;
      const parsed = parseModeRefusedCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.MODE_REFUSED);
      expect(parsed.reason).toBe(1);
    });
  });

  describe('CRC Command', () => {
    it('should build and parse CRC', () => {
      const encoded = buildCrcCommand(10000, 0xcafebabe);
      const result = decodeCommand(encoded)!;
      const parsed = parseCrcCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.CRC);
      expect(parsed.frameNumber).toBe(10000);
      expect(parsed.crc).toBe(0xcafebabe);
    });
  });

  describe('LOAD_SAVESTATE Command', () => {
    /**
     * Calculate the expected NETPLAY-wrapped size for a raw state.
     * Format: NETPLAY header (8) + MEM block (8 + data + padding to 16) + ACHV block (16) + END block (8)
     */
    const calculateNetplayWrappedSize = (rawSize: number): number => {
      const HEADER_SIZE = 8;
      const BLOCK_HEADER_SIZE = 8;
      const ALIGNMENT = 16;
      const memDataEnd = HEADER_SIZE + BLOCK_HEADER_SIZE + rawSize;
      const memPaddedEnd = Math.ceil(memDataEnd / ALIGNMENT) * ALIGNMENT;
      const achvBlockSize = BLOCK_HEADER_SIZE + 8; // 16
      const endBlockSize = BLOCK_HEADER_SIZE; // 8
      return memPaddedEnd + achvBlockSize + endBlockSize;
    };

    it('should build LOAD_SAVESTATE with zlib compression and parse back to original state', () => {
      const rawState = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);
      const encoded = buildLoadSavestateCommand(2000, rawState, 7);
      const result = decodeCommand(encoded)!;
      const parsed = parseLoadSavestateCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.LOAD_SAVESTATE);
      expect(parsed.frameNumber).toBe(2000);

      // State should be decompressed and unwrapped back to original
      expect(parsed.state).toEqual(rawState);
      // uncompressed_size should be the NETPLAY-wrapped size (not raw state length)
      expect(parsed.uncompressedSize).toBe(calculateNetplayWrappedSize(rawState.length));
    });

    it('should compress and decompress state data regardless of protocol version', () => {
      const rawState = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);
      const encoded = buildLoadSavestateCommand(2000, rawState, 4);
      const result = decodeCommand(encoded)!;
      const parsed = parseLoadSavestateCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.LOAD_SAVESTATE);
      expect(parsed.frameNumber).toBe(2000);
      // State should be decompressed and unwrapped back to original
      expect(parsed.state).toEqual(rawState);
      // uncompressed_size should be the NETPLAY-wrapped size
      expect(parsed.uncompressedSize).toBe(calculateNetplayWrappedSize(rawState.length));
    });

    it('should round-trip compressible data correctly', () => {
      // Create a larger, more compressible buffer (repeated data)
      const rawState = Buffer.alloc(1000, 0xaa);
      const encoded = buildLoadSavestateCommand(2000, rawState);
      const result = decodeCommand(encoded)!;
      const parsed = parseLoadSavestateCommand(result.command.payload);

      // State should be decompressed and unwrapped back to original
      expect(parsed.state).toEqual(rawState);
      expect(parsed.uncompressedSize).toBe(calculateNetplayWrappedSize(rawState.length));
    });
  });

  describe('PAUSE/RESUME Commands', () => {
    it('should build and parse PAUSE', () => {
      const encoded = buildPauseCommand('Pauser');
      const result = decodeCommand(encoded)!;
      const parsed = parsePauseCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.PAUSE);
      expect(parsed.nickname).toBe('Pauser');
    });

    it('should build RESUME', () => {
      const encoded = buildResumeCommand();
      const result = decodeCommand(encoded)!;
      expect(result.command.cmd).toBe(NetplayCmd.RESUME);
      expect(result.command.payload.length).toBe(0);
    });
  });

  describe('STALL Command', () => {
    it('should build and parse STALL', () => {
      const encoded = buildStallCommand(5);
      const result = decodeCommand(encoded)!;
      const parsed = parseStallCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.STALL);
      expect(parsed.frames).toBe(5);
    });
  });

  describe('RESET Command', () => {
    it('should build and parse RESET', () => {
      const encoded = buildResetCommand(7500);
      const result = decodeCommand(encoded)!;
      const parsed = parseResetCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.RESET);
      expect(parsed.frameNumber).toBe(7500);
    });
  });

  describe('PLAYER_CHAT Command', () => {
    it('should build and parse PLAYER_CHAT', () => {
      const encoded = buildPlayerChatCommand('Alice', 'Hello, world!');
      const result = decodeCommand(encoded)!;
      const parsed = parsePlayerChatCommand(result.command.payload);

      expect(parsed.cmd).toBe(NetplayCmd.PLAYER_CHAT);
      expect(parsed.nickname).toBe('Alice');
      expect(parsed.message).toBe('Hello, world!');
    });

    it('should handle unicode messages', () => {
      const encoded = buildPlayerChatCommand('Bob', 'こんにちは! 🎮');
      const result = decodeCommand(encoded)!;
      const parsed = parsePlayerChatCommand(result.command.payload);

      expect(parsed.message).toBe('こんにちは! 🎮');
    });
  });

  describe('PING Commands', () => {
    it('should build and parse PING_REQUEST', () => {
      const encoded = buildPingRequestCommand();
      const result = decodeCommand(encoded)!;

      expect(result.command.cmd).toBe(NetplayCmd.PING_REQUEST);
      // Per RetroArch spec, PING commands have no payload
      expect(result.command.payload.length).toBe(0);
    });

    it('should build and parse PING_RESPONSE', () => {
      const encoded = buildPingResponseCommand();
      const result = decodeCommand(encoded)!;

      expect(result.command.cmd).toBe(NetplayCmd.PING_RESPONSE);
      // Per RetroArch spec, PING commands have no payload
      expect(result.command.payload.length).toBe(0);
    });
  });

  describe('Simple Commands', () => {
    it('should build ACK', () => {
      const encoded = buildAckCommand();
      const result = decodeCommand(encoded)!;
      expect(result.command.cmd).toBe(NetplayCmd.ACK);
    });

    it('should build NAK', () => {
      const encoded = buildNakCommand();
      const result = decodeCommand(encoded)!;
      expect(result.command.cmd).toBe(NetplayCmd.NAK);
    });

    it('should build DISCONNECT', () => {
      const encoded = buildDisconnectCommand();
      const result = decodeCommand(encoded)!;
      expect(result.command.cmd).toBe(NetplayCmd.DISCONNECT);
    });

    it('should build SPECTATE', () => {
      const encoded = buildSpectateCommand();
      const result = decodeCommand(encoded)!;
      expect(result.command.cmd).toBe(NetplayCmd.SPECTATE);
    });

    it('should build PLAY', () => {
      const encoded = buildPlayCommand();
      const result = decodeCommand(encoded)!;
      expect(result.command.cmd).toBe(NetplayCmd.PLAY);
    });

    it('should build REQUEST_SAVESTATE', () => {
      const encoded = buildRequestSavestateCommand();
      const result = decodeCommand(encoded)!;
      expect(result.command.cmd).toBe(NetplayCmd.REQUEST_SAVESTATE);
    });
  });

  describe('parseCommand dispatcher', () => {
    it('should dispatch to correct parser for INPUT', () => {
      const encoded = buildInputCommand(100, 1, false, 0xff);
      const result = decodeCommand(encoded)!;
      const parsed = parseCommand(result.command);

      expect(parsed.cmd).toBe(NetplayCmd.INPUT);
    });

    it('should dispatch to correct parser for INFO', () => {
      const encoded = buildInfoCommand('test', '1.0', 123);
      const result = decodeCommand(encoded)!;
      const parsed = parseCommand(result.command);

      expect(parsed.cmd).toBe(NetplayCmd.INFO);
      if ('coreName' in parsed) {
        expect(parsed.coreName).toBe('test');
      }
    });

    it('should return UnknownCommand for unknown command', () => {
      const raw = { cmd: 0xffff as NetplayCmd, payload: Buffer.alloc(0) };
      const parsed = parseCommand(raw);
      // Unknown commands are returned as-is for forward compatibility
      expect(parsed.cmd).toBe(0xffff);
    });
  });
});
