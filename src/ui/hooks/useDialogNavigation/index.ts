/**
 * Dialog Navigation Hook
 *
 * Manages selectedIndex state, keyboard (useInput), and gamepad navigation
 * for dialog components with a list of selectable options.
 */

import { useState } from 'react';
import { useInput, useApp } from 'ink';
import { useGamepad } from '../useGamepad';

interface UseDialogNavigationOptions {
  /** Number of selectable items */
  itemCount: number;
  /** Called when the user confirms a selection (Enter, number key, gamepad A) */
  onSelect: (index: number) => void;
  /** Called when the user cancels (ESC, gamepad B) */
  onCancel: () => void;
  /** Enable left/right arrow navigation in addition to up/down */
  horizontal?: boolean;
  /** Accept space bar as confirmation (in addition to Enter) */
  spaceToSelect?: boolean;
  /** Custom CTRL-C handler; if omitted, CTRL-C is not specially handled */
  onCtrlC?: () => void;
}

/**
 * Hook that provides standard dialog navigation: up/down arrows, Enter to select,
 * ESC to cancel, number shortcuts, and gamepad support.
 */
export const useDialogNavigation = ({
  itemCount,
  onSelect,
  onCancel,
  horizontal = false,
  spaceToSelect = false,
  onCtrlC,
}: UseDialogNavigationOptions) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { exit } = useApp();

  const selectAndExit = (index: number) => {
    onSelect(index);
    exit();
  };

  const cancelAndExit = () => {
    onCancel();
    exit();
  };

  useInput((input, key) => {
    // Optional CTRL-C handling
    if (onCtrlC && (input === '\x03' || (key.ctrl && input === 'c'))) {
      onCtrlC();
      exit();
      return;
    }

    if (key.escape) {
      cancelAndExit();
      return;
    }

    if (key.upArrow || (horizontal && key.leftArrow)) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow || (horizontal && key.rightArrow)) {
      setSelectedIndex(prev => Math.min(itemCount - 1, prev + 1));
      return;
    }

    if (key.return || (spaceToSelect && input === ' ')) {
      selectAndExit(selectedIndex);
      return;
    }

    // Number shortcuts (1-based)
    const num = parseInt(input, 10);
    if (num >= 1 && num <= itemCount) {
      selectAndExit(num - 1);
    }
  });

  useGamepad({
    onUp: () => setSelectedIndex(prev => Math.max(0, prev - 1)),
    onDown: () => setSelectedIndex(prev => Math.min(itemCount - 1, prev + 1)),
    ...(horizontal && {
      onLeft: () => setSelectedIndex(prev => Math.max(0, prev - 1)),
      onRight: () => setSelectedIndex(prev => Math.min(itemCount - 1, prev + 1)),
    }),
    onConfirm: () => selectAndExit(selectedIndex),
    onCancel: cancelAndExit,
  });

  return { selectedIndex, setSelectedIndex };
};
