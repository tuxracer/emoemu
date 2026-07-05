import { StandardButton } from '.';

/**
 * Default keyboard mappings for standard buttons.
 * These are the keys that map to each standard button.
 */
export const DEFAULT_KEYBOARD_MAP: Map<string, StandardButton> = new Map([
  // Face buttons - primary mappings
  ['k', StandardButton.A],
  ['z', StandardButton.A],
  ['j', StandardButton.B],
  ['x', StandardButton.B],
  ['i', StandardButton.X],
  ['u', StandardButton.Y],

  // Shoulder buttons
  ['q', StandardButton.L],
  ['e', StandardButton.R],

  // Control buttons
  ['Enter', StandardButton.Start],
  [' ', StandardButton.Select],

  // D-pad - WASD
  ['w', StandardButton.Up],
  ['s', StandardButton.Down],
  ['a', StandardButton.Left],
  ['d', StandardButton.Right],

  // D-pad - Arrow keys
  ['ArrowUp', StandardButton.Up],
  ['ArrowDown', StandardButton.Down],
  ['ArrowLeft', StandardButton.Left],
  ['ArrowRight', StandardButton.Right],
]);
