/**
 * Libretro core loader
 *
 * Discovers libretro cores from directories and registers them with
 * the core registry, making them available for auto-detection.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { platform, homedir } from "os";
import { loadConfig } from "@/frontend/config";
import { expandPath } from "@/utils/paths";
import { logger } from "@/utils/logger";
import { getErrorMessage } from "@/utils/getErrorMessage";
import type { SystemInfo } from "@/core/core";
import { registerCore, type CoreCreateOptions } from "@/frontend/coreRegistry";
import { getCoresDirectory } from "@/frontend/config";
import { LibretroCore } from "..";

/**
 * Get possible RetroArch installation base directories for the current platform.
 * These are the root directories where RetroArch stores its config and cores.
 *
 * Structure within each base directory:
 * - Config: <base>/retroarch.cfg or <base>/config/retroarch.cfg
 * - Cores: <base>/cores/
 */
const getRetroArchBasePaths = (): string[] => {
  const paths: string[] = [];

  switch (platform()) {
    case "darwin":
      // macOS: User Application Support directory
      paths.push(join(homedir(), "Library", "Application Support", "RetroArch"));
      break;

    case "win32":
      // Windows: Multiple possible install locations
      // Portable/manual install locations
      paths.push("C:\\RetroArch");
      paths.push("C:\\RetroArch-Win64");
      // Program Files locations
      paths.push(
        join(process.env.PROGRAMFILES || "C:\\Program Files", "RetroArch")
      );
      paths.push(
        join(
          process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
          "RetroArch"
        )
      );
      // User AppData location
      paths.push(join(homedir(), "AppData", "Roaming", "RetroArch"));
      break;

    default:
      // Linux: XDG config directory
      paths.push(join(homedir(), ".config", "retroarch"));
      break;
  }

  return paths;
};

/**
 * Get possible locations for retroarch.cfg based on platform.
 * These are READ-ONLY lookups to find the libretro_directory setting.
 *
 * Checks both <base>/retroarch.cfg and <base>/config/retroarch.cfg
 * since different versions/platforms use different structures.
 */
const getRetroArchConfigPaths = (): string[] => {
  const paths: string[] = [];
  const basePaths = getRetroArchBasePaths();

  for (const base of basePaths) {
    // Some versions put config in a subdirectory
    paths.push(join(base, "config", "retroarch.cfg"));
    // Others put it directly in the base
    paths.push(join(base, "retroarch.cfg"));
  }

  // Platform-specific fallback locations not in a RetroArch directory
  switch (platform()) {
    case "win32":
      // Legacy Windows fallback: config directly in AppData
      if (process.env.APPDATA) {
        paths.push(join(process.env.APPDATA, "retroarch.cfg"));
      }
      break;

    default:
      // Linux: System-wide config fallback
      paths.push("/etc/retroarch.cfg");
      break;
  }

  return paths;
};

/**
 * Parse a RetroArch config file and extract the libretro_directory value
 * This is READ-ONLY - we never write to this file
 *
 * @param configPath Path to retroarch.cfg
 * @returns The libretro_directory path if found, null otherwise
 */
const parseRetroArchConfig = (configPath: string): string | null => {
  try {
    const content = readFileSync(configPath, "utf-8");

    // RetroArch config format: key = "value" or key = value
    // We're looking for: libretro_directory = "/path/to/cores"
    for (const line of content.split("\n")) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith("#") || trimmed === "") {
        continue;
      }

      // Match libretro_directory = "value" or libretro_directory = value
      const match = trimmed.match(/^libretro_directory\s*=\s*"?([^"]*)"?$/);
      if (match && match[1]) {
        const value = match[1].trim();
        // Skip placeholder values
        if (value && value !== "default" && value !== "~/.config/retroarch/cores") {
          return expandPath(value);
        }
      }
    }
  } catch {
    // Can't read config file, skip
  }

  return null;
};

/**
 * Get the libretro_directory from RetroArch config if available
 * This is READ-ONLY - we only read the config to find core paths
 *
 * @returns The libretro_directory path if found in any config, null otherwise
 */
export const getRetroArchLibretroDirectory = (): string | null => {
  const configPaths = getRetroArchConfigPaths();

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      const directory = parseRetroArchConfig(configPath);
      if (directory && existsSync(directory)) {
        return directory;
      }
    }
  }

  return null;
};

/**
 * Get the platform-specific library extension
 */
const getLibraryExtension = (): string => {
  switch (platform()) {
    case "darwin":
      return ".dylib";
    case "win32":
      return ".dll";
    default:
      return ".so";
  }
};

/**
 * Get paths to search for libretro cores (excluding RetroArch-specific paths)
 *
 * Search order:
 * 1. Current directory ./cores (for development)
 * 2. Platform-specific emoemu cores directory (matches RetroArch convention)
 *    - macOS: ~/Library/Application Support/emoemu/cores
 *    - Linux: ~/.config/emoemu/cores
 *    - Windows: %APPDATA%\emoemu\cores
 * 3. System library paths (Homebrew on macOS, /usr/lib on Linux)
 */
export const getDefaultCorePaths = (): string[] => {
  const paths: string[] = [];

  // Current directory cores folder (for development/portable use)
  paths.push("./cores");

  // Platform-specific emoemu cores directory (primary location)
  // This follows the same convention as RetroArch:
  // RetroArch: ~/Library/Application Support/RetroArch/cores
  // emoemu:    ~/Library/Application Support/emoemu/cores
  paths.push(getCoresDirectory());

  // Platform-specific system library paths (not part of RetroArch installs)
  switch (platform()) {
    case "darwin":
      // Homebrew paths
      paths.push("/usr/local/lib/libretro");
      paths.push("/opt/homebrew/lib/libretro");
      break;
    case "win32":
      // No additional system paths on Windows
      break;
    default:
      // Linux system library paths
      paths.push("/usr/lib/libretro");
      paths.push("/usr/local/lib/libretro");
      paths.push("/lib/x86_64-linux-gnu/libretro");
      break;
  }

  return paths;
};

/**
 * Get RetroArch-specific paths to search for libretro cores.
 * Includes both standard RetroArch installation directories and
 * custom libretro_directory from retroarch.cfg (READ-ONLY).
 */
export const getRetroArchCorePaths = (): string[] => {
  const paths: string[] = [];

  // Check RetroArch config for custom libretro_directory (READ-ONLY)
  const retroArchDir = getRetroArchLibretroDirectory();
  if (retroArchDir) {
    paths.push(retroArchDir);
  }

  // RetroArch installation directories (cores subfolder)
  for (const base of getRetroArchBasePaths()) {
    paths.push(join(base, "cores"));
  }

  return paths;
};

// Track loaded core paths to avoid duplicates
const loadedCorePaths = new Set<string>();

// Track registered core IDs to handle name collisions
const registeredCoreIds = new Set<string>();

/**
 * Load libretro cores from a directory and register them
 *
 * @param coreDirectory Path to directory containing libretro cores
 * @param verbose If true, log loading status to console (legacy)
 */
export const loadLibretroCores = (coreDirectory: string, verbose = false): void => {
  if (!existsSync(coreDirectory)) {
    return;
  }

  const ext = getLibraryExtension();
  const suffix = `_libretro${ext}`;

  let files: string[];
  try {
    files = readdirSync(coreDirectory).filter((f) => f.endsWith(suffix));
  } catch {
    // Can't read directory, skip
    return;
  }

  if (files.length > 0) {
    logger.debug(`Scanning cores directory: ${coreDirectory}`, 'Core');
  }

  for (const file of files) {
    const corePath = join(coreDirectory, file);

    // Skip if already loaded
    if (loadedCorePaths.has(corePath)) {
      continue;
    }

    // Note: mupen64plus requires a stub OpenGL library on macOS. See TRD for details.

    try {
      // Create a temporary instance to get system info
      const tempCore = new LibretroCore(corePath);
      const info = tempCore.getSystemInfo();
      tempCore.destroy();

      // Generate unique ID if there's a collision
      let coreId = info.id;
      let counter = 2;
      while (registeredCoreIds.has(coreId)) {
        coreId = `${info.id}-${counter}`;
        counter++;
      }

      // Cache the system info to avoid recreating the core
      const cachedInfo: SystemInfo = { ...info, id: coreId };

      // Register the core factory
      registerCore(coreId, {
        create: (options?: CoreCreateOptions) => new LibretroCore(corePath, options),
        extensions: info.extensions,
        getSystemInfo: () => cachedInfo,
        path: corePath,
      });

      loadedCorePaths.add(corePath);
      registeredCoreIds.add(coreId);

      // Log core loading (RetroArch-style)
      logger.info(`Loaded core: ${info.name} (${info.extensions.join(', ')})`, 'Core');

      if (verbose) {
        console.log(
          `Loaded libretro core: ${info.name} (${coreId}) - ${info.extensions.join(", ")}`
        );
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      logger.warn(`Failed to load core ${file}: ${errorMsg}`, 'Core');

      if (verbose) {
        console.warn(
          `Failed to load libretro core ${file}:`,
          getErrorMessage(error)
        );
      }
      // Continue with other cores
    }
  }
};

/**
 * Load libretro cores from all default paths (excludes RetroArch paths)
 *
 * @param verbose If true, log loading status
 */
export const loadDefaultLibretroCores = (verbose = false): void => {
  const paths = getDefaultCorePaths();
  for (const path of paths) {
    loadLibretroCores(path, verbose);
  }
};

/**
 * Load libretro cores from RetroArch installation directories.
 * This includes standard RetroArch paths and the libretro_directory
 * from retroarch.cfg (READ-ONLY config access).
 *
 * @param verbose If true, log loading status
 */
export const loadRetroArchCores = (verbose = false): void => {
  const paths = getRetroArchCorePaths();
  for (const path of paths) {
    loadLibretroCores(path, verbose);
  }
};

/**
 * Load libretro cores from a custom directory specified in config.
 * This respects the `libretro_directory` setting which is RetroArch-compatible.
 *
 * @param libretroDirectory Path to the custom cores directory
 * @param verbose If true, log loading status
 */
export const loadCoresFromConfig = (libretroDirectory: string, verbose = false): void => {
  if (libretroDirectory && libretroDirectory.trim() !== "") {
    const expandedPath = expandPath(libretroDirectory);
    if (existsSync(expandedPath)) {
      loadLibretroCores(expandedPath, verbose);
    }
  }
};

/**
 * Get the count of loaded libretro cores
 */
export const getLoadedLibretroCoreCount = (): number => loadedCorePaths.size;

/**
 * Check if a specific core path has been loaded
 */
export const isLibretroCoreLoaded = (corePath: string): boolean => loadedCorePaths.has(corePath);

/**
 * Unload a libretro core by path, removing it from tracking sets.
 * The core should already be unregistered from the registry before calling this.
 *
 * @param corePath Path to the core file
 * @param coreId The registered core ID (e.g., "mgba")
 * @returns true if the core was tracked and removed, false if not found
 */
export const unloadLibretroCore = (corePath: string, coreId: string): boolean => {
  const hadPath = loadedCorePaths.delete(corePath);
  const hadId = registeredCoreIds.delete(coreId);
  return hadPath || hadId;
};

/**
 * Dynamically register a single libretro core by path.
 * Use this to register cores that were downloaded while the app is running.
 *
 * @param corePath Absolute path to the core file
 * @param verbose If true, log loading status to console (legacy)
 * @returns The registered core ID, or null if registration failed
 */
export const registerLibretroCore = (corePath: string, verbose = false): string | null => {
  // Skip if already loaded
  if (loadedCorePaths.has(corePath)) {
    logger.debug(`Core already loaded: ${corePath}`, 'Core');
    if (verbose) {
      console.log(`Core already loaded: ${corePath}`);
    }
    return null;
  }

  try {
    // Create a temporary instance to get system info
    const tempCore = new LibretroCore(corePath);
    const info = tempCore.getSystemInfo();
    tempCore.destroy();

    // Generate unique ID if there's a collision
    let coreId = info.id;
    let counter = 2;
    while (registeredCoreIds.has(coreId)) {
      coreId = `${info.id}-${counter}`;
      counter++;
    }

    // Cache the system info to avoid recreating the core
    const cachedInfo: SystemInfo = { ...info, id: coreId };

    // Register the core factory
    registerCore(coreId, {
      create: (options?: CoreCreateOptions) => new LibretroCore(corePath, options),
      extensions: info.extensions,
      getSystemInfo: () => cachedInfo,
      path: corePath,
    });

    loadedCorePaths.add(corePath);
    registeredCoreIds.add(coreId);

    // Log core registration (RetroArch-style)
    logger.info(`Registered core: ${info.name} (${info.extensions.join(', ')})`, 'Core');

    if (verbose) {
      console.log(
        `Registered libretro core: ${info.name} (${coreId}) - ${info.extensions.join(", ")}`
      );
    }

    return coreId;
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    logger.warn(`Failed to register core ${corePath}: ${errorMsg}`, 'Core');

    if (verbose) {
      console.warn(
        `Failed to register libretro core ${corePath}:`,
        getErrorMessage(error)
      );
    }
    return null;
  }
};

/**
 * Check if a core path is in a user-managed cores directory.
 * This includes the default cores directory and any configured libretro_directory.
 * Uses path resolution to handle relative paths correctly.
 *
 * @param corePath The core's stored path
 * @returns true if the core is in a user-managed directory
 */
export const isInUserCoresDirectory = (corePath: string): boolean => {
  const resolvedCorePath = resolve(corePath);

  // Check default cores directory
  const defaultCoresDir = resolve(getCoresDirectory());
  if (resolvedCorePath.startsWith(defaultCoresDir)) {
    return true;
  }

  // Check configured libretro_directory if set
  const { config } = loadConfig();
  if (config.libretro_directory && config.libretro_directory.trim() !== "") {
    const resolvedConfiguredDir = resolve(expandPath(config.libretro_directory));
    if (resolvedCorePath.startsWith(resolvedConfiguredDir)) {
      return true;
    }
  }

  return false;
};
