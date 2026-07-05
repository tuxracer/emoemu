// =============================================================================
// Audio Manager Constants
// =============================================================================

/**
 * Maximum number of audio frames to queue ahead.
 * Controls latency vs. stability tradeoff.
 */
export const MAX_AUDIO_QUEUED_FRAMES = 4;

// =============================================================================
// Emulator Bootstrap Constants
// =============================================================================

/**
 * Number of bootstrap frames to run for libretro cores.
 * Some cores (especially N64 with Angrylion) need many frames to stabilize
 * dimensions after loading a ROM before video output begins.
 */
export const LIBRETRO_BOOTSTRAP_FRAMES = 10;

/**
 * Maximum number of frames to skip (run without rendering) when catching up.
 * Set to 1 to ensure HID input events can process between each frame.
 * Higher values improve timing accuracy but cause input delay because
 * the frame skip loop blocks the event loop.
 */
export const MAX_FRAME_SKIP = 1;

// =============================================================================
// Time Constants
// =============================================================================

/** Milliseconds per second (for FPS calculations) */
export const MS_PER_SECOND = 1000;

// =============================================================================
// Audio Sample Rate Constants
// =============================================================================

/** Standard CD-quality sample rate (44.1 kHz) */
export const SAMPLE_RATE_44100 = 44100;

/** Standard DVD/DAT sample rate (48 kHz) */
export const SAMPLE_RATE_48000 = 48000;

/** Audio frame duration in seconds (10ms for low latency) */
export const AUDIO_FRAME_DURATION_SEC = 0.01;

/** Number of audio channels for stereo output */
export const AUDIO_STEREO_CHANNELS = 2;

/** Bytes per 16-bit audio sample */
export const BYTES_PER_INT16_SAMPLE = 2;

/** Number of audio frames to buffer (10 frames = ~100ms) */
export const AUDIO_RING_BUFFER_FRAMES = 10;

/** Maximum 16-bit signed audio sample value */
export const INT16_MAX_VALUE = 32767;

/** Bytes per stereo sample (2 channels * 2 bytes per int16 sample) */
export const BYTES_PER_STEREO_SAMPLE = AUDIO_STEREO_CHANNELS * BYTES_PER_INT16_SAMPLE;

/**
 * RtAudio error type threshold for recoverable errors.
 * Error types 0-2 are warnings, 3+ are actual errors that may require recovery.
 */
export const RTAUDIO_RECOVERABLE_ERROR_THRESHOLD = 3;

/** Delay in ms before attempting audio recovery after an error */
export const AUDIO_RECOVERY_DELAY_MS = 100;

/** Tolerance for floating point comparison (e.g., resample ratio equality) */
export const FLOAT_COMPARE_EPSILON = 0.001;

/** Offset to next right channel sample in interleaved stereo (current pair L=0, R=1, next pair L=2, R=3) */
export const STEREO_NEXT_RIGHT_OFFSET = 3;

// =============================================================================
// Date/Time Formatting Constants
// =============================================================================

/** Slice offset for extracting 2-digit year from full year string */
export const TWO_DIGIT_YEAR_SLICE_START = -2;

/** Length of ISO datetime string without milliseconds ("YYYY-MM-DD HH:MM:SS" = 19 chars) */
export const ISO_DATETIME_LENGTH = 19;

// =============================================================================
// Input Polling Constants
// =============================================================================

/** Interval in ms for polling gamepad input during dialogs */
export const GAMEPAD_DIALOG_POLL_INTERVAL_MS = 50;

// =============================================================================
// Numeric Base/Radix Constants
// =============================================================================

export { HEX_RADIX } from '../utils';

/** Decimal radix for parseInt/toString */
export const DECIMAL_RADIX = 10;

/** Padding width for byte values in decimal (0-255 = 3 digits max) */
export const BYTE_DECIMAL_PAD_WIDTH = 3;

// =============================================================================
// Logging/Display Constants
// =============================================================================

/** Decimal places for aspect ratio and similar floating point logging */
export const ASPECT_RATIO_DECIMALS = 3;
