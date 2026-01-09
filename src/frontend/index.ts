/**
 * Frontend Module Exports
 *
 * Shared frontend infrastructure for all emulator cores.
 */

export { AudioManager } from './audio.js';
export { StateManager } from './state-manager.js';
export type { SaveStateFile, StateValidation } from './state-manager.js';
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
} from './core-registry.js';
export type { CoreFactory } from './core-registry.js';
