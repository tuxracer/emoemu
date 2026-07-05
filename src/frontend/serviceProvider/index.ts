/**
 * Service Provider
 *
 * Centralized service management for both React and non-React code.
 * Services are initialized once with config and can be accessed anywhere.
 *
 * Usage:
 *   // At app startup (CLI or React app mount)
 *   initializeServices(config);
 *
 *   // Anywhere in the codebase
 *   const saveStateService = getSaveStateService();
 *   const path = saveStateService.findExistingStatePath(romPath);
 */

import type { Config } from '../config';
import { getPlaylistsDirectory } from '../config';
import { SaveStateService, BatterySaveService } from '../saveServices';
import { buildCrcCacheFromDirectory, type CrcCache } from '../playlist';
import { ServiceError } from './types';

/** Current config (set at initialization) */
let currentConfig: Config | null = null;

/** Singleton service instances */
let saveStateService: SaveStateService | null = null;
let batterySaveService: BatterySaveService | null = null;

/**
 * Initialize services with config.
 * Call this once at app startup before using any services.
 */
export const initializeServices = (config: Config): void => {
  currentConfig = config;
  saveStateService = new SaveStateService(config);
  batterySaveService = new BatterySaveService(config);
};

/**
 * Update services with new config.
 * Call this when config changes (e.g., settings update).
 */
export const updateServices = (config: Config): void => {
  currentConfig = config;
  saveStateService = new SaveStateService(config);
  batterySaveService = new BatterySaveService(config);
};

/**
 * Get the current config.
 * Returns null if services haven't been initialized.
 */
export const getConfig = (): Config | null => currentConfig;

/**
 * Get the SaveStateService instance.
 * Throws if services haven't been initialized.
 */
export const getSaveStateService = (): SaveStateService => {
  if (!saveStateService) {
    throw new ServiceError('NOT_INITIALIZED');
  }
  return saveStateService;
};

/**
 * Get the BatterySaveService instance.
 * Throws if services haven't been initialized.
 */
export const getBatterySaveService = (): BatterySaveService => {
  if (!batterySaveService) {
    throw new ServiceError('NOT_INITIALIZED');
  }
  return batterySaveService;
};

/**
 * Check if services have been initialized.
 */
export const areServicesInitialized = (): boolean => {
  return currentConfig !== null && saveStateService !== null && batterySaveService !== null;
};

/**
 * Get the playlist directory from config.
 * Throws if services haven't been initialized.
 */
export const getPlaylistDirectory = (): string => {
  if (!currentConfig) {
    throw new ServiceError('NOT_INITIALIZED');
  }
  return getPlaylistsDirectory(currentConfig);
};

/**
 * Build a CRC cache from all playlists in the configured playlist directory.
 * This avoids recalculating CRC32s for ROMs that are already in playlists.
 * Returns an empty map if services haven't been initialized.
 */
export const buildCrcCache = (): CrcCache => {
  if (!currentConfig) {
    return new Map();
  }
  const playlistDir = getPlaylistsDirectory(currentConfig);
  return buildCrcCacheFromDirectory(playlistDir);
};

export * from "./types";
