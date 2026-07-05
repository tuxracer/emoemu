import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BufferedFileWriter } from '.';

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('BufferedFileWriter', () => {
  let dir: string;
  let path: string;
  let writer: BufferedFileWriter;

  const readOutput = (): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'emoemu-writer-'));
    path = join(dir, 'out.log');
    writer = new BufferedFileWriter(() => path);
  });

  afterEach(async () => {
    await writer.flush();
    rmSync(dir, { recursive: true, force: true });
  });

  it('should buffer appends instead of writing to disk synchronously', () => {
    writer.append('line\n');
    expect(readOutput()).toBe('');
  });

  it('should persist appended chunks in order on flush', async () => {
    writer.append('one\n');
    writer.append('two\n');
    await writer.flush();
    expect(readOutput()).toBe('one\ntwo\n');
  });

  it('should flush automatically without an explicit flush call', async () => {
    writer.append('auto\n');
    await waitFor(() => readOutput() === 'auto\n');
  });

  it('should flush promptly when a chunk is marked urgent', async () => {
    writer.append('crash detail\n', true);
    await waitFor(() => readOutput() === 'crash detail\n');
  });

  it('should not lose chunks appended while a flush is in flight', async () => {
    writer.append('a\n');
    const firstFlush = writer.flush();
    writer.append('b\n');
    await Promise.all([firstFlush, writer.flush()]);
    await writer.flush();
    expect(readOutput()).toBe('a\nb\n');
  });

  it('should resolve the target path at flush time, not construction time', async () => {
    let target = path;
    const lateWriter = new BufferedFileWriter(() => target);
    lateWriter.append('x\n');
    target = join(dir, 'moved.log');
    await lateWriter.flush();
    expect(readFileSync(target, 'utf8')).toBe('x\n');
  });

  it('should swallow write errors silently', async () => {
    const badWriter = new BufferedFileWriter(() => join(dir, 'missing', 'nested', 'out.log'));
    badWriter.append('doomed\n');
    await expect(badWriter.flush()).resolves.toBeUndefined();
  });
});
