import { GamepadManager } from '../../input/GamepadManager';
import HID from 'node-hid';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { getDefaultLogsDirectory } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { join } from 'path';
import {
  listCores,
  getSupportedExtensions,
  unregisterCore,
} from '../../frontend/coreRegistry';
import { HEX_RADIX, BYTE_DECIMAL_PAD_WIDTH } from '../../frontend';
import { scanDirectory } from '../../frontend/romScanner';
import {
  generatePlaylistsBySystem,
  generateConsolidatedPlaylist,
} from '../../frontend/playlist';
import type { PlaylistOptions } from '../../frontend/playlist';
import { downloadCore } from '../../frontend/coreDownloader';
import { registerLibretroCore, unloadLibretroCore } from '../../cores/libretro/loader';
import {
  LINE_CLEAR_WIDTH,
  PERCENT_MULTIPLIER,
  BYTES_PER_KB,
  PERCENT_SUFFIX_WIDTH,
  ELLIPSIS_LENGTH,
} from './consts';

export * from './consts';

export const printUsage = (): void => {
  // Get supported extensions from core registry
  const extensions = getSupportedExtensions().join(", ");

  console.log(`
emoemu - Terminal Retro Emulator

Usage: emoemu <rom> [options]

Options:
  --config <path>   Use a custom config file path
  --core <id>       Use a specific emulator core (see --list-cores)
  --list-cores      List available emulator cores and exit
  --install-core <name>  Download/build and install a libretro core by name
                    (e.g., --install-core mupen64plus_next)
  --remove-core <id>     Remove an installed libretro core (use same ID as --core)
  --retroarch       Also load libretro cores from RetroArch installation paths
  --native          Use native window rendering (best performance)
  --kitty           Use Kitty graphics protocol (default, best quality)
  --terminal        Use terminal character rendering (Unicode half-blocks)
  --ascii           Use colored ASCII character rendering
  --emoji           Use emoji character rendering
  --no-color        Disable colors (use with --ascii or --terminal)
  --scale <n>       Internal render scale for Kitty mode (default: 2)
  --png-level <n>   PNG compression level 1-9 for Kitty mode (default: 4)
                    Higher = smaller output, reduces terminal I/O bottleneck.
  --crt             CRT effect preset: --scale 1 --ntsc 1.0 --scanlines 0.1 --gamma 1.3 --vignette 0.5
                    --curvature 0.1 --chromatic-aberration 0.3
                    Individual flags can override these defaults
  --gamma <n>       Gamma correction (default: 1.0)
                    Values > 1.0 darken midtones (CRT-like), try 1.1-1.4
  --scanlines [n]   Scanline intensity (default: 0.3 if enabled)
                    Values 0.0-1.0, try 0.2-0.4 for subtle CRT effect
  --saturation <n>  Color saturation (default: 1.0)
                    Values > 1.0 boost colors (CRT-like), try 1.1-1.3
  --brightness <n>  Brightness multiplier (default: 1.0)
                    Values > 1.0 brighten, < 1.0 darken
  --contrast <n>    Contrast adjustment (default: 1.0)
                    Values > 1.0 increase contrast, < 1.0 decrease
  --vignette [n]    Vignette edge darkening (default: 1.0 if enabled)
                    Values 0.3-0.5 for subtle CRT-like edge darkening
  --bloom [n]       Phosphor bloom/glow for Kitty mode only (default: 0.5 if enabled)
                    Values 0.3-0.6 for subtle CRT phosphor glow
  --bloom-threshold <n>  Brightness threshold for bloom (default: 0.6)
                    Pixels brighter than this emit glow (range 0-1)
  --ntsc [n]        NTSC color artifacts for Kitty mode only (default: 1.0 if enabled)
                    Simulates horizontal color bleeding from composite video
  --curvature [n]   CRT screen curvature for Kitty mode only (default: 0.1 if enabled)
                    Barrel distortion to simulate curved CRT glass, try 0.1-0.3
  --chromatic-aberration [n]  RGB color fringing for Kitty mode only (default: 0.5 if enabled)
                    Simulates CRT electron beam convergence errors, try 0.3-1.0
  --width <n>       Set display width in characters (terminal/ascii mode)
  --height <n>      Set display height in characters (terminal/ascii mode)
  --list-gamepads   List detected gamepad/controller devices and exit
  --no-gamepad      Disable gamepad support
  --no-audio        Disable audio output
  --no-save-state   Disable save state loading and saving
  --no-battery-save Disable battery save (.srm) loading and saving
  --status          Show the status bar (disabled by default)
  --no-diff-render  Disable diff-based rendering optimization
  --no-render       Disable video rendering (for debugging, audio/emulation still run)
  --fps-limit <n>   Override FPS limit (0 = uncapped, default: core native)
  --frame-limit <n> Limit rendering to N fps (0 = off, default: 0)
                    Common values: 30, 60. Reduces terminal I/O while
                    emulation runs at full speed. Useful over SSH.
  --debug-gamepad   Show raw gamepad HID data (for debugging)
  --clear-logs      Delete all emoemu log files
  --verbose         Enable verbose logging to stderr (RetroArch-style)
  --help            Show this help message

Browser:
  --scan-depth <n>  Max depth to scan for ROMs (default: 1)
                    0 = only specified directory
                    1 = directory + immediate subdirectories
                    -1 = unlimited (scan all subdirectories)

Playlist Generation (RetroArch-compatible .lpl files):
  --generate-playlist [path]  Scan directory for ROMs and generate a playlist
                              If path is omitted, uses current directory
                              Creates per-system playlists (e.g., "Nintendo - NES.lpl")
  --playlist-output <dir>     Output directory for playlists (default: ./playlists)
  --single-playlist <name>    Generate one consolidated playlist instead of per-system
                              Specify the playlist name (without .lpl extension)
  --windows-paths             Use Windows-style backslash separators in paths

Netplay (RetroArch-compatible multiplayer):
  --netplay-host              Host a netplay session (server mode)
  --netplay-connect [host]    Connect to a netplay server (host or host:port)
                              If host is omitted, auto-discovers LAN hosts
  --netplay-port <n>          Port for netplay (default: 55435)
  --netplay-password <pw>     Password for netplay session
  --netplay-spectate          Join as spectator (view only)
  --netplay-nick <name>       Set your nickname (default: Player)
  --netplay-frames <n>        Input delay frames 0-16 (default: 0)
                              Higher values reduce rollbacks at cost of latency

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
};

export const debugGamepad = (): void => {
  console.log("Gamepad Debug Mode");
  console.log("==================");
  console.log("Press Ctrl+C to exit\n");

  const devices = GamepadManager.listDevices();
  if (devices.length === 0) {
    console.log("No gamepad devices found.");
    process.exit(1);
  }

  const deviceInfo = devices[0];
  console.log(`Connecting to: ${deviceInfo.product}`);
  console.log(`Path: ${deviceInfo.path}\n`);

  try {
    const device = new HID.HID(deviceInfo.path);
    let lastData = "";

    device.on("data", (data: Buffer) => {
      // Only print if data changed (reduces noise)
      const hexStr = Array.from(data)
        .map(
          (b, i) =>
            `${i.toString().padStart(2)}:${b.toString(HEX_RADIX).padStart(2, "0")}`
        )
        .join(" ");

      if (hexStr !== lastData) {
        // Show byte index and value in both hex and decimal
        console.log(`\nBytes (${data.length}):`);
        const parts: string[] = [];
        for (let i = 0; i < data.length; i++) {
          parts.push(
            `[${i}]=0x${data[i].toString(HEX_RADIX).padStart(2, "0")}(${data[i]
              .toString()
              .padStart(BYTE_DECIMAL_PAD_WIDTH)})`
          );
        }
        console.log(parts.join(" "));
        lastData = hexStr;
      }
    });

    device.on("error", (err) => {
      console.error("Device error:", err);
      process.exit(1);
    });

    // Keep running
    process.on("SIGINT", () => {
      device.close();
      process.exit(0);
    });
  } catch (err) {
    console.error("Failed to open device:", err);
    process.exit(1);
  }
};

export const listGamepads = (): void => {
  console.log("Detected Gamepad Devices");
  console.log("========================\n");

  const devices = GamepadManager.listDevices();

  if (devices.length === 0) {
    console.log("No gamepad devices detected.\n");
    console.log("Tips:");
    console.log(
      "  - Make sure your controller is connected and paired (for Bluetooth)"
    );
    console.log("  - Try pressing a button on the controller to wake it up");
    console.log(
      '  - On Linux, you may need to add your user to the "input" group\n'
    );
  } else {
    const HEX_ID_WIDTH = 4;
    for (const device of devices) {
      console.log(`${device.product}`);
      console.log(`  Manufacturer: ${device.manufacturer}`);
      console.log(
        `  Vendor ID:    0x${device.vendorId.toString(HEX_RADIX).padStart(HEX_ID_WIDTH, "0")}`
      );
      console.log(
        `  Product ID:   0x${device.productId.toString(HEX_RADIX).padStart(HEX_ID_WIDTH, "0")}`
      );
      console.log(`  Profile:      ${device.profile}`);
      console.log("");
    }
  }

  console.log("Supported Controllers:");
  for (const profile of GamepadManager.getSupportedProfiles()) {
    console.log(`  - ${profile}`);
  }
  console.log("  - Generic USB Gamepad (fallback)");
};

export const listCoresCommand = (): void => {
  console.log("Available Emulator Cores");
  console.log("========================\n");

  const cores = listCores();

  if (cores.length === 0) {
    console.log("No cores registered.\n");
  } else {
    for (const core of cores) {
      console.log(`${core.name} (--core ${core.id})`);
      console.log(`  Extensions: ${core.extensions.join(", ")}`);
      console.log(`  Path: ${core.path}`);
      console.log("");
    }
  }

  console.log("Note: Cores are auto-detected by ROM file extension.");
  console.log("      Use --core <id> to override auto-detection.");
};

/** Format bytes as human-readable string */
const formatBytes = (bytes: number): string => {
  const mb = BYTES_PER_KB * BYTES_PER_KB;
  if (bytes >= mb) {
    return `${(bytes / mb).toFixed(1)} MB`;
  } else if (bytes >= BYTES_PER_KB) {
    return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  }
  return `${bytes} B`;
};

/** Install/build a libretro core by name */
export const installCoreCommand = async (coreName: string): Promise<void> => {
  console.log(`Installing core: ${coreName}`);
  console.log("");

  try {
    const corePath = await downloadCore(coreName, (progress) => {
      if (progress.phase === "downloading") {
        const percent = progress.totalBytes
          ? Math.round((progress.bytesDownloaded / progress.totalBytes) * PERCENT_MULTIPLIER)
          : 0;
        const downloaded = formatBytes(progress.bytesDownloaded);
        const total = progress.totalBytes ? formatBytes(progress.totalBytes) : "unknown";
        // Use carriage return to update the same line
        process.stdout.write(`\rDownloading: ${downloaded} / ${total} (${percent}%)`);
      } else if (progress.phase === "extracting") {
        // Clear the download line and show extracting status
        process.stdout.write("\r" + " ".repeat(LINE_CLEAR_WIDTH) + "\r");
        console.log("Extracting...");
      } else if (progress.phase === "building") {
        // Building from source - show progress percentage with build output
        if (progress.buildProgressPercent !== undefined && progress.buildMessage) {
          const percent = progress.buildProgressPercent;
          // Truncate message to fit on one line with percentage
          const maxMsgLen = LINE_CLEAR_WIDTH - PERCENT_SUFFIX_WIDTH;
          const msg = progress.buildMessage.length > maxMsgLen
            ? progress.buildMessage.slice(0, maxMsgLen - ELLIPSIS_LENGTH) + "..."
            : progress.buildMessage.padEnd(maxMsgLen);
          // Use carriage return to update the same line
          process.stdout.write(`\r${msg} (${percent}%)`);
        } else if (progress.buildMessage) {
          // No progress data - just log the message (used during initial analysis)
          process.stdout.write("\r" + " ".repeat(LINE_CLEAR_WIDTH) + "\r");
          console.log(progress.buildMessage);
        }
      } else {
        // phase === "complete" - clear any partial line
        process.stdout.write("\r" + " ".repeat(LINE_CLEAR_WIDTH) + "\r");
      }
    });

    // Register the newly installed core so it can be used immediately
    registerLibretroCore(corePath);

    console.log(`Successfully installed: ${corePath}`);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error(`\nError installing core: ${errorMessage}`);
    logger.error(`Failed to install core ${coreName}: ${errorMessage}`, "CLI");
    process.exit(1);
  }
};

/**
 * Remove an installed libretro core by ID
 * Uses the same core ID shown in --list-cores and accepted by --core
 */
export const removeCoreCommand = (coreId: string): void => {
  // Look up the core in the registry by ID
  const cores = listCores();
  const core = cores.find(c => c.id === coreId);

  if (!core) {
    console.error(`Core "${coreId}" is not installed.`);
    console.error("Use --list-cores to see installed cores.");
    process.exit(1);
  }

  // Don't allow removing native cores
  try {
    // Delete the core file
    unlinkSync(core.path);
    // Unregister from the core registry
    unregisterCore(coreId);
    // Clean up libretro loader tracking
    unloadLibretroCore(core.path, coreId);
    console.log(`Successfully removed: ${core.path}`);
    logger.info(`Removed core ${coreId} from ${core.path}`, "CLI");
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error(`Error removing core: ${errorMessage}`);
    logger.error(`Failed to remove core ${coreId}: ${errorMessage}`, "CLI");
    process.exit(1);
  }
};

/** Delete all emoemu log files */
export const clearLogsCommand = (): void => {
  const logsDir = getDefaultLogsDirectory();

  if (!existsSync(logsDir)) {
    console.log("No logs directory found. Nothing to delete.");
    return;
  }

  const files = readdirSync(logsDir);
  const logFiles = files.filter(f => f.endsWith('.log') || /\.log\.\d+$/.test(f));

  if (logFiles.length === 0) {
    console.log("No log files found.");
    return;
  }

  let deleted = 0;
  for (const file of logFiles) {
    try {
      unlinkSync(join(logsDir, file));
      deleted++;
    } catch {
      console.error(`Failed to delete: ${file}`);
    }
  }

  console.log(`Deleted ${deleted} log file${deleted === 1 ? '' : 's'} from ${logsDir}`);
};

/** Generate RetroArch-compatible playlists from scanned ROMs */
export const generatePlaylistCommand = (
  scanPath: string,
  scanDepth: number,
  outputDir: string,
  singlePlaylist: string | undefined,
  windowsPaths: boolean
): void => {
  console.log("Generating RetroArch Playlists");
  console.log("==============================\n");

  console.log(`Scanning: ${scanPath}`);
  console.log(`Scan depth: ${scanDepth === -1 ? 'unlimited' : scanDepth}`);
  console.log(`Output: ${outputDir}`);
  if (singlePlaylist) {
    console.log(`Mode: single playlist (${singlePlaylist}.lpl)`);
  } else {
    console.log(`Mode: per-system playlists`);
  }
  console.log("");

  // Scan for ROMs (CRC cache built automatically from playlists)
  console.log("Scanning for ROMs...");
  const roms = scanDirectory(scanPath, scanDepth);

  if (roms.length === 0) {
    console.log("No ROMs found.\n");
    console.log("Make sure you have libretro cores installed to detect ROM types.");
    console.log("Use --retroarch to load cores from RetroArch installation.");
    return;
  }

  console.log(`Found ${roms.length} ROM(s)\n`);

  // Build playlist options
  const playlistOptions: PlaylistOptions = {
    windowsPaths,
  };

  // Generate playlists
  if (singlePlaylist) {
    // Single consolidated playlist
    const outputPath = join(outputDir, singlePlaylist);
    const result = generateConsolidatedPlaylist(roms, outputPath, playlistOptions);

    if (result.success) {
      console.log(`Created: ${result.outputPath} (${result.entryCount} entries)`);
    } else {
      console.error(`Error: ${result.error}`);
    }
  } else {
    // Per-system playlists
    const results = generatePlaylistsBySystem(roms, outputDir, playlistOptions);

    let successCount = 0;
    let totalEntries = 0;

    for (const result of results) {
      if (result.success) {
        console.log(`Created: ${result.outputPath} (${result.entryCount} entries)`);
        successCount++;
        totalEntries += result.entryCount;
      } else {
        console.error(`Error: ${result.error}`);
      }
    }

    console.log(`\nGenerated ${successCount} playlist(s) with ${totalEntries} total entries.`);
  }
};
