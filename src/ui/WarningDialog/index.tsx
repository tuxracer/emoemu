/**
 * Warning Dialog Component
 *
 * A general-purpose warning dialog that displays a message and allows
 * the user to choose between continuing (OK) or exiting the application.
 */

import { Box, Text } from 'ink';
import { useDialogNavigation } from '../hooks/useDialogNavigation';
import { DialogContainer } from '../DialogContainer';
import { launchDialog, type DialogRenderOptions } from '../NativeDialog';
import { DIALOG_BOX_PADDING } from '..';

export type WarningChoice = 'ok' | 'exit';

interface WarningDialogProps {
  message: string;
  title?: string;
  onChoice: (choice: WarningChoice) => void;
}

const WarningDialog = ({ message, title = 'Warning', onChoice }: WarningDialogProps) => {
  const options: { label: string; choice: WarningChoice; color: string }[] = [
    { label: 'OK', choice: 'ok', color: 'green' },
    { label: 'Exit', choice: 'exit', color: 'red' },
  ];

  const { selectedIndex } = useDialogNavigation({
    itemCount: options.length,
    onSelect: (index) => onChoice(options[index].choice),
    onCancel: () => onChoice('ok'),
    horizontal: true,
    spaceToSelect: true,
    onCtrlC: () => onChoice('exit'),
  });

  return (
    <DialogContainer>
      {(boxWidth) => (
        <>
          {/* Main Dialog Box */}
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={2}
            paddingY={1}
            width={boxWidth}
          >
            {/* Header with warning icon */}
            <Box justifyContent="center" marginBottom={1}>
              <Text bold color="yellow">{'\u26A0'} {title}</Text>
            </Box>

            {/* Message */}
            <Box justifyContent="center" marginBottom={1}>
              <Text wrap="wrap">{message}</Text>
            </Box>

            {/* Separator */}
            <Box justifyContent="center" marginY={1}>
              <Text color="gray" dimColor>{'─'.repeat(boxWidth - DIALOG_BOX_PADDING - 2)}</Text>
            </Box>

            {/* Buttons - horizontal layout */}
            <Box justifyContent="center" gap={2}>
              {options.map((option, index) => (
                <Box
                  key={option.choice}
                  paddingX={2}
                  borderStyle={selectedIndex === index ? 'round' : 'single'}
                  borderColor={selectedIndex === index ? option.color : 'gray'}
                >
                  <Text
                    color={selectedIndex === index ? option.color : 'gray'}
                    bold={selectedIndex === index}
                  >
                    {option.label}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Footer */}
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              {'\u2190\u2192'} Navigate  {'\u23CE'}/Space Select  ESC Continue
            </Text>
          </Box>
        </>
      )}
    </DialogContainer>
  );
};

/**
 * Show the warning dialog and get user's choice
 *
 * @param message - The warning message to display
 * @param options - Dialog render options (native mode, title, etc.)
 * @returns 'ok' if user chooses to continue, 'exit' if user chooses to exit
 */
export const showWarningDialog = (
  message: string,
  options: DialogRenderOptions & { title?: string } = {}
): Promise<WarningChoice> => launchDialog<WarningChoice>(
  (onChoice) => <WarningDialog message={message} title={options.title} onChoice={onChoice} />,
  'ok',
  { ...options, title: options.title ?? 'emoemu - Warning' },
);

export default WarningDialog;
