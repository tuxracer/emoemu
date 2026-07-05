import { Box, useStdout } from 'ink';
import { useClearTerminal } from '../hooks/useClearTerminal';
import {
  DEFAULT_TERM_WIDTH,
  DEFAULT_TERM_HEIGHT,
  DIALOG_BOX_PADDING,
  DIALOG_BOX_MIN_WIDTH,
} from '..';

interface DialogContainerProps {
  minWidth?: number;
  children: (boxWidth: number) => React.ReactNode;
}

/**
 * Shared container for dialogs that handles terminal dimension detection,
 * screen clearing, ready state, and centering layout.
 */
export const DialogContainer = ({ minWidth = DIALOG_BOX_MIN_WIDTH, children }: DialogContainerProps): React.JSX.Element | null => {
  const { stdout } = useStdout();
  const ready = useClearTerminal();

  const termWidth = stdout.columns || DEFAULT_TERM_WIDTH;
  const termHeight = stdout.rows || DEFAULT_TERM_HEIGHT;
  const boxWidth = Math.min(minWidth, termWidth - DIALOG_BOX_PADDING);

  if (!ready) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      width={termWidth}
      height={termHeight}
      alignItems="center"
      justifyContent="center"
    >
      {children(boxWidth)}
    </Box>
  );
};
