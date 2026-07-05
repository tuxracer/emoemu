/**
 * Core Downloader Service
 *
 * Downloads and installs libretro cores from the RetroArch buildbot.
 * Provides progress callbacks for UI integration.
 */

import { createWriteStream, existsSync, writeFileSync } from "fs";
import { readJsonFile } from '../../utils/readJsonFile';
import { ensureDirectory } from '../../utils/ensureDirectory';
import { mkdir, unlink, chmod } from "fs/promises";
import { pipeline } from "stream/promises";
import { dirname, join } from "path";
import { platform, arch } from "os";
import { Readable } from "stream";
import { execSync } from "child_process";
import { getCoresDirectory } from "../config";
import { getConfigDirectory } from "../../utils/paths";
import {
  requiresBuildFromSource,
  getBuildReason,
  buildCore,
  type BuildProgress,
} from "../coreBuilder";
import { logger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/getErrorMessage";
import { CoreDownloadError } from "./types";

/** Base URL for the RetroArch buildbot */
const BUILDBOT_BASE_URL = "https://buildbot.libretro.com/nightly";

/** Cache duration: 1 week in milliseconds */
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const CACHE_DURATION_MS = DAYS_PER_WEEK * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** Path to the cores index cache file */
const getCacheFilePath = (): string => join(getConfigDirectory(), "cache", "cores-index.json");

/** Index file suffix for the buildbot */
const INDEX_SUFFIX = ".index-extended";

/** File permissions for executable cores */
const EXECUTABLE_PERMISSIONS = 0o755;

/** Recommended cores with descriptions - popular systems only */
export const RECOMMENDED_CORES = [
  {
    name: "bsnes",
    description: "SNES",
  },
  {
    name: "mgba",
    description: "Game Boy Advance",
  },
  {
    name: "gambatte",
    description: "Game Boy / Color",
  },
  {
    name: "picodrive",
    description: "Sega Genesis / Mega Drive",
  },
  {
    name: "mupen64plus_next",
    description: "Nintendo 64 (software rendering)",
  },
] as const;

/** Set of recommended core names for quick lookup */
export const RECOMMENDED_CORE_NAMES: Set<string> = new Set(RECOMMENDED_CORES.map(c => c.name));

/**
 * Comprehensive mapping of libretro core names to system descriptions.
 * Used to display what system each core emulates.
 */
export const CORE_DESCRIPTIONS: Record<string, string> = {
  // Build from recommended cores first
  ...Object.fromEntries(RECOMMENDED_CORES.map(c => [c.name, c.description])),

  // Additional cores not in recommended list
  // NES / Famicom
  quicknes: "NES (fast)",
  bnes: "NES",
  fixnes: "NES",

  // SNES
  snes9x_next: "SNES",
  snes9x2002: "SNES (very fast)",
  snes9x2005: "SNES (fast)",
  snes9x2005_plus: "SNES (fast)",
  snes9x2010: "SNES",
  bsnes_mercury_accuracy: "SNES (high accuracy)",
  bsnes_mercury_balanced: "SNES (balanced)",
  bsnes_mercury_performance: "SNES (performance)",
  bsnes_hd_beta: "SNES (HD mode 7)",
  bsnes_cplusplus98: "SNES",
  mednafen_snes: "SNES",
  mesen_s: "SNES (cycle-accurate)",

  // Game Boy / Color
  sameboy: "Game Boy / Color (accurate)",
  gearboy: "Game Boy / Color",
  mgba: "Game Boy Advance",
  vbam: "Game Boy Advance",
  meteor: "Game Boy Advance",

  // Nintendo 64
  mupen64plus_next: "Nintendo 64 (software rendering)",
  parallel_n64: "Nintendo 64 (requires GPU)",

  // Nintendo DS
  melonds: "Nintendo DS",
  desmume: "Nintendo DS",
  desmume2015: "Nintendo DS",

  // Sega
  genesis_plus_gx_wide: "Genesis (widescreen)",
  smsplus: "Master System / Game Gear",
  emux_sms: "Master System",
  flycast: "Dreamcast",
  redream: "Dreamcast",
  kronos: "Saturn",
  mednafen_saturn: "Saturn",
  yabause: "Saturn",

  // PlayStation
  beetle_psx: "PlayStation (accurate)",
  beetle_psx_hw: "PlayStation (hardware)",
  duckstation: "PlayStation",
  swanstation: "PlayStation",
  pcsx1: "PlayStation",

  // PSP
  ppsspp: "PlayStation Portable",

  // Atari
  stella2014: "Atari 2600",
  atari800: "Atari 8-bit / 5200",
  a5200: "Atari 5200",
  virtualjaguar: "Atari Jaguar",

  // Other consoles
  mednafen_lynx: "Atari Lynx",
  beetle_lynx: "Atari Lynx",
  mednafen_pcfx: "PC-FX",
  beetle_pcfx: "PC-FX",
  opera: "3DO",
  "4do": "3DO",
  neocd: "Neo Geo CD",
  race: "Neo Geo Pocket",
  beetle_ngp: "Neo Geo Pocket",
  beetle_wswan: "WonderSwan",
  beetle_vb: "Virtual Boy",
  beetle_supergrafx: "SuperGrafx",
  mednafen_supergrafx: "SuperGrafx",

  // Arcade
  mame: "Arcade (MAME)",
  mame2000: "Arcade (MAME 2000)",
  mame2003: "Arcade (MAME 2003)",
  mame2003_plus: "Arcade (MAME 2003+)",
  mame2010: "Arcade (MAME 2010)",
  mame2015: "Arcade (MAME 2015)",
  mame2016: "Arcade (MAME 2016)",
  fbneo: "Arcade (FinalBurn Neo)",
  fbalpha: "Arcade (FinalBurn Alpha)",
  fbalpha2012: "Arcade (FBA 2012)",
  fbalpha2012_cps1: "Arcade (CPS1)",
  fbalpha2012_cps2: "Arcade (CPS2)",
  fbalpha2012_cps3: "Arcade (CPS3)",
  fbalpha2012_neogeo: "Arcade (Neo Geo)",

  // Computers
  dosbox: "DOS",
  dosbox_core: "DOS",
  dosbox_pure: "DOS",
  dosbox_svn: "DOS",
  puae: "Amiga",
  uae4arm: "Amiga",
  vice_x64: "Commodore 64",
  vice_x64sc: "Commodore 64 (accurate)",
  vice_x128: "Commodore 128",
  vice_xpet: "Commodore PET",
  vice_xplus4: "Commodore Plus/4",
  vice_xvic: "VIC-20",
  vice_xcbm2: "Commodore CBM-II",
  vice_xcbm5x0: "Commodore CBM 5x0",
  frodo: "Commodore 64",
  fmsx: "MSX / MSX2",
  bluemsx: "MSX / MSX2 / ColecoVision",
  hatari: "Atari ST",
  theodore: "Thomson MO/TO",
  x1: "Sharp X1",
  px68k: "Sharp X68000",
  np2kai: "PC-98",
  nekop2: "PC-98",
  quasi88: "PC-88",
  pc88: "PC-88",
  ep128emu: "Enterprise 128",

  // ScummVM / game engines
  scummvm: "ScummVM (adventure games)",
  easyrpg: "RPG Maker 2000/2003",
  prboom: "Doom",
  tyrquake: "Quake",
  vitaquake2: "Quake II",
  vitaquake3: "Quake III",
  ecwolf: "Wolfenstein 3D",
  cannonball: "OutRun",
  dinothawr: "Dinothawr (puzzle game)",
  mrboom: "Mr. Boom (Bomberman clone)",
  gong: "Pong",
  "2048": "2048",
  craft: "Minecraft clone",

  // Other
  uzem: "Uzebox",
  lowresnx: "LowRes NX (fantasy console)",
  tic80: "TIC-80 (fantasy console)",
  lutro: "Lutro (Lua game framework)",
  chailove: "ChaiLove (2D game framework)",
  pokemini: "Pokemon Mini",
  mednafen_coverflow: "Channel F",
  freechaf: "Channel F",
  nxengine: "Cave Story",
};

/** Information about an available core from the buildbot */
export interface AvailableCoreInfo {
  name: string;
  filename: string;
  size: number;
  date: string;
  description?: string;
  isRecommended: boolean;
}

/** Cache structure for storing cores list with timestamp */
interface CoresCache {
  timestamp: number;
  platform: string;
  arch: string;
  cores: AvailableCoreInfo[];
}

/**
 * Type guard to validate cache structure
 */
const isValidCoresCache = (data: unknown): data is CoresCache =>
  typeof data === "object" &&
  data !== null &&
  "timestamp" in data &&
  typeof data.timestamp === "number" &&
  "platform" in data &&
  typeof data.platform === "string" &&
  "arch" in data &&
  typeof data.arch === "string" &&
  "cores" in data &&
  Array.isArray(data.cores);

/**
 * Read the cached cores list if it exists and is valid
 * @returns Cached cores or null if cache is missing/expired/invalid
 */
const readCoresCache = (): AvailableCoreInfo[] | null => {
  const data = readJsonFile(getCacheFilePath());

  if (!isValidCoresCache(data)) {
    return null;
  }

  // Check if cache is for current platform/arch
  if (data.platform !== platform() || data.arch !== arch()) {
    return null;
  }

  // Check if cache has expired
  const age = Date.now() - data.timestamp;
  if (age > CACHE_DURATION_MS) {
    return null;
  }

  return data.cores;
};

/**
 * Write the cores list to cache
 */
const writeCoresCache = (cores: AvailableCoreInfo[]): void => {
  const cachePath = getCacheFilePath();
  const cacheDir = dirname(cachePath);

  ensureDirectory(cacheDir);

  const cache: CoresCache = {
    timestamp: Date.now(),
    platform: platform(),
    arch: arch(),
    cores,
  };

  writeFileSync(cachePath, JSON.stringify(cache), "utf-8");
};

/** Progress callback for download operations */
export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
  phase: "downloading" | "extracting" | "building" | "complete";
  /** Build-specific message when phase is "building" */
  buildMessage?: string;
  /** Build progress percentage (0-100) when phase is "building" */
  buildProgressPercent?: number;
  /** Human-readable build progress (e.g., "15 of 238 files") */
  buildProgressText?: string;
}

/**
 * Get the buildbot URL path and file extension for the current platform
 */
export const getBuildPath = (): { path: string; ext: string } => {
  const p = platform();
  const a = arch();

  switch (p) {
    case "darwin":
      // macOS - arm64 or x86_64
      if (a === "arm64") {
        return { path: "apple/osx/arm64", ext: ".dylib" };
      } else {
        return { path: "apple/osx/x86_64", ext: ".dylib" };
      }

    case "linux":
      // Linux - x86_64 or arm
      if (a === "arm64" || a === "arm") {
        return { path: "linux/armv7-neon-hf", ext: ".so" };
      } else {
        return { path: "linux/x86_64", ext: ".so" };
      }

    case "win32":
      // Windows - x86_64 or x86
      if (a === "x64") {
        return { path: "windows/x86_64", ext: ".dll" };
      } else {
        return { path: "windows/x86", ext: ".dll" };
      }

    default:
      throw new CoreDownloadError('UNSUPPORTED_PLATFORM', p);
  }
};

/**
 * Parse the buildbot index file to get available cores
 * Format: YYYY-MM-DD hexhash filename
 * Example: 2026-01-21 eabc1f27 mgba_libretro.dylib.zip
 */
const parseIndexFile = (content: string, ext: string): AvailableCoreInfo[] => {
  const cores: AvailableCoreInfo[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Format: YYYY-MM-DD hexhash filename
    const match = line.match(/^(\d{4}-\d{2}-\d{2}) [a-f0-9]+ (.+)$/);
    if (!match) { continue; }

    const [, date, filename] = match;

    // Only include core files (with .zip extension)
    if (!filename.endsWith(`${ext}.zip`)) { continue; }

    // Extract core name from filename: corename_libretro.ext.zip
    const coreMatch = filename.match(/^(.+)_libretro/);
    if (!coreMatch) { continue; }

    const name = coreMatch[1];

    cores.push({
      name,
      filename,
      size: 0, // Size not available in this index format
      date,
      description: CORE_DESCRIPTIONS[name],
      isRecommended: RECOMMENDED_CORE_NAMES.has(name),
    });
  }

  return cores;
};

/**
 * Fetch the list of available cores from the buildbot.
 * Uses a local cache that's refreshed at most once per week.
 *
 * @param forceRefresh If true, bypasses the cache and fetches fresh data
 */
export const fetchAvailableCores = async (forceRefresh = false): Promise<AvailableCoreInfo[]> => {
  // Check cache first unless force refresh requested
  if (!forceRefresh) {
    const cached = readCoresCache();
    if (cached) {
      return cached;
    }
  }

  const { path: buildPath, ext } = getBuildPath();
  const indexUrl = `${BUILDBOT_BASE_URL}/${buildPath}/latest/${INDEX_SUFFIX}`;

  const response = await fetch(indexUrl);
  if (!response.ok) {
    throw new CoreDownloadError('FETCH_INDEX_FAILED', `HTTP ${response.status}`);
  }

  const content = await response.text();
  const cores = parseIndexFile(content, ext);

  // Save to cache
  writeCoresCache(cores);

  return cores;
};

/**
 * Extract a zip file to a destination directory
 */
const extractZip = async (zipPath: string, destDir: string): Promise<void> => {
  try {
    execSync(`unzip -o -q "${zipPath}" -d "${destDir}"`, {
      stdio: "pipe",
    });
  } catch {
    throw new CoreDownloadError('EXTRACT_FAILED', zipPath);
  }
};

/**
 * Download a core from the buildbot, or build from source if required.
 *
 * On ARM macOS, certain cores (like mupen64plus_next) require building from
 * source because the pre-built binaries need OpenGL which isn't available
 * for terminal-based rendering.
 *
 * @param coreName Name of the core to download (e.g., "mgba")
 * @param onProgress Optional callback for progress updates
 * @returns Path to the installed core file
 */
export const downloadCore = async (
  coreName: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> => {
  // Check if this core needs to be built from source on this platform
  if (requiresBuildFromSource(coreName)) {
    const reason = getBuildReason(coreName);
    onProgress?.({
      bytesDownloaded: 0,
      totalBytes: null,
      phase: "building",
      buildMessage: reason ?? "Building from source...",
    });

    // Wrap build progress into download progress format
    const buildProgressHandler = (buildProgress: BuildProgress): void => {
      onProgress?.({
        bytesDownloaded: 0,
        totalBytes: null,
        phase: buildProgress.phase === "complete" ? "complete" : "building",
        buildMessage: buildProgress.message,
        buildProgressPercent: buildProgress.progressPercent,
        buildProgressText: buildProgress.progressText,
      });
    };

    return buildCore(coreName, buildProgressHandler);
  }

  const { path: buildPath, ext } = getBuildPath();
  const coresDir = getCoresDirectory();

  // Ensure cores directory exists
  if (!existsSync(coresDir)) {
    await mkdir(coresDir, { recursive: true });
  }

  const coreFileName = `${coreName}_libretro${ext}`;
  const destPath = join(coresDir, coreFileName);

  // Check if already exists
  if (existsSync(destPath)) {
    onProgress?.({ bytesDownloaded: 0, totalBytes: 0, phase: "complete" });
    return destPath;
  }

  // Download the zip file
  const compressedFileName = `${coreFileName}.zip`;
  const zipUrl = `${BUILDBOT_BASE_URL}/${buildPath}/latest/${compressedFileName}`;
  const tempPath = `${destPath}.zip`;

  logger.info(`Downloading core ${coreName} from ${zipUrl}`, "CoreDownloader");

  try {
    const response = await fetch(zipUrl);
    if (!response.ok) {
      throw new CoreDownloadError('DOWNLOAD_FAILED', `HTTP ${response.status}`);
    }

    const body = response.body;
    if (!body) {
      throw new CoreDownloadError('NO_RESPONSE_BODY');
    }

    const totalBytes = response.headers.get("content-length");
    const totalSize = totalBytes ? parseInt(totalBytes, 10) : null;

    // Track download progress
    let bytesDownloaded = 0;
    const progressStream = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        bytesDownloaded += chunk.length;
        onProgress?.({
          bytesDownloaded,
          totalBytes: totalSize,
          phase: "downloading",
        });
        controller.enqueue(chunk);
      },
    });

    // Convert web ReadableStream to Node.js Readable through transform
    const webStream = body.pipeThrough(progressStream);
    const nodeStream = Readable.fromWeb(webStream as import("stream/web").ReadableStream);
    const fileStream = createWriteStream(tempPath);

    await pipeline(nodeStream, fileStream);

    // Extract the zip file
    onProgress?.({
      bytesDownloaded,
      totalBytes: totalSize,
      phase: "extracting",
    });

    await extractZip(tempPath, coresDir);

    // Clean up the zip file
    await unlink(tempPath);

    // Make the core executable (important for macOS/Linux)
    if (platform() !== "win32") {
      await chmod(destPath, EXECUTABLE_PERMISSIONS);
    }

    logger.info(`Successfully installed core ${coreName} to ${destPath}`, "CoreDownloader");

    onProgress?.({
      bytesDownloaded,
      totalBytes: totalSize,
      phase: "complete",
    });

    return destPath;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error(`Failed to download core ${coreName}: ${errorMessage}`, "CoreDownloader");
    throw error;
  }
};

/**
 * Check if a core is installed
 */
export const isCoreInstalled = (coreName: string): boolean => {
  const { ext } = getBuildPath();
  const coresDir = getCoresDirectory();
  const coreFileName = `${coreName}_libretro${ext}`;
  return existsSync(join(coresDir, coreFileName));
};

/**
 * Get the path to an installed core
 */
export const getCorePath = (coreName: string): string | null => {
  const { ext } = getBuildPath();
  const coresDir = getCoresDirectory();
  const coreFileName = `${coreName}_libretro${ext}`;
  const fullPath = join(coresDir, coreFileName);
  return existsSync(fullPath) ? fullPath : null;
};

/**
 * Remove an installed core
 * @param coreName Name of the core to remove (e.g., "mgba", "mupen64plus_next")
 * @returns true if the core was removed, false if it wasn't installed
 */
export const removeCore = async (coreName: string): Promise<boolean> => {
  const corePath = getCorePath(coreName);

  if (!corePath) {
    return false;
  }

  try {
    await unlink(corePath);
    logger.info(`Removed core ${coreName} from ${corePath}`, "CoreDownloader");
    return true;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error(`Failed to remove core ${coreName}: ${errorMessage}`, "CoreDownloader");
    throw error;
  }
};

// Re-export build-related functions for UI use
export { requiresBuildFromSource, getBuildReason } from "../coreBuilder";
export * from "./types";
