/**
 * Configuration file system for emoemu
 *
 * Provides loading and saving of user settings in a RetroArch-compatible
 * INI-style format. Config files are stored in platform-specific locations.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { ensureDirectory } from '../../utils/ensureDirectory';
import { dirname, join, resolve } from "path";
import {
  getConfigDirectory,
  getDefaultConfigPath,
  getConfigPaths,
  getDefaultPlaylistsDirectory,
  getDefaultSavestatesDirectory,
  getDefaultSavefilesDirectory,
} from "../../utils/paths";
import {
  parseIniLine,
  formatIniValue,
  updateIniLine,
  commentOutIniLine,
  parseIniBool,
  parseIniNumber,
  parseIniNullableNumber,
} from "../../utils/ini";
import { pipe, filter, map, isNonNull, fromEntries } from "remeda";
import { logger } from "../../utils/logger";
import { DEFAULT_PNG_COMPRESSION } from "../../rendering";

/**
 * Get the platform-specific cores directory path
 *
 * This follows the same convention as RetroArch:
 * - macOS: ~/Library/Application Support/emoemu/cores
 * - Linux: ~/.config/emoemu/cores
 * - Windows: %APPDATA%\emoemu\cores
 */
export const getCoresDirectory = (): string => join(getConfigDirectory(), "cores");

/**
 * Get the effective playlists directory path (always absolute)
 * Uses config value if set, otherwise platform-specific default
 */
export const getPlaylistsDirectory = (config: Config): string =>
  resolve(config.playlist_directory || getDefaultPlaylistsDirectory());

/**
 * Get the effective save states directory path (always absolute)
 * Uses config value if set, otherwise platform-specific default:
 * - macOS: ~/Library/Application Support/emoemu/states
 * - Linux: ~/.config/emoemu/states
 * - Windows: %APPDATA%\emoemu\states
 */
export const getSavestatesDirectory = (config: Config): string =>
  resolve(config.savestate_directory || getDefaultSavestatesDirectory());

/**
 * Get the effective save files (battery saves) directory path (always absolute)
 * Uses config value if set, otherwise platform-specific default:
 * - macOS: ~/Library/Application Support/emoemu/saves
 * - Linux: ~/.config/emoemu/saves
 * - Windows: %APPDATA%\emoemu\saves
 */
export const getSavefilesDirectory = (config: Config): string =>
  resolve(config.savefile_directory || getDefaultSavefilesDirectory());

/**
 * Determine the directory to look for save states based on config settings.
 * - If savestates_in_content_dir is true (or config is not provided): use content (ROM) directory
 * - If savestates_in_content_dir is false: use configured savestate_directory or platform default
 *
 * @param contentDir The ROM's directory (dirname of romPath)
 * @param config Optional config to determine save state directory
 */
export const resolveSaveStateDir = (contentDir: string, config?: Config): string => {
  if (!config || config.savestates_in_content_dir !== false) {
    return contentDir;
  }
  return getSavestatesDirectory(config);
};

/**
 * Determine the directory to look for battery saves based on config settings.
 * - If savefiles_in_content_dir is true (or config is not provided): use content (ROM) directory
 * - If savefiles_in_content_dir is false: use configured savefile_directory or platform default
 *
 * @param contentDir The ROM's directory (dirname of romPath)
 * @param config Optional config to determine save file directory
 */
export const resolveSaveFileDir = (contentDir: string, config?: Config): string => {
  if (!config || config.savefiles_in_content_dir !== false) {
    return contentDir;
  }
  return getSavefilesDirectory(config);
};

// Re-export for convenience
export { getDefaultPlaylistsDirectory, getDefaultSavestatesDirectory, getDefaultSavefilesDirectory };

export * from './types';

import type { VideoDriver, PostProcessingMode } from './types';
import { isVideoDriver } from './types';

/**
 * Configuration interface matching the documented format
 */
export interface Config {
  // Video
  video_driver: VideoDriver | null;  // null = Auto (use system-specific default)
  video_scale: number | null;  // null = Auto (use system-specific default)
  video_smooth: boolean;
  video_fullscreen: boolean;
  custom_viewport_width: number | null;
  custom_viewport_height: number | null;
  video_color_enable: boolean;
  video_diff_render: boolean;
  menu_scale_factor: number | null;  // UI scale factor for native mode (null = auto-detect from display)

  // Post-processing
  video_postprocessing_mode: PostProcessingMode;  // off, crt, or custom

  // CRT preset values (used when video_postprocessing_mode is 'crt')
  crt_gamma: number;
  crt_scanlines: number;
  crt_saturation: number;
  crt_vignette: number;
  crt_ntsc: number;
  crt_curvature: number;
  crt_chromatic_aberration: number;

  // Custom effect values (used when video_postprocessing_mode is 'custom')
  video_shader_enable: boolean;
  video_gamma: number;
  video_scanlines: number;
  video_saturation: number;
  video_brightness: number;
  video_contrast: number;
  video_vignette: number;
  video_bloom: number;
  video_bloom_threshold: number;
  video_ntsc: number;
  video_curvature: number;
  video_chromatic_aberration: number;

  // Kitty
  kitty_png_level: number;

  // Audio
  audio_enable: boolean;
  audio_volume: number;
  audio_mute_enable: boolean;

  // Input
  input_joypad_enable: boolean;
  input_autodetect_enable: boolean;

  // Save data
  savestate_auto_load: boolean;
  savestate_auto_save: boolean;
  savestate_compression: boolean;
  savestate_directory: string;
  savefile_directory: string;
  savefiles_in_content_dir: boolean;    // When true, battery saves (.srm) go to ROM directory
  savestates_in_content_dir: boolean;   // When true, save states (.state.auto) go to ROM directory
  battery_save_enable: boolean;

  // Directories
  system_directory: string;
  screenshot_directory: string;
  playlist_directory: string;  // Output directory for generated playlists

  // Emulation
  fps_show_enable: boolean;
  fps_limit: number;
  video_frame_limit: number;  // Limit rendering to N fps (0=off/unlimited, 30, 60, or any positive integer)

  // Core
  core_default: string;
  libretro_directory: string;
  retroarch_cores_enable: boolean;

  // Auto-crop
  video_auto_crop_cores: string;  // Comma-separated list of core IDs for auto-crop (e.g., "mupen64plus_next")

  // Browser
  browser_scan_depth: number;  // Max depth to scan for ROMs (0=dir only, 1=+subdirs, -1=unlimited)

  // Notifications
  notifications_enable: boolean;

  // UI/Menu colors
  menu_highlight_bg: string;  // Background color for highlighted menu items
  menu_highlight_fg: string;  // Foreground (text) color for highlighted menu items

  // Logging
  log_verbosity: boolean;           // Enable logging (default: true)
  log_to_file: boolean;             // Write logs to file (default: true), false = output to console
  log_to_file_timestamp: boolean;   // Use timestamped log files instead of overwriting (default: false)
  log_dir: string;                  // Custom log directory (empty = platform default)
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Config = {
  // Video
  video_driver: null,  // Auto (use system-specific default)
  video_scale: null,  // Auto (use system-specific default)
  video_smooth: false,
  video_fullscreen: false,
  custom_viewport_width: null,
  custom_viewport_height: null,
  video_color_enable: true,
  video_diff_render: true,
  menu_scale_factor: null,  // Auto-detect from display

  // Post-processing
  video_postprocessing_mode: "off",

  // CRT preset values (used when video_postprocessing_mode is 'crt')
  crt_gamma: 1.3,
  crt_scanlines: 0.1,
  crt_saturation: 1.0,
  crt_vignette: 0.5,
  crt_ntsc: 1.0,
  crt_curvature: 0.1,
  crt_chromatic_aberration: 0,

  video_shader_enable: false,
  video_gamma: 1.0,
  video_scanlines: 0,
  video_saturation: 1.0,
  video_brightness: 1.0,
  video_contrast: 1.0,
  video_vignette: 0,
  video_bloom: 0,
  video_bloom_threshold: 0.6,
  video_ntsc: 0,
  video_curvature: 0,
  video_chromatic_aberration: 0,

  // Kitty
  kitty_png_level: DEFAULT_PNG_COMPRESSION,

  // Audio
  audio_enable: true,
  audio_volume: 1.0,
  audio_mute_enable: false,

  // Input
  input_joypad_enable: true,
  input_autodetect_enable: true,

  // Save data
  savestate_auto_load: true,
  savestate_auto_save: true,
  savestate_compression: true,
  savestate_directory: "",
  savefile_directory: "",
  savefiles_in_content_dir: true,    // Default: battery saves (.srm) go to ROM directory
  savestates_in_content_dir: true,   // Default: save states (.state.auto) go to ROM directory
  battery_save_enable: true,

  // Directories
  system_directory: "",
  screenshot_directory: "",
  playlist_directory: "",  // Empty = use platform default (~/Library/Application Support/emoemu/playlists, etc.)

  // Emulation
  fps_show_enable: false,
  fps_limit: 0,
  video_frame_limit: 0,  // Off by default (no render limit)

  // Core
  core_default: "",
  libretro_directory: "",
  retroarch_cores_enable: false,

  // Auto-crop
  video_auto_crop_cores: "mupen64plus_next",  // Only N64 cores by default

  // Browser
  browser_scan_depth: 1,  // Scan current dir + immediate subdirs by default

  // Notifications
  notifications_enable: true,

  // UI/Menu colors
  menu_highlight_bg: "cyan",   // Cyan background
  menu_highlight_fg: "black",  // Black text

  // Logging
  log_verbosity: true,              // Enable logging by default
  log_to_file: true,                // Write logs to file by default
  log_to_file_timestamp: false,     // Overwrite emoemu.log by default
  log_dir: "",                      // Empty = use platform default
};

/** Type guard for valid config keys */
const isConfigKey = (key: string): key is keyof Config => key in DEFAULT_CONFIG;

/** Keys that are nullable strings (null = auto/default) */
const NULLABLE_STRING_KEYS: Set<keyof Config> = new Set(['video_driver']);

const parseValue = (key: keyof Config, value: string): Config[keyof Config] => {
  const defaultValue = DEFAULT_CONFIG[key];
  const type = typeof defaultValue;

  // Handle nullable string keys (like video_driver)
  if (NULLABLE_STRING_KEYS.has(key)) {
    const trimmed = value.toLowerCase().trim();
    if (trimmed === 'null' || trimmed === '') {
      return null as Config[keyof Config];
    }
    // video_driver must be a known driver; unknown/legacy values (e.g. the removed "sdl") fall back to Auto
    if (key === 'video_driver' && !isVideoDriver(trimmed)) {
      return null as Config[keyof Config];
    }
    return trimmed as Config[keyof Config];
  }

  // Handle nullable number keys (like video_scale, custom_viewport_width/height)
  if (defaultValue === null) {
    return parseIniNullableNumber(value) as Config[keyof Config];
  }

  switch (type) {
    case "boolean":
      return parseIniBool(value) as Config[keyof Config];
    case "number":
      return parseIniNumber(value, defaultValue as number) as Config[keyof Config];
    case "string":
      return value as Config[keyof Config];
    default:
      return value as Config[keyof Config];
  }
};

/**
 * Parse config file content into a partial Config object
 */
const parseConfig = (content: string): Partial<Config> => pipe(
    content.split("\n"),
    map(parseIniLine),
    filter(isNonNull),
    filter((entry): entry is { key: keyof Config; value: string } => isConfigKey(entry.key)),
    map(({ key, value }) => [key, parseValue(key, value)] as const),
    fromEntries
  ) as Partial<Config>;

/**
 * Load configuration from file
 *
 * Searches config paths in order of precedence and returns the merged config.
 * Values from higher-precedence files override lower ones.
 *
 * If a custom path is provided but doesn't exist, returns defaults without
 * falling back to other paths (explicit path takes precedence).
 *
 * @param customPath Optional custom config path (highest precedence)
 * @returns The loaded config merged with defaults, and the path that was loaded
 */
export const loadConfig = (customPath?: string): { config: Config; loadedFrom: string | null } => {
  // If a custom path is explicitly provided, only check that path
  // Don't fall back to other paths - explicit path takes precedence
  if (customPath !== undefined) {
    if (existsSync(customPath)) {
      try {
        const content = readFileSync(customPath, "utf-8");
        const parsed = parseConfig(content);
        logger.info(`Loading config file: "${customPath}"`, 'Config');
        return {
          config: { ...DEFAULT_CONFIG, ...parsed },
          loadedFrom: customPath,
        };
      } catch {
        // Failed to read/parse, return defaults
        logger.warn(`Failed to parse config file: "${customPath}"`, 'Config');
        return { config: { ...DEFAULT_CONFIG }, loadedFrom: null };
      }
    }
    // Custom path doesn't exist, return defaults
    logger.debug(`Config file not found: "${customPath}"`, 'Config');
    return { config: { ...DEFAULT_CONFIG }, loadedFrom: null };
  }

  // No custom path specified, search standard locations
  const paths = getConfigPaths();

  // Find the first existing config file
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const parsed = parseConfig(content);
        logger.info(`Loading config file: "${path}"`, 'Config');
        return {
          config: { ...DEFAULT_CONFIG, ...parsed },
          loadedFrom: path,
        };
      } catch {
        // Failed to read/parse, try next path
        logger.warn(`Failed to parse config file: "${path}"`, 'Config');
        continue;
      }
    }
  }

  // No config file found, use defaults
  logger.debug('No config file found, using defaults', 'Config');
  return { config: { ...DEFAULT_CONFIG }, loadedFrom: null };
};


/**
 * Generate config file template with all settings commented out.
 */
const generateConfigTemplate = (): string => {
  const d = DEFAULT_CONFIG;
  return `# emoemu Configuration
# https://github.com/tuxracer/emoemu
#
# Settings are commented out by default and use built-in defaults.
# Uncomment and modify settings you want to customize.

# # Video settings
# video_driver = null  # Auto (native, kitty, terminal, ascii, emoji)
# video_scale = null  # Auto (use system-specific default, or set to 0.25, 0.5, 1, 2, 3, 4)
# video_smooth = ${formatIniValue(d.video_smooth)}
# video_fullscreen = ${formatIniValue(d.video_fullscreen)}
# custom_viewport_width = null
# custom_viewport_height = null
# video_color_enable = ${formatIniValue(d.video_color_enable)}
# video_diff_render = ${formatIniValue(d.video_diff_render)}

# # Post-processing effects (mode: off, crt, or custom)
# video_postprocessing_mode = ${formatIniValue(d.video_postprocessing_mode)}

# # CRT preset values (used when video_postprocessing_mode is 'crt')
# crt_gamma = ${formatIniValue(d.crt_gamma)}
# crt_scanlines = ${formatIniValue(d.crt_scanlines)}
# crt_saturation = ${formatIniValue(d.crt_saturation)}
# crt_vignette = ${formatIniValue(d.crt_vignette)}
# crt_ntsc = ${formatIniValue(d.crt_ntsc)}
# crt_curvature = ${formatIniValue(d.crt_curvature)}
# crt_chromatic_aberration = ${formatIniValue(d.crt_chromatic_aberration)}

# # Custom effect values (used when video_postprocessing_mode is 'custom')
# video_shader_enable = ${formatIniValue(d.video_shader_enable)}
# video_gamma = ${formatIniValue(d.video_gamma)}
# video_scanlines = ${formatIniValue(d.video_scanlines)}
# video_saturation = ${formatIniValue(d.video_saturation)}
# video_brightness = ${formatIniValue(d.video_brightness)}
# video_contrast = ${formatIniValue(d.video_contrast)}
# video_vignette = ${formatIniValue(d.video_vignette)}
# video_bloom = ${formatIniValue(d.video_bloom)}
# video_bloom_threshold = ${formatIniValue(d.video_bloom_threshold)}
# video_ntsc = ${formatIniValue(d.video_ntsc)}
# video_curvature = ${formatIniValue(d.video_curvature)}
# video_chromatic_aberration = ${formatIniValue(d.video_chromatic_aberration)}

# # Kitty-specific settings
# kitty_png_level = ${formatIniValue(d.kitty_png_level)}

# # Audio settings
# audio_enable = ${formatIniValue(d.audio_enable)}
# audio_volume = ${formatIniValue(d.audio_volume)}
# audio_mute_enable = ${formatIniValue(d.audio_mute_enable)}

# # Input settings
# input_joypad_enable = ${formatIniValue(d.input_joypad_enable)}
# input_autodetect_enable = ${formatIniValue(d.input_autodetect_enable)}

# # Save data settings
# savestate_auto_load = ${formatIniValue(d.savestate_auto_load)}
# savestate_auto_save = ${formatIniValue(d.savestate_auto_save)}
# savestate_compression = ${formatIniValue(d.savestate_compression)}
# savestate_directory = ${formatIniValue(d.savestate_directory)}
# savefile_directory = ${formatIniValue(d.savefile_directory)}
# savefiles_in_content_dir = ${formatIniValue(d.savefiles_in_content_dir)}
# savestates_in_content_dir = ${formatIniValue(d.savestates_in_content_dir)}
# battery_save_enable = ${formatIniValue(d.battery_save_enable)}

# # Directory settings
# system_directory = ${formatIniValue(d.system_directory)}
# screenshot_directory = ${formatIniValue(d.screenshot_directory)}

# # Emulation settings
# fps_show_enable = ${formatIniValue(d.fps_show_enable)}
# fps_limit = ${formatIniValue(d.fps_limit)}
# video_frame_limit = ${formatIniValue(d.video_frame_limit)}

# # Core settings
# core_default = ${formatIniValue(d.core_default)}
# libretro_directory = ${formatIniValue(d.libretro_directory)}
# retroarch_cores_enable = ${formatIniValue(d.retroarch_cores_enable)}

# # Browser settings
# browser_scan_depth = ${formatIniValue(d.browser_scan_depth)}

# # Notifications
# notifications_enable = ${formatIniValue(d.notifications_enable)}

# # UI/Menu colors (ANSI color names: black, red, green, yellow, blue, magenta, cyan, white,
# # or bright variants: blackBright, redBright, greenBright, yellowBright, blueBright, etc.)
# menu_highlight_bg = ${formatIniValue(d.menu_highlight_bg)}
# menu_highlight_fg = ${formatIniValue(d.menu_highlight_fg)}

# # Logging settings
# log_verbosity = ${formatIniValue(d.log_verbosity)}
# log_to_file = ${formatIniValue(d.log_to_file)}
# log_to_file_timestamp = ${formatIniValue(d.log_to_file_timestamp)}
# log_dir = ${formatIniValue(d.log_dir)}
`;
};

/**
 * Save raw content to config file
 *
 * @param content The content to write
 * @param path Path to save to
 */
const saveConfigContent = (content: string, path: string): void => {
  const dir = dirname(path);

  ensureDirectory(dir);

  writeFileSync(path, content, "utf-8");
};

/**
 * Check if a config file exists at any of the search paths
 */
export const configExists = (customPath?: string): boolean => {
  const paths = getConfigPaths(customPath);
  return paths.some((path) => existsSync(path));
};

/**
 * Create a default config file if none exists.
 * Creates a template with all settings commented out.
 */
export const ensureConfigExists = (): string => {
  const defaultPath = getDefaultConfigPath();

  if (!existsSync(defaultPath)) {
    saveConfigContent(generateConfigTemplate(), defaultPath);
  }

  return defaultPath;
};

/**
 * Update a single config value and save to file
 *
 * This reads the existing config file, updates (or uncomments) the specified
 * key, and writes back. If the key doesn't exist, it's appended.
 * If no config file exists, creates one from template first.
 *
 * @param key The config key to update
 * @param value The new value
 * @param customPath Optional custom config path
 */
export const updateConfigValue = <K extends keyof Config>(key: K, value: Config[K], customPath?: string): void => {
  const targetPath = customPath || getDefaultConfigPath();

  // Read existing content or create template
  let content: string;
  if (existsSync(targetPath)) {
    content = readFileSync(targetPath, "utf-8");
  } else {
    content = generateConfigTemplate();
  }

  // Update the specific line
  const formattedValue = formatIniValue(value);
  const updatedContent = updateIniLine(content, key, formattedValue);

  saveConfigContent(updatedContent, targetPath);
};

/**
 * Reset a config value to default by commenting it out
 *
 * Instead of writing the default value, this comments out the setting
 * so the app will use DEFAULT_CONFIG at runtime. This ensures users
 * get updated defaults if they change in future versions.
 *
 * @param key The config key to reset
 * @param customPath Optional custom config path
 */
export const resetConfigValue = <K extends keyof Config>(key: K, customPath?: string): void => {
  const targetPath = customPath || getDefaultConfigPath();

  // Only process if config file exists
  if (!existsSync(targetPath)) {
    return;
  }

  const content = readFileSync(targetPath, "utf-8");
  const updatedContent = commentOutIniLine(content, key);

  saveConfigContent(updatedContent, targetPath);
};

