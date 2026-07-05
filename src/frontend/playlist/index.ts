/**
 * RetroArch Playlist Generator
 *
 * Generates RetroArch-compatible .lpl playlist files from scanned ROMs.
 *
 * Reference: https://docs.libretro.com/guides/roms-playlists-thumbnails/
 */

import { writeFileSync, existsSync, readdirSync } from 'fs';
import { readJsonFile } from '../../utils/readJsonFile';
import { ensureDirectory } from '../../utils/ensureDirectory';
import { join, dirname, basename, resolve, isAbsolute } from 'path';
import type { RomInfo } from '../romScanner';
import { calculateFileCrc32 } from '../../utils/crc32';
import {
  PLAYLIST_VERSION,
  LABEL_DISPLAY_MODE_DEFAULT,
  THUMBNAIL_MODE_DEFAULT,
  SORT_MODE_ALPHABETICAL,
  RETROARCH_DATABASE_NAMES,
  DEFAULT_DATABASE_NAME,
  WINDOWS_PATH_SEP,
  UNIX_PATH_SEP,
  PLAYLIST_EXTENSION,
} from './consts';
import { readPlaylist } from './reader';
import { normalizePath } from './utils';
import { formatRomLabel } from './labelFormatter';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { secondsToHms, SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from '../../utils/format';
import { isPlainObject } from 'remeda';

/**
 * RetroArch uses "DETECT" as a placeholder when values are unknown.
 * This ensures compatibility with RetroArch's playlist format.
 */
const DETECT = 'DETECT';

// =============================================================================
// CRC Cache Types
// =============================================================================

/**
 * Cache mapping absolute ROM paths to their CRC32 checksums.
 * Used to avoid recomputing CRC32 when updating existing playlists.
 */
export type CrcCache = Map<string, string>;

/**
 * Location of a playlist entry for fast lookups.
 */
export interface PlaylistEntryLocation {
  /** Path to the playlist file */
  playlistPath: string;
  /** Index of the entry within the playlist's items array */
  entryIndex: number;
}

/**
 * Index mapping normalized ROM paths to their playlist locations.
 * Enables O(1) lookups instead of O(n) searches across all playlists.
 */
export type PlaylistIndex = Map<string, PlaylistEntryLocation>;

// =============================================================================
// Types
// =============================================================================

/**
 * A single entry in a RetroArch playlist
 */
export interface PlaylistEntry {
  /** Path to the ROM file */
  path: string;
  /** Display label (game title) */
  label: string;
  /** Path to the libretro core, or "DETECT" for auto-detection */
  core_path: string;
  /** Name of the libretro core, or "DETECT" for auto-detection */
  core_name: string;
  /** CRC32 checksum as 8-char uppercase hex, or "DETECT" to skip validation */
  crc32: string;
  /** Associated database name (system playlist name) */
  db_name: string;

  // Runtime logging fields (RetroArch compatible)
  /** Total runtime hours */
  runtime_hours?: number;
  /** Total runtime minutes (0-59) */
  runtime_minutes?: number;
  /** Total runtime seconds (0-59) */
  runtime_seconds?: number;

  // Last played timestamp fields (RetroArch compatible)
  /** Year last played */
  last_played_year?: number;
  /** Month last played (1-12) */
  last_played_month?: number;
  /** Day last played (1-31) */
  last_played_day?: number;
  /** Hour last played (0-23) */
  last_played_hour?: number;
  /** Minute last played (0-59) */
  last_played_minute?: number;
  /** Second last played (0-59) */
  last_played_second?: number;
}

/**
 * RetroArch playlist file format (JSON, version 1.5+)
 */
export interface PlaylistFile {
  /** Playlist format version */
  version: string;
  /** Default core path for all entries, or "DETECT" for per-entry detection */
  default_core_path: string;
  /** Default core name for all entries, or "DETECT" for per-entry detection */
  default_core_name: string;
  /** Label display mode (0 = default) */
  label_display_mode: number;
  /** Right thumbnail mode (0 = boxart) */
  right_thumbnail_mode: number;
  /** Left thumbnail mode (0 = boxart) */
  left_thumbnail_mode: number;
  /** Sort mode (0 = alphabetical) */
  sort_mode: number;
  /** Playlist entries */
  items: PlaylistEntry[];
}

/**
 * Validates that a parsed JSON value has the basic structure of a PlaylistFile.
 * Checks for an object with an items array.
 */
export const isPlaylistFile = (value: unknown): value is PlaylistFile => {
  return isPlainObject(value) && Array.isArray(value.items);
};

/**
 * Options for playlist generation
 */
export interface PlaylistOptions {
  /** Default core path (optional, auto-detected from ROMs if not specified) */
  defaultCorePath?: string;
  /** Default core name (optional, auto-detected from ROMs if not specified) */
  defaultCoreName?: string;
  /** Use Windows path separators (backslash) */
  windowsPaths?: boolean;
  /** Custom label generator function */
  labelGenerator?: (rom: RomInfo) => string;
}

/**
 * Result of playlist generation
 */
export interface PlaylistGenerationResult {
  /** Whether generation was successful */
  success: boolean;
  /** Path to the generated playlist file */
  outputPath?: string;
  /** Number of entries in the playlist */
  entryCount: number;
  /** Error message if generation failed */
  error?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the RetroArch database name for a ROM based on its extension or system ID.
 */
export const getDatabaseName = (extension: string, systemId?: string): string => {
  // Try system ID first (more specific)
  if (systemId && RETROARCH_DATABASE_NAMES[systemId]) {
    return RETROARCH_DATABASE_NAMES[systemId];
  }

  // Try extension (normalized to lowercase with dot)
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return RETROARCH_DATABASE_NAMES[ext] ?? DEFAULT_DATABASE_NAME;
};

/**
 * Get the RetroArch system name (without .lpl extension) for a ROM.
 * Used for thumbnail directory naming.
 *
 * Example: ".nes" → "Nintendo - Nintendo Entertainment System"
 */
export const getSystemName = (extension: string, systemId?: string): string => {
  const dbName = getDatabaseName(extension, systemId);
  return dbName.endsWith(PLAYLIST_EXTENSION)
    ? dbName.slice(0, -PLAYLIST_EXTENSION.length)
    : dbName;
};

/**
 * Convert a path to use the specified separator style.
 */
const convertPathSeparators = (path: string, useWindows: boolean): string => {
  if (useWindows) {
    return path.replace(/\//g, WINDOWS_PATH_SEP);
  }
  return path.replace(/\\/g, UNIX_PATH_SEP);
};

/**
 * Generate a display label for a ROM.
 * Prefers embedded title from metadata, falls back to filename without extension.
 * Note: Labels are formatted by createPlaylistEntry, so this just returns the raw value.
 */
const defaultLabelGenerator = (rom: RomInfo): string => {
  // Use embedded title if available
  if (rom.metadata.title) {
    return rom.metadata.title;
  }

  // Fall back to filename without extension
  return basename(rom.filename, rom.extension);
};

/**
 * Build a CRC cache from an existing playlist's entries.
 * Maps absolute ROM paths to their CRC32 checksums.
 * Skips entries with "DETECT" as the CRC value (meaning not yet computed).
 */
export const buildCrcCacheFromPlaylist = (
  playlist: PlaylistFile,
  playlistPath: string
): CrcCache => {
  const cache: CrcCache = new Map();
  const playlistDir = dirname(playlistPath);

  for (const entry of playlist.items) {
    // Skip entries without a real CRC value
    if (!entry.crc32 || entry.crc32 === DETECT) {
      continue;
    }

    // Resolve the path to absolute if needed
    let absolutePath = entry.path;
    if (!isAbsolute(entry.path)) {
      // Relative path - resolve relative to playlist location
      absolutePath = resolve(playlistDir, entry.path);
    }

    // Normalize the path for consistent cache lookups (handles case-insensitive FS)
    cache.set(normalizePath(absolutePath), entry.crc32);
  }

  return cache;
};

/**
 * Build a CRC cache from all playlists in a directory.
 * Combines CRC32 values from all playlist files into a single lookup map.
 *
 * @param playlistDirectory - Directory containing playlist files
 * @returns Combined cache mapping normalized ROM paths to CRC32 checksums
 */
export const buildCrcCacheFromDirectory = (playlistDirectory: string): CrcCache => {
  const cache: CrcCache = new Map();

  if (!existsSync(playlistDirectory)) {
    return cache;
  }

  const files = readdirSync(playlistDirectory);

  for (const file of files) {
    if (!file.toLowerCase().endsWith(PLAYLIST_EXTENSION)) {
      continue;
    }

    const playlistPath = join(playlistDirectory, file);

    const parsed = readJsonFile(playlistPath);

    if (!isPlaylistFile(parsed)) {
      continue;
    }

    // Merge CRCs from this playlist into the cache
    const playlistCache = buildCrcCacheFromPlaylist(parsed, playlistPath);
    for (const [path, crc] of playlistCache) {
      cache.set(path, crc);
    }
  }

  return cache;
};

/**
 * Build an index of ROM paths to their playlist locations.
 * Enables O(1) lookups for runtime updates instead of O(n) searches.
 *
 * @param playlistDirectory - Directory containing playlist files
 * @returns Index mapping normalized ROM paths to playlist locations
 */
export const buildPlaylistIndex = (playlistDirectory: string): PlaylistIndex => {
  const index: PlaylistIndex = new Map();

  if (!existsSync(playlistDirectory)) {
    return index;
  }

  const files = readdirSync(playlistDirectory);

  for (const file of files) {
    if (!file.toLowerCase().endsWith(PLAYLIST_EXTENSION)) {
      continue;
    }

    const playlistPath = join(playlistDirectory, file);

    const parsed = readJsonFile(playlistPath);

    if (!isPlaylistFile(parsed)) {
      continue;
    }

    const playlistDir = dirname(playlistPath);

    for (let entryIndex = 0; entryIndex < parsed.items.length; entryIndex++) {
      const entry = parsed.items[entryIndex];

      // Resolve the entry path to absolute if needed
      let absolutePath = entry.path;
      if (!isAbsolute(entry.path)) {
        absolutePath = resolve(playlistDir, entry.path);
      }

      // Normalize for consistent lookups (handles case-insensitive FS via realpathSync)
      index.set(normalizePath(absolutePath), { playlistPath, entryIndex });
    }
  }

  return index;
};


/**
 * Convert a Date to RetroArch last_played fields
 */
const dateToLastPlayed = (date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,  // JavaScript months are 0-indexed
  day: date.getDate(),
  hour: date.getHours(),
  minute: date.getMinutes(),
  second: date.getSeconds(),
});

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Create a playlist entry from a RomInfo object.
 */
export const createPlaylistEntry = (
  rom: RomInfo,
  options: PlaylistOptions = {}
): PlaylistEntry => {
  const {
    windowsPaths = false,
    labelGenerator = defaultLabelGenerator,
  } = options;

  // Convert path separators if needed
  const romPath = convertPathSeparators(rom.path, windowsPaths);

  // Use CRC32 from RomInfo if available (calculated during scan),
  // otherwise compute it
  const fileCrc32 = rom.crc32 ?? calculateFileCrc32(rom.path);

  // Use DETECT for core_path and core_name by default (matches RetroArch behavior).
  // Users can set specific cores later via RetroArch's Playlist Management menu.
  // Always format the label to ensure consistent formatting regardless of source
  const entry: PlaylistEntry = {
    path: romPath,
    label: formatRomLabel(labelGenerator(rom)),
    core_path: DETECT,
    core_name: DETECT,
    crc32: fileCrc32 ?? DETECT,
    db_name: getDatabaseName(rom.extension, rom.systemId),
  };

  // Add runtime data if available
  if (rom.runtimeSeconds !== undefined && rom.runtimeSeconds > 0) {
    const runtime = secondsToHms(rom.runtimeSeconds);
    entry.runtime_hours = runtime.hours;
    entry.runtime_minutes = runtime.minutes;
    entry.runtime_seconds = runtime.seconds;
  }

  // Add last played data if available
  if (rom.lastPlayed !== undefined) {
    const lastPlayed = dateToLastPlayed(rom.lastPlayed);
    entry.last_played_year = lastPlayed.year;
    entry.last_played_month = lastPlayed.month;
    entry.last_played_day = lastPlayed.day;
    entry.last_played_hour = lastPlayed.hour;
    entry.last_played_minute = lastPlayed.minute;
    entry.last_played_second = lastPlayed.second;
  }

  return entry;
};

/**
 * Generate a RetroArch-compatible playlist from a list of ROMs.
 */
export const generatePlaylist = (
  roms: RomInfo[],
  options: PlaylistOptions = {}
): PlaylistFile => {
  const {
    defaultCorePath: providedCorePath,
    defaultCoreName: providedCoreName,
  } = options;

  // Create entries
  const items = roms.map(rom => createPlaylistEntry(rom, options));

  // Use DETECT by default for playlist-level core settings (matches RetroArch behavior).
  // Users can set specific cores later via RetroArch's Playlist Management menu.
  const playlist: PlaylistFile = {
    version: PLAYLIST_VERSION,
    default_core_path: providedCorePath ?? DETECT,
    default_core_name: providedCoreName ?? DETECT,
    label_display_mode: LABEL_DISPLAY_MODE_DEFAULT,
    right_thumbnail_mode: THUMBNAIL_MODE_DEFAULT,
    left_thumbnail_mode: THUMBNAIL_MODE_DEFAULT,
    sort_mode: SORT_MODE_ALPHABETICAL,
    items,
  };

  return playlist;
};

/**
 * Write a playlist to a file.
 *
 * @param playlist - The playlist to write
 * @param outputPath - Path to the output .lpl file
 * @returns Result of the write operation
 */
export const writePlaylist = (
  playlist: PlaylistFile,
  outputPath: string
): PlaylistGenerationResult => {
  try {
    // Ensure output path has .lpl extension
    let finalPath = outputPath;
    if (!finalPath.toLowerCase().endsWith(PLAYLIST_EXTENSION)) {
      finalPath += PLAYLIST_EXTENSION;
    }

    ensureDirectory(dirname(finalPath));

    // Write with pretty-printing for readability
    const json = JSON.stringify(playlist, null, 2);
    writeFileSync(finalPath, json, 'utf-8');

    return {
      success: true,
      outputPath: finalPath,
      entryCount: playlist.items.length,
    };
  } catch (err) {
    return {
      success: false,
      entryCount: 0,
      error: getErrorMessage(err),
    };
  }
};

/**
 * Generate and write a playlist from ROMs in a single operation.
 * If a playlist already exists at the output path, new entries are merged
 * with existing entries (avoiding duplicates by path). CRC32 values from
 * existing entries are cached to avoid recomputing them.
 *
 * @param roms - Array of RomInfo objects to include in the playlist
 * @param outputPath - Path to the output .lpl file
 * @param options - Playlist generation options
 * @returns Result of the generation and write operation
 */
export const generateAndWritePlaylist = (
  roms: RomInfo[],
  outputPath: string,
  options: PlaylistOptions = {}
): PlaylistGenerationResult => {
  if (roms.length === 0) {
    return {
      success: false,
      entryCount: 0,
      error: 'No ROMs provided for playlist generation',
    };
  }

  // Ensure output path has .lpl extension for lookup
  let playlistPath = outputPath;
  if (!playlistPath.toLowerCase().endsWith(PLAYLIST_EXTENSION)) {
    playlistPath += PLAYLIST_EXTENSION;
  }

  // Try to load existing playlist
  const existingResult = readPlaylist(playlistPath);
  const existingPlaylist = existingResult.success ? existingResult.playlist : null;

  // Generate new entries
  const newPlaylist = generatePlaylist(roms, options);

  // If no existing playlist, just write the new one
  if (!existingPlaylist) {
    return writePlaylist(newPlaylist, outputPath);
  }

  // Build a set of existing normalized paths to avoid duplicates
  const playlistDir = dirname(playlistPath);
  const existingPaths = new Set<string>();
  for (const entry of existingPlaylist.items) {
    const resolvedPath = isAbsolute(entry.path)
      ? entry.path
      : resolve(playlistDir, entry.path);
    existingPaths.add(normalizePath(resolvedPath));
  }

  // Filter new entries to only those not already in the playlist
  const newEntries = newPlaylist.items.filter(entry => {
    const resolvedPath = isAbsolute(entry.path)
      ? entry.path
      : resolve(playlistDir, entry.path);
    return !existingPaths.has(normalizePath(resolvedPath));
  });

  // Merge: keep existing entries and add new ones
  const mergedPlaylist: PlaylistFile = {
    ...existingPlaylist,
    items: [...existingPlaylist.items, ...newEntries],
  };

  const result = writePlaylist(mergedPlaylist, outputPath);

  // Return the count of entries actually added, not the total
  return {
    ...result,
    entryCount: newEntries.length,
  };
};

/**
 * Generate playlists grouped by system.
 * Creates one playlist per system (e.g., "Nintendo - NES.lpl", "Sega - Genesis.lpl").
 *
 * @param roms - Array of RomInfo objects
 * @param outputDirectory - Directory to write playlist files
 * @param options - Playlist generation options
 * @returns Array of results, one per generated playlist
 */
export const generatePlaylistsBySystem = (
  roms: RomInfo[],
  outputDirectory: string,
  options: PlaylistOptions = {}
): PlaylistGenerationResult[] => {
  // Group ROMs by database name (system)
  const romsBySystem = new Map<string, RomInfo[]>();

  for (const rom of roms) {
    const dbName = getDatabaseName(rom.extension, rom.systemId);
    const existing = romsBySystem.get(dbName) ?? [];
    existing.push(rom);
    romsBySystem.set(dbName, existing);
  }

  // Generate a playlist for each system
  const results: PlaylistGenerationResult[] = [];

  for (const [dbName, systemRoms] of romsBySystem) {
    const outputPath = join(outputDirectory, dbName);
    const result = generateAndWritePlaylist(systemRoms, outputPath, options);
    results.push(result);
  }

  return results;
};

/**
 * Generate a single consolidated playlist with all ROMs.
 *
 * @param roms - Array of RomInfo objects
 * @param outputPath - Path to the output .lpl file
 * @param options - Playlist generation options
 * @returns Result of the generation
 */
export const generateConsolidatedPlaylist = (
  roms: RomInfo[],
  outputPath: string,
  options: PlaylistOptions = {}
): PlaylistGenerationResult => {
  return generateAndWritePlaylist(roms, outputPath, options);
};

/**
 * Result of updating a playlist entry
 */
export interface PlaylistUpdateResult {
  /** Whether the update was successful */
  success: boolean;
  /** Path to the updated playlist file */
  playlistPath?: string;
  /** Error message if update failed */
  error?: string;
}

/**
 * Update a playlist entry's runtime and write back to disk.
 * Internal helper used by updatePlaylistRuntime.
 */
const updateEntryAndWrite = (
  playlistPath: string,
  entryIndex: number,
  sessionSeconds: number,
  lastPlayed: Date
): PlaylistUpdateResult => {
  const parsed = readJsonFile(playlistPath);

  if (!isPlaylistFile(parsed) || entryIndex >= parsed.items.length) {
    return { success: false, error: 'Invalid playlist or entry index' };
  }

  try {

    const entry = parsed.items[entryIndex];

    // Calculate new runtime (add to existing)
    const existingHours = entry.runtime_hours ?? 0;
    const existingMinutes = entry.runtime_minutes ?? 0;
    const existingSeconds = entry.runtime_seconds ?? 0;
    const existingTotalSeconds = existingHours * SECONDS_PER_HOUR +
                                 existingMinutes * SECONDS_PER_MINUTE +
                                 existingSeconds;
    const newTotalSeconds = existingTotalSeconds + sessionSeconds;
    const newRuntime = secondsToHms(newTotalSeconds);

    entry.runtime_hours = newRuntime.hours;
    entry.runtime_minutes = newRuntime.minutes;
    entry.runtime_seconds = newRuntime.seconds;

    // Update last_played
    const lastPlayedFields = dateToLastPlayed(lastPlayed);
    entry.last_played_year = lastPlayedFields.year;
    entry.last_played_month = lastPlayedFields.month;
    entry.last_played_day = lastPlayedFields.day;
    entry.last_played_hour = lastPlayedFields.hour;
    entry.last_played_minute = lastPlayedFields.minute;
    entry.last_played_second = lastPlayedFields.second;

    // Write back
    const json = JSON.stringify(parsed, null, 2);
    writeFileSync(playlistPath, json, 'utf-8');

    return { success: true, playlistPath };
  } catch (err) {
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
};

/**
 * Update only the last_played fields of a playlist entry (no runtime changes).
 * Internal helper used by updateLastPlayed.
 */
const updateLastPlayedOnly = (
  playlistPath: string,
  entryIndex: number,
  lastPlayed: Date
): PlaylistUpdateResult => {
  const parsed = readJsonFile(playlistPath);

  if (!isPlaylistFile(parsed) || entryIndex >= parsed.items.length) {
    return { success: false, error: 'Invalid playlist or entry index' };
  }

  try {

    const entry = parsed.items[entryIndex];

    // Update last_played fields only
    const lastPlayedFields = dateToLastPlayed(lastPlayed);
    entry.last_played_year = lastPlayedFields.year;
    entry.last_played_month = lastPlayedFields.month;
    entry.last_played_day = lastPlayedFields.day;
    entry.last_played_hour = lastPlayedFields.hour;
    entry.last_played_minute = lastPlayedFields.minute;
    entry.last_played_second = lastPlayedFields.second;

    // Write back
    const json = JSON.stringify(parsed, null, 2);
    writeFileSync(playlistPath, json, 'utf-8');

    return { success: true, playlistPath };
  } catch (err) {
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
};

/**
 * Search for a ROM entry across all playlists (O(n) fallback).
 * Internal helper used when no index is provided.
 */
const findRomInPlaylists = (
  normalizedRomPath: string,
  playlistDirectory: string
): PlaylistEntryLocation | null => {
  const files = readdirSync(playlistDirectory);

  for (const file of files) {
    if (!file.toLowerCase().endsWith(PLAYLIST_EXTENSION)) {
      continue;
    }

    const playlistPath = join(playlistDirectory, file);

    const parsed = readJsonFile(playlistPath);

    if (!isPlaylistFile(parsed)) {
      continue;
    }

    const entryIndex = parsed.items.findIndex(entry => {
      let entryPath = entry.path;
      if (!isAbsolute(entryPath)) {
        entryPath = resolve(dirname(playlistPath), entryPath);
      }
      return normalizePath(entryPath) === normalizedRomPath;
    });

    if (entryIndex !== -1) {
      return { playlistPath, entryIndex };
    }
  }

  return null;
};

/**
 * Update runtime and last_played data for a ROM in a playlist.
 *
 * This function finds the playlist containing the ROM, updates the entry's
 * runtime (adding to existing) and last_played (replacing), then writes back.
 *
 * When an index is provided, uses O(1) lookup. Otherwise falls back to O(n) search.
 *
 * @param romPath - Absolute path to the ROM file
 * @param playlistDirectory - Directory containing playlist files
 * @param sessionSeconds - Seconds played in this session (added to existing runtime)
 * @param lastPlayed - When the session ended (optional, defaults to now)
 * @param index - Optional playlist index for O(1) lookups (from buildPlaylistIndex)
 * @returns Result of the update operation
 */
export const updatePlaylistRuntime = (
  romPath: string,
  playlistDirectory: string,
  sessionSeconds: number,
  lastPlayed: Date = new Date(),
  index?: PlaylistIndex
): PlaylistUpdateResult => {
  try {
    if (!existsSync(playlistDirectory)) {
      return { success: false, error: 'Playlist directory not found' };
    }

    const normalizedRomPath = normalizePath(romPath);

    // Use index for O(1) lookup if available, otherwise fall back to O(n) search
    const location = index?.get(normalizedRomPath) ?? findRomInPlaylists(normalizedRomPath, playlistDirectory);

    if (!location) {
      return { success: false, error: 'ROM not found in any playlist' };
    }

    return updateEntryAndWrite(location.playlistPath, location.entryIndex, sessionSeconds, lastPlayed);
  } catch (err) {
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
};

/**
 * Update only the last_played date for a ROM in a playlist.
 *
 * Used to migrate save state timestamps to playlist last_played fields
 * for ROMs that don't have this data yet.
 *
 * @param romPath - Absolute path to the ROM file
 * @param playlistDirectory - Directory containing playlist files
 * @param lastPlayed - The date to set as last_played
 * @param index - Optional playlist index for O(1) lookups (from buildPlaylistIndex)
 */
export const updateLastPlayed = (
  romPath: string,
  playlistDirectory: string,
  lastPlayed: Date,
  index?: PlaylistIndex
): PlaylistUpdateResult => {
  try {
    if (!existsSync(playlistDirectory)) {
      return { success: false, error: 'Playlist directory not found' };
    }

    const normalizedRomPath = normalizePath(romPath);

    // Use index for O(1) lookup if available, otherwise fall back to O(n) search
    const location = index?.get(normalizedRomPath) ?? findRomInPlaylists(normalizedRomPath, playlistDirectory);

    if (!location) {
      return { success: false, error: 'ROM not found in any playlist' };
    }

    return updateLastPlayedOnly(location.playlistPath, location.entryIndex, lastPlayed);
  } catch (err) {
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
};

// Re-export constants
export * from './consts';

// Re-export reader functions
export {
  readPlaylist,
  playlistEntryToRomInfo,
  playlistToRomInfoArray,
  findPlaylistsInDirectory,
  findPlaylistsForDirectory,
  loadRomsFromPlaylists,
} from './reader';
export type {
  PlaylistReadResult,
  PlaylistInfo,
  ConversionOptions,
} from './reader';

// Re-export utility functions
export { normalizePath, resolvePath } from './utils';

// Re-export sync functions
export {
  analyzePlaylistSync,
  syncPlaylists,
  countPlaylistEntries,
} from './sync';
export type {
  SyncAnalysis,
  SyncResult,
  SyncOptions,
  MissingEntry,
  MovedRom,
  PlaylistEntryWithContext,
  DuplicateCrcRom,
  DuplicateCrcChoice,
  DuplicateDecision,
} from './sync';

// Re-export label formatter
export { formatRomLabel } from './labelFormatter';

// Re-export system lookup utilities
export {
  getSystemInfo,
  getVendor,
  getSystemByExtension,
  getAllVendors,
  getSystemsForVendor,
  getExtensionsForSystem,
} from './systemLookup';
export type { SystemInfo } from './systemLookup';
