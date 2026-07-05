/**
 * Formatting Utilities
 *
 * General-purpose formatting functions.
 */

import {
  DEFAULT_FPS,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from './consts';

export * from './consts';

/**
 * Format frame count as estimated playtime.
 * Calculates hours/minutes/seconds based on frame count and FPS.
 *
 * @param frames Total frame count
 * @param fps Frames per second (default: 60)
 * @returns Formatted playtime string (e.g., "2h 30m 15s", "45m 30s", "15s")
 */
export const formatPlayTime = (frames: number, fps: number = DEFAULT_FPS): string => {
  const totalSeconds = Math.floor(frames / fps);
  return formatRuntimeSeconds(totalSeconds);
};

/**
 * Decompose total seconds into hours, minutes, and seconds.
 */
export const secondsToHms = (totalSeconds: number): { hours: number; minutes: number; seconds: number } => ({
  hours: Math.floor(totalSeconds / SECONDS_PER_HOUR),
  minutes: Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
  seconds: totalSeconds % SECONDS_PER_MINUTE,
});

/**
 * Format runtime in seconds as a human-readable string.
 *
 * @param totalSeconds Total runtime in seconds
 * @returns Formatted runtime string (e.g., "2h 30m 15s", "45m 30s", "15s")
 */
export const formatRuntimeSeconds = (totalSeconds: number): string => {
  const { hours, minutes, seconds } = secondsToHms(totalSeconds);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
};
