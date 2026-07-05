// =============================================================================
// Playlist Format Constants
// =============================================================================

/** Current playlist format version (RetroArch 1.7.5+ JSON format) */
export const PLAYLIST_VERSION = '1.5';

/** Label display mode: default (0) shows filename without extension */
export const LABEL_DISPLAY_MODE_DEFAULT = 0;

/** Thumbnail mode: default (0) uses boxart */
export const THUMBNAIL_MODE_DEFAULT = 0;

/** Sort mode: alphabetical (0) */
export const SORT_MODE_ALPHABETICAL = 0;

// =============================================================================
// RetroArch Database Names
// =============================================================================

/**
 * Maps system IDs and file extensions to RetroArch database names.
 * These match the .lpl filenames used by RetroArch for organizing playlists.
 *
 * Database names follow the format:
 * "Manufacturer - System Name.lpl"
 *
 * Reference: https://github.com/libretro/libretro-database
 */
export const RETROARCH_DATABASE_NAMES: Record<string, string> = {
  // NES / Famicom
  '.nes': 'Nintendo - Nintendo Entertainment System.lpl',
  'nes': 'Nintendo - Nintendo Entertainment System.lpl',

  // Game Boy
  '.gb': 'Nintendo - Game Boy.lpl',
  'gb': 'Nintendo - Game Boy.lpl',

  // Game Boy Color
  '.gbc': 'Nintendo - Game Boy Color.lpl',
  'gbc': 'Nintendo - Game Boy Color.lpl',

  // Super Nintendo / Super Famicom
  '.sfc': 'Nintendo - Super Nintendo Entertainment System.lpl',
  '.smc': 'Nintendo - Super Nintendo Entertainment System.lpl',
  'snes': 'Nintendo - Super Nintendo Entertainment System.lpl',
  'bsnes': 'Nintendo - Super Nintendo Entertainment System.lpl',
  'snes9x': 'Nintendo - Super Nintendo Entertainment System.lpl',

  // Game Boy Advance
  '.gba': 'Nintendo - Game Boy Advance.lpl',
  'gba': 'Nintendo - Game Boy Advance.lpl',
  'mgba': 'Nintendo - Game Boy Advance.lpl',

  // Nintendo 64
  '.n64': 'Nintendo - Nintendo 64.lpl',
  '.z64': 'Nintendo - Nintendo 64.lpl',
  '.v64': 'Nintendo - Nintendo 64.lpl',
  'n64': 'Nintendo - Nintendo 64.lpl',

  // Nintendo DS
  '.nds': 'Nintendo - Nintendo DS.lpl',
  'nds': 'Nintendo - Nintendo DS.lpl',

  // Sega Master System
  '.sms': 'Sega - Master System - Mark III.lpl',
  'sms': 'Sega - Master System - Mark III.lpl',

  // Sega Game Gear
  '.gg': 'Sega - Game Gear.lpl',
  'gg': 'Sega - Game Gear.lpl',

  // Sega Genesis / Mega Drive
  '.md': 'Sega - Mega Drive - Genesis.lpl',
  '.smd': 'Sega - Mega Drive - Genesis.lpl',
  '.gen': 'Sega - Mega Drive - Genesis.lpl',
  '.bin': 'Sega - Mega Drive - Genesis.lpl', // Note: .bin is ambiguous
  'genesis': 'Sega - Mega Drive - Genesis.lpl',
  'picodrive': 'Sega - Mega Drive - Genesis.lpl',

  // Sega 32X
  '.32x': 'Sega - 32X.lpl',
  '32x': 'Sega - 32X.lpl',

  // Sega CD
  '.iso': 'Sega - Mega-CD - Sega CD.lpl', // Note: .iso is ambiguous
  '.cue': 'Sega - Mega-CD - Sega CD.lpl', // Note: .cue is ambiguous
  'segacd': 'Sega - Mega-CD - Sega CD.lpl',

  // PC Engine / TurboGrafx-16
  '.pce': 'NEC - PC Engine - TurboGrafx 16.lpl',
  'pce': 'NEC - PC Engine - TurboGrafx 16.lpl',
  'mednafen_pce': 'NEC - PC Engine - TurboGrafx 16.lpl',

  // Atari 2600
  '.a26': 'Atari - 2600.lpl',
  'atari2600': 'Atari - 2600.lpl',

  // Atari 7800
  '.a78': 'Atari - 7800.lpl',
  'atari7800': 'Atari - 7800.lpl',

  // Atari Lynx
  '.lnx': 'Atari - Lynx.lpl',
  'lynx': 'Atari - Lynx.lpl',

  // Neo Geo Pocket
  '.ngp': 'SNK - Neo Geo Pocket.lpl',
  'ngp': 'SNK - Neo Geo Pocket.lpl',

  // Neo Geo Pocket Color
  '.ngc': 'SNK - Neo Geo Pocket Color.lpl',
  'ngpc': 'SNK - Neo Geo Pocket Color.lpl',

  // WonderSwan
  '.ws': 'Bandai - WonderSwan.lpl',
  'wonderswan': 'Bandai - WonderSwan.lpl',

  // WonderSwan Color
  '.wsc': 'Bandai - WonderSwan Color.lpl',
  'wonderswancolor': 'Bandai - WonderSwan Color.lpl',

  // Virtual Boy
  '.vb': 'Nintendo - Virtual Boy.lpl',
  'virtualboy': 'Nintendo - Virtual Boy.lpl',

  // Vectrex
  '.vec': 'GCE - Vectrex.lpl',
  'vectrex': 'GCE - Vectrex.lpl',

  // ColecoVision
  '.col': 'Coleco - ColecoVision.lpl',
  'colecovision': 'Coleco - ColecoVision.lpl',

  // Intellivision
  '.int': 'Mattel - Intellivision.lpl',
  'intellivision': 'Mattel - Intellivision.lpl',

  // PlayStation
  'psx': 'Sony - PlayStation.lpl',
  'playstation': 'Sony - PlayStation.lpl',

  // PlayStation Portable
  'psp': 'Sony - PlayStation Portable.lpl',
};

/**
 * Default database name for unknown systems.
 * Used when no specific mapping exists.
 */
export const DEFAULT_DATABASE_NAME = 'Unknown System.lpl';

// =============================================================================
// Path Constants
// =============================================================================

/** Windows path separator */
export const WINDOWS_PATH_SEP = '\\';

/** Unix path separator */
export const UNIX_PATH_SEP = '/';

// =============================================================================
// File Extension Constants
// =============================================================================

/** RetroArch playlist file extension */
export const PLAYLIST_EXTENSION = '.lpl';
