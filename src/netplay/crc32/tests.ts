import { describe, it, expect } from 'vitest';
import { crc32, crc32Verify } from '.';

describe('CRC32', () => {
  it('should compute CRC32 of empty buffer', () => {
    const crc = crc32(Buffer.alloc(0));
    expect(crc).toBe(0);
  });

  it('should compute CRC32 of known data', () => {
    // "123456789" has well-known CRC32 value
    const data = Buffer.from('123456789', 'ascii');
    const crc = crc32(data);
    expect(crc).toBe(0xcbf43926);
  });

  it('should compute different CRCs for different data', () => {
    const crc1 = crc32(Buffer.from([1, 2, 3, 4]));
    const crc2 = crc32(Buffer.from([4, 3, 2, 1]));
    expect(crc1).not.toBe(crc2);
  });

  it('should verify matching CRC', () => {
    const data = Buffer.from('test data');
    const crc = crc32(data);
    expect(crc32Verify(data, crc)).toBe(true);
  });

  it('should fail verification for wrong CRC', () => {
    const data = Buffer.from('test data');
    expect(crc32Verify(data, 0x12345678)).toBe(false);
  });

  it('should work with Uint8Array', () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const crc = crc32(data);
    expect(typeof crc).toBe('number');
    expect(crc >>> 0).toBe(crc); // Ensure unsigned
  });
});
