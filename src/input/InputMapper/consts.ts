import { StandardButton } from '../../core/button';

/** Mapping from button name patterns to StandardButton */
export const BUTTON_NAME_MAP: Array<{ names: string[]; button: StandardButton }> = [
  { names: ['a'], button: StandardButton.A },
  { names: ['b'], button: StandardButton.B },
  { names: ['x'], button: StandardButton.X },
  { names: ['y'], button: StandardButton.Y },
  { names: ['l', 'l1', 'lb'], button: StandardButton.L },
  { names: ['r', 'r1', 'rb'], button: StandardButton.R },
  { names: ['l2', 'lt', 'z'], button: StandardButton.L2 },
  { names: ['r2', 'rt'], button: StandardButton.R2 },
  { names: ['l3', 'ls'], button: StandardButton.L3 },
  { names: ['r3', 'rs'], button: StandardButton.R3 },
  { names: ['start'], button: StandardButton.Start },
  { names: ['select', 'back'], button: StandardButton.Select },
  { names: ['up'], button: StandardButton.Up },
  { names: ['down'], button: StandardButton.Down },
  { names: ['left'], button: StandardButton.Left },
  { names: ['right'], button: StandardButton.Right },
];

/** Analog stick indices */
export const ANALOG_INDEX = {
  LEFT: 0,
  RIGHT: 1,
} as const;

/** Analog axis indices */
export const ANALOG_AXIS = {
  X: 0,
  Y: 1,
} as const;
