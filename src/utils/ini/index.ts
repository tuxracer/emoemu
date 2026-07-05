/**
 * INI File Parser Utilities
 *
 * Generic utilities for parsing and writing INI-style configuration files.
 * Compatible with RetroArch config format.
 */

import { pipe, filter, map, isNonNull, fromEntries } from 'remeda';

/**
 * Parsed key-value pair from an INI line
 */
export interface IniKeyValue {
  key: string;
  value: string;
}

/**
 * Supported value types for INI files
 */
export type IniValue = string | number | boolean | null;

/**
 * Parse a config file line and extract key-value pair.
 * Format: key = "value" or key = value
 *
 * @param line A single line from the config file
 * @returns Parsed key-value pair, or null for comments/empty lines
 */
export const parseIniLine = (line: string): IniKeyValue | null => {
  const trimmed = line.trim();

  // Skip comments and empty lines
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null;
  }

  // Match: key = "value" or key = value
  const match = trimmed.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.*)$/i);
  if (!match) {
    return null;
  }

  const key = match[1].toLowerCase();
  let value = match[2].trim();

  // Remove quotes if present
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return { key, value };
};

/**
 * Parse INI file content into a key-value record.
 * Only includes lines that match the provided valid keys.
 *
 * @param content File content to parse
 * @param validKeys Set of valid keys to include (others are ignored)
 * @returns Record of key-value pairs
 */
export const parseIniContent = (
  content: string,
  validKeys: Set<string>
): Record<string, string> => {
  const entries = pipe(
    content.split('\n'),
    map(parseIniLine),
    filter(isNonNull),
    filter(({ key }) => validKeys.has(key)),
    map(({ key, value }) => [key, value] as const),
  );
  return fromEntries(entries) as Record<string, string>;
};

/**
 * Format a value for writing to an INI file.
 *
 * @param value The value to format
 * @returns Formatted string representation
 */
export const formatIniValue = (value: IniValue): string => {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    // Always quote strings for consistency
    return `"${value}"`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
};

/**
 * Update a single setting in INI file content.
 * If the setting exists (commented or not), updates its value.
 * If the setting is commented, uncomments it.
 * If the setting doesn't exist, appends it at the end.
 *
 * @param content Current file content
 * @param key The config key to update
 * @param value The new value (already formatted)
 * @returns Updated file content
 */
export const updateIniLine = (content: string, key: string, value: string): string => {
  const lines = content.split('\n');

  // Pattern to match the key (commented or not): # key = value OR key = value
  const keyPattern = new RegExp(`^(\\s*#\\s*)?${key}\\s*=.*$`, 'i');

  let found = false;
  const updatedLines = lines.map((line) => {
    if (keyPattern.test(line)) {
      found = true;
      // Replace with uncommented version
      return `${key} = ${value}`;
    }
    return line;
  });

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated inside .map() callback
  if (!found) {
    // Append at the end (before final empty line if present)
    const lastLine = updatedLines[updatedLines.length - 1];
    if (lastLine === '') {
      updatedLines.splice(updatedLines.length - 1, 0, `${key} = ${value}`);
    } else {
      updatedLines.push(`${key} = ${value}`);
    }
  }

  return updatedLines.join('\n');
};

/**
 * Comment out a setting in INI file content.
 * If the setting exists (uncommented), comments it out.
 * If the setting is already commented or doesn't exist, leaves content unchanged.
 *
 * @param content Current file content
 * @param key The config key to comment out
 * @returns Updated file content
 */
export const commentOutIniLine = (content: string, key: string): string => {
  const lines = content.split('\n');

  // Pattern to match the uncommented key: key = value (not already commented)
  const keyPattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'i');

  const updatedLines = lines.map((line) => {
    if (keyPattern.test(line)) {
      // Comment out the line, preserving the value for reference
      return `# ${line.trim()}`;
    }
    return line;
  });

  return updatedLines.join('\n');
};

/**
 * Parse a string value into a boolean.
 * Recognizes: true, 1, yes (case-insensitive)
 */
export const parseIniBool = (value: string): boolean =>
  value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes';

/**
 * Parse a string value into a number.
 * Returns the default value if parsing fails.
 */
export const parseIniNumber = (value: string, defaultValue: number): number => {
  const num = parseFloat(value);
  return isNaN(num) ? defaultValue : num;
};

/**
 * Parse a string value into an integer.
 * Returns the default value if parsing fails.
 */
export const parseIniInt = (value: string, defaultValue: number): number => {
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
};

/**
 * Parse a nullable number value.
 * Returns null for empty string, "null", or "auto".
 */
export const parseIniNullableNumber = (value: string): number | null => {
  if (value === '' || value === 'null' || value === 'auto') {
    return null;
  }
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
};
