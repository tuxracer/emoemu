/**
 * Playlist Utility Functions
 *
 * Shared utility functions used by playlist reader and sync modules.
 */

import { realpathSync } from 'fs';
import { resolve, isAbsolute } from 'path';

/**
 * Normalize a path for consistent lookups across different filesystems.
 * Uses realpathSync when the file exists (handles case-insensitive filesystems correctly),
 * falls back to resolve for non-existent files.
 */
export const normalizePath = (filePath: string): string => {
  try {
    // realpathSync returns the canonical path with correct case on case-insensitive FS
    return realpathSync(filePath);
  } catch {
    // File doesn't exist - use resolve for path normalization only
    return resolve(filePath);
  }
};

/**
 * Resolve a path from a playlist entry, handling:
 * - Absolute paths
 * - Relative paths resolved against playlist directory
 * - Windows vs Unix path separators
 */
export const resolvePath = (
  entryPath: string,
  playlistDirectory?: string
): string => {
  // Normalize path separators to current platform
  const normalizedPath = entryPath.replace(/\\/g, '/');

  // If it's an absolute path, use it directly
  if (isAbsolute(normalizedPath) || /^[A-Za-z]:/.test(entryPath)) {
    return normalizedPath;
  }

  // Resolve relative paths against playlist directory
  if (playlistDirectory) {
    return resolve(playlistDirectory, normalizedPath);
  }

  // Last resort: return as-is
  return normalizedPath;
};
