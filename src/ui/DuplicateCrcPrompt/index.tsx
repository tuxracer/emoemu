/**
 * Duplicate CRC Prompt Component
 *
 * Shows when importing a ROM that has the same CRC32 as an existing entry
 * in the library, where both files exist. Prompts user to either update
 * the path or skip the import.
 */

import { Box, Text } from 'ink';
import { DialogOptionsList } from '../DialogOptionsList';
import { DialogContainer } from '../DialogContainer';
import { useDialogNavigation } from '../hooks/useDialogNavigation';
import { launchDialog, type DialogRenderOptions } from '../NativeDialog';
import { SEPARATOR_LINE_PADDING } from '..';
import {
  DIALOG_BOX_MIN_WIDTH,
  PATH_LABEL_WIDTH,
} from './consts';

export type DuplicateCrcChoice = 'update' | 'skip';

export interface DuplicateCrcInfo {
  /** The new ROM path being imported */
  newPath: string;
  /** The existing ROM path in the library */
  existingPath: string;
  /** The game label/title */
  label: string;
  /** The shared CRC32 value */
  crc32: string;
}

interface DuplicateCrcDialogProps {
  info: DuplicateCrcInfo;
  onChoice: (choice: DuplicateCrcChoice) => void;
}

/** Truncate a path to fit within max length, showing ... in the middle */
const truncatePath = (path: string, maxLength: number): string => {
  if (path.length <= maxLength) {
    return path;
  }

  const ellipsis = '...';
  const availableLength = maxLength - ellipsis.length;
  const startLength = Math.ceil(availableLength / 2);
  const endLength = Math.floor(availableLength / 2);

  return path.slice(0, startLength) + ellipsis + path.slice(-endLength);
};

const DuplicateCrcDialog = ({ info, onChoice }: DuplicateCrcDialogProps) => {
  const options: { label: string; choice: DuplicateCrcChoice; color: string }[] = [
    { label: 'Update path to new location', choice: 'update', color: 'green' },
    { label: 'Skip (keep existing)', choice: 'skip', color: 'gray' },
  ];

  const { selectedIndex } = useDialogNavigation({
    itemCount: options.length,
    onSelect: (index) => onChoice(options[index].choice),
    onCancel: () => onChoice('skip'),
  });

  return (
    <DialogContainer minWidth={DIALOG_BOX_MIN_WIDTH}>
      {(boxWidth) => {
        // Calculate max path length for truncation (accounting for label and padding)
        const pathMaxLength = boxWidth - SEPARATOR_LINE_PADDING - PATH_LABEL_WIDTH;

        return (
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
                <Text bold color="yellow">{'\u26A0'} Duplicate ROM Detected</Text>
              </Box>

              {/* Explanation */}
              <Box marginBottom={1}>
                <Text color="white">
                  A ROM with the same checksum already exists in your library.
                </Text>
              </Box>

              {/* Separator */}
              <Text color="gray" dimColor>{'─'.repeat(boxWidth - SEPARATOR_LINE_PADDING)}</Text>

              {/* Game info */}
              <Box flexDirection="column" marginY={1}>
                <Box>
                  <Text color="gray">{'Game:  '}</Text>
                  <Text color="white" bold>{info.label}</Text>
                </Box>
                <Box>
                  <Text color="gray">{'CRC32: '}</Text>
                  <Text color="cyan">{info.crc32}</Text>
                </Box>
              </Box>

              {/* Separator */}
              <Text color="gray" dimColor>{'─'.repeat(boxWidth - SEPARATOR_LINE_PADDING)}</Text>

              {/* Paths */}
              <Box flexDirection="column" marginY={1}>
                <Box>
                  <Text color="gray">{'Existing: '}</Text>
                  <Text color="white">{truncatePath(info.existingPath, pathMaxLength)}</Text>
                </Box>
                <Box>
                  <Text color="gray">{'New:      '}</Text>
                  <Text color="green">{truncatePath(info.newPath, pathMaxLength)}</Text>
                </Box>
              </Box>
            </Box>

            <DialogOptionsList options={options} selectedIndex={selectedIndex} boxWidth={boxWidth} escLabel="Skip" />
          </>
        );
      }}
    </DialogContainer>
  );
};

/**
 * Show the duplicate CRC dialog and get user's choice
 */
export const showDuplicateCrcPrompt = (
  info: DuplicateCrcInfo,
  options: DialogRenderOptions = {}
): Promise<DuplicateCrcChoice> => launchDialog<DuplicateCrcChoice>(
  (onChoice) => <DuplicateCrcDialog info={info} onChoice={onChoice} />,
  'skip',
  { ...options, title: options.title ?? 'emoemu - Duplicate ROM' },
);

export default DuplicateCrcDialog;

// Re-export constants
export * from './consts';
