/**
 * Core Module Exports
 *
 * Re-exports all core interface definitions and button utilities.
 */

export type {
  ButtonDefinition,
  SystemInfo,
  AudioConfig,
  Core,
} from './core';

export {
  StandardButton,
  getButtonName,
  DEFAULT_KEYBOARD_MAP,
  areOppositeDirections,
} from './button';
