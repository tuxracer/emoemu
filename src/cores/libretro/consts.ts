// =============================================================================
// Audio Constants
// =============================================================================

/** Default audio sample rate in Hz (standard for libretro) */
export const DEFAULT_SAMPLE_RATE = 44100;

// =============================================================================
// Input Constants
// =============================================================================

/** Maximum positive value for signed 16-bit analog values */
export const INT16_MAX_POSITIVE = 32767;

// =============================================================================
// Video/Buffer Constants
// =============================================================================

/** Extra headroom bytes added when allocating framebuffer */
export const FRAMEBUFFER_HEADROOM = 1024;

/** Number of bytes per RGB24 pixel */
export const RGB24_BYTES_PER_PIXEL = 3;

// =============================================================================
// Number Formatting Constants
// =============================================================================

export { HEX_RADIX } from '../../utils';

/** Decimal places for aspect ratio formatting */
export const ASPECT_RATIO_DECIMALS = 3;

/** Decimal places for FPS/sample rate formatting */
export const FPS_DECIMALS = 2;

// =============================================================================
// Debug Constants
// =============================================================================

/** Number of initial frames to log timing for */
export const DEBUG_INITIAL_FRAME_LOG_COUNT = 5;

/** Maximum normalized analog value threshold (for int16 conversion detection) */
export const ANALOG_NORMALIZED_THRESHOLD = 1.5;
