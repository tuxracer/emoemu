import { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { flatMap } from 'remeda';
import type { RomInfo } from '@/frontend/romScanner';
import type { Config } from '@/frontend/config';
import { resetConfigValue, DEFAULT_CONFIG } from '@/frontend/config';
import { useGamepadContext } from '../../GamepadContext';
import { useKittyGraphicsSupported, useNativeSupported } from '../../AppCapabilities';
import { useConfig } from '../../ConfigContext';
import { useClearTerminal } from '../../hooks/useClearTerminal';
import {
  filterSettingsCategories,
  allSettingsOptions,
  getSettingsActions,
  getOptionLock,
} from '../settingsConfig';

// Confirm reset dialog component
const ConfirmResetDialog = ({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const [selectedIndex, setSelectedIndex] = useState(1); // Default to "No" (cancel)

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.leftArrow || key.rightArrow) {
      setSelectedIndex(prev => prev === 0 ? 1 : 0);
      return;
    }

    if (key.return || input === ' ') {
      if (selectedIndex === 0) {
        onConfirm();
      } else {
        onCancel();
      }
    }
  });

  useGamepadContext({
    onLeft: () => setSelectedIndex(prev => prev === 0 ? 1 : 0),
    onRight: () => setSelectedIndex(prev => prev === 0 ? 1 : 0),
    onConfirm: () => {
      if (selectedIndex === 0) {
        onConfirm();
      } else {
        onCancel();
      }
    },
    onCancel: onCancel,
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">{'\u26A0'} Reset All Settings</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="white">Are you sure you want to reset all settings to their default values?</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">This action cannot be undone.</Text>
      </Box>

      <Box marginTop={1}>
        <Box marginRight={2}>
          <Text
            backgroundColor={selectedIndex === 0 ? 'red' : undefined}
            color={selectedIndex === 0 ? 'white' : 'gray'}
            bold={selectedIndex === 0}
          >
            {' '}Yes, Reset{' '}
          </Text>
        </Box>
        <Box>
          <Text
            backgroundColor={selectedIndex === 1 ? 'green' : undefined}
            color={selectedIndex === 1 ? 'white' : 'gray'}
            bold={selectedIndex === 1}
          >
            {' '}No, Cancel{' '}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {'\u2190\u2192'}: Select  {'\u23CE'}/A: Confirm  ESC/B: Cancel
        </Text>
      </Box>
    </Box>
  );
};

// Settings panel component
export const SettingsPanel = ({
  onClose,
  lastPlayedRom,
  onResumeGame,
}: {
  onClose: () => void;
  lastPlayedRom?: RomInfo;
  onResumeGame?: () => void;
}) => {
  // Get capabilities and config from context
  const kittyGraphicsSupported = useKittyGraphicsSupported();
  const nativeSupported = useNativeSupported();
  const { config, configPath, lockedKeys, lockedFlagByKey } = useConfig();
  const { exit } = useApp();
  const ready = useClearTerminal();
  const settingsActions = useMemo(() => getSettingsActions(!!lastPlayedRom), [lastPlayedRom]);
  const [localConfig, setLocalConfig] = useState<Config>({ ...config });
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Filter categories and options based on post-processing mode and capabilities
  // Individual effect options are only visible when mode is 'custom'
  // Kitty/native window options are hidden if not supported
  const { visibleCategories, visibleOptions } = useMemo(() => {
    const isCustomMode = localConfig.video_postprocessing_mode === 'custom';
    const isNativeMode = localConfig.video_driver === 'native';
    const filtered = filterSettingsCategories(isCustomMode, isNativeMode, kittyGraphicsSupported, nativeSupported);
    return {
      visibleCategories: filtered,
      visibleOptions: flatMap(filtered, cat => cat.options),
    };
  }, [localConfig.video_postprocessing_mode, localConfig.video_driver, kittyGraphicsSupported, nativeSupported]);

  const optionLock = useCallback(
    (optionId: string) => getOptionLock(optionId, lockedKeys, lockedFlagByKey),
    [lockedKeys, lockedFlagByKey],
  );

  // Helper to find index of current value in select options (returns 0 if not found)
  // Uses numeric comparison for float values to handle "1" vs "1.0" mismatch
  const findOptionIndex = (options: Array<{ value: string }>, value: string): number => {
    // First try exact string match
    const exactIndex = options.findIndex(o => o.value === value);
    if (exactIndex >= 0) {return exactIndex;}
    // Fall back to numeric comparison for float values
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      const numIndex = options.findIndex(o => parseFloat(o.value) === numValue);
      if (numIndex >= 0) {return numIndex;}
    }
    return 0;
  };

  const totalSettingsItems = visibleOptions.length + settingsActions.length;
  // Start with first action item selected (Resume Game if from game, Back to Browser if from ROM browser)
  const [selectedIndex, setSelectedIndex] = useState(() => {
    // Initial index at first action item
    const isCustomMode = config.video_postprocessing_mode === 'custom';
    const isNativeMode = config.video_driver === 'native';
    return flatMap(filterSettingsCategories(isCustomMode, isNativeMode, kittyGraphicsSupported, nativeSupported), cat => cat.options).length;
  });

  // Clamp selected index when visible options change (e.g., switching from custom mode)
  useEffect(() => {
    if (selectedIndex >= totalSettingsItems) {
      setSelectedIndex(Math.max(0, totalSettingsItems - 1));
    }
  }, [selectedIndex, totalSettingsItems]);

  // Reset all settings to defaults by commenting them out in the config file
  // This ensures users get updated defaults if they change in future versions
  const handleResetSettings = useCallback(() => {
    // Comment out each setting in the config file so defaults are used
    for (const option of allSettingsOptions) {
      resetConfigValue(option.id as keyof Config, configPath);
    }
    // Update local state with defaults
    setLocalConfig({ ...DEFAULT_CONFIG });
    setShowResetConfirm(false);
  }, [configPath]);

  useInput((input, key) => {
    // Skip input when confirm dialog is shown
    if (showResetConfirm) {return;}

    // CTRL-C exits the app entirely
    if (input === '\x03' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    if (key.escape) {
      // If we came from a game, resume it; otherwise go back to browser
      if (onResumeGame) {
        onResumeGame();
      } else {
        onClose();
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(totalSettingsItems - 1, prev + 1));
      return;
    }

    // Check if we're on an action item
    if (selectedIndex >= visibleOptions.length) {
      const actionIndex = selectedIndex - visibleOptions.length;
      const action = settingsActions[actionIndex];

      if (key.return || input === ' ') {
        if (action.id === 'resume' && onResumeGame) {
          onResumeGame();
        } else if (action.id === 'back') {
          onClose();
        } else if (action.id === 'reset') {
          setShowResetConfirm(true);
        } else if (action.id === 'exit') {
          exit();
        }
        return;
      }
      return;
    }

    const option = visibleOptions[selectedIndex];

    // Locked by a CLI flag: highlightable but inert (Left/Right/Enter/Space do nothing).
    if (optionLock(option.id).locked) {
      return;
    }

    if (option.type === 'toggle') {
      const currentValue = option.getValue(localConfig);
      // Toggle with Enter/Space
      if (key.return || input === ' ') {
        const newConfig = { ...localConfig };
        option.setValue(newConfig, !currentValue, configPath);
        setLocalConfig(newConfig);
        return;
      }
      // Left arrow = OFF (only update if currently ON)
      if (key.leftArrow && currentValue) {
        const newConfig = { ...localConfig };
        option.setValue(newConfig, false, configPath);
        setLocalConfig(newConfig);
        return;
      }
      // Right arrow = ON (only update if currently OFF)
      if (key.rightArrow && !currentValue) {
        const newConfig = { ...localConfig };
        option.setValue(newConfig, true, configPath);
        setLocalConfig(newConfig);
        return;
      }
      if (key.leftArrow || key.rightArrow) {return;}
    }

    if (option.type === 'select') {
      const currentValue = option.getValue(localConfig);
      const currentIndex = findOptionIndex(option.options, currentValue);

      if (key.leftArrow) {
        const newIndex = Math.max(0, currentIndex - 1);
        if (newIndex === currentIndex) {return;}
        const newConfig = { ...localConfig };
        option.setValue(newConfig, option.options[newIndex].value, configPath);
        setLocalConfig(newConfig);
        return;
      }

      if (key.rightArrow) {
        const newIndex = Math.min(option.options.length - 1, currentIndex + 1);
        if (newIndex === currentIndex) {return;}
        const newConfig = { ...localConfig };
        option.setValue(newConfig, option.options[newIndex].value, configPath);
        setLocalConfig(newConfig);
        return;
      }
    }
  });

  // Handle gamepad input (disabled when confirm dialog is shown)
  useGamepadContext({
    onUp: () => setSelectedIndex((prev) => Math.max(0, prev - 1)),
    onDown: () => setSelectedIndex((prev) => Math.min(totalSettingsItems - 1, prev + 1)),
    onLeft: () => {
      // Handle left on settings
      if (selectedIndex >= visibleOptions.length) {return;}
      const option = visibleOptions[selectedIndex];
      if (optionLock(option.id).locked) {return;}
      if (option.type === 'toggle') {
        const currentValue = option.getValue(localConfig);
        if (!currentValue) {return;}
        const newConfig = { ...localConfig };
        option.setValue(newConfig, false, configPath);
        setLocalConfig(newConfig);
      } else {
        // select type
        const currentValue = option.getValue(localConfig);
        const currentIdx = findOptionIndex(option.options, currentValue);
        const newIndex = Math.max(0, currentIdx - 1);
        if (newIndex === currentIdx) {return;}
        const newConfig = { ...localConfig };
        option.setValue(newConfig, option.options[newIndex].value, configPath);
        setLocalConfig(newConfig);
      }
    },
    onRight: () => {
      // Handle right on settings
      if (selectedIndex >= visibleOptions.length) {return;}
      const option = visibleOptions[selectedIndex];
      if (optionLock(option.id).locked) {return;}
      if (option.type === 'toggle') {
        const currentValue = option.getValue(localConfig);
        if (currentValue) {return;}
        const newConfig = { ...localConfig };
        option.setValue(newConfig, true, configPath);
        setLocalConfig(newConfig);
      } else {
        // select type
        const currentValue = option.getValue(localConfig);
        const currentIdx = findOptionIndex(option.options, currentValue);
        const newIndex = Math.min(option.options.length - 1, currentIdx + 1);
        if (newIndex === currentIdx) {return;}
        const newConfig = { ...localConfig };
        option.setValue(newConfig, option.options[newIndex].value, configPath);
        setLocalConfig(newConfig);
      }
    },
    onConfirm: () => {
      // A button: toggle setting or activate action
      if (selectedIndex >= visibleOptions.length) {
        const actionIndex = selectedIndex - visibleOptions.length;
        const action = settingsActions[actionIndex];
        if (action.id === 'resume' && onResumeGame) {
          onResumeGame();
        } else if (action.id === 'back') {
          onClose();
        } else if (action.id === 'reset') {
          setShowResetConfirm(true);
        } else if (action.id === 'exit') {
          exit();
        }
        return;
      }
      const option = visibleOptions[selectedIndex];
      if (optionLock(option.id).locked) {return;}
      if (option.type === 'toggle') {
        const currentValue = option.getValue(localConfig);
        const newConfig = { ...localConfig };
        option.setValue(newConfig, !currentValue, configPath);
        setLocalConfig(newConfig);
      }
    },
    onCancel: () => {
      // B button: if we came from a game, resume it; otherwise go back to browser
      if (onResumeGame) {
        onResumeGame();
      } else {
        onClose();
      }
    },
    onGuide: () => {
      // Guide button: if we came from a game, resume it; otherwise go back to browser
      if (onResumeGame) {
        onResumeGame();
      } else {
        onClose();
      }
    },
  });  // Context handles focus automatically via stack

  // Wait for terminal clear to complete before rendering
  if (!ready) {
    return null;
  }

  // Show confirm dialog if reset is requested
  if (showResetConfirm) {
    return (
      <ConfirmResetDialog
        onConfirm={handleResetSettings}
        onCancel={() => setShowResetConfirm(false)}
      />
    );
  }

  // Compute starting index for each category (O(n) linear algorithm)
  const categoryStartIndices: number[] = [];
  let runningIndex = 0;
  for (const cat of visibleCategories) {
    categoryStartIndices.push(runningIndex);
    runningIndex += cat.options.length;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{'\u2699'} Settings</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {visibleCategories.map((category, catIndex) => {
          const startIndex = categoryStartIndices[catIndex];

          return (
            <Box key={category.name} flexDirection="column">
              <Box marginTop={catIndex > 0 ? 1 : 0}>
                <Text color="magenta" bold>{category.name}</Text>
              </Box>
              {category.options.map((option, optIndex) => {
                const globalIndex = startIndex + optIndex;
                const isSelected = globalIndex === selectedIndex;
                const value = option.getValue(localConfig);
                const lock = optionLock(option.id);

                return (
                  <Box key={option.id} flexDirection="column">
                    <Box>
                      <Text
                        color={lock.locked ? 'gray' : (isSelected ? 'cyan' : 'white')}
                        dimColor={lock.locked}
                        bold={isSelected && !lock.locked}
                      >
                        {isSelected ? '\u25B6 ' : '  '}
                        {option.label}:
                      </Text>
                      <Text> </Text>
                      {option.type === 'toggle' ? (
                        <Text color={lock.locked ? 'gray' : (value ? 'green' : 'red')} dimColor={lock.locked} bold={isSelected && !lock.locked}>
                          {value ? 'ON' : 'OFF'}
                        </Text>
                      ) : (
                        <Box>
                          <Text color="gray">{isSelected && !lock.locked ? '\u25C0 ' : '  '}</Text>
                          <Text color={lock.locked ? 'gray' : 'yellow'} dimColor={lock.locked} bold={isSelected && !lock.locked}>
                            {option.options.find(o => o.value === value)?.label ?? value}
                          </Text>
                          <Text color="gray">{isSelected && !lock.locked ? ' \u25B6' : '  '}</Text>
                        </Box>
                      )}
                      {lock.locked && (
                        <Text color="gray" dimColor>{'  🔒 '}{lock.flag}</Text>
                      )}
                    </Box>
                    {lock.locked && isSelected && (
                      <Text color="gray" dimColor>{'      \u2514 Locked by command-line flag'}</Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          );
        })}

        {/* Action items (Back, Exit) */}
        <Box marginTop={1} flexDirection="column">
          {settingsActions.map((action, actionIndex) => {
            const globalIndex = visibleOptions.length + actionIndex;
            const isSelected = globalIndex === selectedIndex;
            const isExit = action.id === 'exit';
            const color = isSelected ? (isExit ? 'red' : 'cyan') : 'gray';

            return (
              <Box key={action.id}>
                <Text
                  color={color}
                  bold={isSelected}
                >
                  {isSelected ? '\u25B6 ' : '  '}
                  {action.icon} {action.label}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {'\u2191\u2193'}: Navigate  {'\u2190\u2192'}/Space: Change  ESC: Close
        </Text>
      </Box>
      <Box>
        <Text color="gray" dimColor>
          Changes are saved automatically
        </Text>
      </Box>
    </Box>
  );
};
