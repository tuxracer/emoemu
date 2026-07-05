/**
 * Standard Button Definitions
 *
 * These are the "physical" buttons that the frontend maps from keyboard/gamepad input.
 * The InputMapper translates these to core-specific button IDs based on button names.
 *
 * This enum covers the superset of buttons across supported systems:
 * - NES: A, B, Select, Start, D-pad (8 buttons)
 * - GBA: A, B, L, R, Select, Start, D-pad (10 buttons)
 * - SNES: A, B, X, Y, L, R, Select, Start, D-pad (12 buttons)
 */

export enum StandardButton {
  // Face buttons (right side of controller)
  A = 0,
  B = 1,
  X = 2,
  Y = 3,

  // Shoulder buttons
  L = 4,
  R = 5,
  L2 = 6,
  R2 = 7,

  // Control buttons (center)
  Start = 8,
  Select = 9,

  // D-pad
  Up = 10,
  Down = 11,
  Left = 12,
  Right = 13,

  // Analog sticks (for future use)
  LeftStickUp = 14,
  LeftStickDown = 15,
  LeftStickLeft = 16,
  LeftStickRight = 17,
  RightStickUp = 18,
  RightStickDown = 19,
  RightStickLeft = 20,
  RightStickRight = 21,
  L3 = 22, // Left stick click
  R3 = 23, // Right stick click

  // System buttons
  Guide = 24, // Xbox button / PlayStation button / Home button
}

/**
 * Get the display name for a standard button
 */
export const getButtonName = (button: StandardButton): string => {
  switch (button) {
    case StandardButton.A:
      return 'A';
    case StandardButton.B:
      return 'B';
    case StandardButton.X:
      return 'X';
    case StandardButton.Y:
      return 'Y';
    case StandardButton.L:
      return 'L';
    case StandardButton.R:
      return 'R';
    case StandardButton.L2:
      return 'L2';
    case StandardButton.R2:
      return 'R2';
    case StandardButton.Start:
      return 'Start';
    case StandardButton.Select:
      return 'Select';
    case StandardButton.Up:
      return 'Up';
    case StandardButton.Down:
      return 'Down';
    case StandardButton.Left:
      return 'Left';
    case StandardButton.Right:
      return 'Right';
    case StandardButton.LeftStickUp:
      return 'LS Up';
    case StandardButton.LeftStickDown:
      return 'LS Down';
    case StandardButton.LeftStickLeft:
      return 'LS Left';
    case StandardButton.LeftStickRight:
      return 'LS Right';
    case StandardButton.RightStickUp:
      return 'RS Up';
    case StandardButton.RightStickDown:
      return 'RS Down';
    case StandardButton.RightStickLeft:
      return 'RS Left';
    case StandardButton.RightStickRight:
      return 'RS Right';
    case StandardButton.L3:
      return 'L3';
    case StandardButton.R3:
      return 'R3';
    case StandardButton.Guide:
      return 'Guide';
    default:
      return `Button ${button}`;
  }
};


/**
 * Check if two D-pad directions are opposite (for preventing simultaneous press)
 */
export const areOppositeDirections = (a: StandardButton, b: StandardButton): boolean => (a === StandardButton.Up && b === StandardButton.Down) ||
    (a === StandardButton.Down && b === StandardButton.Up) ||
    (a === StandardButton.Left && b === StandardButton.Right) ||
    (a === StandardButton.Right && b === StandardButton.Left);

// Re-export consts after enum definition to avoid circular dependency
// (consts.ts references StandardButton values)
export * from './consts';
