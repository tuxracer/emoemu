import { existsSync, readFileSync } from 'fs';
import { basename, extname, join } from 'path';
import { Emulator } from '../../Emulator';
import {
  getSupportedExtensions,
  getCoreFactory,
  findMatchingCores,
} from '../../frontend/coreRegistry';
import type { CoreFactory } from '../../frontend/coreRegistry';
import { getCoresDirectory } from '../../frontend/config';
import { getPreferredCoreId, setPreferredCoreId } from '../../frontend/corePreferences';
import { getSaveStateService } from '../../frontend/serviceProvider';
import { SettingsManager } from '../../frontend/SettingsManager';
import {
  selectCore,
  showSaveStateDialog,
  showCorruptedStateDialog,
  showNetplayDisconnectedDialog,
} from '../../ui';
import type { SaveStateInfo, SaveStateChoice, CorruptedStateInfo, NetplayOptions } from '../../ui';
import { STDIN_SETTLE_DELAY_MS } from '../../ui';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/getErrorMessage';
import {
  DEFAULT_TERMINAL_WIDTH_WIDE,
  DEFAULT_TERMINAL_HEIGHT_TALL,
  CHAR_ASPECT_RATIO_4_3,
} from '../../rendering';
import { fitToTerminal } from '../../rendering/shared/fitToTerminal';
import { registerLibretroCore } from '../../cores/libretro/loader';
import type { CliOptions } from '../parseArgs';
import type { RunEmulatorResult } from './types';

export * from './types';

/**
 * Validate a state file exists and is readable
 * @returns true if file exists and can be read, false otherwise
 */
const validateStateFile = (statePath: string): boolean => {
  if (!existsSync(statePath)) {
    return false;
  }

  try {
    const data = readFileSync(statePath);
    // For JSON files, try to parse to validate
    // For binary files (libretro), just check the file is not empty
    if (data.length === 0) {
      return false;
    }

    // Try to parse as JSON (native cores) - if it fails, assume it's binary (libretro)
    const str = data.toString("utf-8");
    if (str.startsWith("{")) {
      JSON.parse(str); // Validate JSON is parseable
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Analyze a corrupted state file and determine if it can be loaded.
 * All cores use raw binary state format.
 */
const analyzeCorruptedState = (statePath: string, romName: string): CorruptedStateInfo => {
  const info: CorruptedStateInfo = {
    path: statePath,
    romName,
    fileReadable: false,
    isBinary: true,
    validJson: false,
    canAttemptLoad: false,
    errorReason: 'Unknown error',
  };

  // Try to read the file
  let data: Buffer;
  try {
    data = readFileSync(statePath);
    info.fileReadable = true;
  } catch (err) {
    info.errorReason = `Cannot read file: ${getErrorMessage(err)}`;
    return info;
  }

  if (data.length > 0) {
    info.canAttemptLoad = true;
    info.errorReason = 'Binary state file may be corrupted';
  } else {
    info.errorReason = 'File is empty';
  }

  return info;
};

// Calculate display size to fit terminal while maintaining aspect ratio
const calculateDisplaySize = (requestedWidth?: number, requestedHeight?: number): { width: number; height: number } => {
  const termCols = process.stdout.columns || DEFAULT_TERMINAL_WIDTH_WIDE;
  const termRows = process.stdout.rows || DEFAULT_TERMINAL_HEIGHT_TALL;

  // Reserve 1 row for status line
  const availableRows = termRows - 1;

  return fitToTerminal({
    availableCols: termCols,
    availableRows,
    aspectRatio: CHAR_ASPECT_RATIO_4_3,
    requestedWidth,
    requestedHeight,
  });
};

/**
 * Run the emulator for a given ROM
 * @param resumeGame If true, skip save state dialog and resume directly
 * @param resumeCoreId If provided, use this core (bypasses core selector when resuming)
 * @param netplay If provided, netplay options from the UI (overrides CLI options)
 * @returns Result indicating whether to continue and if the game was played
 */
export const runEmulator = async (romPath: string, options: CliOptions, resumeGame?: boolean, resumeCoreId?: string, netplay?: NetplayOptions): Promise<RunEmulatorResult> => {
  // Check if joining netplay (used for skipping dialogs)
  // netplayConnect can be empty string for LAN discovery, so check !== undefined
  const isJoiningNetplay = netplay?.mode === 'join' || options.netplayConnect !== undefined;

  // Detect or validate core for the ROM
  let coreFactory: CoreFactory | undefined;

  if (options.core) {
    // User specified a core explicitly via --core flag
    let factory = getCoreFactory(options.core);

    // If core not found, try lazy loading (for cores skipped during startup scan)
    // mupen64plus is skipped during startup due to macOS loading issues
    if (!factory && options.core.includes('mupen64plus')) {
      const coresDir = getCoresDirectory();
      const ext = process.platform === 'darwin' ? '.dylib' : process.platform === 'win32' ? '.dll' : '.so';
      const corePath = join(coresDir, `${options.core}_libretro${ext}`);
      if (existsSync(corePath)) {
        const coreId = registerLibretroCore(corePath);
        if (coreId) {
          factory = getCoreFactory(coreId);
        }
      }
    }

    if (!factory) {
      const errorMsg = `Unknown core '${options.core}'`;
      console.error(`Error: ${errorMsg}`);
      console.error("Use --list-cores to see available cores.");
      logger.error(errorMsg, 'Core');
      return { shouldContinue: false, gameWasPlayed: false };
    }
    coreFactory = factory;
  } else if (resumeCoreId) {
    // Resuming a game - use the same core that was used before
    const factory = getCoreFactory(resumeCoreId);
    if (!factory) {
      // Core no longer available - fall back to normal selection
      const warnMsg = `Core '${resumeCoreId}' no longer available, selecting alternative.`;
      console.error(`Warning: ${warnMsg}`);
      logger.warn(warnMsg, 'Core');
    } else {
      coreFactory = factory;
    }
  }

  // If coreFactory not yet set, do normal core detection
  if (!coreFactory) {
    // Find all cores that support this file extension
    const matchingCores = findMatchingCores(romPath);

    if (matchingCores.length === 0) {
      const supportedExts = getSupportedExtensions().join(", ");
      const errorMsg = `Unsupported ROM format for '${romPath}'`;
      console.error(`Error: ${errorMsg}`);
      console.error(`Supported formats: ${supportedExts}`);
      console.error("Use --list-cores to see available cores.");
      logger.error(`${errorMsg}. Supported: ${supportedExts}`, 'Core');
      return { shouldContinue: true, gameWasPlayed: false }; // Return to browser instead of exiting
    } else if (matchingCores.length === 1) {
      // Only one core matches - use it directly
      coreFactory = matchingCores[0].factory;
    } else if (isJoiningNetplay) {
      // Netplay join mode - auto-select first matching core to skip dialog
      // The netplay protocol will validate CRC anyway
      coreFactory = matchingCores[0].factory;
    } else {
      // Check for a saved core preference for this extension
      const ext = extname(romPath).toLowerCase();
      const preferredId = getPreferredCoreId(ext);
      const preferred = preferredId
        ? matchingCores.find(c => c.id === preferredId)
        : undefined;

      if (preferred) {
        coreFactory = preferred.factory;
      } else {
        // Multiple cores match and no saved preference - show selection dialog
        const selection = await selectCore(matchingCores, basename(romPath), {
          nativeMode: options.config.video_driver === 'native',
          scaleFactor: options.config.menu_scale_factor,
        });
        if (!selection) {
          // User cancelled - return to browser
          return { shouldContinue: true, gameWasPlayed: false };
        }
        coreFactory = selection.factory;
        if (selection.remember) {
          setPreferredCoreId(ext, selection.id);
        }
      }
    }
  }

  // Calculate display size (auto-fit to terminal if not specified) - for terminal mode
  const displaySize = calculateDisplaySize(options.width, options.height);

  const systemInfo = coreFactory.getSystemInfo();

  // Check for saved state (unless disabled or joining netplay session)
  // When joining netplay, the client receives state from the host
  let shouldRestore = false;
  let statePathToLoad: string | null = null;

  if (options.enableSaveState && !isJoiningNetplay) {
    const saveStateService = getSaveStateService();

    // Find any existing save state (checks .state.auto first, then legacy formats)
    const foundStatePath = saveStateService.findExistingStatePath(romPath);
    const stateFileExists = foundStatePath !== null;
    const isValidState = stateFileExists && validateStateFile(foundStatePath);

    // If resumeGame is true and there's a valid state, skip dialogs and resume directly
    if (resumeGame && isValidState) {
      shouldRestore = true;
      statePathToLoad = foundStatePath;
    } else if (stateFileExists && !isValidState) {
      // Corrupted save state - analyze and show detailed dialog
      const corruptedInfo = analyzeCorruptedState(foundStatePath, basename(romPath));
      const choice = await showCorruptedStateDialog(corruptedInfo, {
        nativeMode: options.config.video_driver === 'native',
        scaleFactor: options.config.menu_scale_factor,
      });
      if (choice === 'cancel') {
        return { shouldContinue: true, gameWasPlayed: false };
      } else if (choice === 'try_load') {
        // User wants to try loading anyway - attempt it
        shouldRestore = true;
        statePathToLoad = foundStatePath;
      }
      // If 'continue', will start fresh and overwrite on save
    } else if (isValidState) {
      // Show save state dialog
      const saveStateInfo: SaveStateInfo = {
        path: foundStatePath,
        romName: basename(romPath),
        coreName: systemInfo.name,
      };

      // Reset stdin for the dialog
      process.stdin.removeAllListeners();
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      await new Promise(resolve => setTimeout(resolve, STDIN_SETTLE_DELAY_MS));

      const choice: SaveStateChoice = await showSaveStateDialog(saveStateInfo, {
        nativeMode: options.config.video_driver === 'native',
        scaleFactor: options.config.menu_scale_factor,
      });

      if (choice === 'cancel') {
        return { shouldContinue: true, gameWasPlayed: false };
      } else if (choice === 'delete') {
        // Delete the save state file
        saveStateService.deleteState(romPath);
      } else {
        // Resume
        shouldRestore = true;
        statePathToLoad = foundStatePath;
      }
    }
  }

  try {
    // Only pass explicit dimensions if user specified them (enables auto-resize otherwise)
    const explicitDimensions =
      options.width !== undefined || options.height !== undefined;

    // Create SettingsManager for centralized settings sync
    const settingsManager = new SettingsManager(options.config, options.configPath);

    const emulator = new Emulator({
      romPath: romPath,
      coreFactory: coreFactory,
      width: explicitDimensions ? displaySize.width : undefined,
      height: explicitDimensions ? displaySize.height : undefined,
      colorEnabled: options.colorEnabled,
      renderMode: options.renderMode,
      scale: options.scale,
      enableGamepad: options.enableGamepad,
      enableAudio: options.enableAudio,
      startMuted: options.startMuted,
      enableSaveState: options.enableSaveState,
      enableBatterySave: options.enableBatterySave,
      showStatusBar: options.showStatusBar,
      fpsLimit: options.fpsLimit,
      enableDiffRendering: options.enableDiffRendering,
      noRender: options.noRender,
      frameLimit: options.frameLimit,
      pngCompressionLevel: options.pngCompressionLevel,
      gamma: options.gamma,
      scanlines: options.scanlines,
      saturation: options.saturation,
      brightness: options.brightness,
      contrast: options.contrast,
      vignette: options.vignette,
      bloom: options.bloom,
      bloomThreshold: options.bloomThreshold,
      ntsc: options.ntsc,
      curvature: options.curvature,
      chromaticAberration: options.chromaticAberration,
      hasUserEffects: options.hasUserEffects,
      config: options.config,
      configPath: options.configPath,
      settingsManager,
      // Netplay options - UI options override CLI options
      netplayHost: netplay?.mode === 'host' ? true : options.netplayHost,
      netplayConnect: netplay?.mode === 'join' ? netplay.host : options.netplayConnect,
      netplayPort: netplay?.port ?? options.netplayPort,
      netplayPassword: netplay?.password ?? options.netplayPassword,
      netplaySpectate: netplay?.spectate ?? options.netplaySpectate,
      netplayNickname: netplay?.nickname ?? options.netplayNickname,
      netplayInputDelay: netplay?.inputDelay ?? options.netplayInputDelay,
    });

    let stateLoaded = false;
    if (shouldRestore && statePathToLoad) {
      stateLoaded = await emulator.loadState(statePathToLoad);
    }

    // Set up signal handlers for graceful shutdown
    const signalHandler = () => {
      emulator.stop();
    };
    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    try {
      await emulator.run(stateLoaded);
    } finally {
      // Clean up signal handlers
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
    }
    const sessionSeconds = emulator.getSessionSeconds();

    // If netplay disconnected unexpectedly (not by user choice), show dialog and offer reconnection
    if (emulator.wasNetplayDisconnected() && !emulator.wasIntentionalDisconnect()) {
      const disconnectInfo = emulator.getNetplayDisconnectInfo();
      const choice = await showNetplayDisconnectedDialog(
        {
          reason: disconnectInfo.reason,
          host: disconnectInfo.host || undefined,
          port: disconnectInfo.port || undefined,
        },
        {
          nativeMode: options.config.video_driver === 'native',
          scaleFactor: options.config.menu_scale_factor,
        }
      );

      if (choice === 'reconnect') {
        // Recursively call runEmulator to try reconnecting
        return runEmulator(romPath, options, resumeGame, resumeCoreId, netplay);
      }

      if (choice === 'exit') {
        // User pressed CTRL-C - exit the app entirely
        return { shouldContinue: false, gameWasPlayed: true, coreId: systemInfo.id, sessionSeconds };
      }

      // User chose menu - return to browser with netplay panel
      return { shouldContinue: true, gameWasPlayed: true, coreId: systemInfo.id, sessionSeconds, showNetplayOnReturn: true };
    }

    // If user intentionally disconnected from netplay, return to browser without disconnect dialog
    if (emulator.wasIntentionalDisconnect()) {
      return { shouldContinue: true, gameWasPlayed: true, coreId: systemInfo.id, sessionSeconds };
    }

    return { shouldContinue: true, gameWasPlayed: true, coreId: systemInfo.id, sessionSeconds };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.error("Error:", errorMsg);
    logger.error(errorMsg, 'Emulator');
    // If netplay was requested and failed, show netplay panel on return to browser
    const netplayWasRequested = isJoiningNetplay || options.netplayHost || !!netplay;
    return { shouldContinue: true, gameWasPlayed: false, showNetplayOnReturn: netplayWasRequested };
  }
};
