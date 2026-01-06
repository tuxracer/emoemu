import { Controller, Button } from './controller.js';

/**
 * Kitty keyboard protocol key codes (Unicode codepoints)
 * https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 */
const KITTY_KEY_TO_BUTTON: Map<number, Button> = new Map([
  // WASD for D-Pad (lowercase)
  [119, Button.Up],    // w
  [115, Button.Down],  // s
  [97, Button.Left],   // a
  [100, Button.Right], // d

  // Action buttons
  [107, Button.A],     // k
  [122, Button.A],     // z
  [106, Button.B],     // j
  [120, Button.B],     // x

  // Start/Select
  [13, Button.Start],  // Enter
  [32, Button.Select], // Space
]);

// Special keys use different codes in Kitty protocol
// See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions
const KITTY_SPECIAL_KEYS: Map<number, Button> = new Map([
  [57352, Button.Up],    // Arrow Up
  [57353, Button.Down],  // Arrow Down
  [57350, Button.Left],  // Arrow Left
  [57351, Button.Right], // Arrow Right
]);

/**
 * D-pad buttons that are mutually exclusive (opposite directions)
 */
const OPPOSITE_DIRECTIONS: Map<Button, Button> = new Map([
  [Button.Up, Button.Down],
  [Button.Down, Button.Up],
  [Button.Left, Button.Right],
  [Button.Right, Button.Left],
]);

// Kitty protocol escape sequences
// Flags: 1=disambiguate, 2=report event types (press/repeat/release), 4=report alternate keys, 8=report all keys as escape codes
// We need flags 1+2+8 = 11 to get disambiguated keys, release events, and all keys (including Enter) as CSI sequences
const KITTY_ENABLE = '\x1b[>11u';  // Enable full keyboard protocol
const KITTY_DISABLE = '\x1b[<u';   // Pop keyboard mode (restore previous)

/**
 * InputManager using Kitty keyboard protocol for true keydown/keyup events.
 * Falls back to legacy mode for non-Kitty terminals.
 */
export class InputManager {
  private controller1: Controller;
  private controller2: Controller;
  private quitRequested: boolean = false;

  // Track currently pressed keys (keycode -> button)
  private pressedKeys: Map<number, Button> = new Map();

  // Buffer for parsing escape sequences
  private inputBuffer: string = '';

  // Whether Kitty protocol is active
  private kittyMode: boolean = false;

  constructor(
    controller1: Controller,
    controller2: Controller
  ) {
    this.controller1 = controller1;
    this.controller2 = controller2;
  }

  /**
   * Start listening for keyboard events (enables Kitty protocol).
   */
  start(): void {
    // Enable Kitty keyboard protocol with key release reporting
    process.stdout.write(KITTY_ENABLE);
    this.kittyMode = true;
  }

  /**
   * Stop listening for keyboard events (disables Kitty protocol).
   */
  stop(): void {
    if (this.kittyMode) {
      process.stdout.write(KITTY_DISABLE);
      this.kittyMode = false;
    }
  }

  /**
   * Check if quit was requested (Escape).
   */
  shouldQuit(): boolean {
    return this.quitRequested;
  }

  /**
   * Process raw input from stdin.
   * Parses Kitty keyboard protocol sequences.
   */
  processInput(input: string): { quit: boolean } {
    this.inputBuffer += input;

    // Process all complete sequences in the buffer
    while (this.inputBuffer.length > 0) {
      // Check for Ctrl+C
      if (this.inputBuffer[0] === '\u0003') {
        this.quitRequested = true;
        this.inputBuffer = this.inputBuffer.slice(1);
        return { quit: true };
      }

      // Check for escape sequences
      if (this.inputBuffer[0] === '\x1b') {
        // Try to parse Kitty keyboard protocol
        // Format: CSI keycode ; modifiers:event-type u
        // Examples:
        //   \x1b[97u        - 'a' press (no modifiers field = press)
        //   \x1b[97;1u      - 'a' press with modifiers=1 (no event = press)
        //   \x1b[97;1:1u    - 'a' press explicitly
        //   \x1b[97;1:3u    - 'a' release
        const kittyMatch = this.inputBuffer.match(/^\x1b\[(\d+)(?:;(\d+)(?::(\d+))?)?u/);
        if (kittyMatch) {
          const keycode = parseInt(kittyMatch[1], 10);
          // Event type is after the colon in modifiers field: modifiers:event-type
          const eventType = kittyMatch[3] ? parseInt(kittyMatch[3], 10) : 1; // 1=press, 2=repeat, 3=release

          this.handleKittyKey(keycode, eventType);
          this.inputBuffer = this.inputBuffer.slice(kittyMatch[0].length);
          continue;
        }

        // Check for arrow keys in various formats:
        // Legacy: \x1b[A, \x1b[B, \x1b[C, \x1b[D
        // Kitty enhanced: \x1b[1;modifiers[ABCD] or \x1b[1;modifiers:event_type[ABCD]
        const arrowMatch = this.inputBuffer.match(/^\x1b\[(?:1;(\d+)(?::(\d+))?)?([ABCD])/);
        if (arrowMatch) {
          const arrowMap: Record<string, { code: number; button: Button }> = {
            'A': { code: 57352, button: Button.Up },
            'B': { code: 57353, button: Button.Down },
            'C': { code: 57351, button: Button.Right },
            'D': { code: 57350, button: Button.Left },
          };
          const eventType = arrowMatch[2] ? parseInt(arrowMatch[2], 10) : 1; // 1=press, 2=repeat, 3=release
          const arrowKey = arrowMatch[3];
          const arrow = arrowMap[arrowKey];
          if (arrow) {
            if (eventType === 3) {
              this.handleKeyUp(arrow.code, arrow.button);
            } else {
              this.handleKeyDown(arrow.code, arrow.button);
            }
          }
          this.inputBuffer = this.inputBuffer.slice(arrowMatch[0].length);
          continue;
        }

        // Check for standalone Escape (quit)
        if (this.inputBuffer.length === 1 || !this.inputBuffer[1]?.match(/[\[\]O]/)) {
          this.quitRequested = true;
          this.inputBuffer = this.inputBuffer.slice(1);
          return { quit: true };
        }

        // Unknown escape sequence - wait for more data or skip
        if (this.inputBuffer.length < 10) {
          // Might be incomplete, wait for more
          break;
        }
        // Skip unknown escape sequence
        this.inputBuffer = this.inputBuffer.slice(1);
        continue;
      }

      // Regular character - this is how Kitty sends key PRESS events
      // (releases come as CSI sequences with :3 suffix)
      const char = this.inputBuffer[0];
      const charCode = char.charCodeAt(0);
      this.inputBuffer = this.inputBuffer.slice(1);

      // Handle key press - use charCode as the key identifier
      // so it matches with the release event keycode
      const button = KITTY_KEY_TO_BUTTON.get(charCode);
      if (button !== undefined) {
        this.handleKeyDown(charCode, button);
      }
    }

    return { quit: false };
  }

  /**
   * Handle Kitty keyboard protocol key event.
   */
  private handleKittyKey(keycode: number, eventType: number): void {
    // Check for Escape key (keycode 27)
    if (keycode === 27) {
      this.quitRequested = true;
      return;
    }

    // Get button from keycode
    let button = KITTY_KEY_TO_BUTTON.get(keycode);
    if (button === undefined) {
      button = KITTY_SPECIAL_KEYS.get(keycode);
    }

    if (button === undefined) {
      return;
    }

    if (eventType === 1 || eventType === 2) {
      // Key press or repeat
      this.handleKeyDown(keycode, button);
    } else if (eventType === 3) {
      // Key release
      this.handleKeyUp(keycode, button);
    }
  }

  /**
   * Handle key down event.
   */
  private handleKeyDown(keycode: number, button: Button): void {
    // Check for opposite direction - release it immediately
    const oppositeButton = OPPOSITE_DIRECTIONS.get(button);
    if (oppositeButton !== undefined) {
      for (const [pressedKeycode, pressedButton] of this.pressedKeys.entries()) {
        if (pressedButton === oppositeButton) {
          this.controller1.setButton(oppositeButton, false);
          this.pressedKeys.delete(pressedKeycode);
          break;
        }
      }
    }

    // Press the button
    this.controller1.setButton(button, true);
    this.pressedKeys.set(keycode, button);
  }

  /**
   * Handle key up event.
   */
  private handleKeyUp(keycode: number, button: Button): void {
    // Only release if this key is currently pressed
    if (this.pressedKeys.has(keycode)) {
      this.controller1.setButton(button, false);
      this.pressedKeys.delete(keycode);
    }
  }

  /**
   * Update - called each frame.
   */
  update(): void {
    // No-op for Kitty mode (we have true keyup events)
  }

  /**
   * Get currently pressed buttons as a string for display.
   */
  getPressedButtons(): string {
    return this.controller1.getPressedButtons();
  }

  /**
   * Get debug info.
   */
  getDebugInfo(): string {
    return `Keys: ${this.pressedKeys.size} Kitty: ${this.kittyMode}`;
  }

  /**
   * Clear all input state.
   */
  clear(): void {
    for (const button of this.pressedKeys.values()) {
      this.controller1.setButton(button, false);
    }
    this.pressedKeys.clear();
  }
}
