// =============================================================================
// Pixel Format Byte Sizes
// =============================================================================

/** Number of bytes per XRGB8888 pixel */
export const XRGB8888_BYTES_PER_PIXEL = 4;

/** Number of bytes per 16-bit pixel (RGB565, XRGB1555) */
export const RGB16_BYTES_PER_PIXEL = 2;

// =============================================================================
// RGB565 Bit Manipulation Constants
// =============================================================================

/** Mask for 5-bit color channel (R and B in RGB565/XRGB1555) */
export const MASK_5BIT = 0x1f;

/** Mask for 6-bit color channel (G in RGB565) */
export const MASK_6BIT = 0x3f;

/** Bit shift for red channel in RGB565 (bits 11-15) */
export const RGB565_RED_SHIFT = 11;

/** Bit shift for green channel in RGB565 (bits 5-10) */
export const RGB565_GREEN_SHIFT = 5;

/** Bit shift for red channel in XRGB1555 (bits 10-14) */
export const XRGB1555_RED_SHIFT = 10;

/** Bit shift for green channel in XRGB1555 (bits 5-9) */
export const XRGB1555_GREEN_SHIFT = 5;

/** Bit shift to scale 5-bit to 8-bit (left shift) */
export const SCALE_5BIT_TO_8BIT_SHIFT = 3;

/** Bit shift to scale 6-bit to 8-bit (left shift) */
export const SCALE_6BIT_TO_8BIT_SHIFT = 2;

/** Bit shift to replicate 5-bit upper bits into lower bits */
export const REPLICATE_5BIT_SHIFT = 2;

/** Bit shift to replicate 6-bit upper bits into lower bits */
export const REPLICATE_6BIT_SHIFT = 4;
