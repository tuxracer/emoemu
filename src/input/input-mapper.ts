/**
 * Input Mapper
 *
 * Translates physical inputs (keyboard keys, gamepad buttons) to core-specific
 * button IDs. This allows the same physical controls to work across different
 * emulated systems.
 *
 * Flow:
 * 1. Frontend receives keyboard/gamepad input
 * 2. Input is translated to StandardButton enum
 * 3. StandardButton is mapped to core-specific button ID via button name matching
 * 4. Core receives setButtonState(port, coreButtonId, pressed)
 */

import type { ButtonDefinition } from '../core/core.js';
import {
  StandardButton,
  DEFAULT_KEYBOARD_MAP,
  areOppositeDirections,
} from '../core/button.js';

/**
 * Callback type for button state changes
 */
export type ButtonChangeCallback = (
  port: number,
  button: number,
  pressed: boolean
) => void;

/**
 * Maps physical inputs to core-specific buttons
 */
export class InputMapper {
  /** Core's button definitions */
  private coreButtons: ButtonDefinition[];

  /** Map from StandardButton to core button ID */
  private standardToCore: Map<StandardButton, number>;

  /** Map from keyboard key to StandardButton */
  private keyboardMap: Map<string, StandardButton>;

  /** Current button state per port: port -> (coreButtonId -> pressed) */
  private portState: Map<number, Map<number, boolean>>;

  /** Callback when button state changes */
  public onButtonChange: ButtonChangeCallback | null = null;

  /**
   * Create an input mapper for a specific core's buttons.
   *
   * @param coreButtons Button definitions from SystemInfo.buttons
   * @param maxPlayers Maximum number of controller ports
   */
  constructor(coreButtons: ButtonDefinition[], maxPlayers: number = 2) {
    this.coreButtons = coreButtons;
    this.keyboardMap = new Map(DEFAULT_KEYBOARD_MAP);

    // Initialize port state
    this.portState = new Map();
    for (let port = 0; port < maxPlayers; port++) {
      this.portState.set(port, new Map());
    }

    // Build mapping from StandardButton to core button IDs by name matching
    this.standardToCore = this.buildDefaultMapping();
  }

  /**
   * Build default mapping from StandardButton to core buttons by matching names.
   * This allows automatic mapping without explicit configuration.
   */
  private buildDefaultMapping(): Map<StandardButton, number> {
    const mapping = new Map<StandardButton, number>();

    for (const button of this.coreButtons) {
      const name = button.name.toLowerCase();

      // Match by common button names
      if (name === 'a') {
        mapping.set(StandardButton.A, button.id);
      } else if (name === 'b') {
        mapping.set(StandardButton.B, button.id);
      } else if (name === 'x') {
        mapping.set(StandardButton.X, button.id);
      } else if (name === 'y') {
        mapping.set(StandardButton.Y, button.id);
      } else if (name === 'l' || name === 'l1' || name === 'lb') {
        mapping.set(StandardButton.L, button.id);
      } else if (name === 'r' || name === 'r1' || name === 'rb') {
        mapping.set(StandardButton.R, button.id);
      } else if (name === 'l2' || name === 'lt') {
        mapping.set(StandardButton.L2, button.id);
      } else if (name === 'r2' || name === 'rt') {
        mapping.set(StandardButton.R2, button.id);
      } else if (name === 'start') {
        mapping.set(StandardButton.Start, button.id);
      } else if (name === 'select' || name === 'back') {
        mapping.set(StandardButton.Select, button.id);
      } else if (name === 'up') {
        mapping.set(StandardButton.Up, button.id);
      } else if (name === 'down') {
        mapping.set(StandardButton.Down, button.id);
      } else if (name === 'left') {
        mapping.set(StandardButton.Left, button.id);
      } else if (name === 'right') {
        mapping.set(StandardButton.Right, button.id);
      }
    }

    return mapping;
  }

  /**
   * Handle a keyboard key event.
   *
   * @param key The key that was pressed/released (e.g., 'a', 'Enter', 'ArrowUp')
   * @param pressed Whether the key is pressed (true) or released (false)
   * @param port Controller port (default 0)
   */
  handleKey(key: string, pressed: boolean, port: number = 0): void {
    const standardButton = this.keyboardMap.get(key);
    if (standardButton === undefined) return;

    this.handleStandardButton(standardButton, pressed, port);
  }

  /**
   * Handle a standard button event (from keyboard or gamepad).
   *
   * @param standardButton The standard button
   * @param pressed Whether pressed or released
   * @param port Controller port
   */
  handleStandardButton(
    standardButton: StandardButton,
    pressed: boolean,
    port: number = 0
  ): void {
    const coreButton = this.standardToCore.get(standardButton);
    if (coreButton === undefined) return;

    // Handle opposite direction prevention for D-pad
    if (pressed) {
      const portState = this.portState.get(port);
      if (portState) {
        // Check if opposite direction is pressed
        for (const [otherStandard, otherCore] of this.standardToCore) {
          if (
            areOppositeDirections(standardButton, otherStandard) &&
            portState.get(otherCore)
          ) {
            // Release opposite direction first
            this.setButton(port, otherCore, false);
          }
        }
      }
    }

    this.setButton(port, coreButton, pressed);
  }

  /**
   * Handle gamepad button by index (from HID report).
   * This maps the gamepad button index to a StandardButton.
   *
   * @param gamepadButton Gamepad button index (system-specific)
   * @param pressed Whether pressed or released
   * @param port Controller port
   */
  handleGamepadButton(
    gamepadButton: StandardButton,
    pressed: boolean,
    port: number = 0
  ): void {
    this.handleStandardButton(gamepadButton, pressed, port);
  }

  /**
   * Set a core button state directly.
   *
   * @param port Controller port
   * @param coreButton Core-specific button ID
   * @param pressed Whether pressed or released
   */
  private setButton(port: number, coreButton: number, pressed: boolean): void {
    const portState = this.portState.get(port);
    if (!portState) return;

    const wasPressed = portState.get(coreButton) ?? false;
    if (pressed !== wasPressed) {
      portState.set(coreButton, pressed);
      this.onButtonChange?.(port, coreButton, pressed);
    }
  }

  /**
   * Get the current button state for a port.
   *
   * @param port Controller port
   * @returns Map of core button ID to pressed state
   */
  getButtonState(port: number): Map<number, boolean> {
    return new Map(this.portState.get(port) ?? []);
  }

  /**
   * Get pressed buttons as a display string.
   *
   * @param port Controller port
   * @returns Space-separated button names
   */
  getPressedButtons(port: number = 0): string {
    const portState = this.portState.get(port);
    if (!portState) return '';

    const pressed: string[] = [];
    for (const button of this.coreButtons) {
      if (portState.get(button.id)) {
        pressed.push(button.name);
      }
    }

    return pressed.join(' ');
  }

  /**
   * Clear all button states (e.g., when losing focus).
   */
  clear(): void {
    for (const portState of this.portState.values()) {
      for (const [button, pressed] of portState) {
        if (pressed) {
          portState.set(button, false);
          // Note: We don't call onButtonChange here to avoid spamming
          // the core during focus loss. The core should handle this gracefully.
        }
      }
    }
  }

  /**
   * Set a custom keyboard mapping.
   *
   * @param key Keyboard key
   * @param standardButton StandardButton to map to, or undefined to remove
   */
  setKeyMapping(key: string, standardButton: StandardButton | undefined): void {
    if (standardButton === undefined) {
      this.keyboardMap.delete(key);
    } else {
      this.keyboardMap.set(key, standardButton);
    }
  }

  /**
   * Get the keyboard mapping.
   *
   * @returns Copy of the keyboard map
   */
  getKeyboardMap(): Map<string, StandardButton> {
    return new Map(this.keyboardMap);
  }

  /**
   * Check if a standard button is mapped to a core button.
   *
   * @param standardButton The standard button to check
   * @returns true if mapped
   */
  isButtonMapped(standardButton: StandardButton): boolean {
    return this.standardToCore.has(standardButton);
  }

  /**
   * Get the core button ID for a standard button.
   *
   * @param standardButton The standard button
   * @returns Core button ID or undefined if not mapped
   */
  getCoreButton(standardButton: StandardButton): number | undefined {
    return this.standardToCore.get(standardButton);
  }
}
