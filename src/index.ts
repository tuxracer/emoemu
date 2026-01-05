#!/usr/bin/env node

import { Emulator, RenderMode } from './emulator.js';

function printUsage(): void {
  console.log(`
TUI-NES - Terminal NES Emulator

Usage: tui-nes <rom.nes> [options]

Options:
  --kitty         Use Kitty graphics protocol (default, best quality)
  --terminal      Use terminal character rendering (fallback)
  --scale <n>     Scale factor for Kitty mode (default: 2)
  --width <n>     Set display width in characters (terminal mode)
  --height <n>    Set display height in characters (terminal mode)
  --no-color      Disable colors (terminal ASCII mode)
  --help          Show this help message

Controls:
  W/Arrow Up      D-Pad Up
  S/Arrow Down    D-Pad Down
  A/Arrow Left    D-Pad Left
  D/Arrow Right   D-Pad Right
  K/Z             A Button (Jump/Action)
  J/X             B Button (Run)
  Enter           Start
  Space           Select
  Escape/Ctrl+C   Quit

Note: You can hold buttons and press multiple buttons simultaneously
      (e.g., hold D + J to run right, then press K to jump)
`);
}

function parseArgs(args: string[]): {
  romPath?: string;
  width: number | undefined;
  height: number | undefined;
  useColor: boolean;
  renderMode: RenderMode;
  scale: number;
  help: boolean;
} {
  const result = {
    romPath: undefined as string | undefined,
    width: undefined as number | undefined,  // undefined = auto-fit
    height: undefined as number | undefined, // undefined = auto-fit
    useColor: true,
    renderMode: 'kitty' as RenderMode,
    scale: 2,
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
    } else if (arg === '--scale' && args[i + 1]) {
      result.scale = parseInt(args[++i], 10);
    } else if (arg === '--no-color') {
      result.useColor = false;
    } else if (arg === '--kitty') {
      result.renderMode = 'kitty';
    } else if (arg === '--terminal') {
      result.renderMode = 'terminal';
    } else if (!arg.startsWith('-')) {
      result.romPath = arg;
    }
  }

  return result;
}

// Calculate display size to fit terminal while maintaining NES aspect ratio
function calculateDisplaySize(requestedWidth?: number, requestedHeight?: number): { width: number; height: number } {
  // Get terminal size (with fallbacks)
  const termCols = process.stdout.columns || 120;
  const termRows = process.stdout.rows || 40;

  // Reserve 1 row for status line
  const availableRows = termRows - 1;
  const availableCols = termCols;

  // NES resolution: 256x240, displayed on 4:3 TV
  // With half-block characters (▀), each char = 1 NES pixel wide, 2 NES pixels tall
  // Terminal characters are typically ~2x taller than wide (1:2 aspect)
  // To achieve 4:3 display aspect: width / (height * 2) = 4/3
  // So: width = height * 8/3 ≈ height * 2.67
  const charAspectRatio = 8 / 3; // ~2.67

  let width: number;
  let height: number;

  if (requestedWidth !== undefined && requestedHeight !== undefined) {
    // Both specified - use as-is
    width = requestedWidth;
    height = requestedHeight;
  } else if (requestedWidth !== undefined) {
    // Width specified, calculate height from aspect ratio
    width = Math.min(requestedWidth, availableCols);
    height = Math.floor(width / charAspectRatio);
  } else if (requestedHeight !== undefined) {
    // Height specified, calculate width from aspect ratio
    height = Math.min(requestedHeight, availableRows);
    width = Math.floor(height * charAspectRatio);
  } else {
    // Auto-fit: use full terminal width, calculate height for correct aspect
    width = availableCols;
    height = Math.floor(width / charAspectRatio);

    // If calculated height exceeds available rows, scale down
    if (height > availableRows) {
      height = availableRows;
      width = Math.floor(height * charAspectRatio);
    }
  }

  // Ensure minimum size
  width = Math.max(width, 32);
  height = Math.max(height, 15);

  // Ensure we don't exceed terminal
  width = Math.min(width, availableCols);
  height = Math.min(height, availableRows);

  return { width, height };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || !options.romPath) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  // Calculate display size (auto-fit to terminal if not specified) - for terminal mode
  const displaySize = calculateDisplaySize(options.width, options.height);

  console.log('TUI-NES - Terminal NES Emulator');
  console.log('================================');
  console.log(`Loading ROM: ${options.romPath}`);
  console.log(`Terminal: ${process.stdout.columns || '?'}x${process.stdout.rows || '?'}`);
  console.log(`Render mode: ${options.renderMode}`);
  if (options.renderMode === 'kitty') {
    console.log(`Scale: ${options.scale}x (${256 * options.scale}x${240 * options.scale} pixels)`);
  } else {
    console.log(`Display: ${displaySize.width}x${displaySize.height}${options.width === undefined ? ' (auto-fit)' : ''}`);
    console.log(`Color: ${options.useColor ? 'enabled' : 'disabled'}`);
  }
  console.log('');
  console.log('Press Escape or Ctrl+C to quit');
  console.log('Starting in 2 seconds...');

  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const emulator = new Emulator({
      romPath: options.romPath,
      width: displaySize.width,
      height: displaySize.height,
      useColor: options.useColor,
      renderMode: options.renderMode,
      scale: options.scale,
    });

    await emulator.run();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
