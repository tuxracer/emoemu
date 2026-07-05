// =============================================================================
// File Size Constants
// =============================================================================

/** Minimum file size for a valid ROM (most ROMs are at least 8KB) */
export const MIN_ROM_SIZE = 1024;

/** Size of buffer to read for binary detection (small for speed) */
export const BINARY_CHECK_SIZE = 512;

/** Maximum bytes to read for ROM header metadata extraction (default fallback) */
export const HEADER_READ_SIZE = 65536;

// =============================================================================
// Per-Format Header Size Requirements
// =============================================================================

/** NES: iNES header is 16 bytes, but read 512 for binary detection */
export const NES_REQUIRED_HEADER_SIZE = 512;

/** Game Boy: Header ends at 0x150 (336 bytes) */
export const GB_REQUIRED_HEADER_SIZE = 512;

/** SNES: HiROM with copier header at 0x101C0 + 32 bytes = 66,016 bytes */
export const SNES_REQUIRED_HEADER_SIZE = 66048;

/** Genesis: Header at 0x100-0x200 (512 bytes) */
export const GENESIS_REQUIRED_HEADER_SIZE = 512;

/** GBA: Header at 0x00-0xC0 (192 bytes), read 512 for binary detection */
export const GBA_REQUIRED_HEADER_SIZE = 512;

/** Non-printable character ratio threshold for binary detection (10%) */
export const BINARY_DETECTION_THRESHOLD = 0.1;

// =============================================================================
// File Size Formatting
// =============================================================================

/** Bytes in a kilobyte */
export const BYTES_PER_KB = 1024;

/** Bytes in a megabyte */
export const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

// =============================================================================
// iNES Header Constants
// =============================================================================

/** iNES header minimum size (16 bytes) */
export const INES_HEADER_SIZE = 16;

/** iNES magic bytes */
export const INES_MAGIC_N = 0x4e;
export const INES_MAGIC_E = 0x45;
export const INES_MAGIC_S = 0x53;
export const INES_MAGIC_EOF = 0x1a;

/** iNES header byte indices */
export const INES_PRG_BANKS_BYTE = 4;
export const INES_CHR_BANKS_BYTE = 5;
export const INES_FLAGS6_BYTE = 6;
export const INES_FLAGS7_BYTE = 7;

/** iNES mapper extraction constants */
export const INES_MAPPER_HIGH_SHIFT = 4;
export const INES_MAPPER_LOW_MASK = 0x0f;
export const INES_MAPPER_HIGH_MASK = 0xf0;

/** iNES PRG/CHR bank sizes */
export const INES_PRG_BANK_SIZE_KB = 16;
export const INES_CHR_BANK_SIZE_KB = 8;

/** iNES flags6 battery bit */
export const INES_BATTERY_BIT = 0x02;

/** iNES flags7 PAL bit */
export const INES_PAL_BIT = 0x01;

/** NES 2.0 format detection */
export const NES2_FORMAT_MASK = 0x0c;
export const NES2_FORMAT_VALUE = 0x08;
export const NES2_PRG_RAM_BYTE = 10;
export const NES2_PRG_RAM_MASK = 0x0f;
export const NES2_PRG_RAM_MAX_SHIFT = 16;
export const NES2_PRG_RAM_BASE = 64;

/** Default NES SRAM size (8KB) */
export const DEFAULT_NES_SRAM_KB = 8;

// =============================================================================
// Game Boy Header Constants
// =============================================================================

/** Minimum GB header size */
export const GB_MIN_HEADER_SIZE = 0x150;

/** GB header field offsets */
export const GB_TITLE_START = 0x134;
export const GB_TITLE_END = 0x144;
export const GB_CGB_FLAG = 0x143;
export const GB_SGB_FLAG = 0x146;
export const GB_CART_TYPE = 0x147;
export const GB_ROM_SIZE = 0x148;
export const GB_RAM_SIZE = 0x149;
export const GB_OLD_LICENSEE = 0x14b;
export const GB_NEW_LICENSEE_START = 0x144;
export const GB_NEW_LICENSEE_END = 0x145;
export const GB_HEADER_CHECKSUM = 0x14d;
export const GB_CHECKSUM_START = 0x134;
export const GB_CHECKSUM_END = 0x14c;

/** GB special values */
export const GB_NEW_LICENSEE_MARKER = 0x33;
export const GB_SGB_SUPPORT_VALUE = 0x03;
export const GB_CGB_ENHANCED_VALUE = 0x80;
export const GB_CGB_ONLY_VALUE = 0xc0;

/** GB cartridge types with battery - individual values */
export const GB_CART_MBC1_RAM_BATTERY = 0x03;
export const GB_CART_MBC2_BATTERY = 0x06;
export const GB_CART_MBC3_TIMER_BATTERY = 0x0f;
export const GB_CART_MBC3_TIMER_RAM_BATTERY = 0x10;
export const GB_CART_MBC3_RAM_BATTERY = 0x13;
export const GB_CART_MBC5_RAM_BATTERY = 0x1b;
export const GB_CART_MBC5_RUMBLE_RAM_BATTERY = 0x1e;

/** GB cartridge types with battery */
export const GB_BATTERY_CART_TYPES = [
  GB_CART_MBC1_RAM_BATTERY,
  GB_CART_MBC2_BATTERY,
  GB_CART_MBC3_TIMER_BATTERY,
  GB_CART_MBC3_TIMER_RAM_BATTERY,
  GB_CART_MBC3_RAM_BATTERY,
  GB_CART_MBC5_RAM_BATTERY,
  GB_CART_MBC5_RUMBLE_RAM_BATTERY,
] as const;

/** GB cartridge type names lookup table */
export const GB_CARTRIDGE_TYPES: Record<number, string> = {
  0x00: 'ROM Only',
  0x01: 'MBC1',
  0x02: 'MBC1+RAM',
  0x03: 'MBC1+RAM+Battery',
  0x05: 'MBC2',
  0x06: 'MBC2+Battery',
  0x0f: 'MBC3+Timer+Battery',
  0x10: 'MBC3+Timer+RAM+Battery',
  0x11: 'MBC3',
  0x12: 'MBC3+RAM',
  0x13: 'MBC3+RAM+Battery',
  0x19: 'MBC5',
  0x1a: 'MBC5+RAM',
  0x1b: 'MBC5+RAM+Battery',
  0x1c: 'MBC5+Rumble',
  0x1d: 'MBC5+Rumble+RAM',
  0x1e: 'MBC5+Rumble+RAM+Battery',
};

/** GB ROM size names lookup table */
export const GB_ROM_SIZES: Record<number, string> = {
  0x00: '32 KB',
  0x01: '64 KB',
  0x02: '128 KB',
  0x03: '256 KB',
  0x04: '512 KB',
  0x05: '1 MB',
  0x06: '2 MB',
  0x07: '4 MB',
  0x08: '8 MB',
};

/** GB RAM size names lookup table */
export const GB_RAM_SIZES: Record<number, string> = {
  0x01: '2 KB',
  0x02: '8 KB',
  0x03: '32 KB',
  0x04: '128 KB',
  0x05: '64 KB',
};

// =============================================================================
// SNES Header Constants
// =============================================================================

/** SNES header locations (without/with copier header) */
export const SNES_LOROM_OFFSET = 0x7fc0;
export const SNES_HIROM_OFFSET = 0xffc0;
export const SNES_LOROM_COPIER_OFFSET = 0x81c0;
export const SNES_HIROM_COPIER_OFFSET = 0x101c0;

/** SNES header requires 32 bytes minimum */
export const SNES_HEADER_MIN_SIZE = 32;

/** SNES header field offsets (relative to header base) */
export const SNES_TITLE_LENGTH = 21;
export const SNES_MAKEUP_OFFSET = 0x15;
export const SNES_ROM_TYPE_OFFSET = 0x16;
export const SNES_ROM_SIZE_OFFSET = 0x17;
export const SNES_SRAM_SIZE_OFFSET = 0x18;
export const SNES_COUNTRY_OFFSET = 0x19;
export const SNES_PUBLISHER_OFFSET = 0x1a;
export const SNES_CHECKSUM_OFFSET = 0x1e;
export const SNES_CHECKSUM_HIGH_OFFSET = 0x1f;
export const SNES_COMPLEMENT_OFFSET = 0x1c;
export const SNES_COMPLEMENT_HIGH_OFFSET = 0x1d;

/** SNES checksum XOR mask */
export const SNES_CHECKSUM_XOR = 0xffff;

/** SNES makeup byte bits */
export const SNES_HIROM_BIT = 0x01;
export const SNES_FASTROM_BIT = 0x10;

/** SNES ROM types without special chips */
export const SNES_ROM_ONLY = 0x00;
export const SNES_ROM_RAM = 0x01;
export const SNES_ROM_RAM_BATTERY = 0x02;

/** SNES ROM types with battery - individual values */
export const SNES_ROM_TYPE_BATTERY = 0x02;
export const SNES_ROM_TYPE_DSP_BATTERY = 0x05;
export const SNES_ROM_TYPE_SUPERFX_BATTERY = 0x15;
export const SNES_ROM_TYPE_SUPERFX2_BATTERY = 0x1a;
export const SNES_ROM_TYPE_OBC1_BATTERY = 0x25;
export const SNES_ROM_TYPE_SA1_BATTERY = 0x35;
export const SNES_ROM_TYPE_SDD1_BATTERY = 0x45;
export const SNES_ROM_TYPE_SRTC_BATTERY = 0x55;

/** SNES ROM types with battery */
export const SNES_BATTERY_ROM_TYPES = [
  SNES_ROM_TYPE_BATTERY,
  SNES_ROM_TYPE_DSP_BATTERY,
  SNES_ROM_TYPE_SUPERFX_BATTERY,
  SNES_ROM_TYPE_SUPERFX2_BATTERY,
  SNES_ROM_TYPE_OBC1_BATTERY,
  SNES_ROM_TYPE_SA1_BATTERY,
  SNES_ROM_TYPE_SDD1_BATTERY,
  SNES_ROM_TYPE_SRTC_BATTERY,
] as const;

/** SNES chip type names lookup table */
export const SNES_CHIP_TYPES: Record<number, string> = {
  0x00: 'ROM',
  0x01: 'ROM+RAM',
  0x02: 'ROM+RAM+Battery',
  0x03: 'DSP',
  0x04: 'DSP+RAM',
  0x05: 'DSP+RAM+Battery',
  0x13: 'SuperFX',
  0x14: 'SuperFX+RAM',
  0x15: 'SuperFX+RAM+Battery',
  0x1a: 'SuperFX2+RAM+Battery',
  0x23: 'OBC1',
  0x24: 'OBC1+RAM',
  0x25: 'OBC1+RAM+Battery',
  0x33: 'SA-1',
  0x34: 'SA-1+RAM',
  0x35: 'SA-1+RAM+Battery',
  0x43: 'S-DD1',
  0x45: 'S-DD1+RAM+Battery',
  0x55: 'S-RTC+RAM+Battery',
  0xe3: 'Super Game Boy',
  0xf3: 'Cx4',
  0xf5: 'SPC7110',
  0xf6: 'SPC7110+RTC',
  0xf9: 'ST010/ST011',
};

/** SNES size code max */
export const SNES_SIZE_CODE_MAX = 16;

/** SNES PAL region threshold */
export const SNES_PAL_THRESHOLD = 0x02;

// =============================================================================
// Genesis Header Constants
// =============================================================================

/** Genesis header minimum size */
export const GENESIS_MIN_HEADER_SIZE = 0x200;

/** Genesis header field offsets */
export const GENESIS_SYSTEM_TYPE_START = 0x100;
export const GENESIS_SYSTEM_TYPE_END = 0x110;
export const GENESIS_DOMESTIC_NAME_START = 0x120;
export const GENESIS_DOMESTIC_NAME_END = 0x150;
export const GENESIS_OVERSEAS_NAME_START = 0x150;
export const GENESIS_OVERSEAS_NAME_END = 0x180;
export const GENESIS_SERIAL_START = 0x183;
export const GENESIS_SERIAL_END = 0x18e;
export const GENESIS_IO_SUPPORT_START = 0x190;
export const GENESIS_IO_SUPPORT_END = 0x1a0;
export const GENESIS_ROM_START_ADDR = 0x1a0;
export const GENESIS_ROM_END_ADDR = 0x1a4;
export const GENESIS_RAM_START_ADDR = 0x1b4;
export const GENESIS_RAM_END_ADDR = 0x1b8;
export const GENESIS_REGION_START = 0x1f0;
export const GENESIS_REGION_END = 0x1f3;
export const GENESIS_COPYRIGHT_START = 0x110;
export const GENESIS_COPYRIGHT_END = 0x120;

/** Genesis size validation */
export const GENESIS_MAX_ROM_SIZE = 0x10000000;
export const GENESIS_MAX_RAM_SIZE = 0x100000;
export const GENESIS_INVALID_RAM_MARKER = 0xffffffff;

// =============================================================================
// GBA Header Constants
// =============================================================================

/** GBA header minimum size */
export const GBA_MIN_HEADER_SIZE = 0xc0;

/** GBA header field offsets */
export const GBA_TITLE_START = 0xa0;
export const GBA_TITLE_END = 0xac;
export const GBA_GAME_CODE_START = 0xac;
export const GBA_GAME_CODE_END = 0xb0;
export const GBA_MAKER_CODE_START = 0xb0;
export const GBA_MAKER_CODE_END = 0xb2;
export const GBA_UNIT_CODE = 0xb3;
export const GBA_HEADER_CHECKSUM = 0xbd;
export const GBA_CHECKSUM_START = 0xa0;
export const GBA_CHECKSUM_END = 0xbd;

/** GBA valid unit code */
export const GBA_VALID_UNIT_CODE = 0x96;

/** GBA checksum adjustment */
export const GBA_CHECKSUM_ADJUSTMENT = 0x19;

/** GBA game code region index (4th character) */
export const GBA_REGION_CHAR_INDEX = 3;

/** GBA game code length */
export const GBA_GAME_CODE_LENGTH = 4;

/** GBA maker code length */
export const GBA_MAKER_CODE_LENGTH = 2;

// =============================================================================
// Checksum Constants
// =============================================================================

/** 8-bit checksum mask */
export const CHECKSUM_BYTE_MASK = 0xff;

