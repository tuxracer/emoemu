#!/usr/bin/env node

import * as readline from 'readline';
import { Emulator, RenderMode } from './emulator.js';
import { GamepadManager } from './input/gamepad-manager.js';
import HID from 'node-hid';
import { existsSync, readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import type { SaveState } from './emulator.js';
import { findProfile, isGamepadDevice } from './input/gamepad-profiles.js';
import { Button } from './input/controller.js';
import {
  listCores,
  getSupportedExtensions,
  detectCoreFactory,
  getCoreFactory,
} from './frontend/core-registry.js';

// Import NES core to register it with the registry
import './cores/nes/index.js';

/**
 * Validate a state file and return the parsed state if valid
 * @returns The parsed SaveState if valid, null if invalid/corrupted
 */
function validateStateFile(statePath: string): SaveState | null {
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const data = readFileSync(statePath);
    // Check for gzip magic number (0x1f 0x8b)
    const isGzipped = data[0] === 0x1f && data[1] === 0x8b;
    const json = isGzipped ? gunzipSync(data).toString('utf-8') : data.toString('utf-8');
    const state = JSON.parse(json) as SaveState;

    // Basic validation - check required fields exist
    if (!state.version || !state.coreState) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * Prompt the user with a yes/no question
 * Supports both keyboard input and gamepad A/B buttons
 * @param question The question to ask
 * @param defaultYes If true, default is Y (empty input = yes). If false, default is N (empty input = no)
 */
function askYesNo(question: string, defaultYes: boolean = true): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    let gamepadDevice: HID.HID | null = null;
    let hasGamepad = false;

    const cleanup = () => {
      if (gamepadDevice) {
        try {
          gamepadDevice.close();
        } catch {
          // Ignore close errors
        }
        gamepadDevice = null;
      }
    };

    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      rl.close();
      resolve(result);
    };

    // Try to detect gamepad first (before showing prompt)
    try {
      const devices = HID.devices();
      const gamepadDevices = devices.filter(isGamepadDevice);
      const deviceInfo = gamepadDevices.find(d => d.path);
      if (deviceInfo?.path) {
        gamepadDevice = new HID.HID(deviceInfo.path as string);
        hasGamepad = true;
        const profile = findProfile(deviceInfo.vendorId ?? 0, deviceInfo.productId ?? 0);

        gamepadDevice.on('data', (data: Buffer) => {
          if (resolved) return;

          try {
            const buttonStates = profile.parseReport(data);
            const aPressed = buttonStates.get(Button.A) ?? false;
            const bPressed = buttonStates.get(Button.B) ?? false;
            const startPressed = buttonStates.get(Button.Start) ?? false;

            if (aPressed || startPressed) {
              console.log(aPressed ? 'A' : 'Start'); // Echo the selection
              finish(true);
            } else if (bPressed) {
              console.log('B'); // Echo the selection
              finish(false);
            }
          } catch {
            // Ignore parse errors
          }
        });

        gamepadDevice.on('error', () => {
          cleanup();
        });
      }
    } catch {
      // Gamepad setup failed - keyboard only
    }

    // Set up keyboard input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Build prompt with appropriate default and gamepad hint
    const defaultHint = defaultYes ? '[Y/n]' : '[y/N]';
    const gamepadHint = hasGamepad ? ', A/B' : '';
    const prompt = `${question} (${defaultHint}${gamepadHint}): `;

    rl.question(prompt, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        // Empty input = use default
        finish(defaultYes);
      } else {
        // Explicit input
        finish(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

/**
 * Get the save state path for a ROM
 * Handles any ROM extension by replacing it with .state
 */
function getStatePath(romPath: string): string {
  // Get all supported extensions and create a regex pattern
  const extensions = getSupportedExtensions();
  const extPattern = extensions.map(ext => ext.replace('.', '\\.')).join('|');
  const regex = new RegExp(`(${extPattern})$`, 'i');
  return romPath.replace(regex, '.state');
}

function printUsage(): void {
  // Get supported extensions from core registry
  const extensions = getSupportedExtensions().join(', ');

  console.log(`
TUI-NES - Terminal Retro Emulator

Usage: tui-nes <rom> [options]

Options:
  --core <id>       Use a specific emulator core (see --list-cores)
  --list-cores      List available emulator cores and exit
  --kitty           Use Kitty graphics protocol (default, best quality)
  --terminal        Use terminal character rendering (Unicode half-blocks)
  --ascii           Use colored ASCII character rendering
  --emoji           Use emoji character rendering
  --no-color        Disable colors (use with --ascii or --terminal)
  --scale <n>       Scale factor for Kitty mode (default: auto-fit to terminal)
  --width <n>       Set display width in characters (terminal/ascii mode)
  --height <n>      Set display height in characters (terminal/ascii mode)
  --list-gamepads   List detected gamepad/controller devices and exit
  --no-gamepad      Disable gamepad support
  --no-audio        Disable audio output
  --no-status       Hide the status bar
  --debug-gamepad   Show raw gamepad HID data (for debugging)
  --help            Show this help message

Supported ROM formats: ${extensions}

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
  listCoresFlag: boolean;
  core: string | undefined;
  enableGamepad: boolean;
  enableAudio: boolean;
  showStatusBar: boolean;
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
    listCoresFlag: false,
    core: undefined as string | undefined,
    enableGamepad: true,
    enableAudio: true,
    showStatusBar: true,
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
    } else if (arg === '--emoji') {
      result.renderMode = 'emoji';
    } else if (arg === '--no-color') {
      result.useColor = false;
    } else if (arg === '--kitty') {
      result.renderMode = 'kitty';
    } else if (arg === '--terminal') {
      result.renderMode = 'terminal';
    } else if (arg === '--list-gamepads') {
      result.listGamepads = true;
    } else if (arg === '--list-cores') {
      result.listCoresFlag = true;
    } else if (arg === '--core' && args[i + 1]) {
      result.core = args[++i];
    } else if (arg === '--no-gamepad') {
      result.enableGamepad = false;
    } else if (arg === '--no-audio') {
      result.enableAudio = false;
    } else if (arg === '--no-status') {
      result.showStatusBar = false;
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

function listCoresCommand(): void {
  console.log('Available Emulator Cores');
  console.log('========================\n');

  const cores = listCores();

  if (cores.length === 0) {
    console.log('No cores registered.\n');
  } else {
    for (const core of cores) {
      console.log(`${core.name} (--core ${core.id})`);
      console.log(`  Extensions: ${core.extensions.join(', ')}`);
      console.log('');
    }
  }

  console.log('Note: Cores are auto-detected by ROM file extension.');
  console.log('      Use --core <id> to override auto-detection.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Handle --list-gamepads before checking for ROM
  if (options.listGamepads) {
    listGamepads();
    process.exit(0);
  }

  // Handle --list-cores before checking for ROM
  if (options.listCoresFlag) {
    listCoresCommand();
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

  // Detect or validate core for the ROM
  let coreFactory;
  if (options.core) {
    // User specified a core explicitly
    coreFactory = getCoreFactory(options.core);
    if (!coreFactory) {
      console.error(`Error: Unknown core '${options.core}'`);
      console.error('Use --list-cores to see available cores.');
      process.exit(1);
    }
  } else {
    // Auto-detect core by file extension
    coreFactory = detectCoreFactory(options.romPath);
    if (!coreFactory) {
      const supportedExts = getSupportedExtensions().join(', ');
      console.error(`Error: Unsupported ROM format for '${options.romPath}'`);
      console.error(`Supported formats: ${supportedExts}`);
      console.error('Use --list-cores to see available cores.');
      process.exit(1);
    }
  }

  // Calculate display size (auto-fit to terminal if not specified) - for terminal mode
  const displaySize = calculateDisplaySize(options.width, options.height);

  const systemInfo = coreFactory.getSystemInfo();

  console.log('TUI-NES - Terminal Retro Emulator');
  console.log('==================================');
  console.log(`Core: ${systemInfo.name}`);
  console.log(`Loading ROM: ${options.romPath}`);
  console.log(`Terminal: ${process.stdout.columns || '?'}x${process.stdout.rows || '?'}`);
  console.log(`Render mode: ${options.renderMode}`);
  if (options.renderMode === 'kitty') {
    if (options.scale !== undefined) {
      console.log(`Scale: ${options.scale}x (${256 * options.scale}x${240 * options.scale} pixels)`);
    } else {
      console.log('Scale: auto-fit to terminal');
    }
  } else if (options.renderMode === 'emoji') {
    console.log(`Display: ${displaySize.width}x${displaySize.height}${options.width === undefined ? ' (auto-fit)' : ''}`);
    console.log('Mode: Emoji characters');
  } else if (options.renderMode === 'ascii') {
    console.log(`Display: ${displaySize.width}x${displaySize.height}${options.width === undefined ? ' (auto-fit)' : ''}`);
    console.log(`Mode: ASCII characters${options.useColor ? ' with color' : ' (grayscale)'}`);
  } else {
    console.log(`Display: ${displaySize.width}x${displaySize.height}${options.width === undefined ? ' (auto-fit)' : ''}`);
    console.log('Mode: Unicode half-blocks with color');
  }
  console.log('');
  console.log('Press Escape or Ctrl+C to quit');

  // Check for saved state
  const statePath = getStatePath(options.romPath);
  const stateFileExists = existsSync(statePath);
  const validState = stateFileExists ? validateStateFile(statePath) : null;
  let shouldRestore = false;

  if (stateFileExists && !validState) {
    console.log('');
    console.warn('Warning: A saved state file was found but appears to be corrupted or invalid.');
    console.warn('The state file will be ignored and a fresh game will start.');
    console.log('');
  } else if (validState) {
    console.log('');
    console.log('A saved state was found for this ROM.');
    shouldRestore = await askYesNo('Would you like to resume from where you left off?');
    console.log('');
  }

  if (!shouldRestore) {
    console.log('Starting in 2 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  try {
    // Only pass explicit dimensions if user specified them (enables auto-resize otherwise)
    const explicitDimensions = options.width !== undefined || options.height !== undefined;

    const emulator = new Emulator({
      romPath: options.romPath,
      coreFactory: coreFactory,
      width: explicitDimensions ? displaySize.width : undefined,
      height: explicitDimensions ? displaySize.height : undefined,
      useColor: options.useColor,
      renderMode: options.renderMode,
      scale: options.scale,
      enableGamepad: options.enableGamepad,
      enableAudio: options.enableAudio,
      showStatusBar: options.showStatusBar,
    });

    let stateLoaded = false;
    if (shouldRestore) {
      stateLoaded = await emulator.loadState();
      if (stateLoaded) {
        console.log('Resuming from saved state...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await emulator.run(stateLoaded);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
