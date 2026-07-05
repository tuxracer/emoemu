import { existsSync, mkdirSync } from 'fs';

/**
 * Ensure a directory exists, creating it (and parents) if necessary.
 */
export const ensureDirectory = (dir: string): void => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};
