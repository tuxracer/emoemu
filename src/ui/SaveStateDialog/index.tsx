/**
 * Save State Dialog Component
 *
 * Shows save state metadata and asks the user how to proceed.
 */

import { Box, Text } from 'ink';
import { DialogOptionsList } from '../DialogOptionsList';
import { DialogContainer } from '../DialogContainer';
import { useDialogNavigation } from '../hooks/useDialogNavigation';
import { launchDialog, type DialogRenderOptions } from '../NativeDialog';
import { SEPARATOR_LINE_PADDING } from '..';
import { CORRUPTED_DIALOG_MIN_WIDTH } from './consts';

export * from './consts';

export interface SaveStateInfo {
  path: string;
  romName: string;
  coreName: string;
}

export type SaveStateChoice = 'resume' | 'delete' | 'cancel';

interface SaveStateDialogProps {
  info: SaveStateInfo;
  onChoice: (choice: SaveStateChoice) => void;
}

const SaveStateDialog = ({ info, onChoice }: SaveStateDialogProps) => {
  const options: { label: string; choice: SaveStateChoice; color: string }[] = [
    { label: 'Resume from Save State', choice: 'resume', color: 'green' },
    { label: 'Delete Save & Start Fresh', choice: 'delete', color: 'red' },
    { label: 'Cancel', choice: 'cancel', color: 'gray' },
  ];

  const { selectedIndex } = useDialogNavigation({
    itemCount: options.length,
    onSelect: (index) => onChoice(options[index].choice),
    onCancel: () => onChoice('cancel'),
  });

  return (
    <DialogContainer>
      {(boxWidth) => (
        <>
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
              <Text bold color="cyan">{'\u{1F4BE}'} Save State Found</Text>
            </Box>

            {/* ROM Name */}
            <Box marginBottom={1}>
              <Text color="gray">ROM: </Text>
              <Text color="white" bold>{info.romName}</Text>
            </Box>

            {/* Core Name */}
            <Box>
              <Text color="gray">{'Core: '}</Text>
              <Text color="white">{info.coreName}</Text>
            </Box>
          </Box>

          <DialogOptionsList options={options} selectedIndex={selectedIndex} boxWidth={boxWidth} />
        </>
      )}
    </DialogContainer>
  );
};

/**
 * Show the save state dialog and get user's choice
 */
export const showSaveStateDialog = (
  info: SaveStateInfo,
  options: DialogRenderOptions = {}
): Promise<SaveStateChoice> => launchDialog<SaveStateChoice>(
  (onChoice) => <SaveStateDialog info={info} onChoice={onChoice} />,
  'cancel',
  { ...options, title: options.title ?? 'emoemu - Save State' },
);

export default SaveStateDialog;

// ============================================================================
// Corrupted State Dialog
// ============================================================================

export interface CorruptedStateInfo {
  path: string;
  romName: string;
  /** Whether the file could be read at all */
  fileReadable: boolean;
  /** Whether it's a binary file (libretro) or JSON (native core) */
  isBinary: boolean;
  /** Whether it was valid JSON (only relevant for native cores) */
  validJson: boolean;
  /** Whether we can attempt to load it (file readable and correct format) */
  canAttemptLoad: boolean;
  /** The specific error that caused validation to fail */
  errorReason: string;
}

export type CorruptedStateChoice = 'try_load' | 'continue' | 'cancel';

interface CorruptedStateDialogProps {
  info: CorruptedStateInfo;
  onChoice: (choice: CorruptedStateChoice) => void;
}

const CorruptedStateDialog = ({ info, onChoice }: CorruptedStateDialogProps) => {
  // Build options dynamically - offer "Try Loading" if we can attempt to load
  const options: { label: string; choice: CorruptedStateChoice; color: string }[] = [];

  if (info.canAttemptLoad) {
    options.push({ label: 'Try Loading Anyway', choice: 'try_load', color: 'green' });
  }
  options.push({ label: 'Start Fresh (overwrites save)', choice: 'continue', color: 'yellow' });
  options.push({ label: 'Cancel', choice: 'cancel', color: 'gray' });

  const { selectedIndex } = useDialogNavigation({
    itemCount: options.length,
    onSelect: (index) => onChoice(options[index].choice),
    onCancel: () => onChoice('cancel'),
  });

  return (
    <DialogContainer minWidth={CORRUPTED_DIALOG_MIN_WIDTH}>
      {(boxWidth) => (
        <>
          {/* Header */}
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={2}
            paddingY={1}
            width={boxWidth}
          >
            <Box justifyContent="center" marginBottom={1}>
              <Text bold color="yellow">{'\u26A0'} Corrupted Save State</Text>
            </Box>

            {/* ROM Name */}
            <Box marginBottom={1}>
              <Text color="gray">ROM: </Text>
              <Text color="white" bold>{info.romName}</Text>
            </Box>

            {/* Parse Status Checklist */}
            <Box flexDirection="column" marginBottom={1}>
              <Box>
                <Text color="gray">{'File readable: '}</Text>
                <Text color={info.fileReadable ? 'green' : 'red'}>
                  {info.fileReadable ? '\u2713 Yes' : '\u2717 No'}
                </Text>
              </Box>
              <Box>
                <Text color="gray">{'Format:        '}</Text>
                <Text color="white">
                  {info.isBinary ? 'Binary (libretro)' : 'JSON (native)'}
                </Text>
              </Box>
              {!info.isBinary && (
                <Box>
                  <Text color="gray">{'Valid JSON:    '}</Text>
                  <Text color={info.validJson ? 'green' : 'red'}>
                    {info.validJson ? '\u2713 Yes' : '\u2717 No'}
                  </Text>
                </Box>
              )}
            </Box>

            {/* Error reason */}
            <Box flexDirection="column">
              <Text color="red" dimColor>{'─'.repeat(boxWidth - SEPARATOR_LINE_PADDING)}</Text>
              <Box marginTop={1}>
                <Text color="red">Error: </Text>
                <Text color="white">{info.errorReason}</Text>
              </Box>
            </Box>
          </Box>

          {/* Warning */}
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={2}
            paddingY={1}
            marginTop={1}
            width={boxWidth}
          >
            <Text color="yellow">
              {'\u26A0'} Starting fresh will overwrite this save state
            </Text>
          </Box>

          <DialogOptionsList options={options} selectedIndex={selectedIndex} boxWidth={boxWidth} />
        </>
      )}
    </DialogContainer>
  );
};

/**
 * Show the corrupted state dialog and get user's choice
 */
export const showCorruptedStateDialog = (
  info: CorruptedStateInfo,
  options: DialogRenderOptions = {}
): Promise<CorruptedStateChoice> => launchDialog<CorruptedStateChoice>(
  (onChoice) => <CorruptedStateDialog info={info} onChoice={onChoice} />,
  'cancel',
  { ...options, title: options.title ?? 'emoemu - Corrupted Save State' },
);
