/**
 * Read and parse a JSON file, returning null if it doesn't exist or fails to parse.
 */

import { existsSync, readFileSync } from 'fs';

export const readJsonFile = (path: string): unknown => {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  } catch {
    return null;
  }
};
