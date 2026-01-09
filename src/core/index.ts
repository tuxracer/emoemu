/**
 * Core Module Exports
 *
 * Re-exports all core interface definitions and button utilities.
 */

export type {
  ButtonDefinition,
  SystemInfo,
  AudioConfig,
  CoreState,
  Core,
} from './core.js';

export {
  StandardButton,
  getButtonName,
  DEFAULT_KEYBOARD_MAP,
  areOppositeDirections,
} from './button.js';
