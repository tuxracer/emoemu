/**
 * Netplay Disconnected Dialog Component
 *
 * Shows when netplay connection is lost and offers reconnect option.
 */

import { Box, Text } from 'ink';
import { DialogOptionsList } from '../DialogOptionsList';
import { DialogContainer } from '../DialogContainer';
import { useDialogNavigation } from '../hooks/useDialogNavigation';
import { launchDialog, type DialogRenderOptions } from '../NativeDialog';

export interface DisconnectInfo {
  reason: string;
  host?: string;
  port?: number;
}

export type DisconnectChoice = 'reconnect' | 'menu' | 'exit';

interface NetplayDisconnectedDialogProps {
  info: DisconnectInfo;
  onChoice: (choice: DisconnectChoice) => void;
}

const NetplayDisconnectedDialog = ({ info, onChoice }: NetplayDisconnectedDialogProps) => {
  const options: { label: string; choice: DisconnectChoice; color: string }[] = [
    { label: 'Try to Reconnect', choice: 'reconnect', color: 'green' },
    { label: 'Back to Menu', choice: 'menu', color: 'gray' },
  ];

  const { selectedIndex } = useDialogNavigation({
    itemCount: options.length,
    onSelect: (index) => onChoice(options[index].choice),
    onCancel: () => onChoice('menu'),
    onCtrlC: () => onChoice('exit'),
  });

  // Format host info if available
  const hostInfo = info.host ? `${info.host}${info.port ? `:${info.port}` : ''}` : null;

  return (
    <DialogContainer>
      {(boxWidth) => (
        <>
          {/* Header */}
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="red"
            paddingX={2}
            paddingY={1}
            width={boxWidth}
          >
            <Box justifyContent="center" marginBottom={1}>
              <Text bold color="red">{'\u26A0'} Disconnected</Text>
            </Box>

            {/* Host info if available */}
            {hostInfo && (
              <Box marginBottom={1}>
                <Text color="gray">Host: </Text>
                <Text color="white">{hostInfo}</Text>
              </Box>
            )}

            {/* Disconnect reason */}
            <Box>
              <Text color="gray">Reason: </Text>
              <Text color="yellow">{info.reason}</Text>
            </Box>
          </Box>

          <DialogOptionsList options={options} selectedIndex={selectedIndex} boxWidth={boxWidth} escLabel="Back" />
        </>
      )}
    </DialogContainer>
  );
};

/**
 * Show the netplay disconnected dialog and get user's choice
 */
export const showNetplayDisconnectedDialog = (
  info: DisconnectInfo,
  options: DialogRenderOptions = {}
): Promise<DisconnectChoice> => launchDialog<DisconnectChoice>(
  (onChoice) => <NetplayDisconnectedDialog info={info} onChoice={onChoice} />,
  'menu',
  { ...options, title: options.title ?? 'emoemu - Disconnected' },
);

export default NetplayDisconnectedDialog;
