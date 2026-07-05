// Periodic bounds re-detection intervals
export const BOUNDS_CHECK_INTERVAL_INITIAL = 60;
export const BOUNDS_CHECK_INTERVAL_LATER = 300;
export const BOUNDS_CHECK_MAX_COUNT = 10;
export const BOUNDS_CHECK_INITIAL_COUNT = 3;  // Use initial interval for first N checks

/** Auto-save interval in ms (only saves if SRAM was modified) */
export const AUTO_SAVE_INTERVAL_MS = 30000;

/** Status bar update interval in frames (~10 FPS at 60 FPS) */
export const STATUS_BAR_UPDATE_INTERVAL = 6;

/** Default duration for core messages in ms */
export const DEFAULT_MESSAGE_DURATION_MS = 3000;
