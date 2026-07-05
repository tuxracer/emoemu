export const APP_NAME = 'emoemu';
export const ICON_FILENAME = 'icon.png';
export const DEFAULT_NOTIFICATION_DURATION_MS = 3000;

/**
 * Numeric values for notification severity (matches libretro SET_MESSAGE_EXT).
 * Useful for converting from libretro numeric values.
 */
export const NOTIFICATION_SEVERITY = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;
