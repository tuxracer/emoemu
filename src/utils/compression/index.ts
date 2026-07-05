/**
 * Compression Utilities
 *
 * Helpers for working with compressed data formats.
 * Supports detection and decompression of RetroArch save state formats:
 * - Zstandard (default in newer RetroArch)
 * - Zlib (older default)
 * - Gzip (rare)
 * - Uncompressed (raw binary)
 */

import { gunzipSync, inflateSync } from 'zlib';
import { decompress as decompressZstd } from 'fzstd';
import {
  GZIP_MAGIC_BYTE_1,
  GZIP_MAGIC_BYTE_2,
  GZIP_MAGIC_SIZE,
  ZSTD_MAGIC_BYTE_1,
  ZSTD_MAGIC_BYTE_2,
  ZSTD_MAGIC_BYTE_3,
  ZSTD_MAGIC_BYTE_4,
  ZSTD_MAGIC_SIZE,
  ZLIB_CMF_BYTE,
  ZLIB_FLG_LOW,
  ZLIB_FLG_DEFAULT,
  ZLIB_FLG_BEST,
  ZLIB_MAGIC_SIZE,
} from './consts';

export * from './consts';

/** Compression format of a data buffer */
export type CompressionFormat = 'zstd' | 'zlib' | 'gzip' | 'none';

/**
 * Check if a buffer contains gzip-compressed data.
 * Gzip files start with magic bytes 0x1f 0x8b.
 */
export const isGzipped = (data: Buffer | Uint8Array): boolean =>
  data.length >= GZIP_MAGIC_SIZE &&
  data[0] === GZIP_MAGIC_BYTE_1 &&
  data[1] === GZIP_MAGIC_BYTE_2;

/**
 * Check if a buffer contains Zstandard-compressed data.
 * Zstandard files start with magic bytes 0x28 0xb5 0x2f 0xfd.
 */
export const isZstd = (data: Buffer | Uint8Array): boolean =>
  data.length >= ZSTD_MAGIC_SIZE &&
  data[0] === ZSTD_MAGIC_BYTE_1 &&
  data[1] === ZSTD_MAGIC_BYTE_2 &&
  data[2] === ZSTD_MAGIC_BYTE_3 &&
  data[3] === ZSTD_MAGIC_BYTE_4;

/**
 * Check if a buffer contains zlib-compressed data.
 * Zlib data starts with 0x78 followed by 0x01 (low), 0x9c (default), or 0xda (best).
 */
export const isZlib = (data: Buffer | Uint8Array): boolean =>
  data.length >= ZLIB_MAGIC_SIZE &&
  data[0] === ZLIB_CMF_BYTE &&
  (data[1] === ZLIB_FLG_LOW || data[1] === ZLIB_FLG_DEFAULT || data[1] === ZLIB_FLG_BEST);

/**
 * Detect the compression format of a data buffer.
 * Checks magic bytes to identify the format.
 */
export const detectCompressionFormat = (data: Buffer | Uint8Array): CompressionFormat => {
  if (isZstd(data)) {
    return 'zstd';
  }
  if (isZlib(data)) {
    return 'zlib';
  }
  if (isGzipped(data)) {
    return 'gzip';
  }
  return 'none';
};

/**
 * Decompress data that may be in any supported format.
 * Auto-detects the compression format and decompresses accordingly.
 * Returns the original data unchanged if not compressed.
 */
export const decompress = (data: Buffer | Uint8Array): Buffer => {
  const format = detectCompressionFormat(data);

  switch (format) {
    case 'zstd': {
      const decompressed = decompressZstd(data);
      return Buffer.from(decompressed);
    }
    case 'zlib':
      return inflateSync(data);
    case 'gzip':
      return gunzipSync(data);
    case 'none':
      return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }
};
