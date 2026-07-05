/**
 * Gamepad Hook for UI Components
 *
 * Provides gamepad navigation support for Ink-based UI components.
 * Handles Up/Down for navigation, A for confirm, B for cancel.
 * Directional inputs support accelerating repeat when held.
 */

import { useEffect, useRef } from 'react';
import { GamepadManager } from '@/input/GamepadManager';
import { StandardButton } from '@/core/button';
import {
  INITIAL_DELAY_MS,
  INITIAL_REPEAT_MS,
  MIN_REPEAT_MS,
  ACCELERATION_TIME_MS,
  EASE_CUBIC_FACTOR,
  EASE_CUBIC_DIVISOR,
} from './consts';

export * from './consts';

export interface GamepadCallbacks {
  onUp?: () => void;
  onDown?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onConfirm?: () => void;  // A button
  onCancel?: () => void;   // B button
  onStart?: () => void;    // Start button (falls back to onConfirm when unset)
}

type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTION_CALLBACKS: Record<Direction, keyof Pick<GamepadCallbacks, 'onUp' | 'onDown' | 'onLeft' | 'onRight'>> = {
  up: 'onUp',
  down: 'onDown',
  left: 'onLeft',
  right: 'onRight',
};

const fireDirectionalCallback = (callbacks: GamepadCallbacks, direction: Direction): void => {
  callbacks[DIRECTION_CALLBACKS[direction]]?.();
};

interface RepeatState {
  direction: Direction;
  startTime: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Hook for gamepad input in UI components.
 * Automatically manages GamepadManager lifecycle.
 * Directional buttons accelerate when held.
 *
 * @param callbacks Object with callback functions for different inputs
 * @param enabled Whether gamepad input is enabled (default: true)
 */
export const useGamepad = (callbacks: GamepadCallbacks, enabled: boolean = true): void => {
  const managerRef = useRef<GamepadManager | null>(null);
  const callbacksRef = useRef(callbacks);
  const repeatStateRef = useRef<RepeatState | null>(null);

  // Keep callbacks ref up to date
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!enabled) {return;}

    // Calculate repeat interval based on how long button has been held
    const getRepeatInterval = (heldDuration: number): number => {
      if (heldDuration < INITIAL_DELAY_MS) {
        return INITIAL_DELAY_MS - heldDuration;
      }

      // Calculate acceleration progress (0 to 1)
      const accelerationProgress = Math.min(
        1,
        (heldDuration - INITIAL_DELAY_MS) / ACCELERATION_TIME_MS
      );

      // Ease-in-out curve for smooth acceleration (smoothstep)
      const easedProgress = accelerationProgress * accelerationProgress * (EASE_CUBIC_FACTOR - EASE_CUBIC_DIVISOR * accelerationProgress);

      // Interpolate between initial and minimum repeat interval
      return INITIAL_REPEAT_MS - (INITIAL_REPEAT_MS - MIN_REPEAT_MS) * easedProgress;
    };

    // Fire callback for direction and schedule next repeat
    const fireAndSchedule = (direction: Direction) => {
      const cb = callbacksRef.current;
      const state = repeatStateRef.current;

      if (!state || state.direction !== direction) {return;}

      // Fire the appropriate callback
      fireDirectionalCallback(cb, direction);

      // Schedule next repeat with accelerated interval
      const heldDuration = Date.now() - state.startTime;
      const interval = getRepeatInterval(heldDuration);

      state.timeoutId = setTimeout(() => fireAndSchedule(direction), interval);
    };

    // Start repeat for a direction
    const startRepeat = (direction: Direction) => {
      // Cancel any existing repeat
      stopRepeat();

      // Fire callback immediately
      fireDirectionalCallback(callbacksRef.current, direction);

      // Start repeat state
      repeatStateRef.current = {
        direction,
        startTime: Date.now(),
        timeoutId: setTimeout(() => fireAndSchedule(direction), INITIAL_DELAY_MS),
      };
    };

    // Stop any active repeat
    const stopRepeat = () => {
      const state = repeatStateRef.current;
      if (state?.timeoutId) {
        clearTimeout(state.timeoutId);
      }
      repeatStateRef.current = null;
    };

    // Map button to direction
    const buttonToDirection = (button: StandardButton): Direction | null => {
      switch (button) {
        case StandardButton.Up:
        case StandardButton.LeftStickUp:
          return 'up';
        case StandardButton.Down:
        case StandardButton.LeftStickDown:
          return 'down';
        case StandardButton.Left:
        case StandardButton.LeftStickLeft:
          return 'left';
        case StandardButton.Right:
        case StandardButton.LeftStickRight:
          return 'right';
        default:
          return null;
      }
    };

    // Create and start the gamepad manager
    const manager = new GamepadManager();
    managerRef.current = manager;

    manager.onButtonChange = (_port, button, pressed) => {
      const cb = callbacksRef.current;
      const direction = buttonToDirection(button);

      if (direction) {
        // Directional buttons with acceleration
        if (pressed) {
          startRepeat(direction);
        } else {
          // Only stop if this is the direction currently being held
          if (repeatStateRef.current?.direction === direction) {
            stopRepeat();
          }
        }
      } else if (pressed) {
        // Non-directional buttons: fire on press only
        switch (button) {
          case StandardButton.A:
            cb.onConfirm?.();
            break;
          case StandardButton.B:
            cb.onCancel?.();
            break;
          case StandardButton.Start:
            // Start mirrors A/confirm (like keyboard Enter) unless a component overrides it
            (cb.onStart ?? cb.onConfirm)?.();
            break;
        }
      }
    };

    manager.start();

    return () => {
      stopRepeat();
      manager.stop();
      managerRef.current = null;
    };
  }, [enabled]);
};
