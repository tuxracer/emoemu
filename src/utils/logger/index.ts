/**
 * General-Purpose Logger
 *
 * Writes debug logs to a file for debugging and monitoring.
 * Log file is stored in the platform-specific config directory.
 * Format matches RetroArch's log format for consistency.
 */

import { writeFileSync } from 'fs';
import { BufferedFileWriter } from '../BufferedFileWriter';
import { ensureDirectory } from '../ensureDirectory';
import { rotateLogFile } from '../rotateLogFile';
import { join } from 'path';
import { getConfigDirectory } from '../paths';

/** Log levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export * from './consts';

import {
  LOG_LEVEL_PRIORITY,
  LOG_LEVEL_TAGS,
  MAX_LOG_SIZE_BYTES,
  MAX_BACKUP_FILES,
  DATE_PAD_WIDTH,
} from './consts';

/** Get the default log directory */
const getDefaultLogDirectory = (): string => join(getConfigDirectory(), 'logs');

/**
 * Format current date/time for timestamped log filename
 * Format: emoemu__2026_01_22__02_53_37.log
 */
const formatLogTimestamp = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(DATE_PAD_WIDTH, '0');
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());
  return `emoemu__${year}_${month}_${day}__${hour}_${minute}_${second}.log`;
};

/**
 * Logger provides structured logging for application events.
 * Output format matches RetroArch: [LEVEL] [Category]: message
 *
 * File output is buffered and flushed asynchronously so logging never
 * blocks the emulation loop on disk I/O. Remaining lines are flushed
 * synchronously on process exit.
 */
export class Logger {
  private logPath: string;
  private minLevel: LogLevel = 'debug';
  private enabled = false;
  private initialized = false;
  private logToStderr = false;
  private logToFile = true;
  private useTimestampedFile = false;
  private customLogDir: string | null = null;
  private fileWriter = new BufferedFileWriter(() => {
    this.initialize();
    return this.logPath;
  });

  constructor() {
    this.logPath = join(getDefaultLogDirectory(), 'emoemu.log');
  }

  /** Enable or disable logging */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Check if logging is enabled */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if a message at this level would actually be logged.
   * Hot paths should guard expensive log-string construction with this.
   */
  isLevelEnabled(level: LogLevel): boolean {
    return this.enabled && LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  /** Set minimum log level */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** Enable logging to stderr (for --verbose mode) */
  setLogToStderr(enabled: boolean): void {
    this.logToStderr = enabled;
  }

  /** Set whether to write logs to file (true) or console (false) */
  setLogToFile(enabled: boolean): void {
    this.logToFile = enabled;
  }

  /** Set whether to use timestamped log files */
  setUseTimestampedFile(enabled: boolean): void {
    this.useTimestampedFile = enabled;
  }

  /** Set custom log directory */
  setLogDirectory(dir: string): void {
    this.customLogDir = dir || null;
  }

  /** Get the log file path */
  getLogPath(): string {
    return this.logPath;
  }

  /** Get the log directory */
  getLogDirectory(): string {
    return this.customLogDir || getDefaultLogDirectory();
  }

  /** Initialize the log file (creates directory and sets up log file) */
  private initialize(): void {
    if (this.initialized) {
      return;
    }

    const logDir = this.getLogDirectory();

    ensureDirectory(logDir);

    // Set up log file path
    if (this.useTimestampedFile) {
      // Use timestamped filename
      this.logPath = join(logDir, formatLogTimestamp());
    } else {
      // Use fixed filename, clear on startup
      this.logPath = join(logDir, 'emoemu.log');
      // Clear the log file by writing empty content
      try {
        writeFileSync(this.logPath, '');
      } catch {
        // Ignore errors
      }
    }

    // Check if rotation is needed (only for non-timestamped files)
    if (!this.useTimestampedFile) {
      this.rotateIfNeeded();
    }

    this.initialized = true;
  }

  /** Rotate log file if it exceeds max size */
  private rotateIfNeeded(): void {
    rotateLogFile(this.logPath, MAX_LOG_SIZE_BYTES, MAX_BACKUP_FILES);
  }

  /** Write a log entry in RetroArch format */
  private write(level: LogLevel, message: string, category?: string): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const levelTag = LOG_LEVEL_TAGS[level];
    const logLine = category
      ? `[${levelTag}] [${category}]: ${message}`
      : `[${levelTag}] ${message}`;

    // Write to stderr if verbose mode is enabled
    if (this.logToStderr) {
      process.stderr.write(logLine + '\n');
    }

    if (this.logToFile) {
      // Buffer the line; flushed asynchronously so the caller never blocks
      // on disk I/O. Errors flush promptly since they often precede a crash.
      this.fileWriter.append(logLine + '\n', level === 'error');
    } else {
      // Output to console based on log level
      switch (level) {
        case 'debug':
          console.debug(logLine);
          break;
        case 'info':
          console.info(logLine);
          break;
        case 'warn':
          console.warn(logLine);
          break;
        case 'error':
          console.error(logLine);
          break;
      }
    }
  }

  /** Write all buffered lines to the log file */
  flush(): Promise<void> {
    return this.fileWriter.flush();
  }

  /** Log a debug message */
  debug(message: string, category?: string): void {
    this.write('debug', message, category);
  }

  /** Log an info message */
  info(message: string, category?: string): void {
    this.write('info', message, category);
  }

  /** Log a warning message */
  warn(message: string, category?: string): void {
    this.write('warn', message, category);
  }

  /** Log an error message */
  error(message: string, category?: string): void {
    this.write('error', message, category);
  }
}

/** Singleton logger instance */
export const logger = new Logger();
