import { Button } from '.';

// Default keyboard mappings
// Layout designed for comfortable two-handed play:
//   Left hand: WASD (D-pad), Q/E (L/R shoulders), Space (Select)
//   Right hand: IJKL cluster (Y/X/A/B face buttons), Enter (Start)
export const DEFAULT_KEY_MAP: Record<string, Button> = {
  // WASD for D-Pad
  w: Button.Up,
  s: Button.Down,
  a: Button.Left,
  d: Button.Right,
  W: Button.Up,
  S: Button.Down,
  A: Button.Left,
  D: Button.Right,

  // Arrow keys (escape sequences from terminal)
  '\u001b[A': Button.Up,
  '\u001b[B': Button.Down,
  '\u001b[D': Button.Left,
  '\u001b[C': Button.Right,

  // Face buttons - IJKL cluster (matches SNES diamond layout)
  // I = top (X), J = left (Y), K = bottom (B), L = right (A)
  i: Button.X,
  I: Button.X,
  j: Button.Y,
  J: Button.Y,
  k: Button.B,
  K: Button.B,
  l: Button.A,
  L: Button.A,

  // Alternative face buttons (Z/X for B/A like NES emulators)
  z: Button.B,
  Z: Button.B,
  x: Button.A,
  X: Button.A,

  // Shoulder buttons
  q: Button.L,
  Q: Button.L,
  e: Button.R,
  E: Button.R,

  // Start/Select
  '\r': Button.Start,      // Enter key
  ' ': Button.Select,      // Space key
};
