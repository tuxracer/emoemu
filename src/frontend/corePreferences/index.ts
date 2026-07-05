/**
 * Core Preferences
 *
 * Persists user's preferred core for each file extension.
 * When multiple cores support the same ROM format, the user can choose
 * to remember their selection so they won't be prompted again.
 *
 * Stored as JSON in the config directory: <config>/core-preferences.json
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { isPlainObject, isString } from 'remeda';
import { getConfigDirectory } from '../../utils/paths';
import { ensureDirectory } from '../../utils/ensureDirectory';
import { readJsonFile } from '../../utils/readJsonFile';
import { logger } from '../../utils/logger';

const PREFERENCES_FILENAME = 'core-preferences.json';

const getPreferencesPath = (): string =>
  join(getConfigDirectory(), PREFERENCES_FILENAME);

/** Load the preferences map from disk */
const loadPreferences = (): Record<string, string> => {
  const parsed = readJsonFile(getPreferencesPath());
  if (!isPlainObject(parsed)) {
    return {};
  }
  // Filter to only valid string→string entries
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isString(value)) {
      result[key] = value;
    }
  }
  return result;
};

/** Save the preferences map to disk */
const savePreferences = (prefs: Record<string, string>): void => {
  const path = getPreferencesPath();
  ensureDirectory(getConfigDirectory());
  writeFileSync(path, JSON.stringify(prefs, null, 2) + '\n', 'utf-8');
};

/**
 * Get the preferred core ID for a file extension.
 *
 * @param ext File extension (lowercase, with dot, e.g., ".z64")
 * @returns Core ID or null if no preference is saved
 */
export const getPreferredCoreId = (ext: string): string | null => {
  const prefs = loadPreferences();
  return prefs[ext.toLowerCase()] ?? null;
};

/**
 * Save a core preference for a file extension.
 *
 * @param ext File extension (lowercase, with dot, e.g., ".z64")
 * @param coreId The core ID to prefer for this extension
 */
export const setPreferredCoreId = (ext: string, coreId: string): void => {
  const prefs = loadPreferences();
  prefs[ext.toLowerCase()] = coreId;
  savePreferences(prefs);
  logger.info(`Saved core preference: ${ext} -> ${coreId}`, 'CorePreferences');
};
