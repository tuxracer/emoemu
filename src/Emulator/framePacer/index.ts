import { PACER_SPIN_THRESHOLD_MS, PACER_MIN_SLEEP_MS } from './consts';

export * from './consts';

/**
 * Decide how the emulation loop should schedule its next iteration.
 *
 * Returns the number of milliseconds to sleep (via setTimeout), or null to
 * run again immediately (via setImmediate). Sleeping off most of the
 * inter-frame gap keeps the loop from busy-spinning a full CPU core between
 * frames; the final PACER_SPIN_THRESHOLD_MS are spun for timing precision.
 */
export const nextLoopDelayMs = (
  nowMs: number,
  lastFrameTimeMs: number,
  targetFrameTimeMs: number,
): number | null => {
  // Uncapped mode: run as fast as possible
  if (targetFrameTimeMs === 0) {
    return null;
  }

  const sleepableMs = lastFrameTimeMs + targetFrameTimeMs - nowMs - PACER_SPIN_THRESHOLD_MS;
  if (sleepableMs < PACER_MIN_SLEEP_MS) {
    return null;
  }

  return Math.floor(sleepableMs);
};
