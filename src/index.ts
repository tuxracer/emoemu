#!/usr/bin/env node

import { Emulator } from './emulator.js';

function printUsage(): void {
  console.log(`
TUI-NES - Terminal NES Emulator

Usage: tui-nes <rom.nes> [options]

Options:
  --width <n>     Set display width in characters (default: 128)
  --height <n>    Set display height in characters (default: 60)
  --no-color      Disable colors (ASCII mode)
  --help          Show this help message

Controls:
  W/Arrow Up      D-Pad Up
  S/Arrow Down    D-Pad Down
  A/Arrow Left    D-Pad Left
  D/Arrow Right   D-Pad Right
  K/Z             A Button
  J/X             B Button
  Enter           Start
  Shift           Select
  Escape/Ctrl+C   Quit
`);
}

function parseArgs(args: string[]): {
  romPath?: string;
  width: number;
  height: number;
  useColor: boolean;
  help: boolean;
} {
  const result = {
    romPath: undefined as string | undefined,
    width: 128,
    height: 60,
    useColor: true,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--width' && args[i + 1]) {
      result.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      result.height = parseInt(args[++i], 10);
    } else if (arg === '--no-color') {
      result.useColor = false;
    } else if (!arg.startsWith('-')) {
      result.romPath = arg;
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || !options.romPath) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  console.log('TUI-NES - Terminal NES Emulator');
  console.log('================================');
  console.log(`Loading ROM: ${options.romPath}`);
  console.log(`Display: ${options.width}x${options.height}`);
  console.log(`Color: ${options.useColor ? 'enabled' : 'disabled'}`);
  console.log('');
  console.log('Press Escape or Ctrl+C to quit');
  console.log('Starting in 2 seconds...');

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const emulator = new Emulator({
      romPath: options.romPath,
      width: options.width,
      height: options.height,
      useColor: options.useColor,
    });

    await emulator.run();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
