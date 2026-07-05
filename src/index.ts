#!/usr/bin/env node

import { VERSION_WITH_DATE as VERSION, BUILD_DATE } from "./consts";
import { statSync } from "fs";
import { expandPath } from "./utils/paths";
import { detectKittyGraphicsSupport } from "./utils/kitty";
import { detectCellPixelSize } from "./utils/terminal";
import { showWarningDialog } from "./ui";
import { logger } from "./utils/logger";
import { cpus } from "os";
import { loadConfig, getPlaylistsDirectory } from "./frontend/config";
import { updateServices } from "./frontend/serviceProvider";

import { isFensterAvailable, getWindowManager } from "./rendering/nativeUi";
import {
  generatePlaylistsBySystem,
  updatePlaylistRuntime,
  buildPlaylistIndex,
  normalizePath,
} from "./frontend/playlist";

// Load libretro cores from default paths (not RetroArch - use --retroarch flag for that)
import {
  loadDefaultLibretroCores,
  loadRetroArchCores,
  loadCoresFromConfig,
} from "./cores/libretro/loader";
import { launchBrowser, importDirectory, validateRomFile } from "./ui";
import type { RomInfo } from "./ui";
import { STDIN_SETTLE_DELAY_MS } from "./ui";

import { parseArgs, updateOptionsFromConfig, applyCliOverrides, remapDriverOverride } from "./cli/parseArgs";
import {
  printUsage,
  debugGamepad,
  listGamepads,
  listCoresCommand,
  installCoreCommand,
  removeCoreCommand,
  clearLogsCommand,
  generatePlaylistCommand,
} from "./cli/commands";
import { runEmulator } from "./cli/runEmulator";

loadDefaultLibretroCores();

// Build date format constants (YYYYMMDD)
const BUILD_DATE_LENGTH = 8;
const BUILD_DATE_YEAR_END = 4;
const BUILD_DATE_MONTH_END = 6;

/**
 * Format build date from YYYYMMDD to "Mon DD YYYY" format
 * e.g., "20260121" -> "Jan 21 2026"
 */
const formatBuildDate = (dateStr: string): string => {
  if (!dateStr || dateStr.length !== BUILD_DATE_LENGTH) {
    return '';
  }
  const year = parseInt(dateStr.slice(0, BUILD_DATE_YEAR_END), 10);
  const month = parseInt(dateStr.slice(BUILD_DATE_YEAR_END, BUILD_DATE_MONTH_END), 10) - 1;
  const day = parseInt(dateStr.slice(BUILD_DATE_MONTH_END, BUILD_DATE_LENGTH), 10);
  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) {
    return '';
  }
  // Format without comma: "Jan 21 2026"
  const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const parts = formatter.formatToParts(date);
  const monthPart = parts.find(p => p.type === 'month')?.value ?? '';
  const dayPart = parts.find(p => p.type === 'day')?.value ?? '';
  const yearPart = parts.find(p => p.type === 'year')?.value ?? '';
  return `${monthPart} ${dayPart} ${yearPart}`;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Ensure the shared native window is torn down on any exit path.
  process.on("exit", () => {
    const wm = getWindowManager();
    if (wm.isInitialized()) {
      wm.destroy();
    }
  });

  // Check native window availability if native mode is requested
  const nativeRequested = options.renderMode === "native" || options.config.video_driver === "native";
  if (nativeRequested && !isFensterAvailable()) {
    const warnMsg = "Native window mode is not available. Falling back to Kitty graphics protocol.";
    logger.warn(warnMsg, "Video");
    const choice = await showWarningDialog(warnMsg, { title: "Native Mode Not Available" });
    if (choice === "exit") {
      process.exit(1);
    }
    if (options.renderMode === "native") {
      options.renderMode = "kitty";
    }
    if (options.config.video_driver === "native") {
      options.config.video_driver = "kitty";
    }
    remapDriverOverride(options.cliOverrides, "native", "kitty");
  }

  // Check Kitty graphics support if using Kitty mode (explicit or auto/default)
  const willUseKitty = options.renderMode === "kitty" ||
    options.renderMode === undefined ||
    options.config.video_driver === "kitty" ||
    options.config.video_driver === null;
  if (willUseKitty && !await detectKittyGraphicsSupport()) {
    const warnMsg = "Your terminal does not support the Kitty graphics protocol. " +
      "For the best experience, we recommend using a terminal that supports it:\n\n" +
      "  \u2022 Ghostty (recommended): https://ghostty.org\n" +
      "  \u2022 iTerm2: https://iterm2.com\n" +
      "  \u2022 kitty: https://sw.kovidgoyal.net/kitty\n\n" +
      "The emulator will fall back to Unicode half-block rendering.";
    logger.warn("Terminal does not support Kitty graphics protocol", "Video");
    const choice = await showWarningDialog(warnMsg, { title: "Terminal Compatibility" });
    if (choice === "exit") {
      process.exit(1);
    }
    // Fall back to terminal (Unicode half-block) mode
    if (options.renderMode === "kitty" || options.renderMode === undefined) {
      options.renderMode = "terminal";
    }
    if (options.config.video_driver === "kitty" || options.config.video_driver === null) {
      options.config.video_driver = "terminal";
    }
    remapDriverOverride(options.cliOverrides, "kitty", "terminal");
  } else if (willUseKitty) {
    // Measure the terminal's actual cell pixel size so the Kitty display keeps
    // the correct aspect ratio regardless of the user's font width. Must run
    // now, while stdin is directly queryable (before the render loop starts).
    await detectCellPixelSize();
  }

  // Configure logging from config options
  // Set custom log directory if specified (with ~ expansion)
  if (options.config.log_dir) {
    logger.setLogDirectory(expandPath(options.config.log_dir));
  }

  // Set whether to log to file or console
  logger.setLogToFile(options.config.log_to_file);

  // Set timestamped file mode (only applies when log_to_file is true)
  logger.setUseTimestampedFile(options.config.log_to_file_timestamp);

  // Enable logging based on config (log_verbosity)
  logger.setEnabled(options.config.log_verbosity);

  // Enable stderr output if --verbose flag is set
  if (options.verbose) {
    logger.setEnabled(true);  // --verbose implies logging enabled
    logger.setLogToStderr(true);
  }

  // Log startup information (RetroArch-style)
  logger.info(`emoemu ${VERSION}`, 'emoemu');
  logger.info('=== Build =======================================');
  logger.info(`Version: ${VERSION}`);
  const builtDate = formatBuildDate(BUILD_DATE);
  if (builtDate) {
    logger.info(`Built: ${builtDate}`);
  }
  logger.info(`CPU Model Name: ${cpus()[0]?.model ?? 'Unknown'}`);
  logger.info(`Node.js: ${process.version}`);
  logger.info('=================================================');

  // Handle --clear-logs early (clears logs and continues)
  if (options.clearLogs) {
    clearLogsCommand();
  }

  // Load cores from config's libretro_directory if specified (RetroArch-compatible)
  if (options.config.libretro_directory) {
    loadCoresFromConfig(options.config.libretro_directory);
  }

  // Load RetroArch cores if requested (before listing or detecting cores)
  if (options.loadRetroArch) {
    loadRetroArchCores();
  }

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

  // Handle --install-core before checking for ROM
  if (options.installCore) {
    await installCoreCommand(options.installCore);
    // If no ROM specified, exit after installation
    if (!options.romPath) {
      process.exit(0);
    }
    // Otherwise continue to run the emulator with the installed core
  }

  // Handle --remove-core before checking for ROM
  if (options.removeCore) {
    removeCoreCommand(options.removeCore);
    process.exit(0);
  }

  // Handle --debug-gamepad before checking for ROM
  if (options.debugGamepad) {
    debugGamepad();
    // debugGamepad() doesn't return - runs until Ctrl+C
    return;
  }

  // Handle --generate-playlist before checking for ROM
  if (options.generatePlaylist) {
    const scanPath = typeof options.generatePlaylist === 'string'
      ? options.generatePlaylist
      : process.cwd();
    generatePlaylistCommand(
      scanPath,
      options.scanDepth,
      options.playlistOutput,
      options.singlePlaylist,
      options.windowsPaths
    );
    process.exit(0);
  }

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  if (options.showVersion) {
    console.log(`emoemu ${VERSION}`);
    process.exit(0);
  }

  // Track the last played ROM and filter for restoring browser state
  let lastPlayedRom: string | undefined;
  let lastPlayedRomInfo: RomInfo | undefined;
  let lastPlayedCoreId: string | undefined;  // Core ID used for last played game (for resume)
  let lastFilter: string | undefined;
  let showSettingsOnMount = false;  // Show settings menu after exiting a game
  let showNetplayOnMount = false;   // Show netplay panel after netplay connection failure

  // Handle CLI path argument (directory or ROM file)
  if (options.romPath) {
    const playlistDir = getPlaylistsDirectory(options.config);

    try {
      const stats = statSync(options.romPath);
      if (stats.isDirectory()) {
        // Directory provided: import ROMs with progress bar UI, then show browser
        await importDirectory(options.romPath, options.scanDepth, options.config);
      } else {
        // ROM file provided: auto-import silently and launch immediately
        const playlistIndex = buildPlaylistIndex(playlistDir);
        const normalizedPath = normalizePath(options.romPath);
        if (!playlistIndex.has(normalizedPath)) {
          const validateResult = validateRomFile(options.romPath);
          if (validateResult.valid) {
            generatePlaylistsBySystem([validateResult.rom], playlistDir);
          }
        }

        const result = await runEmulator(options.romPath, options);
        if (!result.shouldContinue) {
          // Still update runtime even when exiting (user might press Esc to quit)
          if (result.gameWasPlayed && result.sessionSeconds !== undefined) {
            updatePlaylistRuntime(options.romPath, playlistDir, result.sessionSeconds);
          }
          process.exit(0);
        }
        // Check if netplay disconnected - show netplay panel instead of settings
        if (result.showNetplayOnReturn) {
          showNetplayOnMount = true;
          showSettingsOnMount = false;
          lastPlayedRom = options.romPath;
          lastPlayedCoreId = result.coreId;
        } else if (result.gameWasPlayed) {
          lastPlayedRom = options.romPath;
          lastPlayedCoreId = result.coreId;  // Track which core was used
          // Get RomInfo for the resume game feature
          const validateResult = validateRomFile(options.romPath);
          if (validateResult.valid) {
            lastPlayedRomInfo = validateResult.rom;
          }
          showSettingsOnMount = true;  // Show settings when returning from a game

          // Update playlist runtime (RetroArch compatible)
          if (result.sessionSeconds !== undefined) {
            updatePlaylistRuntime(options.romPath, playlistDir, result.sessionSeconds);
          }
        }
      }
    } catch {
      // Path doesn't exist - treat as ROM path and let runEmulator handle the error
      const playlistIndex = buildPlaylistIndex(playlistDir);
      const normalizedPath = normalizePath(options.romPath);
      if (!playlistIndex.has(normalizedPath)) {
        const validateResult = validateRomFile(options.romPath);
        if (validateResult.valid) {
          generatePlaylistsBySystem([validateResult.rom], playlistDir);
        }
      }

      const result = await runEmulator(options.romPath, options);
      if (!result.shouldContinue) {
        if (result.gameWasPlayed && result.sessionSeconds !== undefined) {
          updatePlaylistRuntime(options.romPath, playlistDir, result.sessionSeconds);
        }
        process.exit(0);
      }
      // Check if netplay disconnected - show netplay panel instead of settings
      if (result.showNetplayOnReturn) {
        showNetplayOnMount = true;
        showSettingsOnMount = false;
        lastPlayedRom = options.romPath;
        lastPlayedCoreId = result.coreId;
      } else if (result.gameWasPlayed) {
        lastPlayedRom = options.romPath;
        lastPlayedCoreId = result.coreId;
        const validateResult = validateRomFile(options.romPath);
        if (validateResult.valid) {
          lastPlayedRomInfo = validateResult.rom;
        }
        showSettingsOnMount = true;
        if (result.sessionSeconds !== undefined) {
          updatePlaylistRuntime(options.romPath, playlistDir, result.sessionSeconds);
        }
      }
    }
  }

  // Main browser loop - user can only exit the app from here
  for (;;) {
    // Reset stdin state for Ink to take over
    process.stdin.removeAllListeners('data');
    process.stdin.removeAllListeners('keypress');
    process.stdin.removeAllListeners('readable');

    // Small delay to let event loop settle before launching browser
    await new Promise(resolve => setTimeout(resolve, STDIN_SETTLE_DELAY_MS));

    const result = await launchBrowser(options.scanDepth, lastPlayedRom, lastFilter, options.config, options.configPath, showSettingsOnMount, lastPlayedRomInfo, lastPlayedCoreId, showNetplayOnMount, options.cliOverrides);

    // Reset mount flags after launching (only show once)
    showSettingsOnMount = false;
    showNetplayOnMount = false;

    // Always track the filter for next time
    lastFilter = result.filter;

    // Check if user triggered a refresh (e.g., after adding ROMs)
    if (result.shouldRefresh) {
      continue;  // Re-launch browser with fresh ROM list
    }

    if (!result.path) {
      // User exited browser - quit the app
      process.exit(0);
    }

    // Thoroughly reset stdin for emulator to take over
    // Remove all listeners that Ink may have attached
    process.stdin.removeAllListeners();

    // Drain any pending input that might be buffered
    process.stdin.read();

    // Reset TTY state - must be done in this order
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    // Small delay for stdin to fully settle
    await new Promise(resolve => setTimeout(resolve, STDIN_SETTLE_DELAY_MS));

    // Now pre-configure stdin for the emulator
    // The emulator's setupStdin will set rawMode to true, but we need stdin resumed first
    process.stdin.resume();

    // Reload config from disk in case settings were changed in the browser
    const { config: freshConfig } = loadConfig(options.configPath);
    options.config = freshConfig;
    applyCliOverrides(freshConfig, options.cliOverrides);  // CLI flags outrank the reloaded config
    updateServices(freshConfig);

    // Update runtime options from fresh config (for settings changed in browser)
    updateOptionsFromConfig(options, freshConfig);

    const emulatorResult = await runEmulator(result.path, options, result.resumeGame, result.resumeCoreId, result.netplay);

    // Check if user wants to exit the app entirely (e.g., CTRL-C on netplay disconnect dialog)
    if (!emulatorResult.shouldContinue) {
      process.exit(0);
    }

    // Check if netplay failed - show netplay panel instead of settings
    if (emulatorResult.showNetplayOnReturn) {
      showNetplayOnMount = true;
      showSettingsOnMount = false;
      // Still track last played ROM so it's selected when netplay panel opens
      lastPlayedRom = result.path;
      lastPlayedCoreId = emulatorResult.coreId;
    } else if (emulatorResult.gameWasPlayed) {
      // Only update state if game was actually played (not cancelled from dialog)
      // Track for next browser launch
      lastPlayedRom = result.path;
      lastPlayedCoreId = emulatorResult.coreId;  // Track which core was used
      // Get RomInfo for the resume game feature
      const validateResult = validateRomFile(result.path);
      if (validateResult.valid) {
        lastPlayedRomInfo = validateResult.rom;
      }
      // Show settings menu when returning from a game
      showSettingsOnMount = true;

      // Update playlist runtime (RetroArch compatible)
      if (emulatorResult.sessionSeconds !== undefined) {
        const playlistDir = getPlaylistsDirectory(freshConfig);
        updatePlaylistRuntime(result.path, playlistDir, emulatorResult.sessionSeconds);
      }
    }
  }
};

void main();
