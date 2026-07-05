/**
 * Directory Cache
 *
 * Shared utility for caching directory listings to avoid repeated stat() calls.
 * Used by rom-scanner and playlist reader for efficient file existence checks.
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Cache for directory listings to avoid repeated stat() calls.
 * Maps directory path -> filename -> file modification time.
 */
export type DirectoryCache = Map<string, Map<string, Date>>;

/**
 * Create a new empty directory cache.
 */
export const createDirectoryCache = (): DirectoryCache => new Map();

/**
 * Get or create a cached directory listing.
 * Returns a map of filename -> mtime for all files in the directory.
 * Skips hidden files (starting with '.').
 */
export const getCachedDirectoryListing = (dirPath: string, cache: DirectoryCache): Map<string, Date> => {
  const existing = cache.get(dirPath);
  if (existing) {
    return existing;
  }

  const listing = new Map<string, Date>();
  try {
    // Use withFileTypes to avoid stat() calls just to check isFile()
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files and directories (only stat actual files)
      if (entry.name.startsWith('.') || !entry.isFile()) {
        continue;
      }
      try {
        const fullPath = join(dirPath, entry.name);
        const stats = statSync(fullPath);
        listing.set(entry.name, stats.mtime);
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  cache.set(dirPath, listing);
  return listing;
};

/**
 * Check if a file exists in a cached directory listing.
 * Returns the file's modification time if found, undefined otherwise.
 */
export const getFileFromCache = (
  dirPath: string,
  filename: string,
  cache: DirectoryCache
): Date | undefined => {
  const listing = getCachedDirectoryListing(dirPath, cache);
  return listing.get(filename);
};

/**
 * Clear all entries from a directory cache.
 */
export const clearDirectoryCache = (cache: DirectoryCache): void => {
  cache.clear();
};
