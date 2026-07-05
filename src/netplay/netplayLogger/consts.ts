import type { LogLevel } from '.';

/** Kilobyte in bytes */
export const KILOBYTE = 1024;

/** Megabyte in bytes */
export const MEGABYTE = KILOBYTE * KILOBYTE;

/** Maximum log file size factor (5 MB) */
export const MAX_LOG_SIZE_MB = 5;

/** Maximum log file size before rotation */
export const MAX_LOG_SIZE_BYTES = MAX_LOG_SIZE_MB * MEGABYTE;

/** Number of backup files to keep */
export const MAX_BACKUP_FILES = 3;

/** Millisecond padding width for timestamps */
export const MS_PAD_WIDTH = 3;

/** Level string padding width */
export const LEVEL_PAD_WIDTH = 5;

/** Log level priority for filtering */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
