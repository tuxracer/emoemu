/**
 * How close to the next frame's due time (in ms) the loop switches from
 * sleeping (setTimeout) to spinning (setImmediate). Node timers routinely
 * fire 1-2ms late, so sleeping any closer than this risks missing the frame.
 */
export const PACER_SPIN_THRESHOLD_MS = 2;

/** Minimum sleep worth scheduling; below this, spinning is cheaper and safer */
export const PACER_MIN_SLEEP_MS = 1;

/** Poll interval while the pause menu is open and emulation is idle */
export const PAUSE_MENU_POLL_MS = 16;
