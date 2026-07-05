// =============================================================================
// Audio Constants
// =============================================================================

/** Initial audio buffer capacity in samples (stereo frames * 2 channels) */
export const INITIAL_AUDIO_BUFFER_SIZE = 4096;

/** Maximum value for signed 16-bit audio samples */
export const INT16_MAX = 32768;

/** Audio buffer growth factor (1.5x is more memory-efficient than 2x) */
export const AUDIO_BUFFER_GROWTH_FACTOR = 1.5;

// =============================================================================
// Input Constants
// =============================================================================

/** Libretro RETRO_DEVICE_ID_JOYPAD_MASK value for bitmask input */
export const JOYPAD_BITMASK_ID = 256;

/** Minimum value for signed 16-bit (used for analog clamping) */
export const INT16_MIN = -32768;

/** Maximum positive value for signed 16-bit (used for analog normalization) */
export const INT16_MAX_POSITIVE = 32767;

// =============================================================================
// Debug Logging Constants
// =============================================================================

/** Number of initial video callbacks to log with detailed info */
export const DEBUG_VIDEO_CALLBACK_COUNT = 10;

/** Number of initial frames to always log video frame info */
export const DEBUG_INITIAL_FRAMES_TO_LOG = 3;

/** Frames between periodic video frame log messages (every N frames) */
export const DEBUG_VIDEO_FRAME_LOG_INTERVAL = 60;

/** Minimum analog value change threshold to trigger debug logging */
export const DEBUG_ANALOG_CHANGE_THRESHOLD = 1000;
