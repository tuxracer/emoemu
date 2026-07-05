/**
 * Core Options Configuration
 *
 * Handles loading and saving libretro core options in RetroArch-compatible format.
 * Options are stored in INI format with keys matching RetroArch conventions.
 *
 * Example format:
 *   mupen64plus-rdp-plugin = "angrylion"
 *   mupen64plus-rsp-plugin = "parallel"
 *   genesis_plus_gx-region_detect = "auto"
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { ensureDirectory } from '@/utils/ensureDirectory';
import { dirname, join } from "path";
import { pipe, filter, map, isNonNull, fromEntries } from "remeda";
import { getConfigDirectory } from "@/utils/paths";
import { parseIniLine, formatIniValue } from "@/utils/ini";
import { logger } from "@/utils/logger";

export * from './consts';

import { DEFAULT_CORE_OPTIONS } from './consts';

/** Normalize a core name to lowercase with underscores (e.g., "Mupen64Plus-Next" → "mupen64plus_next") */
const normalizeCoreName = (coreName: string): string =>
  coreName.toLowerCase().replace(/[^a-z0-9]+/g, '_');

/**
 * Get the default path for the core options config file.
 * Follows RetroArch convention: config_dir/retroarch-core-options.cfg
 */
export const getDefaultCoreOptionsPath = (): string =>
  join(getConfigDirectory(), "retroarch-core-options.cfg");

/**
 * Get the path for a core-specific options file.
 * Format: config_dir/config/core_name/core_name.opt
 */
export const getCoreSpecificOptionsPath = (coreName: string): string =>
  join(getConfigDirectory(), "config", coreName, `${coreName}.opt`);

/**
 * Get the path for a game-specific options file.
 * Format: config_dir/config/core_name/game_name.opt
 */
export const getGameSpecificOptionsPath = (coreName: string, gameName: string): string =>
  join(getConfigDirectory(), "config", coreName, `${gameName}.opt`);

/**
 * Parse core options from a config file content.
 * Only includes lines that look like core options (contain hyphens, typical of libretro options).
 *
 * @param content File content to parse
 * @param corePrefix Optional prefix to filter options (e.g., "mupen64plus")
 * @returns Record of option key-value pairs
 */
export const parseCoreOptionsContent = (
  content: string,
  corePrefix?: string
): Record<string, string> => {
  const entries = pipe(
    content.split('\n'),
    map(parseIniLine),
    filter(isNonNull),
    // Core options typically have hyphens in their keys (e.g., "core-name-option")
    filter(({ key }) => key.includes('-') || key.includes('_')),
    // Optionally filter by core prefix
    filter(({ key }) => !corePrefix || key.startsWith(corePrefix)),
    map(({ key, value }) => [key, value] as const),
  );
  return fromEntries(entries) as Record<string, string>;
};

/**
 * Load core options from a config file.
 *
 * @param filePath Path to the config file
 * @param corePrefix Optional prefix to filter options
 * @returns Record of option key-value pairs, or empty object if file doesn't exist
 */
export const loadCoreOptionsFile = (
  filePath: string,
  corePrefix?: string
): Record<string, string> => {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const options = parseCoreOptionsContent(content, corePrefix);

    if (Object.keys(options).length > 0) {
      logger.debug(`Loaded ${Object.keys(options).length} core options from ${filePath}`, 'CoreOptions');
    }

    return options;
  } catch (err) {
    logger.warn(`Failed to load core options from ${filePath}: ${err}`, 'CoreOptions');
    return {};
  }
};

/**
 * Load core options with RetroArch-compatible precedence:
 * 1. Game-specific options (highest priority)
 * 2. Core-specific options
 * 3. Global core options (lowest priority)
 *
 * @param coreName The core name (e.g., "mupen64plus_next")
 * @param gameName Optional game name for game-specific options
 * @returns Merged options with higher precedence overriding lower
 */
export const loadCoreOptions = (
  coreName: string,
  gameName?: string
): Record<string, string> => {
  // Normalize core name (convert spaces/special chars to underscores)
  const normalizedCoreName = normalizeCoreName(coreName);

  // Extract core prefix from the core name (e.g., "mupen64plus" from "mupen64plus_next")
  // This is used to filter options that belong to this core
  const corePrefix = normalizedCoreName.split('_')[0];

  // Load options in order of precedence (lowest to highest)
  const globalOptions = loadCoreOptionsFile(getDefaultCoreOptionsPath(), corePrefix);
  const coreOptions = loadCoreOptionsFile(getCoreSpecificOptionsPath(normalizedCoreName));

  let gameOptions: Record<string, string> = {};
  if (gameName) {
    const normalizedGameName = gameName.replace(/\.[^.]+$/, ''); // Remove extension
    gameOptions = loadCoreOptionsFile(getGameSpecificOptionsPath(normalizedCoreName, normalizedGameName));
  }

  // Merge with higher precedence overriding lower
  return {
    ...globalOptions,
    ...coreOptions,
    ...gameOptions,
  };
};

/**
 * Save core options to the global core options file.
 *
 * @param options Options to save
 * @param append If true, merge with existing options; if false, replace entirely
 */
export const saveCoreOptions = (
  options: Record<string, string>,
  append = true
): void => {
  const filePath = getDefaultCoreOptionsPath();
  const dir = dirname(filePath);

  ensureDirectory(dir);

  // Load existing options if appending
  let mergedOptions = options;
  if (append && existsSync(filePath)) {
    const existing = loadCoreOptionsFile(filePath);
    mergedOptions = { ...existing, ...options };
  }

  // Format as INI content
  const lines = Object.entries(mergedOptions)
    .sort(([a], [b]) => a.localeCompare(b)) // Sort by key for consistency
    .map(([key, value]) => `${key} = ${formatIniValue(value)}`);

  const content = `# emoemu Core Options\n# RetroArch-compatible format\n\n${lines.join('\n')}\n`;

  writeFileSync(filePath, content, "utf-8");
  logger.info(`Saved ${Object.keys(mergedOptions).length} core options to ${filePath}`, 'CoreOptions');
};

/**
 * Save core-specific options to the core's config directory.
 *
 * @param coreName The core name
 * @param options Options to save
 */
export const saveCoreSpecificOptions = (
  coreName: string,
  options: Record<string, string>
): void => {
  const normalizedCoreName = normalizeCoreName(coreName);
  const filePath = getCoreSpecificOptionsPath(normalizedCoreName);
  const dir = dirname(filePath);

  ensureDirectory(dir);

  // Format as INI content
  const lines = Object.entries(options)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key} = ${formatIniValue(value)}`);

  const content = `# Core options for ${coreName}\n\n${lines.join('\n')}\n`;

  writeFileSync(filePath, content, "utf-8");
  logger.info(`Saved core-specific options to ${filePath}`, 'CoreOptions');
};


/**
 * Get default core options for a given core name.
 * Returns options needed for emoemu compatibility (e.g., software rendering).
 *
 * @param coreName The core's library name (e.g., "Mupen64Plus-Next")
 * @returns Default options for the core, or undefined if none needed
 */
export const getDefaultCoreOptions = (coreName: string): Record<string, string> | undefined => {
  const lowerName = coreName.toLowerCase();

  for (const [pattern, options] of Object.entries(DEFAULT_CORE_OPTIONS)) {
    if (lowerName.includes(pattern.toLowerCase())) {
      return { ...options };
    }
  }

  return undefined;
};
