/**
 * ROM Scanner
 *
 * Scans directories for ROM files and extracts metadata.
 */

import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, readFileSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import { groupBy, flatMap } from 'remeda';
import { calculateFileCrc32 } from '../../utils/crc32';
import { getThumbnailPath, THUMBNAIL_TYPES, type ThumbnailType } from '../../utils/paths';
import { HEX_RADIX } from '../../utils';
import { getSupportedExtensions, findMatchingCoresByExtension } from '../coreRegistry';
import { normalizePath } from '../playlist/utils';
import { getSystemName as getPlaylistSystemName } from '../playlist';
import { getSaveStateService, getBatterySaveService, buildCrcCache } from '../serviceProvider';
import type { CrcCache } from '../playlist';
import {
  MIN_ROM_SIZE,
  BINARY_CHECK_SIZE,
  HEADER_READ_SIZE,
  NES_REQUIRED_HEADER_SIZE,
  GB_REQUIRED_HEADER_SIZE,
  SNES_REQUIRED_HEADER_SIZE,
  GENESIS_REQUIRED_HEADER_SIZE,
  GBA_REQUIRED_HEADER_SIZE,
  BINARY_DETECTION_THRESHOLD,
  BYTES_PER_KB,
  BYTES_PER_MB,
  INES_HEADER_SIZE,
  INES_MAGIC_N,
  INES_MAGIC_E,
  INES_MAGIC_S,
  INES_MAGIC_EOF,
  INES_PRG_BANKS_BYTE,
  INES_CHR_BANKS_BYTE,
  INES_FLAGS6_BYTE,
  INES_FLAGS7_BYTE,
  INES_MAPPER_HIGH_SHIFT,
  INES_MAPPER_LOW_MASK,
  INES_MAPPER_HIGH_MASK,
  INES_PRG_BANK_SIZE_KB,
  INES_CHR_BANK_SIZE_KB,
  INES_BATTERY_BIT,
  INES_PAL_BIT,
  NES2_FORMAT_MASK,
  NES2_FORMAT_VALUE,
  NES2_PRG_RAM_BYTE,
  NES2_PRG_RAM_MASK,
  NES2_PRG_RAM_MAX_SHIFT,
  NES2_PRG_RAM_BASE,
  DEFAULT_NES_SRAM_KB,
  GB_MIN_HEADER_SIZE,
  GB_TITLE_START,
  GB_TITLE_END,
  GB_CGB_FLAG,
  GB_SGB_FLAG,
  GB_CART_TYPE,
  GB_ROM_SIZE,
  GB_RAM_SIZE,
  GB_OLD_LICENSEE,
  GB_NEW_LICENSEE_START,
  GB_NEW_LICENSEE_END,
  GB_HEADER_CHECKSUM,
  GB_CHECKSUM_START,
  GB_CHECKSUM_END,
  GB_NEW_LICENSEE_MARKER,
  GB_SGB_SUPPORT_VALUE,
  GB_CGB_ENHANCED_VALUE,
  GB_CGB_ONLY_VALUE,
  GB_BATTERY_CART_TYPES,
  GB_CARTRIDGE_TYPES,
  GB_ROM_SIZES,
  GB_RAM_SIZES,
  SNES_LOROM_OFFSET,
  SNES_HIROM_OFFSET,
  SNES_LOROM_COPIER_OFFSET,
  SNES_HIROM_COPIER_OFFSET,
  SNES_HEADER_MIN_SIZE,
  SNES_TITLE_LENGTH,
  SNES_MAKEUP_OFFSET,
  SNES_ROM_TYPE_OFFSET,
  SNES_ROM_SIZE_OFFSET,
  SNES_SRAM_SIZE_OFFSET,
  SNES_COUNTRY_OFFSET,
  SNES_PUBLISHER_OFFSET,
  SNES_CHECKSUM_OFFSET,
  SNES_CHECKSUM_HIGH_OFFSET,
  SNES_COMPLEMENT_OFFSET,
  SNES_COMPLEMENT_HIGH_OFFSET,
  SNES_CHECKSUM_XOR,
  SNES_HIROM_BIT,
  SNES_FASTROM_BIT,
  SNES_ROM_ONLY,
  SNES_ROM_RAM,
  SNES_ROM_RAM_BATTERY,
  SNES_BATTERY_ROM_TYPES,
  SNES_CHIP_TYPES,
  SNES_SIZE_CODE_MAX,
  SNES_PAL_THRESHOLD,
  GENESIS_MIN_HEADER_SIZE,
  GENESIS_SYSTEM_TYPE_START,
  GENESIS_SYSTEM_TYPE_END,
  GENESIS_DOMESTIC_NAME_START,
  GENESIS_DOMESTIC_NAME_END,
  GENESIS_OVERSEAS_NAME_START,
  GENESIS_OVERSEAS_NAME_END,
  GENESIS_SERIAL_START,
  GENESIS_SERIAL_END,
  GENESIS_IO_SUPPORT_START,
  GENESIS_IO_SUPPORT_END,
  GENESIS_ROM_START_ADDR,
  GENESIS_ROM_END_ADDR,
  GENESIS_RAM_START_ADDR,
  GENESIS_RAM_END_ADDR,
  GENESIS_REGION_START,
  GENESIS_REGION_END,
  GENESIS_COPYRIGHT_START,
  GENESIS_COPYRIGHT_END,
  GENESIS_MAX_ROM_SIZE,
  GENESIS_MAX_RAM_SIZE,
  GENESIS_INVALID_RAM_MARKER,
  GBA_MIN_HEADER_SIZE,
  GBA_TITLE_START,
  GBA_TITLE_END,
  GBA_GAME_CODE_START,
  GBA_GAME_CODE_END,
  GBA_MAKER_CODE_START,
  GBA_MAKER_CODE_END,
  GBA_UNIT_CODE,
  GBA_HEADER_CHECKSUM,
  GBA_CHECKSUM_START,
  GBA_CHECKSUM_END,
  GBA_VALID_UNIT_CODE,
  GBA_CHECKSUM_ADJUSTMENT,
  GBA_REGION_CHAR_INDEX,
  GBA_GAME_CODE_LENGTH,
  GBA_MAKER_CODE_LENGTH,
  CHECKSUM_BYTE_MASK,
} from './consts';

export * from './consts';

/**
 * Check if a buffer contains binary ROM data (not text).
 * Analyzes the first BINARY_CHECK_SIZE bytes for binary indicators.
 */
const isBinaryFromBuffer = (buffer: Buffer): boolean => {
  const bytesToCheck = Math.min(BINARY_CHECK_SIZE, buffer.length);

  let nullBytes = 0;
  let nonPrintable = 0;

  for (let i = 0; i < bytesToCheck; i++) {
    const byte = buffer[i];

    // Null bytes are very common in binary files, rare in text
    if (byte === 0x00) {
      nullBytes++;
    }

    // Count non-printable characters (excluding common whitespace)
    // Printable ASCII: 0x09 (tab), 0x0A (LF), 0x0D (CR), 0x20-0x7E
    const ASCII_TAB = 0x09;
    const ASCII_LF = 0x0a;
    const ASCII_CR = 0x0d;
    const ASCII_SPACE = 0x20;
    const ASCII_TILDE = 0x7e;
    if (byte !== ASCII_TAB && byte !== ASCII_LF && byte !== ASCII_CR &&
        (byte < ASCII_SPACE || byte > ASCII_TILDE)) {
      nonPrintable++;
    }
  }

  // If file contains null bytes, it's almost certainly binary
  if (nullBytes > 0) {
    return true;
  }

  // If more than 10% non-printable characters, likely binary
  const nonPrintableRatio = nonPrintable / bytesToCheck;
  return nonPrintableRatio > BINARY_DETECTION_THRESHOLD;
};

/**
 * Get the required header size for a given file extension.
 * Returns the minimum bytes needed for binary detection + metadata extraction.
 */
const getRequiredHeaderSize = (extension: string): number => {
  switch (extension) {
    case '.nes':
      return NES_REQUIRED_HEADER_SIZE;
    case '.gb':
    case '.gbc':
      return GB_REQUIRED_HEADER_SIZE;
    case '.sfc':
    case '.smc':
      return SNES_REQUIRED_HEADER_SIZE;
    case '.md':
    case '.smd':
    case '.gen':
    case '.bin':
      return GENESIS_REQUIRED_HEADER_SIZE;
    case '.gba':
      return GBA_REQUIRED_HEADER_SIZE;
    default:
      // Unknown format: use default size for safety
      return HEADER_READ_SIZE;
  }
};

/**
 * Read ROM header from file (single file open for both binary check and metadata).
 * Uses smart sizing based on file extension to minimize I/O.
 * Returns null if file is too small or can't be read.
 */
const readRomHeader = (filePath: string, fileSize: number, extension?: string): Buffer | null => {
  if (fileSize < MIN_ROM_SIZE) {
    return null;
  }

  try {
    // Use format-specific size if extension provided, otherwise use default
    const maxSize = extension ? getRequiredHeaderSize(extension) : HEADER_READ_SIZE;
    const bytesToRead = Math.min(maxSize, fileSize);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = openSync(filePath, 'r');
    let bytesRead: number;
    try {
      bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
    } finally {
      closeSync(fd);
    }
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  }
};

/**
 * Normalize a title string by trimming and collapsing multiple spaces
 */
const normalizeTitle = (title: string): string => title.trim().replace(/\s+/g, ' ');

export interface RomInfo {
  /** Full path to the ROM file */
  path: string;
  /** File name without directory */
  filename: string;
  /** File extension (lowercase, with dot) */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Human-readable file size */
  sizeFormatted: string;
  /** Last modified date */
  modified: Date;
  /** System name (e.g., "Nintendo Entertainment System") */
  system: string;
  /** System ID for core selection */
  systemId: string;
  /** Number of cores that can play this ROM */
  coreCount: number;
  /** IDs of cores that can play this ROM (cached for playlist generation) */
  coreIds: string[];
  /** Additional metadata extracted from ROM header */
  metadata: RomMetadata;
  /** Whether a save state file exists for this ROM */
  hasSaveState: boolean;
  /** Modified date of the save state file (if exists) */
  saveStateDate?: Date;
  /** Screenshot from save state (base64-encoded PNG) */
  saveStateScreenshot?: string;
  /** Frame count from save state (for estimated playtime) */
  saveStateFrameCount?: number;
  /** Whether a battery save (.srm) file exists for this ROM */
  hasBatterySave: boolean;
  /** Modified date of the battery save file (if exists) */
  batterySaveDate?: Date;
  /** CRC32 checksum of the ROM file (uppercase hex, calculated during scan) */
  crc32?: string;

  // Runtime tracking (from playlist, RetroArch compatible)
  /** Total runtime in seconds (from playlist) */
  runtimeSeconds?: number;
  /** Last played date (from playlist) */
  lastPlayed?: Date;

  // Playlist label (display name from playlist file, separate from ROM header title)
  /** Display label from playlist file (user-editable game title) */
  label?: string;
}

export interface RomMetadata {
  /** Game title (if extractable from header) */
  title?: string;
  /** Mapper number (NES) */
  mapper?: number;
  /** PRG ROM size */
  prgSize?: string;
  /** CHR ROM size */
  chrSize?: string;
  /** RAM/SRAM size */
  ramSize?: string;
  /** Region (NTSC/PAL/etc) */
  region?: string;
  /** Cartridge type (GBC) */
  cartridgeType?: string;
  /** ROM type (LoROM/HiROM for SNES) */
  romType?: string;
  /** Has battery-backed save */
  hasBattery?: boolean;
  /** Publisher/developer name */
  publisher?: string;
  /** Special chip (SNES: DSP, SuperFX, SA-1, etc.) */
  specialChip?: string;
  /** Super Game Boy support */
  sgbSupport?: boolean;
  /** Game serial/product code */
  serial?: string;
  /** Supported input devices (Genesis) */
  inputDevices?: string;
  /** Header checksum valid */
  checksumValid?: boolean;
}

/**
 * Format bytes to human-readable size
 */
const formatSize = (bytes: number): string => {
  if (bytes < BYTES_PER_KB) {return `${bytes} B`;}
  if (bytes < BYTES_PER_MB) {return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;}
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
};

/**
 * Extract metadata from NES ROM header (iNES format)
 */
const extractNesMetadata = (data: Buffer): RomMetadata => {
  const metadata: RomMetadata = {};

  try {
    // Need at least 16 bytes for iNES header
    if (data.length < INES_HEADER_SIZE) {return metadata;}

    // Check for iNES header (NES\x1A)
    if (data[0] === INES_MAGIC_N && data[1] === INES_MAGIC_E && data[2] === INES_MAGIC_S && data[3] === INES_MAGIC_EOF) {
      const prgBanks = data[INES_PRG_BANKS_BYTE];
      const chrBanks = data[INES_CHR_BANKS_BYTE];
      const flags6 = data[INES_FLAGS6_BYTE];
      const flags7 = data[INES_FLAGS7_BYTE];

      metadata.mapper = ((flags6 >> INES_MAPPER_HIGH_SHIFT) & INES_MAPPER_LOW_MASK) | (flags7 & INES_MAPPER_HIGH_MASK);
      metadata.prgSize = `${prgBanks * INES_PRG_BANK_SIZE_KB} KB`;
      metadata.chrSize = chrBanks > 0 ? `${chrBanks * INES_CHR_BANK_SIZE_KB} KB` : 'CHR RAM';
      metadata.region = (flags7 & INES_PAL_BIT) ? 'PAL' : 'NTSC';

      // Battery-backed RAM (bit 1 of flags6)
      metadata.hasBattery = (flags6 & INES_BATTERY_BIT) !== 0;

      // Check for NES 2.0 format (bits 2-3 of flags7 == 2)
      const isNes2 = (flags7 & NES2_FORMAT_MASK) === NES2_FORMAT_VALUE;
      if (isNes2 && data.length > NES2_PRG_RAM_BYTE) {
        // NES 2.0: PRG-RAM size at byte 10
        const prgRamShift = data[NES2_PRG_RAM_BYTE] & NES2_PRG_RAM_MASK;
        if (prgRamShift > 0 && prgRamShift < NES2_PRG_RAM_MAX_SHIFT) {
          const prgRamSize = NES2_PRG_RAM_BASE << prgRamShift;
          metadata.ramSize = prgRamSize >= BYTES_PER_KB ? `${prgRamSize / BYTES_PER_KB} KB` : `${prgRamSize} B`;
        }
      } else if (metadata.hasBattery) {
        // iNES 1.0: assume 8KB if battery present
        metadata.ramSize = `${DEFAULT_NES_SRAM_KB} KB`;
      }
    }
  } catch {
    // Best effort - return whatever we extracted
  }

  return metadata;
};

/**
 * Game Boy licensee codes (old format at 0x14B)
 */
const oldLicenseeCodes: Record<number, string> = {
  0x00: 'None',
  0x01: 'Nintendo',
  0x08: 'Capcom',
  0x09: 'Hot-B',
  0x0A: 'Jaleco',
  0x0B: 'Coconuts',
  0x0C: 'Elite Systems',
  0x13: 'Electronic Arts',
  0x18: 'Hudson Soft',
  0x19: 'ITC Entertainment',
  0x1A: 'Yanoman',
  0x1D: 'Clary',
  0x1F: 'Virgin',
  0x24: 'PCM Complete',
  0x25: 'San-X',
  0x28: 'Kotobuki Systems',
  0x29: 'Seta',
  0x30: 'Infogrames',
  0x31: 'Nintendo',
  0x32: 'Bandai',
  0x33: 'New licensee (see 0x144-0x145)',
  0x34: 'Konami',
  0x35: 'Hector',
  0x38: 'Capcom',
  0x39: 'Banpresto',
  0x3C: 'Entertainment i',
  0x3E: 'Gremlin',
  0x41: 'Ubisoft',
  0x42: 'Atlus',
  0x44: 'Malibu',
  0x46: 'Angel',
  0x47: 'Spectrum Holoby',
  0x49: 'Irem',
  0x4A: 'Virgin',
  0x4D: 'Malibu',
  0x4F: 'U.S. Gold',
  0x50: 'Absolute',
  0x51: 'Acclaim',
  0x52: 'Activision',
  0x53: 'American Sammy',
  0x54: 'GameTek',
  0x55: 'Park Place',
  0x56: 'LJN',
  0x57: 'Matchbox',
  0x59: 'Milton Bradley',
  0x5A: 'Mindscape',
  0x5B: 'Romstar',
  0x5C: 'Naxat Soft',
  0x5D: 'Tradewest',
  0x60: 'Titus',
  0x61: 'Virgin',
  0x67: 'Ocean',
  0x69: 'Electronic Arts',
  0x6E: 'Elite Systems',
  0x6F: 'Electro Brain',
  0x70: 'Infogrames',
  0x71: 'Interplay',
  0x72: 'Broderbund',
  0x73: 'Sculptered Soft',
  0x75: 'The Sales Curve',
  0x78: 'THQ',
  0x79: 'Accolade',
  0x7A: 'Triffix Entertainment',
  0x7C: 'Microprose',
  0x7F: 'Kemco',
  0x80: 'Misawa Entertainment',
  0x83: 'LOZC',
  0x86: 'Tokuma Shoten',
  0x8B: 'Bullet-Proof Software',
  0x8C: 'Vic Tokai',
  0x8E: 'Ape',
  0x8F: 'I\'Max',
  0x91: 'Chunsoft',
  0x92: 'Video System',
  0x93: 'Tsuburava',
  0x95: 'Varie',
  0x96: 'Yonezawa/S\'Pal',
  0x97: 'Kaneko',
  0x99: 'Arc',
  0x9A: 'Nihon Bussan',
  0x9B: 'Tecmo',
  0x9C: 'Imagineer',
  0x9D: 'Banpresto',
  0x9F: 'Nova',
  0xA1: 'Hori Electric',
  0xA2: 'Bandai',
  0xA4: 'Konami',
  0xA6: 'Kawada',
  0xA7: 'Takara',
  0xA9: 'Technos Japan',
  0xAA: 'Broderbund',
  0xAC: 'Toei Animation',
  0xAD: 'Toho',
  0xAF: 'Namco',
  0xB0: 'Acclaim',
  0xB1: 'Nexoft',
  0xB2: 'Bandai',
  0xB4: 'Enix',
  0xB6: 'HAL',
  0xB7: 'SNK',
  0xB9: 'Pony Canyon',
  0xBA: 'Culture Brain',
  0xBB: 'Sunsoft',
  0xBD: 'Sony Imagesoft',
  0xBF: 'Sammy',
  0xC0: 'Taito',
  0xC2: 'Kemco',
  0xC3: 'Squaresoft',
  0xC4: 'Tokuma Shoten',
  0xC5: 'Data East',
  0xC6: 'Tonkin House',
  0xC8: 'Koei',
  0xC9: 'UFL',
  0xCA: 'Ultra',
  0xCB: 'Vap',
  0xCC: 'Use',
  0xCD: 'Meldac',
  0xCE: 'Pony Canyon',
  0xCF: 'Angel',
  0xD0: 'Taito',
  0xD1: 'Sofel',
  0xD2: 'Quest',
  0xD3: 'Sigma Enterprises',
  0xD4: 'Ask Kodansha',
  0xD6: 'Naxat Soft',
  0xD7: 'Copya Systems',
  0xD9: 'Banpresto',
  0xDA: 'Tomy',
  0xDB: 'LJN',
  0xDD: 'NCS',
  0xDE: 'Human',
  0xDF: 'Altron',
  0xE0: 'Jaleco',
  0xE1: 'Towachiki',
  0xE2: 'Uutaka',
  0xE3: 'Varie',
  0xE5: 'Epoch',
  0xE7: 'Athena',
  0xE8: 'Asmik',
  0xE9: 'Natsume',
  0xEA: 'King Records',
  0xEB: 'Atlus',
  0xEC: 'Epic/Sony Records',
  0xEE: 'IGS',
  0xF0: 'A Wave',
  0xF3: 'Extreme Entertainment',
  0xFF: 'LJN',
};

/**
 * Game Boy new licensee codes (at 0x144-0x145, when old licensee is 0x33)
 */
const newLicenseeCodes: Record<string, string> = {
  '00': 'None',
  '01': 'Nintendo R&D1',
  '08': 'Capcom',
  '13': 'Electronic Arts',
  '18': 'Hudson Soft',
  '19': 'b-ai',
  '20': 'kss',
  '22': 'pow',
  '24': 'PCM Complete',
  '25': 'san-x',
  '28': 'Kemco Japan',
  '29': 'seta',
  '30': 'Viacom',
  '31': 'Nintendo',
  '32': 'Bandai',
  '33': 'Ocean/Acclaim',
  '34': 'Konami',
  '35': 'Hector',
  '37': 'Taito',
  '38': 'Hudson',
  '39': 'Banpresto',
  '41': 'Ubi Soft',
  '42': 'Atlus',
  '44': 'Malibu',
  '46': 'angel',
  '47': 'Bullet-Proof',
  '49': 'irem',
  '50': 'Absolute',
  '51': 'Acclaim',
  '52': 'Activision',
  '53': 'American sammy',
  '54': 'Konami',
  '55': 'Hi tech entertainment',
  '56': 'LJN',
  '57': 'Matchbox',
  '58': 'Mattel',
  '59': 'Milton Bradley',
  '60': 'Titus',
  '61': 'Virgin',
  '64': 'LucasArts',
  '67': 'Ocean',
  '69': 'Electronic Arts',
  '70': 'Infogrames',
  '71': 'Interplay',
  '72': 'Broderbund',
  '73': 'sculptured',
  '75': 'sci',
  '78': 'THQ',
  '79': 'Accolade',
  '80': 'misawa',
  '83': 'lozc',
  '86': 'Tokuma Shoten',
  '87': 'Tsukuda Original',
  '91': 'Chunsoft',
  '92': 'Video system',
  '93': 'Ocean/Acclaim',
  '95': 'Varie',
  '96': 'Yonezawa/s\'pal',
  '97': 'Kaneko',
  '99': 'Pack in soft',
  'A4': 'Konami (Yu-Gi-Oh!)',
};

/**
 * Extract metadata from Game Boy ROM header
 */
const extractGbMetadata = (data: Buffer): RomMetadata => {
  const metadata: RomMetadata = {};

  // Need at least 0x150 bytes for full header
  if (data.length < GB_MIN_HEADER_SIZE) {return metadata;}

  // Title is at 0x134-0x143
  try {
    const titleBytes = data.slice(GB_TITLE_START, GB_TITLE_END);
    const nullIndex = titleBytes.indexOf(0);
    const title = titleBytes.slice(0, nullIndex > 0 ? nullIndex : titleBytes.length).toString('ascii');
    if (title && /^[\x20-\x7E]+$/.test(title)) {
      metadata.title = normalizeTitle(title);
    }
  } catch { /* skip field */ }

  // SGB flag at 0x146
  try {
    const sgbFlag = data[GB_SGB_FLAG];
    metadata.sgbSupport = sgbFlag === GB_SGB_SUPPORT_VALUE;
  } catch { /* skip field */ }

  // Cartridge type at 0x147
  try {
    const cartType = data[GB_CART_TYPE];
    metadata.cartridgeType = GB_CARTRIDGE_TYPES[cartType] ?? `Unknown (0x${cartType.toString(HEX_RADIX)})`;

    // Check for battery based on cartridge type
    metadata.hasBattery = GB_BATTERY_CART_TYPES.some(t => t === cartType);
  } catch { /* skip field */ }

  // ROM size at 0x148
  try {
    const romSizeCode = data[GB_ROM_SIZE];
    if (GB_ROM_SIZES[romSizeCode]) {
      metadata.prgSize = GB_ROM_SIZES[romSizeCode];
    }
  } catch { /* skip field */ }

  // RAM size at 0x149
  try {
    const ramSizeCode = data[GB_RAM_SIZE];
    if (GB_RAM_SIZES[ramSizeCode]) {
      metadata.ramSize = GB_RAM_SIZES[ramSizeCode];
    }
  } catch { /* skip field */ }

  // CGB flag at 0x143
  try {
    const cgbFlag = data[GB_CGB_FLAG];
    if (cgbFlag === GB_CGB_ENHANCED_VALUE) {
      metadata.region = 'CGB Enhanced';
    } else if (cgbFlag === GB_CGB_ONLY_VALUE) {
      metadata.region = 'CGB Only';
    } else {
      metadata.region = 'DMG';
    }
  } catch { /* skip field */ }

  // Publisher/licensee code
  try {
    const oldLicensee = data[GB_OLD_LICENSEE];
    if (oldLicensee === GB_NEW_LICENSEE_MARKER) {
      // New licensee code at 0x144-0x145
      const newCode = String.fromCharCode(data[GB_NEW_LICENSEE_START], data[GB_NEW_LICENSEE_END]);
      if (/^[\x20-\x7E]{2}$/.test(newCode)) {
        metadata.publisher = newLicenseeCodes[newCode] ?? `Unknown (${newCode})`;
      }
    } else if (oldLicenseeCodes[oldLicensee]) {
      metadata.publisher = oldLicenseeCodes[oldLicensee];
    }
  } catch { /* skip field */ }

  // Header checksum at 0x14D
  try {
    let checksum = 0;
    for (let i = GB_CHECKSUM_START; i <= GB_CHECKSUM_END; i++) {
      checksum = (checksum - data[i] - 1) & CHECKSUM_BYTE_MASK;
    }
    metadata.checksumValid = checksum === data[GB_HEADER_CHECKSUM];
  } catch { /* skip field */ }

  return metadata;
};

/**
 * SNES publisher codes
 */
const snesPublishers: Record<number, string> = {
  0x01: 'Nintendo',
  0x02: 'Ajinomoto',
  0x03: 'Imagineer-Zoom',
  0x04: 'Chris Gray Enterprises',
  0x05: 'Zamuse',
  0x06: 'Falcom',
  0x08: 'Capcom',
  0x09: 'Hot B',
  0x0A: 'Jaleco',
  0x0B: 'Coconuts',
  0x0C: 'Rage Software',
  0x0E: 'Technos',
  0x0F: 'Mebio Software',
  0x12: 'Gremlin Graphics',
  0x13: 'Electronic Arts',
  0x15: 'COBRA Team',
  0x16: 'Human/Field',
  0x17: 'KOEI',
  0x18: 'Hudson Soft',
  0x1A: 'Yanoman',
  0x1C: 'Tecmo',
  0x1E: 'Open System',
  0x1F: 'Virgin Games',
  0x20: 'KSS',
  0x21: 'Sunsoft',
  0x22: 'POW',
  0x23: 'Micro World',
  0x25: 'Enix',
  0x26: 'Loriciel/Electro Brain',
  0x27: 'Kemco',
  0x28: 'Seta Co., Ltd.',
  0x29: 'Culture Brain',
  0x2A: 'Irem Japan',
  0x2C: 'Pal Soft',
  0x2D: 'Visit Co., Ltd.',
  0x2E: 'INTEC Inc.',
  0x2F: 'System Sacom Corp.',
  0x30: 'Viacom New Media',
  0x31: 'Carrozzeria',
  0x32: 'Dynamic',
  0x33: 'Nintendo',
  0x34: 'Magifact',
  0x35: 'Hect',
  0x3C: 'Empire Interactive',
  0x3E: 'Gremlin Interactive',
  0x41: 'Ubisoft',
  0x42: 'Atlus',
  0x44: 'Playmates Interactive',
  0x46: 'BMG Interactive',
  0x47: 'Atlas',
  0x48: 'Sony Music Entertainment',
  0x4B: 'Bullet-Proof Software',
  0x4C: 'Vic Tokai',
  0x4E: 'Character Soft',
  0x4F: 'I\'Max',
  0x50: 'Takara',
  0x51: 'CHUN Soft',
  0x52: 'Video System',
  0x53: 'BEC',
  0x55: 'Varie',
  0x56: 'Yonezawa/S\'Pal Corp.',
  0x57: 'Kaneko',
  0x5A: 'Nihon Bussan/Nichibutsu',
  0x5B: 'TECMO',
  0x5C: 'Imagineer Co., Ltd.',
  0x5D: 'Nova',
  0x5E: 'Den\'Z',
  0x5F: 'Bottom Up',
  0x60: 'Titus',
  0x61: 'Virgin Interactive',
  0x62: 'Konami',
  0x64: 'Gametek',
  0x66: 'Hori Electric',
  0x68: 'Telstar Publishing',
  0x69: 'Electronic Arts Victor',
  0x6B: 'Namcot/Namco Ltd.',
  0x6C: 'Media Rings Corp.',
  0x6E: 'ASCII Co./Nexoft',
  0x6F: 'Bandai',
  0x70: 'Enix America',
  0x71: 'Loriciel/Electro Brain',
  0x73: 'Tomy',
  0x75: 'KOEI/Koei America',
  0x77: 'Takara',
  0x79: 'Chunsoft',
  0x7A: 'Video System/McO\'River',
  0x7B: 'Varie',
  0x7D: 'Pack-In-Video',
  0x7E: 'Nichibutsu',
  0x7F: 'TECMO',
  0x80: 'Acclaim Japan',
  0x81: 'ASCII Co.',
  0x82: 'Nexoft',
  0x83: 'Bandai/Banpresto',
  0x85: 'Enix America',
  0x86: 'Halken',
  0x8B: 'Square',
  0x8C: 'Tokuma Shoten',
  0x8E: 'Asmik',
  0x8F: 'Naxat/Kaga Tech',
  0x91: 'Toshiba EMI/Compile',
  0x92: 'Konami',
  0x93: 'Bullet-Proof Software',
  0x95: 'Vic Tokai',
  0x97: 'NCS/Masaya',
  0x98: 'Takara',
  0x99: 'A Wave Inc.',
  0x9A: 'Tectoy',
  0x9B: 'Capcom',
  0x9C: 'Banpresto',
  0x9D: 'Tomy',
  0x9E: 'Acclaim',
  0x9F: 'NCS',
  0xA0: 'Human Entertainment',
  0xA1: 'Altron',
  0xA2: 'Jaleco',
  0xA3: 'Paradisco',
  0xA4: 'Epoch',
  0xA6: 'RCM Group',
  0xA7: 'Athena',
  0xA8: 'Asmik',
  0xA9: 'Natsume',
  0xAA: 'King Records',
  0xAB: 'Atlus',
  0xAC: 'Sony Music',
  0xAE: 'IGS',
  0xB0: 'Acclaim',
  0xB2: 'Bandai',
  0xB4: 'Enix',
  0xB5: 'Athena/Kaze',
  0xB6: 'HAL Laboratory',
  0xB7: 'SNK',
  0xB9: 'Pony Canyon',
  0xBA: 'Culture Brain',
  0xBB: 'Sunsoft',
  0xBD: 'Sony Imagesoft',
  0xBF: 'American Sammy',
  0xC0: 'Taito',
  0xC1: 'Sunsoft/Ask',
  0xC2: 'Kemco',
  0xC3: 'Square',
  0xC4: 'Tokuma Soft',
  0xC5: 'Data East',
  0xC6: 'Tonkin House',
  0xC8: 'Koei',
  0xCA: 'Konami USA',
  0xCB: 'NTVIC/VAP',
  0xCC: 'Use Co., Ltd.',
  0xCD: 'Meldac',
  0xCE: 'Pony Canyon',
  0xCF: 'Angel',
  0xD0: 'Taito',
  0xD2: 'Acclaim',
  0xD3: 'ASCII',
  0xD4: 'BanDai',
  0xD6: 'Enix',
  0xD8: 'HAL Laboratory',
  0xDA: 'Tomy',
  0xDB: 'Yutaka',
  0xDD: 'Hiro',
  0xDE: 'Varie',
  0xDF: 'T&E Soft',
  0xE0: 'Yutaka',
  0xE2: 'UFL',
  0xE3: 'Human',
  0xE4: 'Altus',
  0xE5: 'Epoch',
  0xE7: 'Athena',
  0xE8: 'Asmik',
  0xE9: 'Natsume',
  0xEA: 'King Records',
  0xEB: 'Atlus',
  0xEC: 'Sony Music',
  0xED: 'Psygnosis',
  0xEE: 'IGS',
  0xF0: 'Acclaim/A Wave',
};

/**
 * Extract metadata from SNES ROM header
 */
const extractSnesMetadata = (data: Buffer): RomMetadata => {
  const metadata: RomMetadata = {};

  // Try to find SNES header at common locations
  // LoROM: 0x7FC0, HiROM: 0xFFC0
  // With 512-byte copier header: add 0x200
  const locations = [SNES_LOROM_OFFSET, SNES_HIROM_OFFSET, SNES_LOROM_COPIER_OFFSET, SNES_HIROM_COPIER_OFFSET];
  const HIGH_BYTE_SHIFT = 8;

  for (const offset of locations) {
    if (offset + SNES_HEADER_MIN_SIZE > data.length) {continue;}

    try {
      // Check for valid checksum complement
      const checksum = data[offset + SNES_CHECKSUM_OFFSET] | (data[offset + SNES_CHECKSUM_HIGH_OFFSET] << HIGH_BYTE_SHIFT);
      const complement = data[offset + SNES_COMPLEMENT_OFFSET] | (data[offset + SNES_COMPLEMENT_HIGH_OFFSET] << HIGH_BYTE_SHIFT);

      if ((checksum ^ complement) !== SNES_CHECKSUM_XOR) {continue;}

      // Found valid header - extract each field with individual error handling
      try {
        const titleBytes = data.slice(offset, offset + SNES_TITLE_LENGTH);
        const title = titleBytes.toString('ascii');
        if (title && /^[\x20-\x7E]+$/.test(title)) {
          metadata.title = normalizeTitle(title);
        }
      } catch { /* skip field */ }

      try {
        // ROM makeup byte
        const makeup = data[offset + SNES_MAKEUP_OFFSET];
        metadata.romType = (makeup & SNES_HIROM_BIT) ? 'HiROM' : 'LoROM';

        // Check for FastROM
        const fastRom = (makeup & SNES_FASTROM_BIT) !== 0;
        if (fastRom) {
          metadata.romType += ' (FastROM)';
        }
      } catch { /* skip field */ }

      try {
        // ROM type byte (special chips)
        const romType = data[offset + SNES_ROM_TYPE_OFFSET];
        if (romType !== SNES_ROM_ONLY && romType !== SNES_ROM_RAM && romType !== SNES_ROM_RAM_BATTERY) {
          metadata.specialChip = SNES_CHIP_TYPES[romType] ?? `Unknown (0x${romType.toString(HEX_RADIX)})`;
        }

        // Check for battery-backed saves
        metadata.hasBattery = SNES_BATTERY_ROM_TYPES.some(t => t === romType);
      } catch { /* skip field */ }

      try {
        // ROM size
        const sizeCode = data[offset + SNES_ROM_SIZE_OFFSET];
        if (sizeCode > 0 && sizeCode < SNES_SIZE_CODE_MAX) {
          const size = 1 << sizeCode;
          metadata.prgSize = size >= BYTES_PER_KB ? `${size / BYTES_PER_KB} MB` : `${size} KB`;
        }
      } catch { /* skip field */ }

      try {
        // SRAM size
        const sramCode = data[offset + SNES_SRAM_SIZE_OFFSET];
        if (sramCode > 0 && sramCode < SNES_SIZE_CODE_MAX) {
          const sramSize = 1 << sramCode;
          metadata.ramSize = sramSize >= BYTES_PER_KB ? `${sramSize / BYTES_PER_KB} MB` : `${sramSize} KB`;
        }
      } catch { /* skip field */ }

      try {
        // Country code
        const country = data[offset + SNES_COUNTRY_OFFSET];
        metadata.region = country < SNES_PAL_THRESHOLD ? 'NTSC' : 'PAL';
      } catch { /* skip field */ }

      try {
        // Publisher code
        const publisherCode = data[offset + SNES_PUBLISHER_OFFSET];
        if (snesPublishers[publisherCode]) {
          metadata.publisher = snesPublishers[publisherCode];
        }
      } catch { /* skip field */ }

      // Validate checksum - we already verified the complement
      metadata.checksumValid = true;

      break;
    } catch {
      // Try next location
      continue;
    }
  }

  return metadata;
};

/**
 * Extract metadata from Sega Genesis/Mega Drive ROM header
 */
const extractGenesisMetadata = (data: Buffer): RomMetadata => {
  const metadata: RomMetadata = {};
  const COPYRIGHT_MIN_LENGTH = 5;

  // Genesis header starts at 0x100 for cartridges
  // Check for "SEGA" signature at 0x100
  if (data.length < GENESIS_MIN_HEADER_SIZE) {return metadata;}

  try {
    const systemType = data.slice(GENESIS_SYSTEM_TYPE_START, GENESIS_SYSTEM_TYPE_END).toString('ascii').trim();
    if (!systemType.startsWith('SEGA')) {
      return metadata;
    }
  } catch {
    return metadata;
  }

  // Domestic name at 0x120-0x14F (Japanese)
  // Overseas name at 0x150-0x17F (English)
  try {
    const overseasName = data.slice(GENESIS_OVERSEAS_NAME_START, GENESIS_OVERSEAS_NAME_END).toString('ascii');
    if (overseasName && /^[\x20-\x7E]+$/.test(overseasName)) {
      metadata.title = normalizeTitle(overseasName);
    } else {
      // Fall back to domestic name
      const domesticName = data.slice(GENESIS_DOMESTIC_NAME_START, GENESIS_DOMESTIC_NAME_END).toString('ascii');
      if (domesticName && /^[\x20-\x7E]+$/.test(domesticName)) {
        metadata.title = normalizeTitle(domesticName);
      }
    }
  } catch { /* skip field */ }

  // Serial number at 0x180-0x18D
  try {
    const serial = data.slice(GENESIS_SERIAL_START, GENESIS_SERIAL_END).toString('ascii').trim();
    if (serial && /^[\x20-\x7E]+$/.test(serial)) {
      metadata.serial = serial;
    }
  } catch { /* skip field */ }

  // ROM size from header (end address - start address)
  try {
    const romStart = data.readUInt32BE(GENESIS_ROM_START_ADDR);
    const romEnd = data.readUInt32BE(GENESIS_ROM_END_ADDR);
    if (romEnd > romStart && romEnd < GENESIS_MAX_ROM_SIZE) {
      const size = (romEnd - romStart + 1);
      if (size >= BYTES_PER_MB) {
        metadata.prgSize = `${(size / BYTES_PER_MB).toFixed(1)} MB`;
      } else if (size > 0) {
        metadata.prgSize = `${Math.round(size / BYTES_PER_KB)} KB`;
      }
    }
  } catch { /* skip field */ }

  // RAM info at 0x1B4-0x1B8
  try {
    const ramStart = data.readUInt32BE(GENESIS_RAM_START_ADDR);
    const ramEnd = data.readUInt32BE(GENESIS_RAM_END_ADDR);
    if (ramEnd >= ramStart && ramStart !== GENESIS_INVALID_RAM_MARKER && ramStart < GENESIS_MAX_ROM_SIZE) {
      const ramSize = ramEnd - ramStart + 1;
      if (ramSize > 0 && ramSize < GENESIS_MAX_RAM_SIZE) {
        metadata.ramSize = ramSize >= BYTES_PER_KB ? `${ramSize / BYTES_PER_KB} KB` : `${ramSize} B`;
        metadata.hasBattery = true; // SRAM usually battery-backed
      }
    }
  } catch { /* skip field */ }

  // Region code at 0x1F0
  try {
    const regionBytes = data.slice(GENESIS_REGION_START, GENESIS_REGION_END).toString('ascii');
    const regions: string[] = [];
    if (regionBytes.includes('J')) {regions.push('Japan');}
    if (regionBytes.includes('U') || regionBytes.includes('4')) {regions.push('USA');}
    if (regionBytes.includes('E') || regionBytes.includes('A')) {regions.push('Europe');}
    if (regions.length > 0) {
      metadata.region = regions.join('/');
    }
  } catch { /* skip field */ }

  // I/O support at 0x190-0x19F
  try {
    const ioSupport = data.slice(GENESIS_IO_SUPPORT_START, GENESIS_IO_SUPPORT_END).toString('ascii').trim();
    const devices: string[] = [];
    if (ioSupport.includes('J')) {devices.push('3-button');}
    if (ioSupport.includes('6')) {devices.push('6-button');}
    if (ioSupport.includes('K')) {devices.push('Keyboard');}
    if (ioSupport.includes('M')) {devices.push('Mouse');}
    if (ioSupport.includes('T')) {devices.push('Trackball');}
    if (ioSupport.includes('B')) {devices.push('Justifier');}
    if (ioSupport.includes('4')) {devices.push('Team Player');}
    if (devices.length > 0) {
      metadata.inputDevices = devices.join(', ');
    }
  } catch { /* skip field */ }

  // Publisher from copyright string at 0x110-0x11F
  try {
    const copyright = data.slice(GENESIS_COPYRIGHT_START, GENESIS_COPYRIGHT_END).toString('ascii').trim();
    // Extract publisher name - usually after (C) and year
    const pubMatch = copyright.match(/\(C\)\s*\w+\s+(\d{4})?\s*(.+)/i);
    if (pubMatch && pubMatch[2]) {
      const pub = pubMatch[2].trim();
      if (pub && /^[\x20-\x7E]+$/.test(pub)) {
        metadata.publisher = pub;
      }
    } else if (copyright.length > COPYRIGHT_MIN_LENGTH && /^[\x20-\x7E]+$/.test(copyright)) {
      metadata.publisher = copyright;
    }
  } catch { /* skip field */ }

  // Note: Checksum validation requires full ROM file and is skipped during scanning
  // for performance. The checksum field at 0x18E can be read but not validated.

  return metadata;
};

/**
 * GBA maker codes
 */
const gbaMakerCodes: Record<string, string> = {
  '01': 'Nintendo',
  '08': 'Capcom',
  '13': 'Electronic Arts',
  '18': 'Hudson Soft',
  '20': 'Destination Software',
  '28': 'Kemco Japan',
  '31': 'Nintendo',
  '32': 'Bandai',
  '34': 'Konami',
  '37': 'Taito',
  '41': 'Ubisoft',
  '42': 'Atlus',
  '4F': 'Eidos',
  '52': 'Activision',
  '54': 'Take-Two Interactive',
  '5D': 'Midway',
  '5G': 'Majesco',
  '64': 'LucasArts',
  '69': 'Electronic Arts',
  '6E': 'Elite Systems',
  '70': 'Infogrames',
  '78': 'THQ',
  '7D': 'Sierra',
  '7F': 'Kemco',
  '8P': 'Sega',
  '99': 'Pack-In-Video',
  'A4': 'Konami',
  'AF': 'Namco',
  'B2': 'Bandai',
  'C3': 'Square Enix',
  'EB': 'Atlus',
};

/**
 * Extract metadata from GBA ROM header
 */
const extractGbaMetadata = (data: Buffer): RomMetadata => {
  const metadata: RomMetadata = {};

  // GBA header starts at 0x00
  // Title at 0xA0-0xAB (12 chars)
  if (data.length < GBA_MIN_HEADER_SIZE) {return metadata;}

  // Title
  try {
    const titleBytes = data.slice(GBA_TITLE_START, GBA_TITLE_END);
    const nullIndex = titleBytes.indexOf(0);
    const title = titleBytes.slice(0, nullIndex > 0 ? nullIndex : titleBytes.length).toString('ascii');
    if (title && /^[\x20-\x7E]+$/.test(title)) {
      metadata.title = normalizeTitle(title);
    }
  } catch { /* skip field */ }

  // Game code at 0xAC-0xAF (4 chars)
  try {
    const gameCode = data.slice(GBA_GAME_CODE_START, GBA_GAME_CODE_END).toString('ascii');
    const GAME_CODE_REGEX = new RegExp(`^[A-Z0-9]{${GBA_GAME_CODE_LENGTH}}$`);
    if (gameCode && GAME_CODE_REGEX.test(gameCode)) {
      metadata.serial = gameCode;

      // Third character often indicates region
      const regionChar = gameCode[GBA_REGION_CHAR_INDEX];
      switch (regionChar) {
        case 'J': metadata.region = 'Japan'; break;
        case 'E': metadata.region = 'USA'; break;
        case 'P': metadata.region = 'Europe'; break;
        case 'D': metadata.region = 'Germany'; break;
        case 'F': metadata.region = 'France'; break;
        case 'S': metadata.region = 'Spain'; break;
        case 'I': metadata.region = 'Italy'; break;
        default: metadata.region = 'Unknown';
      }
    }
  } catch { /* skip field */ }

  // Maker code at 0xB0-0xB1 (2 chars)
  try {
    const makerCode = data.slice(GBA_MAKER_CODE_START, GBA_MAKER_CODE_END).toString('ascii');
    const MAKER_CODE_REGEX = new RegExp(`^[A-Z0-9]{${GBA_MAKER_CODE_LENGTH}}$`);
    if (makerCode && MAKER_CODE_REGEX.test(makerCode)) {
      if (gbaMakerCodes[makerCode]) {
        metadata.publisher = gbaMakerCodes[makerCode];
      }
    }
  } catch { /* skip field */ }

  // Main unit code at 0xB3 (should be 0x96 for GBA)
  // Don't bail on invalid unit code - just skip checksum validation
  let validHeader = false;
  try {
    const unitCode = data[GBA_UNIT_CODE];
    validHeader = unitCode === GBA_VALID_UNIT_CODE;
  } catch { /* skip field */ }

  // Header checksum at 0xBD
  if (validHeader) {
    try {
      let checksum = 0;
      for (let i = GBA_CHECKSUM_START; i < GBA_CHECKSUM_END; i++) {
        checksum = (checksum - data[i]) & CHECKSUM_BYTE_MASK;
      }
      checksum = (checksum - GBA_CHECKSUM_ADJUSTMENT) & CHECKSUM_BYTE_MASK;
      metadata.checksumValid = checksum === data[GBA_HEADER_CHECKSUM];
    } catch { /* skip field */ }
  }

  return metadata;
};

/**
 * Extract metadata from a pre-read ROM header buffer.
 */
const extractMetadataFromBuffer = (headerData: Buffer, extension: string): RomMetadata => {
  switch (extension) {
    case '.nes':
      return extractNesMetadata(headerData);
    case '.gb':
    case '.gbc':
      return extractGbMetadata(headerData);
    case '.sfc':
    case '.smc':
      return extractSnesMetadata(headerData);
    case '.md':
    case '.smd':
    case '.gen':
    case '.bin':
      return extractGenesisMetadata(headerData);
    case '.gba':
      return extractGbaMetadata(headerData);
    default:
      return {};
  }
};

/**
 * Extract metadata from ROM file based on extension.
 * Uses smart header sizing to read only what's needed for each format.
 */
const extractMetadata = (path: string, extension: string): RomMetadata => {
  try {
    const fd = openSync(path, 'r');
    const headerSize = getRequiredHeaderSize(extension);
    const buffer = Buffer.alloc(headerSize);
    let bytesRead: number;
    try {
      bytesRead = readSync(fd, buffer, 0, headerSize, 0);
    } finally {
      closeSync(fd);
    }
    return extractMetadataFromBuffer(buffer.subarray(0, bytesRead), extension);
  } catch {
    return {};
  }
};

/**
 * System definitions with their file extensions
 */
const systemExtensions: Array<{ name: string; extensions: string[] }> = [
  { name: 'Nintendo Entertainment System', extensions: ['.nes'] },
  { name: 'Game Boy', extensions: ['.gb'] },
  { name: 'Game Boy Color', extensions: ['.gbc'] },
  { name: 'Super Nintendo', extensions: ['.sfc', '.smc'] },
  { name: 'Sega Master System', extensions: ['.sms'] },
  { name: 'Sega Game Gear', extensions: ['.gg'] },
  { name: 'Sega Genesis', extensions: ['.md', '.smd', '.gen', '.bin'] },
  { name: 'Sega 32X', extensions: ['.32x'] },
  { name: 'PC Engine', extensions: ['.pce'] },
  { name: 'Game Boy Advance', extensions: ['.gba'] },
  { name: 'Nintendo 64', extensions: ['.n64', '.z64', '.v64'] },
  { name: 'Nintendo DS', extensions: ['.nds'] },
  { name: 'Atari 2600', extensions: ['.a26'] },
  { name: 'Atari 7800', extensions: ['.a78'] },
  { name: 'Atari Lynx', extensions: ['.lnx'] },
  { name: 'Neo Geo Pocket', extensions: ['.ngp'] },
  { name: 'Neo Geo Pocket Color', extensions: ['.ngc'] },
  { name: 'WonderSwan', extensions: ['.ws'] },
  { name: 'WonderSwan Color', extensions: ['.wsc'] },
  { name: 'Virtual Boy', extensions: ['.vb'] },
  { name: 'Vectrex', extensions: ['.vec'] },
  { name: 'ColecoVision', extensions: ['.col'] },
  { name: 'Intellivision', extensions: ['.int'] },
];

// Build lookup map from extensions to system names
const extensionToSystem = new Map(
  flatMap(systemExtensions, (system) =>
    system.extensions.map((ext) => [ext, system.name] as const)
  )
);

/**
 * Get system name from extension
 */
const getSystemName = (extension: string, fallback: string): string => extensionToSystem.get(extension) ?? fallback;


/**
 * Result of loading a thumbnail
 */
export interface ThumbnailResult {
  /** Base64-encoded PNG data */
  data: string;
  /** Full path to the thumbnail file */
  path: string;
  /** Type of thumbnail loaded */
  type: ThumbnailType;
}

/**
 * Load a specific type of thumbnail PNG for a ROM if it exists.
 *
 * RetroArch supports three thumbnail types:
 * - boxart: Box art / cover images (Named_Boxarts/)
 * - snap: In-game screenshots (Named_Snaps/)
 * - title: Title screen images (Named_Titles/)
 *
 * @param rom RomInfo object containing extension, systemId, and metadata
 * @param type Thumbnail type to load (default: 'snap')
 * @returns Thumbnail data and path, or undefined if thumbnail doesn't exist
 */
export const loadThumbnail = (rom: RomInfo, type: ThumbnailType = 'snap'): ThumbnailResult | undefined => {
  try {
    // Get system name in RetroArch format (must match how thumbnails are saved)
    const systemName = getPlaylistSystemName(rom.extension, rom.systemId);

    // Build list of names to try (in priority order):
    // 1. Playlist label (if available) - user-friendly name from playlist
    // 2. ROM filename without extension - fallback for flexible matching
    const namesToTry: string[] = [];

    if (rom.label) {
      namesToTry.push(rom.label);
    }

    // Always add filename without extension as fallback
    const filenameWithoutExt = rom.filename.replace(/\.[^.]+$/, '');
    if (filenameWithoutExt !== rom.label) {
      namesToTry.push(filenameWithoutExt);
    }

    // Try each name in order (getThumbnailPath handles special character sanitization)
    for (const name of namesToTry) {
      const thumbnailPath = getThumbnailPath(systemName, name, type);

      if (existsSync(thumbnailPath)) {
        const pngData = readFileSync(thumbnailPath);
        return {
          data: pngData.toString('base64'),
          path: thumbnailPath,
          type,
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Load the first available thumbnail for a ROM, trying types in priority order.
 * Priority: snap (in-game) > title > boxart
 *
 * @param rom RomInfo object containing extension, systemId, and metadata
 * @returns Thumbnail data, path, and type, or undefined if none exist
 */
export const loadAnyThumbnail = (rom: RomInfo): ThumbnailResult | undefined => {
  for (const type of THUMBNAIL_TYPES) {
    const result = loadThumbnail(rom, type);
    if (result) {
      return result;
    }
  }
  return undefined;
};

/**
 * Check if a save state file exists for a ROM and get its modification time.
 * Uses the SaveStateService from the service provider.
 */
const checkForSaveState = (romPath: string): { exists: boolean; savedAt?: Date } => {
  const result = getSaveStateService().checkExists(romPath);
  return { exists: result.exists, savedAt: result.date };
};

/**
 * Check if a battery save (.srm) file exists for a ROM and get its modified date.
 * Uses the BatterySaveService from the service provider.
 */
const checkForBatterySave = (romPath: string): { exists: boolean; modifiedAt?: Date } => {
  const result = getBatterySaveService().checkExists(romPath);
  return { exists: result.exists, modifiedAt: result.date };
};

/**
 * Scan a directory for ROM files.
 * Automatically uses CRC cache from existing playlists to avoid recalculation.
 * @param dirPath Directory to scan
 * @param maxDepth Maximum depth to scan (0 = only dirPath, 1 = dirPath + immediate subdirs, -1 = unlimited)
 */
export const scanDirectory = (
  dirPath: string,
  maxDepth: number = 1
): RomInfo[] => {
  const roms: RomInfo[] = [];
  const supportedExtensions = new Set(getSupportedExtensions());
  const crcCache = buildCrcCache();

  const scan = (currentPath: string, currentDepth: number): void => {
    try {
      const entries = readdirSync(currentPath);

      for (const entry of entries) {
        const fullPath = join(currentPath, entry);

        try {
          const stats = statSync(fullPath);

          if (stats.isDirectory() && (maxDepth === -1 || currentDepth < maxDepth)) {
            scan(fullPath, currentDepth + 1);
          } else if (stats.isFile()) {
            const ext = extname(entry).toLowerCase();

            if (supportedExtensions.has(ext)) {
              // Read file header once for both binary check and metadata extraction
              // Uses smart sizing based on format to minimize I/O
              const headerBuffer = readRomHeader(fullPath, stats.size, ext);
              if (!headerBuffer) {
                continue;
              }

              // Quick sanity check: ensure file is plausibly a binary ROM
              // This filters out text files that happen to have ROM extensions (e.g., .md markdown files)
              if (!isBinaryFromBuffer(headerBuffer)) {
                continue;
              }

              const matchingCores = findMatchingCoresByExtension(ext);

              if (matchingCores.length > 0) {
                const primaryCore = matchingCores[0];
                const systemInfo = primaryCore.factory.getSystemInfo();
                const saveStateInfo = checkForSaveState(fullPath);
                const batterySaveInfo = checkForBatterySave(fullPath);

                // Use cached CRC32 if available, otherwise calculate
                const normalizedPath = normalizePath(fullPath);
                const cachedCrc = crcCache.get(normalizedPath);
                const crc32 = cachedCrc && cachedCrc !== 'DETECT'
                  ? cachedCrc
                  : calculateFileCrc32(fullPath);

                roms.push({
                  path: fullPath,
                  filename: basename(entry),
                  extension: ext,
                  size: stats.size,
                  sizeFormatted: formatSize(stats.size),
                  modified: stats.mtime,
                  system: getSystemName(ext, systemInfo.name),
                  systemId: primaryCore.id,
                  coreCount: matchingCores.length,
                  coreIds: matchingCores.map(c => c.id),
                  metadata: extractMetadataFromBuffer(headerBuffer, ext),
                  hasSaveState: saveStateInfo.exists,
                  saveStateDate: saveStateInfo.savedAt,
                  // Note: screenshot and frameCount are loaded lazily when ROM is selected
                  hasBatterySave: batterySaveInfo.exists,
                  batterySaveDate: batterySaveInfo.modifiedAt,
                  crc32,
                });
              }
            }
          }
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // Skip directories we can't read
    }
  };

  scan(dirPath, 0);
  sortRoms(roms);

  return roms;
};

/**
 * Group ROMs by system
 */
export const groupBySystem = (roms: RomInfo[]): Map<string, RomInfo[]> =>
  new Map(Object.entries(groupBy(roms, rom => rom.system)));

/**
 * Result of validating a ROM file
 */
export type ValidateRomResult =
  | { valid: true; rom: RomInfo }
  | { valid: false; error: 'not_found' | 'not_file' | 'invalid_rom' | 'no_core'; message: string };

/**
 * Validate a single ROM file and return its info if valid
 *
 * @param filePath Path to the ROM file
 * @returns Either a valid RomInfo or an error with reason
 */
export const validateRomFile = (filePath: string): ValidateRomResult => {
  // Check if file exists
  if (!existsSync(filePath)) {
    return { valid: false, error: 'not_found', message: 'File does not exist' };
  }

  // Check if it's a file (not a directory)
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(filePath);
    if (!stats.isFile()) {
      return { valid: false, error: 'not_file', message: 'Path is not a file' };
    }
  } catch {
    return { valid: false, error: 'not_found', message: 'Cannot access file' };
  }

  const ext = extname(filePath).toLowerCase();
  const filename = basename(filePath);

  // Check if extension is supported by any core
  const supportedExtensions = new Set(getSupportedExtensions());
  if (!supportedExtensions.has(ext)) {
    return { valid: false, error: 'no_core', message: `No core installed for ${ext} files` };
  }

  // Read file header once for both binary check and metadata extraction
  // Uses smart sizing based on format to minimize I/O
  const headerBuffer = readRomHeader(filePath, stats.size, ext);
  if (!headerBuffer) {
    return { valid: false, error: 'invalid_rom', message: 'File is too small to be a valid ROM' };
  }

  // Check if file is plausibly a binary ROM (not a text file)
  if (!isBinaryFromBuffer(headerBuffer)) {
    return { valid: false, error: 'invalid_rom', message: 'File does not appear to be a valid ROM' };
  }

  // Check for matching cores
  const matchingCores = findMatchingCoresByExtension(ext);
  if (matchingCores.length === 0) {
    return { valid: false, error: 'no_core', message: `No core installed for ${ext} files` };
  }

  // Build RomInfo object
  const primaryCore = matchingCores[0];
  const systemInfo = primaryCore.factory.getSystemInfo();
  const saveStateInfo = checkForSaveState(filePath);
  const batterySaveInfo = checkForBatterySave(filePath);
  const crc32 = calculateFileCrc32(filePath);

  const rom: RomInfo = {
    path: filePath,
    filename: filename,
    extension: ext,
    size: stats.size,
    sizeFormatted: formatSize(stats.size),
    modified: stats.mtime,
    system: getSystemName(ext, systemInfo.name),
    systemId: primaryCore.id,
    coreCount: matchingCores.length,
    coreIds: matchingCores.map(c => c.id),
    metadata: extractMetadataFromBuffer(headerBuffer, ext),
    hasSaveState: saveStateInfo.exists,
    saveStateDate: saveStateInfo.savedAt,
    // Note: screenshot and frameCount are loaded lazily when ROM is selected
    hasBatterySave: batterySaveInfo.exists,
    batterySaveDate: batterySaveInfo.modifiedAt,
    crc32,
  };

  return { valid: true, rom };
};

/**
 * Extract the title from a ROM file.
 * Returns the embedded title if available, otherwise returns undefined.
 * @param romPath Full path to the ROM file
 */
export const getRomTitle = (romPath: string): string | undefined => {
  try {
    const ext = extname(romPath).toLowerCase();
    const metadata = extractMetadata(romPath, ext);
    return metadata.title;
  } catch {
    return undefined;
  }
};

/**
 * Progress callback for directory scanning
 */
export interface ScanProgress {
  /** Current file being processed */
  currentFile: string;
  /** Number of files processed so far */
  processed: number;
  /** Total number of files to process, or undefined if unknown (async scan) */
  total?: number;
  /** Number of ROMs found so far */
  romsFound: number;
}

/**
 * Count total files in a directory tree (for progress tracking)
 * @param dirPath Directory to count files in
 * @param maxDepth Maximum depth to scan (-1 = unlimited)
 * @param supportedExtensions Set of extensions to count (if provided, only counts matching files)
 */
export const countFiles = (
  dirPath: string,
  maxDepth: number = 1,
  supportedExtensions?: Set<string>
): number => {
  let count = 0;

  const countRecursive = (currentPath: string, currentDepth: number): void => {
    try {
      const entries = readdirSync(currentPath);

      for (const entry of entries) {
        const fullPath = join(currentPath, entry);

        try {
          const stats = statSync(fullPath);

          if (stats.isDirectory() && (maxDepth === -1 || currentDepth < maxDepth)) {
            countRecursive(fullPath, currentDepth + 1);
          } else if (stats.isFile()) {
            if (supportedExtensions) {
              const ext = extname(entry).toLowerCase();
              if (supportedExtensions.has(ext)) {
                count++;
              }
            } else {
              count++;
            }
          }
        } catch {
          // Skip files we can't access
        }
      }
    } catch {
      // Skip directories we can't read
    }
  };

  countRecursive(dirPath, 0);
  return count;
};

/**
 * Count total files in a directory tree asynchronously (for progress tracking).
 * Uses async I/O to avoid blocking the event loop.
 */
export const countFilesAsync = async (
  dirPath: string,
  maxDepth: number = 1,
  supportedExtensions?: Set<string>,
  signal?: AbortSignal
): Promise<number> => {
  let count = 0;
  let entryCount = 0;

  const countRecursive = async (currentPath: string, currentDepth: number): Promise<void> => {
    // Check for cancellation
    if (signal?.aborted) {
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      // Skip directories we can't read
      return;
    }

    for (const entry of entries) {
      // Check for cancellation
      if (signal?.aborted) {
        return;
      }

      const fullPath = join(currentPath, entry);

      try {
        const stats = await stat(fullPath);

        if (stats.isDirectory() && (maxDepth === -1 || currentDepth < maxDepth)) {
          await countRecursive(fullPath, currentDepth + 1);
        } else if (stats.isFile()) {
          if (supportedExtensions) {
            const ext = extname(entry).toLowerCase();
            if (supportedExtensions.has(ext)) {
              count++;
            }
          } else {
            count++;
          }
        }

        // Yield control periodically
        entryCount++;
        if (entryCount % ASYNC_YIELD_INTERVAL === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      } catch {
        // Skip files we can't access
      }
    }
  };

  await countRecursive(dirPath, 0);
  return count;
};

/** Number of entries to process before yielding control */
const ASYNC_YIELD_INTERVAL = 50;

/**
 * Collect file paths from a directory tree asynchronously.
 * Uses async I/O and yields control periodically to prevent blocking the event loop.
 */
async function* collectFilePathsAsync(
  dirPath: string,
  maxDepth: number,
  supportedExtensions: Set<string>
): AsyncGenerator<string> {
  let entryCount = 0;

  /** Recursively collect files, yielding paths as found */
  const collect = async function* (currentPath: string, currentDepth: number): AsyncGenerator<string> {
    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      // Skip directories we can't read
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);

      try {
        const stats = await stat(fullPath);

        if (stats.isDirectory() && (maxDepth === -1 || currentDepth < maxDepth)) {
          // Recurse into subdirectory
          yield* collect(fullPath, currentDepth + 1);
        } else if (stats.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (supportedExtensions.has(ext)) {
            yield fullPath;
          }
        }

        // Yield control periodically to allow UI updates
        entryCount++;
        if (entryCount % ASYNC_YIELD_INTERVAL === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      } catch {
        // Skip files we can't access
      }
    }
  };

  yield* collect(dirPath, 0);
}

/**
 * Process a single file and return RomInfo if valid
 */
const processFile = (
  fullPath: string,
  crcCache?: CrcCache
): RomInfo | null => {
  try {
    const stats = statSync(fullPath);
    const entry = basename(fullPath);
    const ext = extname(entry).toLowerCase();

    // Read file header once for both binary check and metadata extraction
    // Uses smart sizing based on format to minimize I/O
    const headerBuffer = readRomHeader(fullPath, stats.size, ext);
    if (!headerBuffer) {
      return null;
    }

    // Quick sanity check: ensure file is plausibly a binary ROM
    if (!isBinaryFromBuffer(headerBuffer)) {
      return null;
    }

    const matchingCores = findMatchingCoresByExtension(ext);

    if (matchingCores.length > 0) {
      const primaryCore = matchingCores[0];
      const systemInfo = primaryCore.factory.getSystemInfo();
      const saveStateInfo = checkForSaveState(fullPath);
      const batterySaveInfo = checkForBatterySave(fullPath);

      // Use cached CRC32 if available, otherwise calculate
      const normalizedPath = normalizePath(fullPath);
      const cachedCrc = crcCache?.get(normalizedPath);
      const crc32 = cachedCrc && cachedCrc !== 'DETECT'
        ? cachedCrc
        : calculateFileCrc32(fullPath);

      return {
        path: fullPath,
        filename: basename(entry),
        extension: ext,
        size: stats.size,
        sizeFormatted: formatSize(stats.size),
        modified: stats.mtime,
        system: getSystemName(ext, systemInfo.name),
        systemId: primaryCore.id,
        coreCount: matchingCores.length,
        coreIds: matchingCores.map(c => c.id),
        metadata: extractMetadataFromBuffer(headerBuffer, ext),
        hasSaveState: saveStateInfo.exists,
        saveStateDate: saveStateInfo.savedAt,
        hasBatterySave: batterySaveInfo.exists,
        batterySaveDate: batterySaveInfo.modifiedAt,
        crc32,
      };
    }
  } catch {
    // Skip files we can't process
  }

  return null;
};

/**
 * Get a valid timestamp from a lastPlayed value, handling Date objects and potential edge cases.
 * Returns undefined if the value is not a valid date with a positive timestamp.
 */
const getValidTimestamp = (lastPlayed: Date | undefined): number | undefined => {
  if (!lastPlayed) {
    return undefined;
  }

  // Ensure it's a Date object (might be a string if serialized)
  const date = lastPlayed instanceof Date ? lastPlayed : new Date(lastPlayed);
  const time = date.getTime();

  // Must be a valid positive number (dates after epoch)
  if (typeof time === 'number' && !Number.isNaN(time) && time > 0) {
    return time;
  }

  return undefined;
};

/**
 * Sort ROMs by last played date (most recent first), then alphabetically for unplayed ROMs
 */
export const sortRoms = (roms: RomInfo[]): void => {
  roms.sort((a, b) => {
    const aTime = getValidTimestamp(a.lastPlayed);
    const bTime = getValidTimestamp(b.lastPlayed);

    // Both have valid lastPlayed - sort by date (most recent first)
    if (aTime !== undefined && bTime !== undefined) {
      return bTime - aTime;
    }

    // Only one has lastPlayed - it comes first
    if (aTime !== undefined) {
      return -1;
    }
    if (bTime !== undefined) {
      return 1;
    }

    // Neither has lastPlayed - sort alphabetically
    return a.filename.localeCompare(b.filename);
  });
};

/**
 * Scan a directory for ROM files asynchronously with progress reporting.
 * This allows the UI to update between file processing.
 * Automatically uses CRC cache from existing playlists to avoid recalculation.
 *
 * @param dirPath Directory to scan
 * @param maxDepth Maximum depth to scan (0 = only dirPath, 1 = dirPath + immediate subdirs, -1 = unlimited)
 * @param onProgress Callback for progress updates
 * @param signal Optional abort signal for cancellation
 */
/** Error thrown when scan is cancelled */
export class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled');
    this.name = 'ScanCancelledError';
  }
}

export const scanDirectoryAsync = async (
  dirPath: string,
  maxDepth: number = 1,
  onProgress?: (progress: ScanProgress) => void,
  signal?: AbortSignal
): Promise<RomInfo[]> => {
  const roms: RomInfo[] = [];
  const supportedExtensions = new Set(getSupportedExtensions());
  const crcCache = buildCrcCache();

  // Count files first for accurate progress reporting (async to avoid blocking)
  const totalFiles = await countFilesAsync(dirPath, maxDepth, supportedExtensions, signal);

  // Check for cancellation after count
  if (signal?.aborted) {
    throw new ScanCancelledError();
  }

  // Process files using async generator
  // This avoids blocking the event loop for large directories
  let processed = 0;

  for await (const fullPath of collectFilePathsAsync(dirPath, maxDepth, supportedExtensions)) {
    // Check for cancellation
    if (signal?.aborted) {
      throw new ScanCancelledError();
    }

    const rom = processFile(fullPath, crcCache);

    if (rom) {
      roms.push(rom);
    }

    processed++;

    // Report progress with known total
    if (onProgress) {
      onProgress({
        currentFile: basename(fullPath),
        processed,
        total: totalFiles,
        romsFound: roms.length,
      });
    }
  }

  // Sort results
  sortRoms(roms);

  return roms;
};
