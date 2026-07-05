/**
 * Frontend Module Exports
 *
 * Shared frontend infrastructure for all emulator cores.
 */

export * from './consts';
export { AudioManager } from './AudioManager';
export {
  type DirectoryCache,
  createDirectoryCache,
  getCachedDirectoryListing,
  getFileFromCache,
  clearDirectoryCache,
} from './directoryCache';
export { SaveStateService, BatterySaveService } from './saveServices';
export type { SaveStateDetails, SaveStateCheckResult, BatterySaveCheckResult } from './saveServices';
export {
  initializeServices,
  updateServices,
  getSaveStateService,
  getBatterySaveService,
  areServicesInitialized,
  getConfig,
  getPlaylistDirectory,
  buildCrcCache,
} from './serviceProvider';
export {
  registerCore,
  getCoreFactory,
  createCore,
  detectCoreFactory,
  detectCore,
  isRomSupported,
  listCores,
  getSupportedExtensions,
  getCoreCount,
} from './coreRegistry';
export type { CoreFactory } from './coreRegistry';
export {
  loadConfig,
  updateConfigValue,
  configExists,
  ensureConfigExists,
  DEFAULT_CONFIG,
} from './config';
export type { Config, VideoDriver } from './config';
export { SettingsManager } from './SettingsManager';
export type { RuntimeSettings, RenderMode } from './SettingsManager';
export {
  generatePlaylist,
  writePlaylist,
  generateAndWritePlaylist,
  generatePlaylistsBySystem,
  generateConsolidatedPlaylist,
  createPlaylistEntry,
  getDatabaseName,
  updatePlaylistRuntime,
  PLAYLIST_VERSION,
  PLAYLIST_EXTENSION,
  // Reader functions
  readPlaylist,
  playlistEntryToRomInfo,
  playlistToRomInfoArray,
  findPlaylistsInDirectory,
  findPlaylistsForDirectory,
  loadRomsFromPlaylists,
} from './playlist';
export type {
  PlaylistEntry,
  PlaylistFile,
  PlaylistOptions,
  PlaylistGenerationResult,
  PlaylistUpdateResult,
  // Reader types
  PlaylistReadResult,
  PlaylistInfo,
  ConversionOptions,
} from './playlist';
