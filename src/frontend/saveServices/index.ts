/**
 * Save Services
 *
 * Service classes for save state and battery save operations.
 * These hold config internally so callers don't need to pass it to every method.
 * Services manage their own directory cache for efficient batch operations.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { decompress, detectCompressionFormat } from '../../utils/compression';
import type { Config } from '../config';
import { resolveSaveStateDir, resolveSaveFileDir } from '../config';
import { type DirectoryCache, createDirectoryCache, getCachedDirectoryListing } from '../directoryCache';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/getErrorMessage';

export * from './consts';

import { JSON_OPEN_BRACE } from './consts';

/**
 * Escape special regex characters in a string
 */
const escapeRegExp = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Details loaded from a save state file
 */
export interface SaveStateDetails {
  /** Timestamp when the save state was last modified (from file system) */
  savedAt?: Date;
}

/**
 * Result of checking for a save state
 */
export interface SaveStateCheckResult {
  exists: boolean;
  date?: Date;
  path?: string;
}

/**
 * Result of checking for a battery save
 */
export interface BatterySaveCheckResult {
  exists: boolean;
  date?: Date;
  path?: string;
}

/**
 * Service for save state operations.
 * Holds config internally so callers don't need to pass it to every method.
 * Manages its own directory cache for efficient batch operations.
 */
export class SaveStateService {
  private cache: DirectoryCache = createDirectoryCache();

  constructor(private config: Config) {}

  /**
   * Clear the internal directory cache.
   * Call this after batch operations or when files may have changed.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the directory where save states should be stored for a ROM.
   * Uses savestates_in_content_dir setting to determine location.
   */
  getSaveDir(romPath: string): string {
    return resolveSaveStateDir(dirname(romPath), this.config);
  }

  /**
   * Get the path for writing a new save state file.
   * Format: [rom basename without extension].state.auto
   */
  getStatePath(romPath: string): string {
    const dir = this.getSaveDir(romPath);
    const name = basename(romPath, extname(romPath));
    return join(dir, `${name}.state.auto`);
  }

  /**
   * Find an existing save state file for a ROM.
   * Searches only in the directory specified by config settings.
   *
   * Priority:
   * 1. [romname].state.auto (highest priority)
   * 2. [romname].[anything].state (legacy format with coreId or other suffix)
   * 3. [romname].state (legacy format without suffix)
   *
   * Returns the path to the save state file, or null if none found.
   */
  findExistingStatePath(romPath: string): string | null {
    const dir = this.getSaveDir(romPath);
    const name = basename(romPath, extname(romPath));

    // Priority 1: Check for .state.auto (preferred format)
    const autoPath = join(dir, `${name}.state.auto`);
    if (existsSync(autoPath)) {
      return autoPath;
    }

    // Priority 2 & 3: Look for legacy formats
    try {
      const files = readdirSync(dir);
      const statePattern = new RegExp(`^${escapeRegExp(name)}(\\.[^.]+)?\\.state$`);

      for (const file of files) {
        if (statePattern.test(file)) {
          return join(dir, file);
        }
      }
    } catch {
      // Directory read failed
    }

    return null;
  }

  /**
   * Check if a save state exists for a ROM.
   * Uses internal directory cache for efficient batch lookups.
   */
  checkExists(romPath: string): SaveStateCheckResult {
    const dir = this.getSaveDir(romPath);
    const romName = basename(romPath, extname(romPath));

    // Use cached directory listing for O(1) lookup
    const listing = getCachedDirectoryListing(dir, this.cache);

    // Priority 1: Check for .state.auto
    const autoFilename = `${romName}.state.auto`;
    const autoMtime = listing.get(autoFilename);
    if (autoMtime) {
      return { exists: true, date: autoMtime, path: join(dir, autoFilename) };
    }

    // Priority 2 & 3: Check legacy formats
    const statePattern = new RegExp(`^${escapeRegExp(romName)}(\\.[^.]+)?\\.state$`);
    for (const [filename, mtime] of listing.entries()) {
      if (statePattern.test(filename)) {
        return { exists: true, date: mtime, path: join(dir, filename) };
      }
    }

    return { exists: false };
  }

  /**
   * Load detailed information from a save state file.
   * Uses file modification time since save states no longer contain metadata.
   */
  loadDetails(romPath: string): SaveStateDetails {
    const result = this.checkExists(romPath);
    if (result.exists && result.date) {
      return { savedAt: result.date };
    }
    return {};
  }

  /**
   * Load raw binary state directly from file.
   * Automatically decompresses if the file is compressed (zstd, zlib, or gzip).
   */
  loadRawState(romPath: string): Buffer | null {
    const statePath = this.findExistingStatePath(romPath);

    if (!statePath) {
      return null;
    }

    try {
      const data = readFileSync(statePath);
      return decompress(data);
    } catch (err) {
      logger.error(`Failed to load raw state: ${statePath} - ${getErrorMessage(err)}`, 'SaveState');
      return null;
    }
  }

  /**
   * Save raw binary state directly to file (RetroArch-compatible format).
   * Always writes to .state.auto format.
   */
  saveRawState(romPath: string, buffer: Buffer): void {
    const statePath = this.getStatePath(romPath);

    try {
      writeFileSync(statePath, buffer);
    } catch (err) {
      logger.error(`Failed to save raw state: ${statePath} - ${getErrorMessage(err)}`, 'SaveState');
    }
  }

  /**
   * Check if the saved state appears to be a raw binary file (not JSON).
   * Handles compressed files by checking the decompressed content.
   */
  isRawStateFile(romPath: string): boolean {
    const statePath = this.findExistingStatePath(romPath);

    if (!statePath) {
      return false;
    }

    try {
      const data = readFileSync(statePath);
      const format = detectCompressionFormat(data);
      const decompressed = format !== 'none' ? decompress(data) : data;

      if (decompressed.length > 0 && decompressed[0] === JSON_OPEN_BRACE) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete the save state file for a ROM.
   */
  deleteState(romPath: string): void {
    const statePath = this.findExistingStatePath(romPath);
    if (statePath) {
      try {
        unlinkSync(statePath);
      } catch {
        // Ignore errors when deleting
      }
    }
  }

  /**
   * Check if a save state exists for this ROM
   */
  hasSavedState(romPath: string): boolean {
    return this.findExistingStatePath(romPath) !== null;
  }

  /**
   * Get the game ID (ROM filename without path)
   */
  getGameId(romPath: string): string {
    return basename(romPath);
  }
}

/**
 * Service for battery save (.srm) operations.
 * Holds config internally so callers don't need to pass it to every method.
 * Manages its own directory cache for efficient batch operations.
 */
export class BatterySaveService {
  private cache: DirectoryCache = createDirectoryCache();

  constructor(private config: Config) {}

  /**
   * Clear the internal directory cache.
   * Call this after batch operations or when files may have changed.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the directory where battery saves should be stored for a ROM.
   * Uses savefiles_in_content_dir setting to determine location.
   */
  getSaveDir(romPath: string): string {
    return resolveSaveFileDir(dirname(romPath), this.config);
  }

  /**
   * Get the path for a battery save file.
   * Format: [rom basename without extension].srm
   */
  getSavePath(romPath: string): string {
    const dir = this.getSaveDir(romPath);
    const name = basename(romPath, extname(romPath));
    return join(dir, `${name}.srm`);
  }

  /**
   * Check if a battery save exists for a ROM.
   * Uses internal directory cache for efficient batch lookups.
   */
  checkExists(romPath: string): BatterySaveCheckResult {
    const dir = this.getSaveDir(romPath);
    const romName = basename(romPath, extname(romPath));
    const srmFilename = `${romName}.srm`;

    // Use cached directory listing for O(1) lookup
    const listing = getCachedDirectoryListing(dir, this.cache);
    const mtime = listing.get(srmFilename);
    if (mtime) {
      return { exists: true, date: mtime, path: join(dir, srmFilename) };
    }

    return { exists: false };
  }
}
