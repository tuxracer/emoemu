/**
 * Netplay Logger
 *
 * Writes detailed netplay events to a log file for debugging and monitoring.
 * Log file is stored in the platform-specific config directory.
 */

import { BufferedFileWriter } from '@/utils/BufferedFileWriter';
import { ensureDirectory } from '../../utils/ensureDirectory';
import { rotateLogFile } from '../../utils/rotateLogFile';
import { dirname, join } from 'path';
import { getConfigDirectory } from '../../utils/paths';
import { HEX_RADIX } from '..';

export * from './consts';

import { LOG_LEVEL_PRIORITY, MAX_LOG_SIZE_BYTES, MAX_BACKUP_FILES, MS_PAD_WIDTH, LEVEL_PAD_WIDTH } from './consts';

/** Log levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Format a date for log timestamps */
const formatTimestamp = (): string => {
  const now = new Date();
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), MS_PAD_WIDTH)}`;
};

/** Get the netplay log directory */
const getLogDirectory = (): string => join(getConfigDirectory(), 'logs');

/** Get the netplay log file path */
const getLogFilePath = (): string => join(getLogDirectory(), 'netplay.log');

/**
 * NetplayLogger provides structured logging for netplay events.
 */
class NetplayLogger {
  private logPath: string;
  private minLevel: LogLevel = 'debug';
  private enabled = true;
  private initialized = false;
  // Buffered so netplay's per-frame events (stalls, rollbacks) never block
  // the emulation loop on disk I/O
  private fileWriter = new BufferedFileWriter(() => {
    this.initialize();
    return this.logPath;
  });

  constructor() {
    this.logPath = getLogFilePath();
  }

  /** Enable or disable logging */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Set minimum log level */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** Get the log file path */
  getLogPath(): string {
    return this.logPath;
  }

  /** Initialize the log file (creates directory and rotates if needed) */
  private initialize(): void {
    if (this.initialized) {
      return;
    }

    ensureDirectory(dirname(this.logPath));

    // Check if rotation is needed
    this.rotateIfNeeded();

    this.initialized = true;
  }

  /** Rotate log file if it exceeds max size */
  private rotateIfNeeded(): void {
    rotateLogFile(this.logPath, MAX_LOG_SIZE_BYTES, MAX_BACKUP_FILES);
  }

  /** Write a log entry */
  private write(level: LogLevel, category: string, message: string, details?: Record<string, unknown>): void {
    if (!this.enabled) {
      return;
    }

    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const timestamp = formatTimestamp();
    const levelStr = level.toUpperCase().padEnd(LEVEL_PAD_WIDTH);
    let logLine = `[${timestamp}] ${levelStr} [${category}] ${message}`;

    if (details && Object.keys(details).length > 0) {
      const detailStr = Object.entries(details)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
      logLine += ` | ${detailStr}`;
    }

    logLine += '\n';

    // Errors flush promptly since they often precede a crash or disconnect
    this.fileWriter.append(logLine, level === 'error');
  }

  /** Write all buffered lines to the log file */
  flush(): Promise<void> {
    return this.fileWriter.flush();
  }

  /** Clear the log file and write a session header */
  startSession(info: { nickname: string; mode: 'host' | 'client'; port?: number; host?: string }): void {
    if (!this.enabled) {
      return;
    }

    const header = `
================================================================================
  NETPLAY SESSION STARTED
  Time: ${formatTimestamp()}
  Mode: ${info.mode.toUpperCase()}
  Nickname: ${info.nickname}
  ${info.mode === 'host' ? `Port: ${info.port}` : `Host: ${info.host}:${info.port}`}
================================================================================
`;

    this.fileWriter.append(header, true);
  }

  /** Log session end */
  endSession(reason: string): void {
    this.write('info', 'SESSION', `Session ended: ${reason}`);
  }

  // ============================================================================
  // Discovery Events
  // ============================================================================

  /** Log discovery broadcaster start */
  discoveryStarted(port: number, addresses: string[]): void {
    this.write('info', 'DISCOVERY', 'LAN discovery broadcasting started', {
      port,
      broadcastAddresses: addresses,
    });
  }

  /** Log discovery broadcaster stop */
  discoveryStopped(): void {
    this.write('info', 'DISCOVERY', 'LAN discovery broadcasting stopped');
  }

  /** Log discovery broadcast sent */
  discoveryBroadcast(address: string): void {
    this.write('debug', 'DISCOVERY', `Broadcast sent to ${address}`);
  }

  /** Log discovery broadcast error */
  discoveryError(error: string): void {
    this.write('error', 'DISCOVERY', `Discovery error: ${error}`);
  }

  // ============================================================================
  // Server Events
  // ============================================================================

  /** Log server start */
  serverStarted(port: number, nickname: string, hasPassword: boolean): void {
    this.write('info', 'SERVER', 'Netplay server started', {
      port,
      nickname,
      hasPassword,
    });
  }

  /** Log server stop */
  serverStopped(): void {
    this.write('info', 'SERVER', 'Netplay server stopped');
  }

  /** Log incoming connection attempt */
  connectionAttempt(clientId: number, remoteAddress: string, remotePort: number): void {
    this.write('info', 'SERVER', `Connection attempt from ${remoteAddress}:${remotePort}`, {
      clientId,
      remoteAddress,
      remotePort,
    });
  }

  /** Log client connected (after handshake) */
  clientConnected(clientId: number, nickname: string, isPlaying: boolean, deviceIndex: number): void {
    this.write('info', 'SERVER', `Client connected: ${nickname}`, {
      clientId,
      nickname,
      isPlaying,
      deviceIndex,
    });
  }

  /** Log client disconnected */
  clientDisconnected(clientId: number, nickname: string, reason: string, details?: {
    state?: string;
    handshakeCompleted?: boolean;
    commandsReceived?: string[];
    connectedDuration?: number;
  }): void {
    this.write('info', 'SERVER', `Client disconnected: ${nickname}`, {
      clientId,
      nickname,
      reason,
      ...details,
    });
  }

  /** Log handshake step */
  handshakeStep(clientId: number, step: string, details?: Record<string, unknown>): void {
    this.write('debug', 'SERVER', `Handshake [${clientId}]: ${step}`, details);
  }

  /** Log handshake failure */
  handshakeFailed(clientId: number, reason: string): void {
    this.write('warn', 'SERVER', `Handshake failed for client ${clientId}`, { reason });
  }

  /** Log core/content mismatch */
  mismatch(clientId: number, type: 'core' | 'crc', expected: string | number, received: string | number): void {
    this.write('warn', 'SERVER', `${type.toUpperCase()} mismatch from client ${clientId}`, {
      expected,
      received,
    });
  }

  /** Log password authentication */
  passwordAuth(clientId: number, success: boolean): void {
    this.write('info', 'SERVER', `Password authentication ${success ? 'succeeded' : 'failed'}`, {
      clientId,
      success,
    });
  }

  /** Log server error */
  serverError(error: string, details?: Record<string, unknown>): void {
    this.write('error', 'SERVER', error, details);
  }

  // ============================================================================
  // Client Events
  // ============================================================================

  /** Log client connecting */
  clientConnecting(host: string, port: number): void {
    this.write('info', 'CLIENT', `Connecting to ${host}:${port}`, { host, port });
  }

  /** Log client connected to server */
  connectedToServer(host: string, port: number): void {
    this.write('info', 'CLIENT', `Connected to server ${host}:${port}`);
  }

  /** Log client connection failed */
  connectionFailed(host: string, port: number, reason: string): void {
    this.write('error', 'CLIENT', `Connection failed to ${host}:${port}`, { reason });
  }

  /** Log client disconnected from server */
  disconnectedFromServer(reason: string): void {
    this.write('info', 'CLIENT', `Disconnected from server`, { reason });
  }

  /** Log client error */
  clientError(error: string, details?: Record<string, unknown>): void {
    this.write('error', 'CLIENT', error, details);
  }

  // ============================================================================
  // Sync Events
  // ============================================================================

  /** Log desync detection */
  desyncDetected(frame: number, localCrc: number, remoteCrc: number): void {
    this.write('warn', 'SYNC', `Desync detected at frame ${frame}`, {
      frame,
      localCrc: localCrc.toString(HEX_RADIX),
      remoteCrc: remoteCrc.toString(HEX_RADIX),
    });
  }

  /** Log desync recovery trigger */
  desyncRecovery(frame: number, trigger: 'server' | 'client-request'): void {
    this.write('info', 'SYNC', `Desync recovery triggered at frame ${frame} (${trigger})`, { frame, trigger });
  }

  /** Log rollback */
  rollback(fromFrame: number, toFrame: number): void {
    this.write('info', 'SYNC', `Rollback from frame ${fromFrame} to ${toFrame}`, {
      fromFrame,
      toFrame,
      framesDelta: fromFrame - toFrame,
    });
  }

  /** Log stall (waiting for remote input) */
  stall(frame: number, waitingFor: number[]): void {
    this.write('debug', 'SYNC', `Stalling at frame ${frame}`, {
      frame,
      waitingForClients: waitingFor,
    });
  }

  // ============================================================================
  // Generic Events
  // ============================================================================

  /** Log a debug message */
  debug(category: string, message: string, details?: Record<string, unknown>): void {
    this.write('debug', category, message, details);
  }

  /** Log an info message */
  info(category: string, message: string, details?: Record<string, unknown>): void {
    this.write('info', category, message, details);
  }

  /** Log a warning message */
  warn(category: string, message: string, details?: Record<string, unknown>): void {
    this.write('warn', category, message, details);
  }

  /** Log an error message */
  error(category: string, message: string, details?: Record<string, unknown>): void {
    this.write('error', category, message, details);
  }
}

/** Singleton logger instance */
export const netplayLogger = new NetplayLogger();
