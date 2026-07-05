/**
 * Gamepad Context for Shared Input Management
 *
 * Provides a single GamepadManager instance shared across all UI components.
 * Uses a focus stack to determine which component receives input - the most
 * recently mounted component with gamepad handlers takes priority.
 */

import { createContext, useContext, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { GamepadManager } from '../../input/GamepadManager';
import { StandardButton } from '../../core/button';
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
  onGuide?: () => void;    // Guide/Xbox/Home button
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

interface GamepadContextValue {
  register: (id: string, callbacks: GamepadCallbacks) => void;
  unregister: (id: string) => void;
}

const GamepadContext = createContext<GamepadContextValue | null>(null);

// Counter for generating unique IDs
let idCounter = 0;
const generateId = (): string => `gamepad-handler-${++idCounter}`;

interface GamepadProviderProps {
  children: ReactNode;
  enabled?: boolean;
}

/**
 * GamepadProvider - Wraps the app to provide shared gamepad input
 *
 * Maintains a stack of registered handlers. The most recently registered
 * handler (top of stack) receives all input events.
 */
export const GamepadProvider = ({ children, enabled = true }: GamepadProviderProps) => {
  const managerRef = useRef<GamepadManager | null>(null);
  const handlersRef = useRef<Map<string, GamepadCallbacks>>(new Map());
  const stackRef = useRef<string[]>([]);
  const repeatStateRef = useRef<RepeatState | null>(null);

  // Get the currently active callbacks (top of stack)
  const getActiveCallbacks = useCallback((): GamepadCallbacks | null => {
    const stack = stackRef.current;
    if (stack.length === 0) {return null;}
    const activeId = stack[stack.length - 1];
    return handlersRef.current.get(activeId) ?? null;
  }, []);

  // Calculate repeat interval based on hold duration
  const getRepeatInterval = useCallback((heldDuration: number): number => {
    if (heldDuration < INITIAL_DELAY_MS) {
      return INITIAL_DELAY_MS - heldDuration;
    }
    const accelerationProgress = Math.min(
      1,
      (heldDuration - INITIAL_DELAY_MS) / ACCELERATION_TIME_MS
    );
    const easedProgress = accelerationProgress * accelerationProgress *
      (EASE_CUBIC_FACTOR - EASE_CUBIC_DIVISOR * accelerationProgress);
    return INITIAL_REPEAT_MS - (INITIAL_REPEAT_MS - MIN_REPEAT_MS) * easedProgress;
  }, []);

  // Fire callback for direction and schedule next repeat
  const fireAndSchedule = useCallback((direction: Direction) => {
    const state = repeatStateRef.current;
    if (!state || state.direction !== direction) {return;}

    const cb = getActiveCallbacks();
    if (cb) {
      fireDirectionalCallback(cb, direction);
    }

    const heldDuration = Date.now() - state.startTime;
    const interval = getRepeatInterval(heldDuration);
    state.timeoutId = setTimeout(() => fireAndSchedule(direction), interval);
  }, [getActiveCallbacks, getRepeatInterval]);

  // Start repeat for a direction
  const startRepeat = useCallback((direction: Direction) => {
    // Cancel any existing repeat
    const state = repeatStateRef.current;
    if (state?.timeoutId) {
      clearTimeout(state.timeoutId);
    }

    // Fire callback immediately
    const cb = getActiveCallbacks();
    if (cb) {
      fireDirectionalCallback(cb, direction);
    }

    // Start repeat state
    repeatStateRef.current = {
      direction,
      startTime: Date.now(),
      timeoutId: setTimeout(() => fireAndSchedule(direction), INITIAL_DELAY_MS),
    };
  }, [getActiveCallbacks, fireAndSchedule]);

  // Stop any active repeat
  const stopRepeat = useCallback(() => {
    const state = repeatStateRef.current;
    if (state?.timeoutId) {
      clearTimeout(state.timeoutId);
    }
    repeatStateRef.current = null;
  }, []);

  // Map button to direction
  const buttonToDirection = useCallback((button: StandardButton): Direction | null => {
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
  }, []);

  // Initialize GamepadManager
  useEffect(() => {
    if (!enabled) {return;}

    const manager = new GamepadManager();
    managerRef.current = manager;

    manager.onButtonChange = (_port, button, pressed) => {
      const direction = buttonToDirection(button);

      if (direction) {
        if (pressed) {
          startRepeat(direction);
        } else if (repeatStateRef.current?.direction === direction) {
          stopRepeat();
        }
      } else if (pressed) {
        const cb = getActiveCallbacks();
        if (cb) {
          switch (button) {
            case StandardButton.A:
              cb.onConfirm?.();
              break;
            case StandardButton.B:
              cb.onCancel?.();
              break;
            case StandardButton.Start:
              cb.onStart?.();
              break;
            case StandardButton.Guide:
              cb.onGuide?.();
              break;
          }
        }
      }
    };

    manager.start();

    return () => {
      stopRepeat();
      manager.stop();
      managerRef.current = null;
    };
  }, [enabled, buttonToDirection, startRepeat, stopRepeat, getActiveCallbacks]);

  // Register a new handler (pushes to top of stack)
  const register = useCallback((id: string, callbacks: GamepadCallbacks) => {
    handlersRef.current.set(id, callbacks);
    // Remove from stack if already present, then add to top
    stackRef.current = stackRef.current.filter(i => i !== id);
    stackRef.current.push(id);
  }, []);

  // Unregister a handler (removes from stack)
  const unregister = useCallback((id: string) => {
    handlersRef.current.delete(id);
    stackRef.current = stackRef.current.filter(i => i !== id);
    // Stop repeat if the active handler was removed
    stopRepeat();
  }, [stopRepeat]);

  // Memoize context value to prevent unnecessary effect re-runs in consumers
  const contextValue = useMemo<GamepadContextValue>(() => ({
    register,
    unregister,
  }), [register, unregister]);

  return (
    <GamepadContext.Provider value={contextValue}>
      {children}
    </GamepadContext.Provider>
  );
};

/**
 * useGamepadContext - Hook for components to receive gamepad input
 *
 * Automatically registers on mount and unregisters on unmount.
 * The most recently mounted component receives input (focus stack).
 *
 * @param callbacks Object with callback functions for different inputs
 * @param enabled Whether this handler should be active (default: true)
 */
export const useGamepadContext = (callbacks: GamepadCallbacks, enabled: boolean = true): void => {
  const context = useContext(GamepadContext);
  const idRef = useRef<string>(generateId());
  const callbacksRef = useRef(callbacks);

  // Keep callbacks ref up to date
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!context || !enabled) {return;}

    const id = idRef.current;

    // Create a wrapper that always calls the latest callbacks
    const wrappedCallbacks: GamepadCallbacks = {
      onUp: () => callbacksRef.current.onUp?.(),
      onDown: () => callbacksRef.current.onDown?.(),
      onLeft: () => callbacksRef.current.onLeft?.(),
      onRight: () => callbacksRef.current.onRight?.(),
      onConfirm: () => callbacksRef.current.onConfirm?.(),
      onCancel: () => callbacksRef.current.onCancel?.(),
      // Start mirrors A/confirm (like keyboard Enter) unless a component overrides it
      onStart: () => (callbacksRef.current.onStart ?? callbacksRef.current.onConfirm)?.(),
      onGuide: () => callbacksRef.current.onGuide?.(),
    };

    context.register(id, wrappedCallbacks);

    return () => {
      context.unregister(id);
    };
  }, [context, enabled]);
};

/**
 * Note on usage:
 *
 * - Components rendered within the main App tree (RomBrowser, SettingsPanel,
 *   ConfirmResetDialog, DirectoryInput) should use useGamepadContext.
 *
 * - Standalone dialogs that create their own Ink render() call (CoreSelector,
 *   SaveStateDialog, CorruptedStateDialog) should continue using the original
 *   useGamepad hook from useGamepad.ts, as they're outside the context tree.
 */
