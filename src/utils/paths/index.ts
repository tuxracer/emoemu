/**
 * Platform Path Utilities
 *
 * Platform-specific directory resolution following standard conventions:
 * - macOS: ~/Library/Application Support/emoemu
 * - Linux: ~/.config/emoemu (or $XDG_CONFIG_HOME/emoemu)
 * - Windows: %APPDATA%\emoemu
 */

import { join } from 'path';
import { homedir, platform } from 'os';
import { pipe, filter, isTruthy } from 'remeda';

export * from './consts';

import { THUMBNAIL_FORBIDDEN_CHARS, THUMBNAIL_TYPE_DIRS } from './consts';

/**
 * Expand a path, resolving ~ to the user's home directory.
 * Useful for config values that may contain ~ shorthand.
 *
 * @param path Path that may start with ~
 * @returns Expanded path with ~ replaced by home directory
 */
export const expandPath = (path: string): string => {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
};

/**
 * Get the platform-specific config directory path
 */
export const getConfigDirectory = (): string => {
  switch (platform()) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'emoemu');
    case 'win32':
      return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'emoemu');
    default:
      // Linux and other Unix-like systems
      return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'emoemu');
  }
};

/**
 * Get the default config file path for the current platform
 * RetroArch-compatible location: {config_dir}/config/emoemu.cfg
 */
export const getDefaultConfigPath = (): string => join(getConfigDirectory(), 'config', 'emoemu.cfg');

/**
 * Get the default playlists directory path for the current platform
 * RetroArch-compatible location: {config_dir}/playlists
 */
export const getDefaultPlaylistsDirectory = (): string => join(getConfigDirectory(), 'playlists');

/**
 * Get the default save states directory path for the current platform
 * RetroArch-compatible location: {config_dir}/states
 */
export const getDefaultSavestatesDirectory = (): string => join(getConfigDirectory(), 'states');

/**
 * Get the default save files (battery saves) directory path for the current platform
 * RetroArch-compatible location: {config_dir}/saves
 */
export const getDefaultSavefilesDirectory = (): string => join(getConfigDirectory(), 'saves');

/**
 * Get the default thumbnails directory path for the current platform
 * RetroArch-compatible location: {config_dir}/thumbnails
 */
export const getDefaultThumbnailsDirectory = (): string => join(getConfigDirectory(), 'thumbnails');

/**
 * Get the default logs directory path for the current platform
 * Location: {config_dir}/logs
 */
export const getDefaultLogsDirectory = (): string => join(getConfigDirectory(), 'logs');


/**
 * Sanitize a filename for RetroArch thumbnail compatibility.
 * Replaces forbidden characters with underscores.
 */
export const sanitizeThumbnailFilename = (name: string): string =>
  name.replace(THUMBNAIL_FORBIDDEN_CHARS, '_');

/**
 * RetroArch thumbnail types.
 * Each type is stored in a separate subdirectory under the system's thumbnail folder.
 *
 * - boxart: Box art / cover images (Named_Boxarts/)
 * - snap: In-game screenshots (Named_Snaps/)
 * - title: Title screen images (Named_Titles/)
 */
export type ThumbnailType = 'boxart' | 'snap' | 'title';


/**
 * Get the path to a ROM's thumbnail.
 *
 * RetroArch stores thumbnails in: {thumbnails_dir}/{System Name}/{Type}/{Label}.png
 * where Type is one of: Named_Boxarts, Named_Snaps, Named_Titles
 *
 * @param systemName RetroArch system name (e.g., "Nintendo - Nintendo Entertainment System")
 * @param romLabel ROM label/title (will be sanitized)
 * @param type Thumbnail type: 'boxart', 'snap', or 'title' (default: 'snap')
 * @returns Full path to the thumbnail PNG
 */
export const getThumbnailPath = (
  systemName: string,
  romLabel: string,
  type: ThumbnailType = 'snap'
): string => {
  const sanitizedLabel = sanitizeThumbnailFilename(romLabel);
  const typeDir = THUMBNAIL_TYPE_DIRS[type];
  return join(getDefaultThumbnailsDirectory(), systemName, typeDir, `${sanitizedLabel}.png`);
};

/**
 * Get paths to all thumbnail types for a ROM.
 * Useful for checking if any thumbnail exists or for cleanup.
 *
 * @param systemName RetroArch system name
 * @param romLabel ROM label/title (will be sanitized)
 * @returns Object with paths for each thumbnail type
 */
export const getAllThumbnailPaths = (
  systemName: string,
  romLabel: string
): Record<ThumbnailType, string> => ({
  boxart: getThumbnailPath(systemName, romLabel, 'boxart'),
  snap: getThumbnailPath(systemName, romLabel, 'snap'),
  title: getThumbnailPath(systemName, romLabel, 'title'),
});

/**
 * Get all possible config file paths in order of precedence (highest first)
 */
export const getConfigPaths = (customPath?: string): string[] => pipe(
  [
    customPath,                              // 1. Custom path from --config flag
    process.env.EMOEMU_CONFIG,               // 2. Environment variable
    join(process.cwd(), 'emoemu.cfg'),       // 3. Current working directory
    getDefaultConfigPath(),                  // 4. Platform-specific default
  ],
  filter(isTruthy)
);
