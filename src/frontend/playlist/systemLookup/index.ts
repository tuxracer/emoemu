/**
 * System Lookup Utility
 *
 * Provides structured lookup of vendor and system names from file extensions.
 * Parses RetroArch database names like "Sega - Mega Drive - Genesis.lpl" into
 * separate vendor ("Sega") and system ("Mega Drive - Genesis") components.
 */

import { RETROARCH_DATABASE_NAMES, PLAYLIST_EXTENSION } from '..';

// =============================================================================
// Types
// =============================================================================

/**
 * Structured system information with separate vendor and system name.
 */
export interface SystemInfo {
  /** Hardware vendor/manufacturer (e.g., "Nintendo", "Sega", "NEC") */
  vendor: string;
  /** System/console name (e.g., "Nintendo 64", "Mega Drive - Genesis") */
  system: string;
  /** Full display name combining vendor and system (e.g., "Nintendo - Nintendo 64") */
  fullName: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Separator between vendor and system in database names */
const VENDOR_SYSTEM_SEPARATOR = ' - ';

/** Default vendor when system info cannot be parsed */
const DEFAULT_VENDOR = 'Unknown';

/** Default system when system info cannot be parsed */
const DEFAULT_SYSTEM = 'Unknown System';

// =============================================================================
// Internal Lookup Map
// =============================================================================

/**
 * Parsed system info keyed by normalized extension (with leading dot).
 * Built once from RETROARCH_DATABASE_NAMES on first access.
 */
let systemInfoMap: Map<string, SystemInfo> | null = null;

/**
 * Parse a database name into vendor and system components.
 * Database names follow the format: "{Vendor} - {System}.lpl"
 *
 * Examples:
 * - "Sega - Mega Drive - Genesis.lpl" → { vendor: "Sega", system: "Mega Drive - Genesis" }
 * - "Nintendo - Nintendo 64.lpl" → { vendor: "Nintendo", system: "Nintendo 64" }
 */
const parseDatabaseName = (dbName: string): SystemInfo => {
  // Remove .lpl extension if present
  const name = dbName.endsWith(PLAYLIST_EXTENSION)
    ? dbName.slice(0, -PLAYLIST_EXTENSION.length)
    : dbName;

  // Split on first " - " to get vendor and system
  const separatorIndex = name.indexOf(VENDOR_SYSTEM_SEPARATOR);

  if (separatorIndex === -1) {
    // No separator found - use whole name as system
    return {
      vendor: DEFAULT_VENDOR,
      system: name || DEFAULT_SYSTEM,
      fullName: name || DEFAULT_SYSTEM,
    };
  }

  const vendor = name.slice(0, separatorIndex);
  const system = name.slice(separatorIndex + VENDOR_SYSTEM_SEPARATOR.length);

  return {
    vendor: vendor || DEFAULT_VENDOR,
    system: system || DEFAULT_SYSTEM,
    fullName: name,
  };
};

/**
 * Build the system info lookup map from RETROARCH_DATABASE_NAMES.
 * Only includes entries with file extension keys (starting with .).
 */
const buildSystemInfoMap = (): Map<string, SystemInfo> => {
  const map = new Map<string, SystemInfo>();

  for (const [key, dbName] of Object.entries(RETROARCH_DATABASE_NAMES)) {
    // Normalize the key - add leading dot if missing
    const normalizedKey = key.startsWith('.') ? key.toLowerCase() : `.${key.toLowerCase()}`;

    // Skip if we already have this extension (prefer the dotted version)
    if (map.has(normalizedKey)) {
      continue;
    }

    map.set(normalizedKey, parseDatabaseName(dbName));
  }

  return map;
};

/**
 * Get or build the system info map (lazy initialization).
 */
const getSystemInfoMap = (): Map<string, SystemInfo> => {
  if (!systemInfoMap) {
    systemInfoMap = buildSystemInfoMap();
  }
  return systemInfoMap;
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Get structured system information for a file extension.
 *
 * @param extension - File extension (with or without leading dot, e.g., ".gen" or "gen")
 * @returns SystemInfo with vendor, system, and fullName; or default values if not found
 *
 * @example
 * getSystemInfo('.gen')
 * // → { vendor: 'Sega', system: 'Mega Drive - Genesis', fullName: 'Sega - Mega Drive - Genesis' }
 *
 * getSystemInfo('n64')
 * // → { vendor: 'Nintendo', system: 'Nintendo 64', fullName: 'Nintendo - Nintendo 64' }
 */
export const getSystemInfo = (extension: string): SystemInfo => {
  const normalizedExt = extension.startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;

  const info = getSystemInfoMap().get(normalizedExt);

  if (info) {
    return info;
  }

  // Return default for unknown extensions
  return {
    vendor: DEFAULT_VENDOR,
    system: DEFAULT_SYSTEM,
    fullName: DEFAULT_SYSTEM,
  };
};

/**
 * Get the vendor name for a file extension.
 *
 * @param extension - File extension (with or without leading dot)
 * @returns Vendor name (e.g., "Sega", "Nintendo") or "Unknown" if not found
 *
 * @example
 * getVendor('.gen') // → 'Sega'
 * getVendor('nes')  // → 'Nintendo'
 */
export const getVendor = (extension: string): string => {
  return getSystemInfo(extension).vendor;
};

/**
 * Get the system name for a file extension.
 *
 * @param extension - File extension (with or without leading dot)
 * @returns System name (e.g., "Mega Drive - Genesis") or "Unknown System" if not found
 *
 * @example
 * getSystemByExtension('.gen') // → 'Mega Drive - Genesis'
 * getSystemByExtension('n64')  // → 'Nintendo 64'
 */
export const getSystemByExtension = (extension: string): string => {
  return getSystemInfo(extension).system;
};

/**
 * Get all unique vendors from the database.
 *
 * @returns Array of vendor names, sorted alphabetically
 */
export const getAllVendors = (): string[] => {
  const vendors = new Set<string>();

  for (const info of getSystemInfoMap().values()) {
    vendors.add(info.vendor);
  }

  return [...vendors].sort();
};

/**
 * Get all systems for a specific vendor.
 *
 * @param vendor - Vendor name (case-insensitive)
 * @returns Array of system names for that vendor, sorted alphabetically
 */
export const getSystemsForVendor = (vendor: string): string[] => {
  const normalizedVendor = vendor.toLowerCase();
  const systems = new Set<string>();

  for (const info of getSystemInfoMap().values()) {
    if (info.vendor.toLowerCase() === normalizedVendor) {
      systems.add(info.system);
    }
  }

  return [...systems].sort();
};

/**
 * Get all extensions for a specific system.
 *
 * @param system - System name (case-insensitive, e.g., "Mega Drive - Genesis")
 * @returns Array of extensions (with dots) that map to this system
 */
export const getExtensionsForSystem = (system: string): string[] => {
  const normalizedSystem = system.toLowerCase();
  const extensions: string[] = [];

  for (const [ext, info] of getSystemInfoMap().entries()) {
    if (info.system.toLowerCase() === normalizedSystem) {
      extensions.push(ext);
    }
  }

  return extensions.sort();
};
