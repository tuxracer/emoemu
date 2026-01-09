/**
 * Core Registry
 *
 * Discovers and instantiates emulator cores based on ROM file extension.
 * This allows automatic core selection when loading a ROM.
 */

import type { Core, SystemInfo } from '../core/core.js';

/**
 * Factory function for creating a core instance
 */
export interface CoreFactory {
  /** Create a new instance of the core */
  create(): Core;

  /** File extensions this core handles (lowercase, with dot) */
  extensions: string[];

  /** Get system info without creating a full core instance */
  getSystemInfo(): SystemInfo;
}

/**
 * Registry of available cores
 */
const coreFactories = new Map<string, CoreFactory>();

/**
 * Register a core factory.
 * Called by each core module to make itself available.
 *
 * @param id Unique core identifier (e.g., "nes", "gba")
 * @param factory Factory for creating core instances
 */
export function registerCore(id: string, factory: CoreFactory): void {
  if (coreFactories.has(id)) {
    throw new Error(`Core '${id}' is already registered`);
  }
  coreFactories.set(id, factory);
}

/**
 * Get a core factory by ID.
 *
 * @param id Core identifier
 * @returns Core factory or undefined if not found
 */
export function getCoreFactory(id: string): CoreFactory | undefined {
  return coreFactories.get(id);
}

/**
 * Create a core instance by ID.
 *
 * @param id Core identifier
 * @returns New core instance or null if core not found
 */
export function createCore(id: string): Core | null {
  const factory = coreFactories.get(id);
  return factory ? factory.create() : null;
}

/**
 * Detect the appropriate core for a ROM file based on extension.
 *
 * @param romPath Path to the ROM file
 * @returns Core factory or undefined if no matching core found
 */
export function detectCoreFactory(romPath: string): CoreFactory | undefined {
  const ext = romPath.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return undefined;

  for (const factory of coreFactories.values()) {
    if (factory.extensions.includes(ext)) {
      return factory;
    }
  }

  return undefined;
}

/**
 * Detect and create the appropriate core for a ROM file.
 *
 * @param romPath Path to the ROM file
 * @returns New core instance or null if no matching core found
 */
export function detectCore(romPath: string): Core | null {
  const factory = detectCoreFactory(romPath);
  return factory ? factory.create() : null;
}

/**
 * Check if a ROM file extension is supported by any registered core.
 *
 * @param romPath Path to the ROM file
 * @returns true if a core can handle this file type
 */
export function isRomSupported(romPath: string): boolean {
  return detectCoreFactory(romPath) !== undefined;
}

/**
 * Get list of all registered cores with their info.
 *
 * @returns Array of core information objects
 */
export function listCores(): Array<{
  id: string;
  name: string;
  extensions: string[];
}> {
  return Array.from(coreFactories.entries()).map(([id, factory]) => {
    const info = factory.getSystemInfo();
    return {
      id,
      name: info.name,
      extensions: factory.extensions,
    };
  });
}

/**
 * Get all supported file extensions across all cores.
 *
 * @returns Array of supported extensions (lowercase, with dot)
 */
export function getSupportedExtensions(): string[] {
  const extensions = new Set<string>();
  for (const factory of coreFactories.values()) {
    for (const ext of factory.extensions) {
      extensions.add(ext);
    }
  }
  return Array.from(extensions).sort();
}

/**
 * Get the number of registered cores.
 */
export function getCoreCount(): number {
  return coreFactories.size;
}

// Note: Cores register themselves when their modules are imported.
// For example, importing '../cores/nes/index.js' will register the NES core.
// This allows tree-shaking of unused cores in production builds.
