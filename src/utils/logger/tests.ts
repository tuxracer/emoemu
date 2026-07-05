import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger } from '.';

const readLog = (dir: string): string => {
  const path = join(dir, 'emoemu.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('Logger', () => {
  let dir: string;
  let log: Logger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'emoemu-logger-'));
    log = new Logger();
    log.setLogDirectory(dir);
    log.setEnabled(true);
  });

  afterEach(async () => {
    await log.flush();
    rmSync(dir, { recursive: true, force: true });
  });

  it('should buffer log lines instead of writing to disk synchronously', () => {
    log.info('hello', 'Test');
    expect(readLog(dir)).toBe('');
  });

  it('should persist buffered lines in order on flush', async () => {
    log.info('first', 'Test');
    log.warn('second');
    await log.flush();
    expect(readLog(dir)).toBe('[INFO] [Test]: first\n[WARN] second\n');
  });

  it('should flush automatically without an explicit flush call', async () => {
    log.info('auto', 'Test');
    await waitFor(() => readLog(dir).includes('[INFO] [Test]: auto'));
  });

  it('should write nothing to disk when disabled', async () => {
    log.setEnabled(false);
    log.info('nope', 'Test');
    await log.flush();
    expect(readLog(dir)).toBe('');
  });

  it('should filter lines below the minimum level', async () => {
    log.setMinLevel('warn');
    log.debug('too low');
    log.error('kept');
    await log.flush();
    expect(readLog(dir)).toBe('[ERROR] kept\n');
  });

  it('should not lose lines flushed while a flush is in flight', async () => {
    log.info('a');
    const firstFlush = log.flush();
    log.info('b');
    await Promise.all([firstFlush, log.flush()]);
    await log.flush();
    expect(readLog(dir)).toBe('[INFO] a\n[INFO] b\n');
  });

  describe('isLevelEnabled', () => {
    it('should report false when logging is disabled', () => {
      log.setEnabled(false);
      expect(log.isLevelEnabled('error')).toBe(false);
    });

    it('should report per-level status based on the minimum level', () => {
      log.setMinLevel('info');
      expect(log.isLevelEnabled('debug')).toBe(false);
      expect(log.isLevelEnabled('info')).toBe(true);
      expect(log.isLevelEnabled('error')).toBe(true);
    });
  });
});
