/**
 * Hook to clear the terminal on mount and trigger a re-render.
 *
 * When a component clears the terminal in useEffect, Ink doesn't know the
 * screen was cleared, so it won't re-render until user input. This hook
 * handles both clearing and forcing a re-render so content displays immediately.
 */

import { useState, useEffect } from 'react';
import { CLEAR_TERMINAL_SEQUENCE } from './consts';

export * from './consts';

/**
 * Clear the terminal on mount and return whether the component is ready to render.
 *
 * @returns true after the terminal has been cleared and re-render triggered
 *
 * @example
 * const MyComponent = () => {
 *   const ready = useClearTerminal();
 *   if (!ready) return null;
 *   return <Box>Content</Box>;
 * };
 */
export const useClearTerminal = (): boolean => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Clear screen, move cursor to home position, and hide cursor
    process.stdout.write(CLEAR_TERMINAL_SEQUENCE);
    // Trigger re-render so Ink draws the component
    setReady(true);
  }, []);

  return ready;
};
