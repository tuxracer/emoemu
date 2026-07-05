/**
 * RetroArch Playlist Reader
 *
 * Reads and parses RetroArch-compatible .lpl playlist files.
 * Supports both JSON format (1.5+) and converts entries to RomInfo for the browser.
 */

import { readFileSync, existsSync, statSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname, basename, extname, resolve } from 'path';
import { isPlaylistFile } from '..';
import type { PlaylistFile, PlaylistEntry } from '..';
import type { RomInfo, RomMetadata } from '../../romScanner';
import { sortRoms } from '../../romScanner';
import { findMatchingCores } from '../../coreRegistry';
import { PLAYLIST_EXTENSION, RETROARCH_DATABASE_NAMES } from '..';
import { resolvePath } from '../utils';
import { getSaveStateService, getBatterySaveService } from '../../serviceProvider';
import { logger } from '@/utils/logger';
import { getErrorMessage } from '@/utils/getErrorMessage';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of reading a playlist file
 */
export interface PlaylistReadResult {
  /** Whether the read was successful */
  success: boolean;
  /** The parsed playlist, if successful */
  playlist?: PlaylistFile;
  /** Path to the playlist file */
  path: string;
  /** Error message if read failed */
  error?: string;
}

/**
 * Information about a discovered playlist
 */
export interface PlaylistInfo {
  /** Full path to the playlist file */
  path: string;
  /** Playlist filename */
  filename: string;
  /** System name derived from db_name (e.g., "Nintendo - NES") */
  systemName: string;
  /** Number of entries in the playlist */
  entryCount: number;
  /** Last modified date of the playlist file */
  modified: Date;
}

/**
 * Options for converting playlist entries to RomInfo
 */
export interface ConversionOptions {
  /** Base directory to resolve relative paths against */
  baseDirectory?: string;
  /** Whether to validate that ROM files exist */
  validateFiles?: boolean;
  /** Whether to check for save states */
  checkSaveStates?: boolean;
  /**
   * Whether to persist migrated lastPlayed dates to the playlist file.
   * When enabled, ROMs with save states but no last_played in the playlist
   * will have their last_played updated from the save state's savedAt timestamp.
   * Default: true
   */
  persistMigratedDates?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Default file size for entries where the file doesn't exist */
const UNKNOWN_FILE_SIZE = 0;

/** Minimum playlist version we support */
const MIN_PLAYLIST_VERSION = '1.0';

/** Seconds per minute */
const SECONDS_PER_MINUTE = 60;

/** Seconds per hour */
const SECONDS_PER_HOUR = 3600;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert RetroArch runtime fields to total seconds
 */
const parseRuntimeSeconds = (entry: PlaylistEntry): number | undefined => {
  const hours = entry.runtime_hours ?? 0;
  const minutes = entry.runtime_minutes ?? 0;
  const seconds = entry.runtime_seconds ?? 0;

  // If all are 0 or undefined, return undefined
  if (hours === 0 && minutes === 0 && seconds === 0) {
    return undefined;
  }

  return hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds;
};

/**
 * Convert RetroArch last_played fields to a Date object
 */
const parseLastPlayed = (entry: PlaylistEntry): Date | undefined => {
  const year = entry.last_played_year;
  const month = entry.last_played_month;
  const day = entry.last_played_day;

  // Year is required for a valid date
  if (year === undefined || year === 0) {
    return undefined;
  }

  // Create date with available fields (default to 1 for missing month/day)
  return new Date(
    year,
    (month ?? 1) - 1,  // JavaScript months are 0-indexed
    day ?? 1,
    entry.last_played_hour ?? 0,
    entry.last_played_minute ?? 0,
    entry.last_played_second ?? 0
  );
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

/**
 * Extract system name from database name (e.g., "Nintendo - NES.lpl" -> "Nintendo - NES")
 */
const getSystemNameFromDbName = (dbName: string): string => {
  if (!dbName) {
    return 'Unknown System';
  }
  // Remove .lpl extension if present
  return dbName.endsWith(PLAYLIST_EXTENSION)
    ? dbName.slice(0, -PLAYLIST_EXTENSION.length)
    : dbName;
};

/**
 * Get system ID from database name by looking up in our mappings
 */
const getSystemIdFromDbName = (dbName: string): string => {
  // Find extension that maps to this db_name
  for (const [key, value] of Object.entries(RETROARCH_DATABASE_NAMES)) {
    if (value === dbName && key.startsWith('.')) {
      // Return the extension without the dot as a fallback system ID
      return key.slice(1);
    }
  }
  return 'unknown';
};

/**
 * Format file size to human-readable string
 */
const formatSize = (bytes: number): string => {
  const KB = 1024;
  const MB = KB * KB;
  if (bytes < KB) {
    return `${bytes} B`;
  }
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(1)} KB`;
  }
  return `${(bytes / MB).toFixed(1)} MB`;
};

/**
 * Check if a file exists and get its stats
 */
const getFileStats = (filePath: string): { exists: boolean; size: number; modified: Date } | null => {
  try {
    if (existsSync(filePath)) {
      const stats = statSync(filePath);
      if (stats.isFile()) {
        return {
          exists: true,
          size: stats.size,
          modified: stats.mtime,
        };
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
};

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Read and parse a playlist file
 */
export const readPlaylist = (playlistPath: string): PlaylistReadResult => {
  try {
    if (!existsSync(playlistPath)) {
      return {
        success: false,
        path: playlistPath,
        error: 'Playlist file not found',
      };
    }

    const content = readFileSync(playlistPath, 'utf-8');

    // Try to parse as JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        success: false,
        path: playlistPath,
        error: 'Invalid JSON format',
      };
    }

    if (!isPlaylistFile(parsed)) {
      return {
        success: false,
        path: playlistPath,
        error: 'Missing or invalid items array',
      };
    }

    const playlist = parsed;

    // Validate required fields
    if (!playlist.version) {
      return {
        success: false,
        path: playlistPath,
        error: 'Missing version field',
      };
    }

    // Check version compatibility
    const version = parseFloat(playlist.version);
    if (version < parseFloat(MIN_PLAYLIST_VERSION)) {
      return {
        success: false,
        path: playlistPath,
        error: `Unsupported playlist version: ${playlist.version}`,
      };
    }

    // Log successful playlist load (RetroArch-style)
    logger.info(`Loading playlist file: "${playlistPath}"`, 'Playlist');

    return {
      success: true,
      playlist,
      path: playlistPath,
    };
  } catch (err) {
    logger.warn(`Failed to read playlist: "${playlistPath}"`, 'Playlist');
    return {
      success: false,
      path: playlistPath,
      error: getErrorMessage(err),
    };
  }
};

/**
 * Convert a playlist entry to RomInfo for the browser
 */
export const playlistEntryToRomInfo = (
  entry: PlaylistEntry,
  _playlist: PlaylistFile,
  playlistPath: string,
  options: ConversionOptions = {}
): RomInfo | null => {
  const {
    baseDirectory,
    validateFiles = true,
    checkSaveStates = true,
  } = options;

  // Resolve the ROM path
  const playlistDir = dirname(playlistPath);
  const resolvedPath = resolvePath(entry.path, baseDirectory ?? playlistDir);

  // Get file stats if validation is enabled
  const fileStats = validateFiles ? getFileStats(resolvedPath) : null;

  // Skip entries where the file doesn't exist (if validation enabled)
  if (validateFiles && !fileStats) {
    return null;
  }

  const ext = extname(resolvedPath).toLowerCase();
  const filename = basename(resolvedPath);

  // Get matching cores for this file
  const matchingCores = findMatchingCores(resolvedPath);
  const coreIds = matchingCores.map(c => c.id);

  // Determine system info
  const systemName = getSystemNameFromDbName(entry.db_name);
  let systemId = getSystemIdFromDbName(entry.db_name);

  // If we have matching cores, use the first one's info
  if (matchingCores.length > 0) {
    systemId = matchingCores[0].id;
  }

  // Check for save data using services
  const saveStateInfo = checkSaveStates
    ? getSaveStateService().checkExists(resolvedPath)
    : { exists: false };
  const batterySaveInfo = checkSaveStates
    ? getBatterySaveService().checkExists(resolvedPath)
    : { exists: false };

  // Build metadata from the playlist entry
  const metadata: RomMetadata = {
    title: entry.label || undefined,
  };

  // Parse runtime data from playlist entry
  const runtimeSeconds = parseRuntimeSeconds(entry);
  const lastPlayed = parseLastPlayed(entry);

  return {
    path: resolvedPath,
    filename,
    extension: ext,
    size: fileStats?.size ?? UNKNOWN_FILE_SIZE,
    sizeFormatted: formatSize(fileStats?.size ?? UNKNOWN_FILE_SIZE),
    modified: fileStats?.modified ?? new Date(),
    system: systemName,
    systemId,
    coreCount: matchingCores.length,
    coreIds,
    metadata,
    hasSaveState: saveStateInfo.exists,
    saveStateDate: saveStateInfo.date,
    hasBatterySave: batterySaveInfo.exists,
    batterySaveDate: batterySaveInfo.date,
    runtimeSeconds,
    lastPlayed,
    label: entry.label || undefined,
  };
};

/**
 * Convert all entries in a playlist to RomInfo array
 */
export const playlistToRomInfoArray = (
  playlist: PlaylistFile,
  playlistPath: string,
  options: ConversionOptions = {}
): RomInfo[] => {
  const results: RomInfo[] = [];
  const { persistMigratedDates = true } = options;

  // Track entries that need last_played migration (entry index -> Date)
  const migrationsNeeded = new Map<number, Date>();

  for (let i = 0; i < playlist.items.length; i++) {
    const entry = playlist.items[i];
    const romInfo = playlistEntryToRomInfo(entry, playlist, playlistPath, options);
    if (romInfo) {
      results.push(romInfo);

      // Check if this entry was migrated (had no last_played but now has lastPlayed)
      const hadLastPlayed = entry.last_played_year !== undefined && entry.last_played_year !== 0;
      if (!hadLastPlayed && romInfo.lastPlayed) {
        migrationsNeeded.set(i, romInfo.lastPlayed);
      }
    }
  }

  // Batch update playlist with migrated last_played dates
  if (persistMigratedDates && migrationsNeeded.size > 0) {
    try {
      // Read the playlist fresh to avoid stale data
      const content = readFileSync(playlistPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      if (isPlaylistFile(parsed)) {
        // Update all migrated entries
        for (const [entryIndex, lastPlayed] of migrationsNeeded) {
          if (entryIndex < parsed.items.length) {
            const entry = parsed.items[entryIndex];
            const fields = dateToLastPlayed(lastPlayed);
            entry.last_played_year = fields.year;
            entry.last_played_month = fields.month;
            entry.last_played_day = fields.day;
            entry.last_played_hour = fields.hour;
            entry.last_played_minute = fields.minute;
            entry.last_played_second = fields.second;
          }
        }

        // Write back the updated playlist
        writeFileSync(playlistPath, JSON.stringify(parsed, null, 2), 'utf-8');
      }
    } catch {
      // Silently fail - migration is best-effort
    }
  }

  sortRoms(results);

  return results;
};

/**
 * Find all playlist files in a directory
 */
export const findPlaylistsInDirectory = (directory: string): PlaylistInfo[] => {
  const playlists: PlaylistInfo[] = [];

  try {
    const entries = readdirSync(directory);

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(PLAYLIST_EXTENSION)) {
        continue;
      }

      const fullPath = join(directory, entry);

      try {
        const stats = statSync(fullPath);
        if (!stats.isFile()) {
          continue;
        }

        // Read the playlist to get entry count and system name
        const result = readPlaylist(fullPath);
        if (!result.success || !result.playlist) {
          continue;
        }

        // Derive system name from filename or first entry's db_name
        let systemName = basename(entry, PLAYLIST_EXTENSION);
        if (result.playlist.items.length > 0 && result.playlist.items[0].db_name) {
          systemName = getSystemNameFromDbName(result.playlist.items[0].db_name);
        }

        playlists.push({
          path: fullPath,
          filename: entry,
          systemName,
          entryCount: result.playlist.items.length,
          modified: stats.mtime,
        });
      } catch {
        // Skip files we can't read
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  // Sort by system name
  playlists.sort((a, b) => a.systemName.localeCompare(b.systemName));

  return playlists;
};

/**
 * Find playlists that contain ROMs from a specific directory
 */
export const findPlaylistsForDirectory = (
  romDirectory: string,
  playlistDirectory: string
): PlaylistInfo[] => {
  const allPlaylists = findPlaylistsInDirectory(playlistDirectory);
  const matchingPlaylists: PlaylistInfo[] = [];

  const normalizedRomDir = resolve(romDirectory).toLowerCase();

  for (const playlistInfo of allPlaylists) {
    const result = readPlaylist(playlistInfo.path);
    if (!result.success || !result.playlist) {
      continue;
    }

    // Check if any entry's path starts with the ROM directory
    const hasMatchingEntries = result.playlist.items.some(entry => {
      const resolvedPath = resolvePath(entry.path, dirname(playlistInfo.path));
      return resolve(resolvedPath).toLowerCase().startsWith(normalizedRomDir);
    });

    if (hasMatchingEntries) {
      matchingPlaylists.push(playlistInfo);
    }
  }

  return matchingPlaylists;
};

/**
 * Load ROMs from all playlists in a directory
 */
export const loadRomsFromPlaylists = (
  playlistDirectory: string,
  options: ConversionOptions = {}
): RomInfo[] => {
  const playlists = findPlaylistsInDirectory(playlistDirectory);
  const allRoms: RomInfo[] = [];
  const seenPaths = new Set<string>();

  for (const playlistInfo of playlists) {
    const result = readPlaylist(playlistInfo.path);
    if (!result.success || !result.playlist) {
      continue;
    }

    const roms = playlistToRomInfoArray(result.playlist, playlistInfo.path, options);

    // Deduplicate by path
    for (const rom of roms) {
      const normalizedPath = rom.path.toLowerCase();
      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        allRoms.push(rom);
      }
    }
  }

  // Re-sort the combined list
  sortRoms(allRoms);

  return allRoms;
};
