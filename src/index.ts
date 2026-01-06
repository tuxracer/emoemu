#!/usr/bin/env node

import { Emulator, RenderMode } from './emulator.js';
import { GamepadManager } from './input/gamepad-manager.js';
import HID from 'node-hid';

function printUsage(): void {
  console.log(`
TUI-NES - Terminal NES Emulator

Usage: tui-nes <rom.nes> [options]

Options:
  --kitty           Use Kitty graphics protocol (default, best quality)
  --terminal        Use terminal character rendering (Unicode half-blocks)
  --ascii           Use colored ASCII character rendering
  --no-color        Disable colors (use with --ascii or --terminal)
  --scale <n>       Scale factor for Kitty mode (default: auto-fit to terminal)
  --width <n>       Set display width in characters (terminal/ascii mode)
  --height <n>      Set display height in characters (terminal/ascii mode)
  --list-gamepads   List detected gamepad/controller devices and exit
  --no-gamepad      Disable gamepad support
  --no-audio        Disable audio output
  --debug-gamepad   Show raw gamepad HID data (for debugging)
  --help            Show this help message

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
  scale: number | undefined;
  help: boolean;
  listGamepads: boolean;
  enableGamepad: boolean;
  enableAudio: boolean;
  debugGamepad: boolean;
} {
  const result = {
    romPath: undefined as string | undefined,
    width: undefined as number | undefined,  // undefined = auto-fit
    height: undefined as number | undefined, // undefined = auto-fit
    useColor: true,
    renderMode: 'kitty' as RenderMode,
    scale: undefined as number | undefined,  // undefined = auto-fit to terminal
    help: false,
    listGamepads: false,
    enableGamepad: true,
    enableAudio: true,
    debugGamepad: false,
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
    } else if (arg === '--ascii') {
      result.renderMode = 'ascii';
    } else if (arg === '--no-color') {
      result.useColor = false;
    } else if (arg === '--kitty') {
      result.renderMode = 'kitty';
    } else if (arg === '--terminal') {
      result.renderMode = 'terminal';
    } else if (arg === '--list-gamepads') {
      result.listGamepads = true;
    } else if (arg === '--no-gamepad') {
      result.enableGamepad = false;
    } else if (arg === '--no-audio') {
      result.enableAudio = false;
    } else if (arg === '--debug-gamepad') {
      result.debugGamepad = true;
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

function debugGamepad(): void {
  console.log('Gamepad Debug Mode');
  console.log('==================');
  console.log('Press Ctrl+C to exit\n');

  const devices = GamepadManager.listDevices();
  if (devices.length === 0) {
    console.log('No gamepad devices found.');
    process.exit(1);
  }

  const deviceInfo = devices[0];
  console.log(`Connecting to: ${deviceInfo.product}`);
  console.log(`Path: ${deviceInfo.path}\n`);

  try {
    const device = new HID.HID(deviceInfo.path);
    let lastData = '';

    device.on('data', (data: Buffer) => {
      // Only print if data changed (reduces noise)
      const hexStr = Array.from(data)
        .map((b, i) => `${i.toString().padStart(2)}:${b.toString(16).padStart(2, '0')}`)
        .join(' ');

      if (hexStr !== lastData) {
        // Show byte index and value in both hex and decimal
        console.log(`\nBytes (${data.length}):`);
        const parts: string[] = [];
        for (let i = 0; i < data.length; i++) {
          parts.push(`[${i}]=0x${data[i].toString(16).padStart(2, '0')}(${data[i].toString().padStart(3)})`);
        }
        console.log(parts.join(' '));
        lastData = hexStr;
      }
    });

    device.on('error', (err) => {
      console.error('Device error:', err);
      process.exit(1);
    });

    // Keep running
    process.on('SIGINT', () => {
      device.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to open device:', err);
    process.exit(1);
  }
}

function listGamepads(): void {
  console.log('Detected Gamepad Devices');
  console.log('========================\n');

  const devices = GamepadManager.listDevices();

  if (devices.length === 0) {
    console.log('No gamepad devices detected.\n');
    console.log('Tips:');
    console.log('  - Make sure your controller is connected and paired (for Bluetooth)');
    console.log('  - Try pressing a button on the controller to wake it up');
    console.log('  - On Linux, you may need to add your user to the "input" group\n');
  } else {
    for (const device of devices) {
      console.log(`${device.product}`);
      console.log(`  Manufacturer: ${device.manufacturer}`);
      console.log(`  Vendor ID:    0x${device.vendorId.toString(16).padStart(4, '0')}`);
      console.log(`  Product ID:   0x${device.productId.toString(16).padStart(4, '0')}`);
      console.log(`  Profile:      ${device.profile}`);
      console.log('');
    }
  }

  console.log('Supported Controllers:');
  for (const profile of GamepadManager.getSupportedProfiles()) {
    console.log(`  - ${profile}`);
  }
  console.log('  - Generic USB Gamepad (fallback)');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Handle --list-gamepads before checking for ROM
  if (options.listGamepads) {
    listGamepads();
    process.exit(0);
  }

  // Handle --debug-gamepad before checking for ROM
  if (options.debugGamepad) {
    debugGamepad();
    // debugGamepad() doesn't return - runs until Ctrl+C
    return;
  }

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
    if (options.scale !== undefined) {
      console.log(`Scale: ${options.scale}x (${256 * options.scale}x${240 * options.scale} pixels)`);
    } else {
      console.log('Scale: auto-fit to terminal');
    }
  } else if (options.renderMode === 'ascii') {
    console.log(`Display: ${displaySize.width}x${displaySize.height}${options.width === undefined ? ' (auto-fit)' : ''}`);
    console.log(`Mode: ASCII characters${options.useColor ? ' with color' : ' (grayscale)'}`);
  } else {
    console.log(`Display: ${displaySize.width}x${displaySize.height}${options.width === undefined ? ' (auto-fit)' : ''}`);
    console.log('Mode: Unicode half-blocks with color');
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
      enableGamepad: options.enableGamepad,
      enableAudio: options.enableAudio,
    });

    await emulator.run();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
