/**
 * Netplay Pause Menu Component
 *
 * Shows when ESC is pressed during netplay connection/gameplay.
 * Allows user to resume or disconnect from the session.
 */

import { Box, Text } from 'ink';
import { DialogOptionsList } from '../DialogOptionsList';
import { DialogContainer } from '../DialogContainer';
import { useDialogNavigation } from '../hooks/useDialogNavigation';
import { launchDialog, type DialogRenderOptions } from '../NativeDialog';
import { PAUSE_MENU_MIN_WIDTH } from './consts';

export * from './consts';

export type PauseMenuChoice = 'resume' | 'disconnect';

interface NetplayPauseMenuProps {
  gameName?: string;
  isConnecting?: boolean;
  onChoice: (choice: PauseMenuChoice) => void;
}

const NetplayPauseMenu = ({ gameName, isConnecting, onChoice }: NetplayPauseMenuProps) => {
  const options: { label: string; choice: PauseMenuChoice; color: string }[] = [
    { label: isConnecting ? 'Continue Connecting' : 'Resume Game', choice: 'resume', color: 'green' },
    { label: 'Back to Browser', choice: 'disconnect', color: 'yellow' },
  ];

  const { selectedIndex } = useDialogNavigation({
    itemCount: options.length,
    onSelect: (index) => onChoice(options[index].choice),
    onCancel: () => onChoice('resume'),
    onCtrlC: () => onChoice('disconnect'),
  });

  return (
    <DialogContainer minWidth={PAUSE_MENU_MIN_WIDTH}>
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
              <Text bold color="cyan">{'\u23F8'} Paused</Text>
            </Box>

            {/* Game name if available */}
            {gameName && (
              <Box justifyContent="center">
                <Text color="white">{gameName}</Text>
              </Box>
            )}

            {/* Status */}
            <Box justifyContent="center" marginTop={1}>
              <Text color="gray">
                {isConnecting ? 'Connecting to netplay session...' : 'Netplay session active'}
              </Text>
            </Box>
          </Box>

          <DialogOptionsList options={options} selectedIndex={selectedIndex} boxWidth={boxWidth} prompt={false} escLabel="Resume" />
        </>
      )}
    </DialogContainer>
  );
};

export interface PauseMenuOptions extends DialogRenderOptions {
  gameName?: string;
  isConnecting?: boolean;
}

/**
 * Show the netplay pause menu and get user's choice
 */
export const showNetplayPauseMenu = (options: PauseMenuOptions = {}): Promise<PauseMenuChoice> => launchDialog<PauseMenuChoice>(
  (onChoice) => (
    <NetplayPauseMenu
      gameName={options.gameName}
      isConnecting={options.isConnecting}
      onChoice={onChoice}
    />
  ),
  'resume',
  { nativeMode: options.nativeMode, title: options.title ?? 'emoemu - Paused' },
);

export default NetplayPauseMenu;
