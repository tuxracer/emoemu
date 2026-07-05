/**
 * Input System
 *
 * Handles keyboard and gamepad input for the emulator.
 */

// Controllers
export { Controller, Button, DEFAULT_KEY_MAP } from './Controller';

// Input management
export { InputManager, type InputResult } from './InputManager';
export {
  InputMapper,
  type ButtonChangeCallback,
  type AnalogChangeCallback,
  ANALOG_INDEX,
  ANALOG_AXIS,
} from './InputMapper';

// Gamepad support
export {
  GamepadManager,
  type GamepadButtonCallback,
  type GamepadAnalogCallback,
} from './GamepadManager';
export {
  type AnalogState,
  type GamepadProfile,
  gamepadProfiles,
  findProfile,
  isGamepadDevice,
} from './gamepadProfiles';

// Utilities
export { createOppositeDirections } from './inputUtils';

// Re-export constants
export * from './consts';
