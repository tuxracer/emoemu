/**
 * Buffer Reading Utilities
 *
 * Utilities for reading binary data and gamepad input processing.
 */

import { StandardButton } from '../../core/button';
import {
  BYTE_SHIFT_1,
  ANALOG_CENTER_8BIT,
  ANALOG_DEADZONE_8BIT,
  ANALOG_DEADZONE_SIGNED,
  INT16_MAX,
  UINT16_RANGE,
} from './consts';

export * from './consts';

/**
 * D-pad direction state
 */
export interface DpadState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Read unsigned 16-bit little-endian value from buffer
 */
export const readUint16LE = (data: Buffer, offset: number): number =>
  data[offset] | (data[offset + 1] << BYTE_SHIFT_1);

/**
 * Read signed 16-bit little-endian value from buffer
 * Converts unsigned 16-bit to signed (-32768 to +32767)
 */
export const readInt16LE = (data: Buffer, offset: number): number => {
  const raw = readUint16LE(data, offset);
  return raw > INT16_MAX ? raw - UINT16_RANGE : raw;
};

/**
 * Apply analog stick values to d-pad buttons with deadzone
 * For signed analog values centered at 0 (-32768 to +32767)
 */
export const applySignedAnalogToDpad = (
  buttons: Map<StandardButton, boolean>,
  x: number,
  y: number,
  deadzone: number = ANALOG_DEADZONE_SIGNED
): void => {
  if (x < -deadzone) { buttons.set(StandardButton.Left, true); }
  if (x > deadzone) { buttons.set(StandardButton.Right, true); }
  if (y < -deadzone) { buttons.set(StandardButton.Down, true); }
  if (y > deadzone) { buttons.set(StandardButton.Up, true); }
};

/**
 * Convert analog stick values to digital d-pad state
 * For unsigned values (0-255 range with 128 as center)
 */
export const analogToDpad = (
  x: number,
  y: number,
  deadzone: number = ANALOG_DEADZONE_8BIT,
  center: number = ANALOG_CENTER_8BIT
): DpadState => ({
  left: x < center - deadzone,
  right: x > center + deadzone,
  up: y < center - deadzone,
  down: y > center + deadzone,
});

/**
 * Neutral d-pad state (no buttons pressed)
 */
const DPAD_NEUTRAL: DpadState = { up: false, down: false, left: false, right: false };

/**
 * Standard HID hat values: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW, 8/15=center
 */
const STANDARD_HAT_MAP: Record<number, DpadState> = {
  0: { up: true, down: false, left: false, right: false },   // N
  1: { up: true, down: false, left: false, right: true },    // NE
  2: { up: false, down: false, left: false, right: true },   // E
  3: { up: false, down: true, left: false, right: true },    // SE
  4: { up: false, down: true, left: false, right: false },   // S
  5: { up: false, down: true, left: true, right: false },    // SW
  6: { up: false, down: false, left: true, right: false },   // W
  7: { up: true, down: false, left: true, right: false },    // NW
};

/**
 * Xbox-style hat values: 0=none, 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW
 */
const XBOX_HAT_MAP: Record<number, DpadState> = {
  0: DPAD_NEUTRAL,                                           // None
  1: { up: true, down: false, left: false, right: false },   // N
  2: { up: true, down: false, left: false, right: true },    // NE
  3: { up: false, down: false, left: false, right: true },   // E
  4: { up: false, down: true, left: false, right: true },    // SE
  5: { up: false, down: true, left: false, right: false },   // S
  6: { up: false, down: true, left: true, right: false },    // SW
  7: { up: false, down: false, left: true, right: false },   // W
  8: { up: true, down: false, left: true, right: false },    // NW
};

/**
 * Parse hat switch value to d-pad state
 * @param hat - Hat switch value from HID report
 * @param xboxStyle - If true, use Xbox 1-indexed hat values (0=none, 1=N, etc.)
 */
export const hatToDpad = (hat: number, xboxStyle: boolean = false): DpadState =>
  (xboxStyle ? XBOX_HAT_MAP : STANDARD_HAT_MAP)[hat] ?? DPAD_NEUTRAL;

/**
 * Apply d-pad state to button map
 */
export const applyDpadToButtons = (
  buttons: Map<StandardButton, boolean>,
  dpad: DpadState
): void => {
  if (dpad.up) { buttons.set(StandardButton.Up, true); }
  if (dpad.down) { buttons.set(StandardButton.Down, true); }
  if (dpad.left) { buttons.set(StandardButton.Left, true); }
  if (dpad.right) { buttons.set(StandardButton.Right, true); }
};
