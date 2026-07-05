import { Box, Text } from 'ink';

interface DialogOption {
  label: string;
  choice: string;
  color: string;
}

interface DialogOptionsListProps {
  options: DialogOption[];
  selectedIndex: number;
  boxWidth: number;
  /** Label shown after ESC in the footer (default: "Cancel") */
  escLabel?: string;
  /** Prompt shown above options, or false to hide (default: "What would you like to do?") */
  prompt?: string | false;
}

export const DialogOptionsList = ({
  options,
  selectedIndex,
  boxWidth,
  escLabel = 'Cancel',
  prompt = 'What would you like to do?',
}: DialogOptionsListProps): React.JSX.Element => (
  <>
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={2}
      paddingY={1}
      marginTop={1}
      width={boxWidth}
    >
      {prompt !== false && (
        <Box marginBottom={1}>
          <Text bold>{prompt}</Text>
        </Box>
      )}

      {options.map((option, index) => (
        <Box key={option.choice}>
          <Text
            color={selectedIndex === index ? option.color : 'gray'}
            bold={selectedIndex === index}
          >
            {selectedIndex === index ? '\u25B6 ' : '  '}
            {index + 1}. {option.label}
          </Text>
        </Box>
      ))}
    </Box>

    <Box marginTop={1}>
      <Text color="gray" dimColor>
        {'\u2191\u2193'} Navigate  {'\u23CE'} Select  ESC {escLabel}
      </Text>
    </Box>
  </>
);
