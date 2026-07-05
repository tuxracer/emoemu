/**
 * Core Selector UI Component
 *
 * A dialog for selecting which emulator core to use when multiple cores
 * support the same ROM format.
 */

import { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import type { CoreFactory } from '../../frontend/coreRegistry';
import { useGamepad } from '../hooks/useGamepad';
import { cleanupInkInstance } from '../../utils/terminal';
import { renderDialog, type DialogRenderOptions } from '../NativeDialog';
import {
  DEFAULT_TERM_WIDTH,
  DEFAULT_TERM_HEIGHT,
  DIALOG_BOX_PADDING,
} from '..';
import { CORE_SELECTOR_MIN_WIDTH } from './consts';

export * from './consts';

interface CoreOption {
  id: string;
  factory: CoreFactory;
}

export interface CoreSelection {
  id: string;
  factory: CoreFactory;
  remember: boolean;
}

interface CoreSelectorProps {
  cores: CoreOption[];
  romName: string;
  onSelect: (selection: CoreSelection) => void;
  onCancel: () => void;
}

const CoreSelector = ({ cores, romName, onSelect, onCancel }: CoreSelectorProps) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rememberSelection, setRememberSelection] = useState(false);

  // Force re-render on mount to trigger Ink's terminal setup before user interaction
  const [, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      exit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(cores.length - 1, prev + 1));
      return;
    }

    // Tab or 'r' to toggle remember checkbox
    if (key.tab || input === 'r') {
      setRememberSelection(prev => !prev);
      return;
    }

    if (key.return) {
      const selected = cores[selectedIndex];
      onSelect({ id: selected.id, factory: selected.factory, remember: rememberSelection });
      exit();
      return;
    }

    // Number keys for quick selection
    const num = parseInt(input, 10);
    if (num >= 1 && num <= cores.length) {
      const selected = cores[num - 1];
      onSelect({ id: selected.id, factory: selected.factory, remember: rememberSelection });
      exit();
    }
  });

  // Handle gamepad input
  useGamepad({
    onUp: () => setSelectedIndex(prev => Math.max(0, prev - 1)),
    onDown: () => setSelectedIndex(prev => Math.min(cores.length - 1, prev + 1)),
    onConfirm: () => {
      const selected = cores[selectedIndex];
      onSelect({ id: selected.id, factory: selected.factory, remember: rememberSelection });
      exit();
    },
    onCancel: () => {
      onCancel();
      exit();
    },
  });

  // Get terminal dimensions for full-screen layout - use Ink's stdout for native mode compatibility
  const termWidth = stdout.columns || DEFAULT_TERM_WIDTH;
  const termHeight = stdout.rows || DEFAULT_TERM_HEIGHT;
  const boxWidth = Math.min(CORE_SELECTOR_MIN_WIDTH, termWidth - DIALOG_BOX_PADDING);

  return (
    <Box
      flexDirection="column"
      width={termWidth}
      height={termHeight}
      alignItems="center"
      justifyContent="center"
    >
      {/* Header */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        width={boxWidth}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="cyan">{'\u{1F3AE}'} Select Emulator Core</Text>
        </Box>

        <Box>
          <Text color="gray">Multiple cores can play </Text>
          <Text color="white" bold>{romName}</Text>
        </Box>
      </Box>

      {/* Core Options */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={2}
        paddingY={1}
        marginTop={1}
        width={boxWidth}
      >
        {cores.map((core, index) => {
          const info = core.factory.getSystemInfo();
          const isSelected = index === selectedIndex;
          const corePath = core.factory.path ?? 'native';
          const isNative = corePath === 'native';

          return (
            <Box key={core.id} marginBottom={index < cores.length - 1 ? 1 : 0}>
              <Text
                color={isSelected ? 'green' : 'gray'}
                bold={isSelected}
              >
                {isSelected ? '\u25B6 ' : '  '}
                {index + 1}. {info.name}
              </Text>
              {isNative && (
                <Text color="green"> [native]</Text>
              )}
              {!isNative && (
                <Text color="gray" dimColor> (libretro)</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Remember Selection */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={2}
        paddingY={1}
        marginTop={1}
        width={boxWidth}
      >
        <Box>
          <Text
            color={rememberSelection ? 'green' : 'gray'}
          >
            {rememberSelection ? '\u2611' : '\u2610'} Remember this selection
          </Text>
          <Text color="gray" dimColor>  (Tab to toggle)</Text>
        </Box>
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {'\u2191\u2193'} Navigate  {'\u23CE'} Select  1-{cores.length} Quick select  ESC Cancel
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Launch the core selector dialog
 *
 * @param cores Array of matching cores
 * @param romName Name of the ROM file for display
 * @param options Optional dialog render options (e.g., nativeMode)
 * @returns Promise that resolves to the CoreSelection, or null if cancelled
 */
export const selectCore = async (
  cores: CoreOption[],
  romName: string,
  options: DialogRenderOptions = {}
): Promise<CoreSelection | null> => new Promise((resolve) => {
    let selection: CoreSelection | null = null;

    const handleSelect = (sel: CoreSelection) => {
      selection = sel;
    };

    const handleCancel = () => {
      selection = null;
    };

    // Enter alternate screen buffer and clear (only in terminal mode)
    if (!options.nativeMode) {
      process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
    }

    void renderDialog(
      <CoreSelector
        cores={cores}
        romName={romName}
        onSelect={handleSelect}
        onCancel={handleCancel}
      />,
      { ...options, title: options.title ?? 'emoemu - Select Core' }
    ).then(({ instance, cleanup }) => {
      void instance.waitUntilExit().then(() => {
        cleanup();
        cleanupInkInstance(instance, resolve, selection, {
          exitAlternateScreen: !options.nativeMode,
        });
      });
    });
  });

export default CoreSelector;
