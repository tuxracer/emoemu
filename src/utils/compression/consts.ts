//==========================================================================
// Gzip (0x1f 0x8b)
//==========================================================================

/** First byte of gzip magic number (0x1f) */
export const GZIP_MAGIC_BYTE_1 = 0x1f;

/** Second byte of gzip magic number (0x8b) */
export const GZIP_MAGIC_BYTE_2 = 0x8b;

/** Minimum bytes needed to detect gzip compression */
export const GZIP_MAGIC_SIZE = 2;

//==========================================================================
// Zstandard (0x28 0xb5 0x2f 0xfd)
//==========================================================================

/** First byte of Zstandard magic number */
export const ZSTD_MAGIC_BYTE_1 = 0x28;

/** Second byte of Zstandard magic number */
export const ZSTD_MAGIC_BYTE_2 = 0xb5;

/** Third byte of Zstandard magic number */
export const ZSTD_MAGIC_BYTE_3 = 0x2f;

/** Fourth byte of Zstandard magic number */
export const ZSTD_MAGIC_BYTE_4 = 0xfd;

/** Minimum bytes needed to detect Zstandard compression */
export const ZSTD_MAGIC_SIZE = 4;

//==========================================================================
// Zlib (0x78 followed by 0x01, 0x9c, or 0xda)
//==========================================================================

/** First byte of zlib header (CMF - Compression Method and Flags) */
export const ZLIB_CMF_BYTE = 0x78;

/** Zlib FLG byte for low compression */
export const ZLIB_FLG_LOW = 0x01;

/** Zlib FLG byte for default compression */
export const ZLIB_FLG_DEFAULT = 0x9c;

/** Zlib FLG byte for best compression */
export const ZLIB_FLG_BEST = 0xda;

/** Minimum bytes needed to detect zlib compression */
export const ZLIB_MAGIC_SIZE = 2;
