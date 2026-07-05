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

import { pipe, map, filter, isNonNull } from 'remeda';
import type { ButtonDefinition } from '../../core/core';
import {
  StandardButton,
  DEFAULT_KEYBOARD_MAP,
  areOppositeDirections,
} from '../../core/button';
import { logger } from '../../utils/logger';

export * from './consts';

import { BUTTON_NAME_MAP, ANALOG_INDEX, ANALOG_AXIS } from './consts';

/**
 * Callback type for button state changes
 */
export type ButtonChangeCallback = (
  port: number,
  button: number,
  pressed: boolean
) => void;

/**
 * Callback type for analog axis changes
 * @param port Controller port (0-based)
 * @param index Analog stick (0=left, 1=right)
 * @param axis Axis (0=X, 1=Y)
 * @param value Normalized value from -1.0 to 1.0
 */
export type AnalogChangeCallback = (
  port: number,
  index: number,
  axis: number,
  value: number
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

  /** Analog axis state per port: port -> index -> axis -> value */
  private analogState: Map<number, Map<number, Map<number, number>>>;

  /** Callback when button state changes */
  public onButtonChange: ButtonChangeCallback | null = null;

  /** Callback when analog axis state changes */
  public onAnalogChange: AnalogChangeCallback | null = null;

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
    this.analogState = new Map();
    for (let port = 0; port < maxPlayers; port++) {
      this.portState.set(port, new Map());
      this.analogState.set(port, new Map());
    }

    // Build mapping from StandardButton to core button IDs by name matching
    this.standardToCore = this.buildDefaultMapping();
  }

  /**
   * Build default mapping from StandardButton to core buttons by matching names.
   * This allows automatic mapping without explicit configuration.
   */
  private buildDefaultMapping(): Map<StandardButton, number> {
    return new Map(
      pipe(
        this.coreButtons,
        map((button) => {
          const name = button.name.toLowerCase();
          const match = BUTTON_NAME_MAP.find((m) => m.names.includes(name));
          return match ? ([match.button, button.id] as const) : null;
        }),
        filter(isNonNull)
      )
    );
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
    if (standardButton === undefined) {return;}

    this.handleStandardButton(standardButton, pressed, port);
  }

  /** D-pad to analog axis mapping for keyboard-to-analog conversion */
  private static readonly DIRECTION_TO_ANALOG: ReadonlyMap<
    StandardButton,
    { axis: number; value: number }
  > = new Map([
    // Left stick: index=0, axis=0 (X), axis=1 (Y)
    // X: negative = left, positive = right
    // Y: negative = up, positive = down
    [StandardButton.Up, { axis: ANALOG_AXIS.Y, value: -1 }],
    [StandardButton.Down, { axis: ANALOG_AXIS.Y, value: 1 }],
    [StandardButton.Left, { axis: ANALOG_AXIS.X, value: -1 }],
    [StandardButton.Right, { axis: ANALOG_AXIS.X, value: 1 }],
  ]);

  /** Track keyboard-driven analog state to handle opposite directions */
  private keyboardAnalogState: Map<number, Map<number, number>> = new Map();

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
    if (coreButton === undefined) {return;}

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

    // Also send analog input for direction buttons (for systems like N64)
    this.handleDirectionAsAnalog(standardButton, pressed, port);
  }

  /**
   * Convert direction button to analog stick input.
   * This allows keyboard arrows to control analog sticks (useful for N64).
   */
  private handleDirectionAsAnalog(
    standardButton: StandardButton,
    pressed: boolean,
    port: number
  ): void {
    const analogMapping = InputMapper.DIRECTION_TO_ANALOG.get(standardButton);
    if (!analogMapping) {return;}

    // Initialize keyboard analog tracking for this port if needed
    if (!this.keyboardAnalogState.has(port)) {
      this.keyboardAnalogState.set(port, new Map([[ANALOG_AXIS.X, 0], [ANALOG_AXIS.Y, 0]]));
    }
    const portAnalog = this.keyboardAnalogState.get(port)!;

    // Calculate new axis value
    const currentValue = portAnalog.get(analogMapping.axis) ?? 0;
    let newValue: number;

    if (pressed) {
      // Set axis to direction value
      newValue = analogMapping.value;
    } else {
      // On release, check if opposite direction is still held
      // If so, revert to that direction; otherwise, center the axis
      const oppositeButton = this.getOppositeDirection(standardButton);
      const oppositeHeld = oppositeButton !== undefined &&
        this.portState.get(port)?.get(this.standardToCore.get(oppositeButton)!) === true;

      if (oppositeHeld) {
        // Opposite direction is held, set to its value
        const oppositeMapping = InputMapper.DIRECTION_TO_ANALOG.get(oppositeButton);
        newValue = oppositeMapping?.value ?? 0;
      } else {
        // No direction held, center the axis
        newValue = 0;
      }
    }

    // Update tracking and fire callback if value changed
    if (newValue !== currentValue) {
      portAnalog.set(analogMapping.axis, newValue);
      // Debug: Log keyboard-to-analog conversion
      logger.debug(`Keyboard analog: button=${StandardButton[standardButton]} axis=${analogMapping.axis} value=${newValue}`, 'Input');
      this.onAnalogChange?.(port, ANALOG_INDEX.LEFT, analogMapping.axis, newValue);
    }
  }

  /**
   * Get the opposite direction button for a given direction.
   */
  private getOppositeDirection(button: StandardButton): StandardButton | undefined {
    switch (button) {
      case StandardButton.Up: return StandardButton.Down;
      case StandardButton.Down: return StandardButton.Up;
      case StandardButton.Left: return StandardButton.Right;
      case StandardButton.Right: return StandardButton.Left;
      default: return undefined;
    }
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
   * Handle analog stick axis input.
   *
   * @param index Analog stick (0=left, 1=right from ANALOG_INDEX)
   * @param axis Axis (0=X, 1=Y from ANALOG_AXIS)
   * @param value Normalized value from -1.0 to 1.0
   * @param port Controller port (default 0)
   */
  handleAnalogAxis(
    index: number,
    axis: number,
    value: number,
    port: number = 0
  ): void {
    const portState = this.analogState.get(port);
    if (!portState) {return;}

    // Initialize stick state if needed
    if (!portState.has(index)) {
      portState.set(index, new Map([[ANALOG_AXIS.X, 0], [ANALOG_AXIS.Y, 0]]));
    }

    const stickState = portState.get(index);
    if (!stickState) {return;}

    // Only update if value changed significantly (avoid noise)
    const oldValue = stickState.get(axis) ?? 0;
    const DEADZONE = 0.01; // 1% deadzone for noise filtering
    if (Math.abs(value - oldValue) > DEADZONE) {
      stickState.set(axis, value);
      this.onAnalogChange?.(port, index, axis, value);
    }
  }

  /**
   * Get the analog state for a port.
   *
   * @param port Controller port
   * @returns Map of index -> axis -> value
   */
  getAnalogState(port: number): Map<number, Map<number, number>> {
    return new Map(
      Array.from(this.analogState.get(port) ?? []).map(([index, axes]) => [
        index,
        new Map(axes),
      ])
    );
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
    if (!portState) {return;}

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
   * @returns Space-separated button names (with arrow characters for D-pad)
   */
  getPressedButtons(port: number = 0): string {
    const portState = this.portState.get(port);
    if (!portState) {return '';}

    // Map direction names to Unicode arrows
    const formatButtonName = (name: string): string => {
      switch (name.toLowerCase()) {
        case 'up': return '↑';
        case 'down': return '↓';
        case 'left': return '←';
        case 'right': return '→';
        default: return name;
      }
    };

    return pipe(
      this.coreButtons,
      filter((button) => portState.get(button.id) === true),
      map((button) => formatButtonName(button.name))
    ).join(' ');
  }

  /**
   * Clear all button and analog states (e.g., when losing focus).
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

    // Clear analog states
    for (const portAnalog of this.analogState.values()) {
      for (const stickState of portAnalog.values()) {
        stickState.set(ANALOG_AXIS.X, 0);
        stickState.set(ANALOG_AXIS.Y, 0);
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
