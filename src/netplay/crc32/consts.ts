/** CRC-32 polynomial (IEEE 802.3, used by zip, gzip, png, etc.) */
export const CRC32_POLYNOMIAL = 0xedb88320;

/** Size of the CRC32 lookup table */
export const CRC32_TABLE_SIZE = 256;

/** Number of bits in a byte */
export const BITS_PER_BYTE = 8;

/** Mask for extracting low byte */
export const BYTE_MASK = 0xff;

/** Initial/final XOR value for CRC32 */
export const CRC32_XOR_VALUE = 0xffffffff;
