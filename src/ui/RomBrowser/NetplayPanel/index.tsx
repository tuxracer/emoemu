import { useState, useEffect, useRef } from 'react';
import { clamp } from 'remeda';
import { Box, Text, useInput } from 'ink';
import type { RomInfo } from '@/frontend/romScanner';
import type { NetplayOptions } from '../../App';
import { DEFAULT_PORT as NETPLAY_DEFAULT_PORT } from '@/netplay';
import { DiscoveryListener } from '@/netplay/NetplayDiscovery';
import { useGamepadContext } from '../../GamepadContext';
import { useClearTerminal } from '../../hooks/useClearTerminal';
import type { DiscoveredHost } from '..';
import {
  PORT_MAX,
  DECIMAL_BASE,
  inputDelayOptions,
  DISCOVERY_INITIAL_DELAY_MS,
  DISCOVERY_QUERY_INTERVAL_MS,
  DISCOVERY_HOST_MAX_AGE_MS,
} from './consts';

export * from './consts';

// Netplay panel component
export const NetplayPanel = ({
  rom,
  onStart,
  onCancel,
  initialMode = 'host',
}: {
  rom: RomInfo;
  onStart: (options: NetplayOptions) => void;
  onCancel: () => void;
  initialMode?: 'host' | 'join';
}) => {
  const ready = useClearTerminal();

  // Form state
  const [mode, setMode] = useState<'host' | 'join'>(initialMode);
  const [nickname, setNickname] = useState('Player');
  const [port, setPort] = useState(NETPLAY_DEFAULT_PORT);
  const [hostAddress, setHostAddress] = useState('');
  const [password, setPassword] = useState('');
  const [inputDelay, setInputDelay] = useState(2);
  const [spectate, setSpectate] = useState(false);

  // LAN discovery state (Join mode only)
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([]);
  const [selectedHostIndex, setSelectedHostIndex] = useState(-1); // -1 = manual entry
  const [isScanning, setIsScanning] = useState(false);
  const discoveryRef = useRef<DiscoveryListener | null>(null);

  // UI state
  const [selectedField, setSelectedField] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);

  // LAN discovery effect for Join mode
  useEffect(() => {
    if (mode !== 'join') {
      // Stop discovery when switching to host mode
      if (discoveryRef.current) {
        discoveryRef.current.stop();
        discoveryRef.current = null;
      }
      setDiscoveredHosts([]);
      setSelectedHostIndex(-1);
      setIsScanning(false);
      return;
    }

    // Start discovery listener for Join mode
    const listener = new DiscoveryListener();
    discoveryRef.current = listener;
    setIsScanning(true);

    listener.start((host) => {
      setDiscoveredHosts(prev => {
        // Update or add host
        const existingIndex = prev.findIndex(h => h.address === host.address && h.port === host.port);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = host;
          return updated;
        }
        const newHosts = [...prev, host];
        // Auto-select first discovered host if none selected
        setSelectedHostIndex(currentIdx => {
          if (currentIdx === -1 && newHosts.length === 1) {
            return 0;
          }
          return currentIdx;
        });
        return newHosts;
      });
    });

    // Send initial query
    const initialQueryTimeout = setTimeout(() => {
      listener.sendQuery();
    }, DISCOVERY_INITIAL_DELAY_MS);

    // Periodically send queries and refresh host list
    const queryInterval = setInterval(() => {
      if (listener.isRunning()) {
        listener.sendQuery();
        // Refresh host list from listener (removes stale hosts)
        const freshHosts = listener.getDiscoveredHosts(DISCOVERY_HOST_MAX_AGE_MS);
        setDiscoveredHosts(freshHosts);
        // Adjust selection if current selection is gone
        setSelectedHostIndex(currentIdx => {
          if (currentIdx >= freshHosts.length) {
            return freshHosts.length > 0 ? freshHosts.length - 1 : -1;
          }
          return currentIdx;
        });
      }
    }, DISCOVERY_QUERY_INTERVAL_MS);

    return () => {
      clearTimeout(initialQueryTimeout);
      clearInterval(queryInterval);
      listener.stop();
      discoveryRef.current = null;
      setIsScanning(false);
    };
  }, [mode]);

  // Calculate total fields based on mode
  const getFields = (): string[] => {
    const fields = ['mode', 'nickname'];
    if (mode === 'host') {
      fields.push('port');
    } else {
      // Join mode: show discovered hosts, then manual entry option
      for (let i = 0; i < discoveredHosts.length; i++) {
        fields.push(`host_${i}`);
      }
      fields.push('hostManual'); // Manual entry option
      fields.push('spectate');
    }
    fields.push('password', 'inputDelay', 'start', 'cancel');
    return fields;
  };

  // Get the effective host address based on selection
  const getEffectiveHostAddress = (): string => {
    if (selectedHostIndex >= 0 && selectedHostIndex < discoveredHosts.length) {
      const host = discoveredHosts[selectedHostIndex];
      return `${host.address}:${host.port}`;
    }
    return hostAddress.trim();
  };

  const fields = getFields();
  const totalFields = fields.length;

  // Handle text input for editable fields
  useInput((input, key) => {
    // If editing a text field, handle text input
    if (editingField) {
      if (key.escape || key.return) {
        setEditingField(null);
        return;
      }
      if (key.backspace || key.delete) {
        if (editingField === 'nickname') {
          setNickname(prev => prev.slice(0, -1));
        } else if (editingField === 'hostAddress') {
          setHostAddress(prev => prev.slice(0, -1));
        } else if (editingField === 'password') {
          setPassword(prev => prev.slice(0, -1));
        } else if (editingField === 'port') {
          setPort(prev => Math.floor(prev / DECIMAL_BASE) || 0);
        }
        return;
      }
      // Handle text input
      if (input && !key.ctrl && !key.meta) {
        if (editingField === 'nickname') {
          setNickname(prev => prev + input);
        } else if (editingField === 'hostAddress') {
          setHostAddress(prev => prev + input);
        } else if (editingField === 'password') {
          setPassword(prev => prev + input);
        } else if (editingField === 'port') {
          const num = parseInt(input, DECIMAL_BASE);
          if (!isNaN(num)) {
            setPort(prev => Math.min(PORT_MAX, prev * DECIMAL_BASE + num));
          }
        }
      }
      return;
    }

    // Navigation
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedField(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedField(prev => Math.min(totalFields - 1, prev + 1));
      return;
    }

    const currentField = fields[selectedField];

    // Left/Right for select fields
    if (key.leftArrow || key.rightArrow) {
      const delta = key.rightArrow ? 1 : -1;

      if (currentField === 'mode') {
        setMode(prev => prev === 'host' ? 'join' : 'host');
        // Reset field selection when mode changes to avoid invalid index
        setSelectedField(0);
      } else if (currentField === 'spectate') {
        setSpectate(prev => !prev);
      } else if (currentField === 'inputDelay') {
        const currentIdx = inputDelayOptions.findIndex(o => o.value === inputDelay);
        const newIdx = clamp(currentIdx + delta, { min: 0, max: inputDelayOptions.length - 1 });
        setInputDelay(inputDelayOptions[newIdx].value);
      }
      return;
    }

    // Enter to activate
    if (key.return || input === ' ') {
      if (currentField === 'mode') {
        setMode(prev => prev === 'host' ? 'join' : 'host');
        setSelectedField(0);
      } else if (currentField === 'nickname' || currentField === 'password' || currentField === 'port') {
        setEditingField(currentField);
      } else if (currentField.startsWith('host_')) {
        // Select a discovered host
        const hostIdx = parseInt(currentField.split('_')[1], DECIMAL_BASE);
        setSelectedHostIndex(hostIdx);
      } else if (currentField === 'hostManual') {
        // Switch to manual entry and start editing
        setSelectedHostIndex(-1);
        setEditingField('hostAddress');
      } else if (currentField === 'spectate') {
        setSpectate(prev => !prev);
      } else if (currentField === 'start') {
        // Validate and start
        const effectiveHost = getEffectiveHostAddress();
        if (mode === 'join' && !effectiveHost) {
          // Need host address for join mode
          return;
        }
        onStart({
          mode,
          nickname: nickname.trim() || 'Player',
          port,
          host: mode === 'join' ? effectiveHost : undefined,
          password: password || undefined,
          inputDelay,
          spectate: mode === 'join' ? spectate : undefined,
        });
      } else if (currentField === 'cancel') {
        onCancel();
      }
    }
  });

  // Gamepad support
  useGamepadContext({
    onUp: () => {
      if (!editingField) {
        setSelectedField(prev => Math.max(0, prev - 1));
      }
    },
    onDown: () => {
      if (!editingField) {
        setSelectedField(prev => Math.min(totalFields - 1, prev + 1));
      }
    },
    onLeft: () => {
      if (!editingField) {
        const currentField = fields[selectedField];
        if (currentField === 'mode') {
          setMode(prev => prev === 'host' ? 'join' : 'host');
          setSelectedField(0);
        } else if (currentField === 'spectate') {
          setSpectate(prev => !prev);
        } else if (currentField === 'inputDelay') {
          const currentIdx = inputDelayOptions.findIndex(o => o.value === inputDelay);
          const newIdx = Math.max(0, currentIdx - 1);
          setInputDelay(inputDelayOptions[newIdx].value);
        }
      }
    },
    onRight: () => {
      if (!editingField) {
        const currentField = fields[selectedField];
        if (currentField === 'mode') {
          setMode(prev => prev === 'host' ? 'join' : 'host');
          setSelectedField(0);
        } else if (currentField === 'spectate') {
          setSpectate(prev => !prev);
        } else if (currentField === 'inputDelay') {
          const currentIdx = inputDelayOptions.findIndex(o => o.value === inputDelay);
          const newIdx = Math.min(inputDelayOptions.length - 1, currentIdx + 1);
          setInputDelay(inputDelayOptions[newIdx].value);
        }
      }
    },
    onConfirm: () => {
      if (editingField) {
        setEditingField(null);
        return;
      }
      const currentField = fields[selectedField];
      if (currentField === 'mode') {
        setMode(prev => prev === 'host' ? 'join' : 'host');
        setSelectedField(0);
      } else if (currentField.startsWith('host_')) {
        // Select a discovered host
        const hostIdx = parseInt(currentField.split('_')[1], DECIMAL_BASE);
        setSelectedHostIndex(hostIdx);
      } else if (currentField === 'hostManual') {
        // Switch to manual entry
        setSelectedHostIndex(-1);
      } else if (currentField === 'spectate') {
        setSpectate(prev => !prev);
      } else if (currentField === 'start') {
        const effectiveHost = getEffectiveHostAddress();
        if (mode === 'join' && !effectiveHost) {
          return;
        }
        onStart({
          mode,
          nickname: nickname.trim() || 'Player',
          port,
          host: mode === 'join' ? effectiveHost : undefined,
          password: password || undefined,
          inputDelay,
          spectate: mode === 'join' ? spectate : undefined,
        });
      } else if (currentField === 'cancel') {
        onCancel();
      }
    },
    onCancel: () => {
      if (editingField) {
        setEditingField(null);
      } else {
        onCancel();
      }
    },
  });

  if (!ready) {
    return null;
  }

  const renderField = (fieldId: string, label: string, value: string, isEditing: boolean) => {
    const isSelected = fields[selectedField] === fieldId;
    return (
      <Box key={fieldId}>
        <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
          {isSelected ? '\u25B6 ' : '  '}{label}:
        </Text>
        <Text> </Text>
        <Text color={isEditing ? 'green' : 'yellow'} bold={isSelected}>
          {isEditing ? `${value}\u2588` : value}
        </Text>
        {isSelected && !isEditing && (
          <Text color="gray" dimColor> (Enter to edit)</Text>
        )}
      </Box>
    );
  };

  const renderSelect = (fieldId: string, label: string, value: string, _options: string[]) => {
    const isSelected = fields[selectedField] === fieldId;
    return (
      <Box key={fieldId}>
        <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
          {isSelected ? '\u25B6 ' : '  '}{label}:
        </Text>
        <Text> </Text>
        <Text color="gray">{isSelected ? '\u25C0 ' : '  '}</Text>
        <Text color="yellow" bold={isSelected}>{value}</Text>
        <Text color="gray">{isSelected ? ' \u25B6' : '  '}</Text>
      </Box>
    );
  };

  const renderToggle = (fieldId: string, label: string, value: boolean) => {
    const isSelected = fields[selectedField] === fieldId;
    return (
      <Box key={fieldId}>
        <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
          {isSelected ? '\u25B6 ' : '  '}{label}:
        </Text>
        <Text> </Text>
        <Text color={value ? 'green' : 'red'} bold={isSelected}>
          {value ? 'ON' : 'OFF'}
        </Text>
      </Box>
    );
  };

  const renderButton = (fieldId: string, label: string, color: string = 'cyan') => {
    const isSelected = fields[selectedField] === fieldId;
    return (
      <Box key={fieldId}>
        <Text color={isSelected ? color : 'gray'} bold={isSelected}>
          {isSelected ? '\u25B6 ' : '  '}{label}
        </Text>
      </Box>
    );
  };

  const renderHostOption = (fieldId: string, host: DiscoveredHost, index: number) => {
    const isSelected = fields[selectedField] === fieldId;
    const isChosen = selectedHostIndex === index;
    const radioIcon = isChosen ? '\u25C9' : '\u25CB'; // ◉ or ○
    return (
      <Box key={fieldId}>
        <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
          {isSelected ? '\u25B6 ' : '  '}{radioIcon} {host.nickname}
        </Text>
        <Text color="gray"> ({host.address}:{host.port})</Text>
        {host.contentName && (
          <Text color="gray" dimColor> - {host.contentName}</Text>
        )}
        {host.hasPassword && (
          <Text color="yellow"> {'\u{1F512}'}</Text>
        )}
      </Box>
    );
  };

  const renderManualHostOption = () => {
    const isSelected = fields[selectedField] === 'hostManual';
    const isChosen = selectedHostIndex === -1;
    const radioIcon = isChosen ? '\u25C9' : '\u25CB';
    const isEditing = editingField === 'hostAddress';
    return (
      <Box key="hostManual">
        <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
          {isSelected ? '\u25B6 ' : '  '}{radioIcon} Enter address:
        </Text>
        <Text> </Text>
        <Text color={isEditing ? 'green' : (isChosen ? 'yellow' : 'gray')} bold={isSelected}>
          {isEditing ? `${hostAddress}\u2588` : (hostAddress || '(enter host:port)')}
        </Text>
        {isSelected && !isEditing && (
          <Text color="gray" dimColor> (Enter to edit)</Text>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{'\u{1F310}'} Netplay</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="white">Game: </Text>
        <Text color="yellow">{rom.label || rom.metadata.title || rom.filename.replace(/\.[^.]+$/, '')}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {/* Mode selection */}
        {renderSelect('mode', 'Mode', mode === 'host' ? 'Host Session' : 'Join Session', ['Host Session', 'Join Session'])}

        {/* Common fields */}
        {renderField('nickname', 'Nickname', nickname, editingField === 'nickname')}

        {/* Mode-specific fields */}
        {mode === 'host' ? (
          renderField('port', 'Port', String(port), editingField === 'port')
        ) : (
          <>
            {/* Host selection section */}
            <Box marginTop={1} marginBottom={1} flexDirection="column">
              <Box>
                <Text color="white" bold>Select Host</Text>
                {isScanning && (
                  <Text color="gray" dimColor> (scanning LAN...)</Text>
                )}
              </Box>
              {discoveredHosts.length === 0 && (
                <Box>
                  <Text color="gray" dimColor>  No hosts found on local network</Text>
                </Box>
              )}
              {discoveredHosts.map((host, idx) => renderHostOption(`host_${idx}`, host, idx))}
              {renderManualHostOption()}
            </Box>
            {renderToggle('spectate', 'Spectate Only', spectate)}
          </>
        )}

        {/* Common optional fields */}
        {renderField('password', 'Password', password || '(optional)', editingField === 'password')}
        {renderSelect('inputDelay', 'Input Delay', inputDelayOptions.find(o => o.value === inputDelay)?.label ?? '2', inputDelayOptions.map(o => o.label))}

        {/* Action buttons */}
        <Box marginTop={1} flexDirection="column">
          {renderButton('start', mode === 'host' ? '\u25B6 Start Hosting' : '\u25B6 Connect', 'green')}
          {renderButton('cancel', '\u2717 Cancel', 'red')}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {'\u2191\u2193'}: Navigate  {'\u2190\u2192'}/Space: Change  {'\u23CE'}: {editingField ? 'Done' : 'Edit/Activate'}  ESC: Cancel
        </Text>
      </Box>
    </Box>
  );
};
