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
 * Legacy key mappings for non-Kitty terminals
 */
const LEGACY_KEY_TO_BUTTON: Map<string, Button> = new Map([
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
const KITTY_QUERY = '\x1b[?u';     // Query current keyboard mode

// Time in ms to wait for Kitty protocol response
const KITTY_DETECT_TIMEOUT = 100;

// Time in ms before auto-releasing keys in legacy mode
const LEGACY_KEY_RELEASE_TIME = 80;

// Result of processing input
export interface InputResult {
  quit: boolean;
  cycleRenderMode: boolean;
  toggleAudio: boolean;
}

/**
 * InputManager with Kitty keyboard protocol detection.
 * Uses true keydown/keyup events in Kitty mode.
 * Falls back to auto-release timing in legacy mode.
 */
export class InputManager {
  private controller1: Controller;
  private quitRequested: boolean = false;
  private cycleRenderModeRequested: boolean = false;
  private toggleAudioRequested: boolean = false;

  // Track currently pressed keys (keycode -> button)
  private pressedKeys: Map<number, Button> = new Map();

  // Buffer for parsing escape sequences
  private inputBuffer: string = '';

  // Whether Kitty protocol is active and supported
  private kittyMode: boolean = false;
  private kittySupported: boolean | null = null; // null = not yet detected

  // Legacy mode: track key press times for auto-release
  private legacyKeyTimes: Map<string, number> = new Map();

  constructor(
    controller1: Controller,
    _controller2: Controller
  ) {
    this.controller1 = controller1;
    // controller2 reserved for future 2-player keyboard support
  }

  /**
   * Detect if Kitty protocol is supported.
   * Returns a promise that resolves to true if supported.
   * Must be called AFTER stdin is configured (raw mode, resumed).
   */
  async detectKittySupport(): Promise<boolean> {
    return new Promise((resolve) => {
      let responded = false;
      let responseData = '';

      // Temporary handler to check for Kitty query response
      const checkResponse = (data: Buffer) => {
        const str = data.toString();
        responseData += str;

        // Kitty responds with: \x1b[?<flags>u
        // We need to consume the entire response to prevent it leaking to input handler
        if (responseData.includes('\x1b[?') && responseData.includes('u')) {
          responded = true;
          process.stdin.removeListener('data', checkResponse);

          // Give a tiny bit of time for any additional response data to clear
          setTimeout(() => resolve(true), 10);
        }
      };

      process.stdin.on('data', checkResponse);

      // Send query
      process.stdout.write(KITTY_QUERY);

      // Timeout - no response means not supported
      setTimeout(() => {
        if (!responded) {
          process.stdin.removeListener('data', checkResponse);
          resolve(false);
        }
      }, KITTY_DETECT_TIMEOUT);
    });
  }

  /**
   * Start listening for keyboard events.
   * Detects Kitty support and enables appropriate mode.
   */
  async start(): Promise<void> {
    // Detect Kitty protocol support
    this.kittySupported = await this.detectKittySupport();

    if (this.kittySupported) {
      // Enable Kitty keyboard protocol with key release reporting
      process.stdout.write(KITTY_ENABLE);
      this.kittyMode = true;
    } else {
      // Legacy mode - no special setup needed
      this.kittyMode = false;
    }
  }

  /**
   * Start without detection (synchronous).
   * Use when you already know the terminal capabilities.
   */
  startWithMode(useKitty: boolean): void {
    if (useKitty) {
      process.stdout.write(KITTY_ENABLE);
      this.kittyMode = true;
      this.kittySupported = true;
    } else {
      this.kittyMode = false;
      this.kittySupported = false;
    }
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
   * Check if Kitty protocol is being used.
   */
  isKittyMode(): boolean {
    return this.kittyMode;
  }

  /**
   * Check if quit was requested (Escape).
   */
  shouldQuit(): boolean {
    return this.quitRequested;
  }

  /**
   * Process raw input from stdin.
   * Handles both Kitty protocol and legacy input.
   */
  processInput(input: string): InputResult {
    // Reset per-frame flags
    this.cycleRenderModeRequested = false;
    this.toggleAudioRequested = false;

    if (this.kittyMode) {
      return this.processKittyInput(input);
    } else {
      return this.processLegacyInput(input);
    }
  }

  /**
   * Process input in Kitty protocol mode.
   */
  private processKittyInput(input: string): InputResult {
    this.inputBuffer += input;

    // Process all complete sequences in the buffer
    while (this.inputBuffer.length > 0) {
      // Check for Ctrl+C
      if (this.inputBuffer[0] === '\u0003') {
        this.quitRequested = true;
        this.inputBuffer = this.inputBuffer.slice(1);
        return { quit: true, cycleRenderMode: false, toggleAudio: false };
      }

      // Check for escape sequences
      if (this.inputBuffer[0] === '\x1b') {
        // Ignore Kitty protocol query responses: \x1b[?<flags>u
        const queryResponse = this.inputBuffer.match(/^\x1b\[\?\d*u/);
        if (queryResponse) {
          this.inputBuffer = this.inputBuffer.slice(queryResponse[0].length);
          continue;
        }

        // Try to parse Kitty keyboard protocol
        // Format: CSI keycode ; modifiers:event-type u
        const kittyMatch = this.inputBuffer.match(/^\x1b\[(\d+)(?:;(\d+)(?::(\d+))?)?u/);
        if (kittyMatch) {
          const keycode = parseInt(kittyMatch[1], 10);
          const eventType = kittyMatch[3] ? parseInt(kittyMatch[3], 10) : 1;

          this.handleKittyKey(keycode, eventType);
          this.inputBuffer = this.inputBuffer.slice(kittyMatch[0].length);
          continue;
        }

        // Check for arrow keys in various formats
        const arrowMatch = this.inputBuffer.match(/^\x1b\[(?:1;(\d+)(?::(\d+))?)?([ABCD])/);
        if (arrowMatch) {
          const arrowMap: Record<string, { code: number; button: Button }> = {
            'A': { code: 57352, button: Button.Up },
            'B': { code: 57353, button: Button.Down },
            'C': { code: 57351, button: Button.Right },
            'D': { code: 57350, button: Button.Left },
          };
          const eventType = arrowMatch[2] ? parseInt(arrowMatch[2], 10) : 1;
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
          return { quit: true, cycleRenderMode: false, toggleAudio: false };
        }

        // Unknown escape sequence - wait for more data or skip
        if (this.inputBuffer.length < 10) {
          break;
        }
        this.inputBuffer = this.inputBuffer.slice(1);
        continue;
      }

      // Regular character - key press event
      const char = this.inputBuffer[0];
      const charCode = char.charCodeAt(0);
      this.inputBuffer = this.inputBuffer.slice(1);

      // Check for render mode toggle (R/r key)
      if (charCode === 114 || charCode === 82) { // 'r' or 'R'
        this.cycleRenderModeRequested = true;
        continue;
      }

      // Check for audio toggle (M/m key)
      if (charCode === 109 || charCode === 77) { // 'm' or 'M'
        this.toggleAudioRequested = true;
        continue;
      }

      const button = KITTY_KEY_TO_BUTTON.get(charCode);
      if (button !== undefined) {
        this.handleKeyDown(charCode, button);
      }
    }

    return { quit: false, cycleRenderMode: this.cycleRenderModeRequested, toggleAudio: this.toggleAudioRequested };
  }

  /**
   * Process input in legacy mode (non-Kitty terminals).
   */
  private processLegacyInput(input: string): InputResult {
    // Check for Ctrl+C
    if (input === '\u0003') {
      this.quitRequested = true;
      return { quit: true, cycleRenderMode: false, toggleAudio: false };
    }

    // Check for Escape
    if (input === '\x1b') {
      this.quitRequested = true;
      return { quit: true, cycleRenderMode: false, toggleAudio: false };
    }

    // Try to match arrow keys first
    const arrowMatch = input.match(/^\x1b\[([ABCD])/);
    if (arrowMatch) {
      const button = LEGACY_KEY_TO_BUTTON.get(`\x1b[${arrowMatch[1]}`);
      if (button !== undefined) {
        this.handleLegacyKeyPress(`arrow_${arrowMatch[1]}`, button);
      }
      // Process rest of input if any
      if (input.length > 3) {
        return this.processLegacyInput(input.slice(3));
      }
      return { quit: false, cycleRenderMode: this.cycleRenderModeRequested, toggleAudio: this.toggleAudioRequested };
    }

    // Process each character
    for (const char of input) {
      if (char === '\x1b') {
        // Standalone escape - quit
        this.quitRequested = true;
        return { quit: true, cycleRenderMode: false, toggleAudio: false };
      }

      // Check for render mode toggle (R/r key)
      if (char === 'r' || char === 'R') {
        this.cycleRenderModeRequested = true;
        continue;
      }

      // Check for audio toggle (M/m key)
      if (char === 'm' || char === 'M') {
        this.toggleAudioRequested = true;
        continue;
      }

      const button = LEGACY_KEY_TO_BUTTON.get(char);
      if (button !== undefined) {
        this.handleLegacyKeyPress(char, button);
      }
    }

    return { quit: false, cycleRenderMode: this.cycleRenderModeRequested, toggleAudio: this.toggleAudioRequested };
  }

  /**
   * Handle key press in legacy mode with auto-release timing.
   */
  private handleLegacyKeyPress(key: string, button: Button): void {
    const now = Date.now();

    // Release opposite direction
    const oppositeButton = OPPOSITE_DIRECTIONS.get(button);
    if (oppositeButton !== undefined) {
      this.controller1.setButton(oppositeButton, false);
      // Remove any opposite direction keys from timing map
      for (const [k] of this.legacyKeyTimes.entries()) {
        const kButton = LEGACY_KEY_TO_BUTTON.get(k) ??
          (k.startsWith('arrow_') ? this.getArrowButton(k) : undefined);
        if (kButton === oppositeButton) {
          this.legacyKeyTimes.delete(k);
        }
      }
    }

    // Press the button
    this.controller1.setButton(button, true);
    this.legacyKeyTimes.set(key, now);
  }

  /**
   * Get button for arrow key string.
   */
  private getArrowButton(key: string): Button | undefined {
    const map: Record<string, Button> = {
      'arrow_A': Button.Up,
      'arrow_B': Button.Down,
      'arrow_C': Button.Right,
      'arrow_D': Button.Left,
    };
    return map[key];
  }

  /**
   * Handle Kitty keyboard protocol key event.
   */
  private handleKittyKey(keycode: number, eventType: number): void {
    if (keycode === 27) {
      this.quitRequested = true;
      return;
    }

    // Check for render mode toggle (R/r key) - only on key press, not release
    if ((keycode === 114 || keycode === 82) && (eventType === 1 || eventType === 2)) {
      this.cycleRenderModeRequested = true;
      return;
    }

    // Check for audio toggle (M/m key) - only on key press, not release
    if ((keycode === 109 || keycode === 77) && (eventType === 1 || eventType === 2)) {
      this.toggleAudioRequested = true;
      return;
    }

    let button = KITTY_KEY_TO_BUTTON.get(keycode);
    if (button === undefined) {
      button = KITTY_SPECIAL_KEYS.get(keycode);
    }

    if (button === undefined) {
      return;
    }

    if (eventType === 1 || eventType === 2) {
      this.handleKeyDown(keycode, button);
    } else if (eventType === 3) {
      this.handleKeyUp(keycode, button);
    }
  }

  /**
   * Handle key down event (Kitty mode).
   */
  private handleKeyDown(keycode: number, button: Button): void {
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

    this.controller1.setButton(button, true);
    this.pressedKeys.set(keycode, button);
  }

  /**
   * Handle key up event (Kitty mode).
   */
  private handleKeyUp(keycode: number, button: Button): void {
    if (this.pressedKeys.has(keycode)) {
      this.controller1.setButton(button, false);
      this.pressedKeys.delete(keycode);
    }
  }

  /**
   * Update - called each frame.
   * In legacy mode, auto-releases keys that haven't been re-pressed.
   */
  update(): void {
    if (!this.kittyMode) {
      const now = Date.now();

      // Check for keys that should be auto-released
      for (const [key, pressTime] of this.legacyKeyTimes.entries()) {
        if (now - pressTime > LEGACY_KEY_RELEASE_TIME) {
          const button = LEGACY_KEY_TO_BUTTON.get(key) ??
            (key.startsWith('arrow_') ? this.getArrowButton(key) : undefined);
          if (button !== undefined) {
            this.controller1.setButton(button, false);
          }
          this.legacyKeyTimes.delete(key);
        }
      }
    }
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
    const mode = this.kittyMode ? 'Kitty' : 'Legacy';
    const keys = this.kittyMode ? this.pressedKeys.size : this.legacyKeyTimes.size;
    return `${mode} Keys:${keys}`;
  }

  /**
   * Clear all input state.
   */
  clear(): void {
    for (const button of this.pressedKeys.values()) {
      this.controller1.setButton(button, false);
    }
    this.pressedKeys.clear();

    for (const [key] of this.legacyKeyTimes) {
      const button = LEGACY_KEY_TO_BUTTON.get(key) ??
        (key.startsWith('arrow_') ? this.getArrowButton(key) : undefined);
      if (button !== undefined) {
        this.controller1.setButton(button, false);
      }
    }
    this.legacyKeyTimes.clear();
  }
}
