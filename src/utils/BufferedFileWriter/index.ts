import { appendFileSync } from 'fs';
import { appendFile } from 'fs/promises';
import { FLUSH_INTERVAL_MS, FLUSH_MAX_CHUNKS } from './consts';

export * from './consts';

/**
 * Buffers string chunks in memory and appends them to a file
 * asynchronously, so callers (log statements on hot paths) never block on
 * disk I/O. Remaining chunks are flushed synchronously on process exit.
 *
 * The target path is resolved at flush time via the provided callback,
 * allowing owners to initialize (create directories, rotate) lazily.
 */
export class BufferedFileWriter {
  private pendingChunks: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInFlight: Promise<void> | null = null;
  private isExitHookInstalled = false;

  constructor(private readonly resolvePath: () => string) {}

  /** Queue a chunk; set isUrgent to flush promptly (e.g. error lines) */
  append(chunk: string, isUrgent = false): void {
    this.pendingChunks.push(chunk);
    this.installExitHook();

    if (isUrgent || this.pendingChunks.length >= FLUSH_MAX_CHUNKS) {
      void this.flush();
      return;
    }

    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, FLUSH_INTERVAL_MS);
      // Don't keep the process alive just to flush; the exit hook covers
      // anything still buffered at shutdown
      this.flushTimer.unref();
    }
  }

  /** Write all buffered chunks to the file */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Serialize flushes so chunks land in order
    while (this.flushInFlight !== null) {
      await this.flushInFlight;
    }

    if (this.pendingChunks.length === 0) {
      return;
    }

    const data = this.pendingChunks.join('');
    this.pendingChunks = [];
    this.flushInFlight = appendFile(this.resolvePath(), data)
      .catch(() => {
        // Silently ignore write errors
      })
      .finally(() => {
        this.flushInFlight = null;
      });
    await this.flushInFlight;
  }

  /** Synchronously write any buffered chunks (process exit only) */
  private flushSync(): void {
    if (this.pendingChunks.length === 0) {
      return;
    }
    const data = this.pendingChunks.join('');
    this.pendingChunks = [];
    try {
      appendFileSync(this.resolvePath(), data);
    } catch {
      // Silently ignore write errors
    }
  }

  /** Flush remaining buffered chunks when the process exits */
  private installExitHook(): void {
    if (this.isExitHookInstalled) {
      return;
    }
    this.isExitHookInstalled = true;
    process.on('exit', () => {
      this.flushSync();
    });
  }
}
