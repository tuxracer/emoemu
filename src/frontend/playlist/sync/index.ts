/**
 * Playlist Synchronization
 *
 * Detects and syncs changes between ROM directories and playlists:
 * - Adds new ROM files not in any playlist
 * - Removes playlist entries for files that no longer exist
 * - Detects moves (same CRC32, different path) and updates paths while preserving metadata
 */

import { existsSync, unlinkSync } from 'fs';
import { dirname, basename } from 'path';
import type { RomInfo, ScanProgress } from '../../romScanner';
import { scanDirectoryAsync } from '../../romScanner';
import type { PlaylistFile, PlaylistEntry } from '..';
import {
  readPlaylist,
  writePlaylist,
  generatePlaylistsBySystem,
  findPlaylistsInDirectory,
} from '..';
import { normalizePath, resolvePath } from '../utils';
import { formatRomLabel } from '../labelFormatter';

// =============================================================================
// Types
// =============================================================================

/**
 * A playlist entry with context about which playlist it belongs to
 */
export interface PlaylistEntryWithContext {
  /** The playlist entry */
  entry: PlaylistEntry;
  /** Path to the playlist file */
  playlistPath: string;
  /** Index within the playlist's items array */
  entryIndex: number;
}

/**
 * Entry in a playlist whose file no longer exists
 */
export interface MissingEntry {
  /** The playlist entry */
  entry: PlaylistEntry;
  /** Path to the playlist file */
  playlistPath: string;
  /** Index within the playlist's items array */
  entryIndex: number;
  /** Normalized path to the missing file */
  normalizedPath: string;
}

/**
 * A ROM that was moved (detected via CRC32 match)
 */
export interface MovedRom {
  /** The ROM found at the new location */
  rom: RomInfo;
  /** The original playlist entry (at old location) */
  originalEntry: MissingEntry;
}

/**
 * A ROM that has the same CRC32 as an existing entry,
 * but both files exist (different from a move where original is missing)
 */
export interface DuplicateCrcRom {
  /** The new ROM being imported */
  newRom: RomInfo;
  /** The existing playlist entry with matching CRC32 */
  existingEntry: PlaylistEntryWithContext;
  /** The shared CRC32 value */
  crc32: string;
}

/**
 * Result of analyzing playlists for synchronization
 */
export interface SyncAnalysis {
  /** ROMs in directory but not in any playlist */
  newRoms: RomInfo[];
  /** Playlist entries with no file on disk */
  missingEntries: MissingEntry[];
  /** ROMs that were moved (matched by CRC32) */
  movedRoms: MovedRom[];
  /** ROMs with same CRC32 as existing entries (both files exist) */
  duplicateCrcRoms: DuplicateCrcRom[];
  /** Whether any sync action is needed */
  needsSync: boolean;
}

/**
 * Options for syncing playlists
 */
export interface SyncOptions {
  /** Delete empty playlists after removing entries */
  deleteEmptyPlaylists?: boolean;
}

/**
 * Result of synchronizing playlists
 */
export interface SyncResult {
  /** Whether sync completed successfully */
  success: boolean;
  /** Number of ROMs added to playlists */
  added: number;
  /** Number of entries removed from playlists */
  removed: number;
  /** Number of entries updated (moved ROMs) */
  moved: number;
  /** Number of duplicate entries where path was updated */
  duplicatesUpdated: number;
  /** Number of duplicate entries that were skipped */
  duplicatesSkipped: number;
  /** Any errors that occurred */
  errors: string[];
}

/**
 * Choice for how to handle a duplicate CRC ROM
 */
export type DuplicateCrcChoice = 'update' | 'skip';

/**
 * A decision made by the user for a duplicate CRC ROM
 */
export interface DuplicateDecision {
  duplicate: DuplicateCrcRom;
  choice: DuplicateCrcChoice;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Load all playlists from a directory and return entries that are within the target ROM directory
 */
const loadPlaylistEntriesForDirectory = (
  playlistDirectory: string,
  romDirectory: string
): { entries: PlaylistEntryWithContext[]; playlists: Map<string, PlaylistFile> } => {
  const entries: PlaylistEntryWithContext[] = [];
  const playlists = new Map<string, PlaylistFile>();
  const normalizedRomDir = normalizePath(romDirectory).toLowerCase();

  const playlistFiles = findPlaylistsInDirectory(playlistDirectory);

  for (const playlistInfo of playlistFiles) {
    const result = readPlaylist(playlistInfo.path);
    if (!result.success || !result.playlist) {
      continue;
    }

    playlists.set(playlistInfo.path, result.playlist);
    const playlistDir = dirname(playlistInfo.path);

    for (let i = 0; i < result.playlist.items.length; i++) {
      const entry = result.playlist.items[i];
      const resolvedPath = resolvePath(entry.path, playlistDir);
      const normalizedEntryPath = normalizePath(resolvedPath).toLowerCase();

      // Only include entries within the target ROM directory
      if (normalizedEntryPath.startsWith(normalizedRomDir)) {
        entries.push({
          entry,
          playlistPath: playlistInfo.path,
          entryIndex: i,
        });
      }
    }
  }

  return { entries, playlists };
};

/**
 * Build a path index from playlist entries for O(1) lookups
 */
const buildPathIndex = (entries: PlaylistEntryWithContext[]): Map<string, PlaylistEntryWithContext> => {
  const index = new Map<string, PlaylistEntryWithContext>();

  for (const entryWithContext of entries) {
    const playlistDir = dirname(entryWithContext.playlistPath);
    const resolvedPath = resolvePath(entryWithContext.entry.path, playlistDir);
    const normalizedPath = normalizePath(resolvedPath);
    index.set(normalizedPath, entryWithContext);
  }

  return index;
};

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Analyze a directory and its playlists for synchronization needs.
 *
 * @param romDirectory - Directory containing ROM files
 * @param playlistDirectory - Directory containing playlist files
 * @param scanDepth - Max depth for scanning subdirectories
 * @param onProgress - Optional progress callback
 * @param signal - Optional abort signal for cancellation
 * @returns Analysis of what needs to be synced
 */
export const analyzePlaylistSync = async (
  romDirectory: string,
  playlistDirectory: string,
  scanDepth: number,
  onProgress?: (progress: ScanProgress) => void,
  signal?: AbortSignal
): Promise<SyncAnalysis> => {
  // Load all playlist entries for this directory
  const { entries } = loadPlaylistEntriesForDirectory(playlistDirectory, romDirectory);

  // Build indexes for fast lookups
  const pathIndex = buildPathIndex(entries);

  // Scan directory for current ROMs (CRC cache built automatically from playlists)
  const currentRoms = await scanDirectoryAsync(romDirectory, scanDepth, onProgress, signal);

  // Find new ROMs (in filesystem, not in playlists)
  const newRoms: RomInfo[] = [];
  const currentRomPaths = new Set<string>();

  for (const rom of currentRoms) {
    const normalizedPath = normalizePath(rom.path);
    currentRomPaths.add(normalizedPath);

    if (!pathIndex.has(normalizedPath)) {
      newRoms.push(rom);
    }
  }

  // Find missing entries (in playlists, file doesn't exist)
  const missingEntries: MissingEntry[] = [];

  for (const entryWithContext of entries) {
    const playlistDir = dirname(entryWithContext.playlistPath);
    const resolvedPath = resolvePath(entryWithContext.entry.path, playlistDir);
    const normalizedPath = normalizePath(resolvedPath);

    // Check if file still exists
    if (!currentRomPaths.has(normalizedPath) && !existsSync(resolvedPath)) {
      missingEntries.push({
        entry: entryWithContext.entry,
        playlistPath: entryWithContext.playlistPath,
        entryIndex: entryWithContext.entryIndex,
        normalizedPath,
      });
    }
  }

  // Match moves: missing entries with same CRC32 as new ROMs
  const movedRoms: MovedRom[] = [];
  const matchedNewRomPaths = new Set<string>();
  const matchedMissingIndices = new Set<number>();

  for (let i = 0; i < missingEntries.length; i++) {
    const missing = missingEntries[i];
    const missingCrc = missing.entry.crc32;

    // Skip if no valid CRC
    if (!missingCrc || missingCrc === 'DETECT') {
      continue;
    }

    // Find a new ROM with matching CRC
    for (const rom of newRoms) {
      if (matchedNewRomPaths.has(rom.path)) {
        continue;
      }

      if (rom.crc32 === missingCrc) {
        movedRoms.push({
          rom,
          originalEntry: missing,
        });
        matchedNewRomPaths.add(rom.path);
        matchedMissingIndices.add(i);
        break; // Only match first hit
      }
    }
  }

  // Filter out matched items from newRoms and missingEntries
  const filteredNewRoms = newRoms.filter(rom => !matchedNewRomPaths.has(rom.path));
  const filteredMissingEntries = missingEntries.filter((_, i) => !matchedMissingIndices.has(i));

  // Build CRC index from ALL existing playlist entries (not just missing ones)
  const existingCrcIndex = new Map<string, PlaylistEntryWithContext>();
  for (const entryWithContext of entries) {
    const crc = entryWithContext.entry.crc32;
    if (crc && crc !== 'DETECT') {
      existingCrcIndex.set(crc, entryWithContext);
    }
  }

  // Detect duplicate CRCs: new ROMs that match existing entries where file still exists
  const duplicateCrcRoms: DuplicateCrcRom[] = [];
  const duplicateNewRomPaths = new Set<string>();

  for (const rom of filteredNewRoms) {
    if (!rom.crc32 || rom.crc32 === 'DETECT') {
      continue;
    }

    const existingEntry = existingCrcIndex.get(rom.crc32);
    if (existingEntry) {
      // Verify existing file still exists (not a move scenario)
      const playlistDir = dirname(existingEntry.playlistPath);
      const resolvedPath = resolvePath(existingEntry.entry.path, playlistDir);
      if (existsSync(resolvedPath)) {
        duplicateCrcRoms.push({
          newRom: rom,
          existingEntry,
          crc32: rom.crc32,
        });
        duplicateNewRomPaths.add(rom.path);
      }
    }
  }

  // Filter duplicates from newRoms - they'll be handled separately via prompt
  const finalNewRoms = filteredNewRoms.filter(rom => !duplicateNewRomPaths.has(rom.path));

  return {
    newRoms: finalNewRoms,
    missingEntries: filteredMissingEntries,
    movedRoms,
    duplicateCrcRoms,
    needsSync: finalNewRoms.length > 0 || filteredMissingEntries.length > 0 ||
               movedRoms.length > 0 || duplicateCrcRoms.length > 0,
  };
};

/**
 * Apply synchronization changes to playlists.
 *
 * @param analysis - The sync analysis result
 * @param romDirectory - Directory containing ROM files
 * @param playlistDirectory - Directory containing playlist files
 * @param options - Sync options
 * @param duplicateDecisions - User decisions for duplicate CRC ROMs
 * @returns Result of the sync operation
 */
export const syncPlaylists = (
  analysis: SyncAnalysis,
  _romDirectory: string,
  playlistDirectory: string,
  options: SyncOptions = {},
  duplicateDecisions?: DuplicateDecision[]
): SyncResult => {
  const { deleteEmptyPlaylists = true } = options;
  const errors: string[] = [];
  let added = 0;
  let removed = 0;
  let moved = 0;
  let duplicatesUpdated = 0;
  let duplicatesSkipped = 0;

  // Track playlists that need to be rewritten
  const modifiedPlaylists = new Map<string, PlaylistFile>();

  // Helper to get or load a playlist
  const getPlaylist = (playlistPath: string): PlaylistFile | null => {
    if (modifiedPlaylists.has(playlistPath)) {
      return modifiedPlaylists.get(playlistPath)!;
    }
    const result = readPlaylist(playlistPath);
    if (result.success && result.playlist) {
      modifiedPlaylists.set(playlistPath, result.playlist);
      return result.playlist;
    }
    return null;
  };

  // 1. Handle moves: update path field, preserve runtime/last_played
  for (const movedRom of analysis.movedRoms) {
    const playlist = getPlaylist(movedRom.originalEntry.playlistPath);
    if (!playlist) {
      errors.push(`Failed to load playlist: ${movedRom.originalEntry.playlistPath}`);
      continue;
    }

    const entry = playlist.items[movedRom.originalEntry.entryIndex];
    // Update path to new location
    entry.path = movedRom.rom.path;
    // Label might have changed if title was extracted differently
    if (movedRom.rom.metadata.title) {
      entry.label = formatRomLabel(movedRom.rom.metadata.title);
    } else {
      entry.label = formatRomLabel(basename(movedRom.rom.filename, movedRom.rom.extension));
    }
    moved++;
  }

  // 1b. Handle duplicate decisions: update path or skip
  const duplicateUpdatedPlaylists = new Set<string>();
  if (duplicateDecisions) {
    for (const { duplicate, choice } of duplicateDecisions) {
      if (choice === 'update') {
        const playlist = getPlaylist(duplicate.existingEntry.playlistPath);
        if (playlist) {
          const entry = playlist.items[duplicate.existingEntry.entryIndex];
          entry.path = duplicate.newRom.path;
          if (duplicate.newRom.metadata.title) {
            entry.label = formatRomLabel(duplicate.newRom.metadata.title);
          }
          duplicateUpdatedPlaylists.add(duplicate.existingEntry.playlistPath);
          duplicatesUpdated++;
        }
      } else {
        duplicatesSkipped++;
      }
    }
  }

  // 2. Remove missing entries
  // Group by playlist and sort indices descending to remove from end first
  const removalsPerPlaylist = new Map<string, number[]>();

  for (const missing of analysis.missingEntries) {
    const existing = removalsPerPlaylist.get(missing.playlistPath) ?? [];
    existing.push(missing.entryIndex);
    removalsPerPlaylist.set(missing.playlistPath, existing);
  }

  for (const [playlistPath, indices] of removalsPerPlaylist) {
    const playlist = getPlaylist(playlistPath);
    if (!playlist) {
      errors.push(`Failed to load playlist: ${playlistPath}`);
      continue;
    }

    // Sort descending and remove
    const sortedIndices = [...indices].sort((a, b) => b - a);
    for (const index of sortedIndices) {
      if (index < playlist.items.length) {
        playlist.items.splice(index, 1);
        removed++;
      }
    }
  }

  // 3. Add new ROMs using generatePlaylistsBySystem
  // ROMs already have crc32 set from scanning, no cache needed
  if (analysis.newRoms.length > 0) {
    const results = generatePlaylistsBySystem(analysis.newRoms, playlistDirectory);

    for (const result of results) {
      if (result.success) {
        added += result.entryCount;
      } else if (result.error) {
        errors.push(result.error);
      }
    }
  }

  // 4. Write modified playlists
  for (const [playlistPath, playlist] of modifiedPlaylists) {
    // Skip if playlist is unchanged (only loaded but not modified)
    const hasRemovals = removalsPerPlaylist.has(playlistPath);
    const hasMoves = analysis.movedRoms.some(m => m.originalEntry.playlistPath === playlistPath);
    const hasDuplicateUpdates = duplicateUpdatedPlaylists.has(playlistPath);

    if (!hasRemovals && !hasMoves && !hasDuplicateUpdates) {
      continue;
    }

    // Delete empty playlists
    if (playlist.items.length === 0 && deleteEmptyPlaylists) {
      try {
        unlinkSync(playlistPath);
      } catch (err) {
        errors.push(`Failed to delete empty playlist: ${playlistPath}`);
      }
      continue;
    }

    // Write the updated playlist
    const writeResult = writePlaylist(playlist, playlistPath);
    if (!writeResult.success && writeResult.error) {
      errors.push(writeResult.error);
    }
  }

  return {
    success: errors.length === 0,
    added,
    removed,
    moved,
    duplicatesUpdated,
    duplicatesSkipped,
    errors,
  };
};

/**
 * Get a count of entries in playlists for a specific directory
 */
export const countPlaylistEntries = (
  playlistDirectory: string,
  romDirectory: string
): number => {
  const { entries } = loadPlaylistEntriesForDirectory(playlistDirectory, romDirectory);
  return entries.length;
};
