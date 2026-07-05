/** RGB15 format bit mask for 5-bit red channel (bits 0-4) */
export const RGB15_RED_MASK = 0x001f;

/** RGB15 format bit mask for 5-bit green channel (bits 5-9) */
export const RGB15_GREEN_MASK = 0x1f;

/** RGB15 format bit mask for 5-bit blue channel (bits 10-14) */
export const RGB15_BLUE_MASK = 0x1f;

/** Bit shift for green channel in RGB15 format */
export const RGB15_GREEN_SHIFT = 5;

/** Bit shift for blue channel in RGB15 format */
export const RGB15_BLUE_SHIFT = 10;

/** Bit shift for expanding 5-bit to 8-bit (left shift) */
export const RGB5_TO_8_LEFT_SHIFT = 3;

/** Bit shift for expanding 5-bit to 8-bit (right shift for replication) */
export const RGB5_TO_8_RIGHT_SHIFT = 2;

/** Maximum 8-bit color value */
export const MAX_8BIT = 255;

/** LUT size for 8-bit color operations (256 entries) */
export const LUT_SIZE_8BIT = 256;

/** Default gamma correction value (no change) */
export const DEFAULT_GAMMA = 1.0;

/** Weight factor for green in color distance (human eye sensitivity) */
export const GREEN_WEIGHT = 1.5;

/** Luminance threshold for grayscale emoji selection */
export const GRAYSCALE_THRESHOLD = 0.5;

/** ANSI 256-color palette: first index of the 6x6x6 color cube */
export const ANSI_COLOR_CUBE_START = 16;

/** ANSI 256-color palette: levels per channel in the 6x6x6 cube */
export const ANSI_COLOR_CUBE_LEVELS = 6;

/** Multiplier for red channel in ANSI 256-color cube index calculation */
export const ANSI_RED_MULTIPLIER = 36;

/** Multiplier for green channel in ANSI 256-color cube index calculation */
export const ANSI_GREEN_MULTIPLIER = 6;

// ITU-R BT.601 luminance coefficients

/** Red luminance coefficient for grayscale conversion */
export const LUMINANCE_R = 0.299;

/** Green luminance coefficient for grayscale conversion */
export const LUMINANCE_G = 0.587;

/** Blue luminance coefficient for grayscale conversion */
export const LUMINANCE_B = 0.114;
