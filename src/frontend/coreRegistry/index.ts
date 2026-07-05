/**
 * Core Registry
 *
 * Discovers and instantiates emulator cores based on ROM file extension.
 * This allows automatic core selection when loading a ROM.
 */

import { pipe, map, sortBy, flatMap, unique, identity } from 'remeda';
import type { Core, SystemInfo } from '../../core/core';
import { getDatabaseName } from '../playlist';
// Source these two constants from the pure-leaf consts module rather than the
// playlist barrel: they are read at module top-level (UNKNOWN_SYSTEM_NAME
// below), and the barrel's deferred `export *` re-export can still be
// unpopulated when coreRegistry is reached mid-cycle (parseArgs -> ... ->
// coreRegistry -> playlist), leaving these `undefined`.
import { PLAYLIST_EXTENSION, DEFAULT_DATABASE_NAME } from '../playlist/consts';

/**
 * Options that can be passed when creating a core instance
 */
export interface CoreCreateOptions {
  /** Core-specific options (for libretro cores, in RetroArch format) */
  coreOptions?: Record<string, string>;
  /** System directory path for BIOS files */
  systemDirectory?: string;
  /** Save directory path */
  saveDirectory?: string;
}

/**
 * Factory function for creating a core instance
 */
export interface CoreFactory {
  /** Create a new instance of the core, optionally with configuration options */
  create(options?: CoreCreateOptions): Core;

  /** File extensions this core handles (lowercase, with dot) */
  extensions: string[];

  /** Get system info without creating a full core instance */
  getSystemInfo(): SystemInfo;

  /** Path to the core file */
  path?: string;
}

/**
 * Registry of available cores
 */
const coreFactories = new Map<string, CoreFactory>();

/**
 * Pre-computed map of extension → matching cores (sorted).
 * Built lazily on first access, invalidated when cores are registered.
 */
let extensionToCoresCache: Map<string, Array<{ id: string; factory: CoreFactory }>> | null = null;

/**
 * Cached list of all supported extensions.
 * Built lazily on first access, invalidated when cores are registered.
 */
let supportedExtensionsCache: string[] | null = null;

/**
 * Build the extension→cores lookup map from registered cores.
 * Cores are pre-sorted: libretro first, then alphabetically.
 */
const buildExtensionMap = (): Map<string, Array<{ id: string; factory: CoreFactory }>> => {
  const extMap = new Map<string, Array<{ id: string; factory: CoreFactory }>>();

  // Collect all cores for each extension
  for (const [id, factory] of coreFactories) {
    for (const ext of factory.extensions) {
      const existing = extMap.get(ext) ?? [];
      existing.push({ id, factory });
      extMap.set(ext, existing);
    }
  }

  // Sort each extension's cores alphabetically
  for (const [ext, cores] of extMap) {
    extMap.set(ext, pipe(
      cores,
      sortBy(
        [({ id }) => id, 'asc']
      )
    ));
  }

  return extMap;
};

/**
 * Get the extension→cores map, building it if necessary.
 */
const getExtensionMap = (): Map<string, Array<{ id: string; factory: CoreFactory }>> => {
  if (!extensionToCoresCache) {
    extensionToCoresCache = buildExtensionMap();
  }
  return extensionToCoresCache;
};

/**
 * Register a core factory.
 * Called by each core module to make itself available.
 *
 * @param id Unique core identifier (e.g., "nes", "gba")
 * @param factory Factory for creating core instances
 */
export const registerCore = (id: string, factory: CoreFactory): void => {
  if (coreFactories.has(id)) {
    throw new Error(`Core '${id}' is already registered`);
  }
  coreFactories.set(id, factory);
  // Invalidate caches so they're rebuilt on next access
  extensionToCoresCache = null;
  supportedExtensionsCache = null;
};

/**
 * Unregister a core factory.
 * Used when deleting a libretro core to remove it from the registry.
 *
 * @param id Core identifier to unregister
 * @returns true if the core was registered and removed, false if not found
 */
export const unregisterCore = (id: string): boolean => {
  const existed = coreFactories.has(id);
  coreFactories.delete(id);
  // Invalidate caches so they're rebuilt on next access
  extensionToCoresCache = null;
  supportedExtensionsCache = null;
  return existed;
};

/**
 * Get a core factory by ID.
 *
 * @param id Core identifier
 * @returns Core factory or undefined if not found
 */
export const getCoreFactory = (id: string): CoreFactory | undefined => coreFactories.get(id);

/**
 * Create a core instance by ID.
 *
 * @param id Core identifier
 * @param options Optional configuration for the core (e.g., core options, directories)
 * @returns New core instance or null if core not found
 */
export const createCore = (id: string, options?: CoreCreateOptions): Core | null => {
  const factory = coreFactories.get(id);
  return factory ? factory.create(options) : null;
};

/**
 * Find all cores that support a given ROM file extension.
 * Uses pre-computed extension→cores map for O(1) lookup.
 *
 * @param romPath Path to the ROM file
 * @returns Array of matching cores with their IDs and factories
 */
export const findMatchingCores = (romPath: string): Array<{ id: string; factory: CoreFactory }> => {
  const ext = romPath.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) {
    return [];
  }

  // O(1) lookup from pre-computed map (already sorted)
  return getExtensionMap().get(ext) ?? [];
};

/**
 * Find all cores that support a given file extension directly.
 * Useful when extension is already extracted.
 *
 * @param ext File extension (lowercase, with dot)
 * @returns Array of matching cores with their IDs and factories
 */
export const findMatchingCoresByExtension = (ext: string): Array<{ id: string; factory: CoreFactory }> => {
  return getExtensionMap().get(ext.toLowerCase()) ?? [];
};

/**
 * Detect the appropriate core for a ROM file based on extension.
 *
 * @param romPath Path to the ROM file
 * @returns Core factory or undefined if no matching core found
 */
export const detectCoreFactory = (romPath: string): CoreFactory | undefined => {
  const matches = findMatchingCores(romPath);
  return matches.length > 0 ? matches[0].factory : undefined;
};

/**
 * Detect and create the appropriate core for a ROM file.
 *
 * @param romPath Path to the ROM file
 * @param options Optional configuration for the core (e.g., core options, directories)
 * @returns New core instance or null if no matching core found
 */
export const detectCore = (romPath: string, options?: CoreCreateOptions): Core | null => {
  const factory = detectCoreFactory(romPath);
  return factory ? factory.create(options) : null;
};

/**
 * Check if a ROM file extension is supported by any registered core.
 *
 * @param romPath Path to the ROM file
 * @returns true if a core can handle this file type
 */
export const isRomSupported = (romPath: string): boolean => detectCoreFactory(romPath) !== undefined;

/**
 * Get list of all registered cores with their info.
 *
 * @returns Array of core information objects
 */
export const listCores = (): Array<{
  id: string;
  name: string;
  extensions: string[];
  path: string;
}> => pipe(
  Array.from(coreFactories.entries()),
  map(([id, factory]) => ({
    id,
    name: factory.getSystemInfo().name,
    extensions: factory.extensions,
    path: factory.path ?? "",
  }))
);

/**
 * Get all supported file extensions across all cores.
 * Result is cached and invalidated when cores are registered.
 *
 * @returns Array of supported extensions (lowercase, with dot)
 */
export const getSupportedExtensions = (): string[] => {
  if (!supportedExtensionsCache) {
    supportedExtensionsCache = pipe(
      Array.from(coreFactories.values()),
      flatMap((factory) => factory.extensions),
      unique(),
      sortBy([identity(), 'asc'])
    );
  }
  return supportedExtensionsCache;
};

/** System name for unknown/unmapped extensions */
const UNKNOWN_SYSTEM_NAME = DEFAULT_DATABASE_NAME.replace(PLAYLIST_EXTENSION, '');

/**
 * Get unique supported system names based on installed cores.
 * Returns RetroArch-style system names (e.g., "Nintendo - Nintendo Entertainment System").
 */
export const getSupportedSystems = (): string[] => {
  const systems = new Set<string>();
  // Get extensions from installed cores and map to system names
  for (const ext of getSupportedExtensions()) {
    const dbName = getDatabaseName(ext);
    // Remove .lpl extension to get system name
    const systemName = dbName.replace(PLAYLIST_EXTENSION, '');
    // Skip the fallback "Unknown System" entry
    if (systemName !== UNKNOWN_SYSTEM_NAME) {
      systems.add(systemName);
    }
  }
  /** Unique system names, sorted alphabetically */
  return Array.from(systems).sort();
};

/**
 * Get the number of registered cores.
 */
export const getCoreCount = (): number => coreFactories.size;

// Note: Cores register themselves when their modules are imported.
// This allows tree-shaking of unused cores in production builds.
