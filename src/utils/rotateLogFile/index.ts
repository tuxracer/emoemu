/**
 * Log file rotation utility.
 *
 * Rotates a log file when it exceeds a maximum size, keeping a
 * configurable number of backup files (e.g., log.1, log.2, log.3).
 */

import { existsSync, statSync, renameSync, unlinkSync } from 'fs';

/**
 * Rotate a log file if it exceeds maxSizeBytes.
 * Keeps up to maxBackups numbered backups (log.1, log.2, ...).
 */
export const rotateLogFile = (logPath: string, maxSizeBytes: number, maxBackups: number): void => {
  if (!existsSync(logPath)) {
    return;
  }

  try {
    const stats = statSync(logPath);

    if (stats.size < maxSizeBytes) {
      return;
    }

    // Rotate existing backups
    for (let i = maxBackups - 1; i >= 1; i--) {
      const oldPath = `${logPath}.${i}`;
      const newPath = `${logPath}.${i + 1}`;
      if (existsSync(oldPath)) {
        if (i === maxBackups - 1) {
          unlinkSync(oldPath);
        } else {
          renameSync(oldPath, newPath);
        }
      }
    }

    // Move current log to .1
    renameSync(logPath, `${logPath}.1`);
  } catch {
    // Ignore rotation errors
  }
};
