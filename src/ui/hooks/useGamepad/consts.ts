// Gamepad acceleration settings for held direction buttons

/** Delay before repeating starts (ms) */
export const INITIAL_DELAY_MS = 400;

/** Starting repeat interval (ms) */
export const INITIAL_REPEAT_MS = 200;

/** Fastest repeat interval (ms) */
export const MIN_REPEAT_MS = 40;

/** Time to reach max speed (ms) */
export const ACCELERATION_TIME_MS = 1500;

// Ease-in-out curve coefficients (smoothstep function: 3t^2 - 2t^3)

/** Smoothstep cubic factor */
export const EASE_CUBIC_FACTOR = 3;

/** Smoothstep cubic divisor */
export const EASE_CUBIC_DIVISOR = 2;
