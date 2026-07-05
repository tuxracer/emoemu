import { Button } from '../Controller';
import { createOppositeDirections } from '../inputUtils';
import {
  KITTY_KEY_ARROW_UP,
  KITTY_KEY_ARROW_DOWN,
  KITTY_KEY_ARROW_LEFT,
  KITTY_KEY_ARROW_RIGHT,
  KEY_CODE_W,
  KEY_CODE_S,
  KEY_CODE_A,
  KEY_CODE_D,
  KEY_CODE_K,
  KEY_CODE_Z,
  KEY_CODE_J,
  KEY_CODE_X,
  KEY_CODE_ENTER,
  KEY_CODE_SPACE,
} from '..';

/**
 * Kitty keyboard protocol key codes (Unicode codepoints)
 * https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 */
export const KITTY_KEY_TO_BUTTON: Map<number, Button> = new Map([
  // WASD for D-Pad (lowercase)
  [KEY_CODE_W, Button.Up],
  [KEY_CODE_S, Button.Down],
  [KEY_CODE_A, Button.Left],
  [KEY_CODE_D, Button.Right],

  // Action buttons
  [KEY_CODE_K, Button.A],
  [KEY_CODE_Z, Button.A],
  [KEY_CODE_J, Button.B],
  [KEY_CODE_X, Button.B],

  // Start/Select
  [KEY_CODE_ENTER, Button.Start],
  [KEY_CODE_SPACE, Button.Select],
]);

// Special keys use different codes in Kitty protocol
// See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions
export const KITTY_SPECIAL_KEYS: Map<number, Button> = new Map([
  [KITTY_KEY_ARROW_UP, Button.Up],
  [KITTY_KEY_ARROW_DOWN, Button.Down],
  [KITTY_KEY_ARROW_LEFT, Button.Left],
  [KITTY_KEY_ARROW_RIGHT, Button.Right],
]);

/**
 * Legacy key mappings for non-Kitty terminals
 */
export const LEGACY_KEY_TO_BUTTON: Map<string, Button> = new Map([
  // WASD
  ['w', Button.Up], ['W', Button.Up],
  ['s', Button.Down], ['S', Button.Down],
  ['a', Button.Left], ['A', Button.Left],
  ['d', Button.Right], ['D', Button.Right],

  // Arrow keys (legacy escape sequences)
  ['\x1b[A', Button.Up],
  ['\x1b[B', Button.Down],
  ['\x1b[C', Button.Right],
  ['\x1b[D', Button.Left],

  // Action buttons
  ['k', Button.A], ['K', Button.A],
  ['z', Button.A], ['Z', Button.A],
  ['j', Button.B], ['J', Button.B],
  ['x', Button.B], ['X', Button.B],

  // Start/Select
  ['\r', Button.Start],
  [' ', Button.Select],
]);

/**
 * D-pad buttons that are mutually exclusive (opposite directions)
 */
export const OPPOSITE_DIRECTIONS: Map<Button, Button> = createOppositeDirections(
  Button.Up,
  Button.Down,
  Button.Left,
  Button.Right
);
