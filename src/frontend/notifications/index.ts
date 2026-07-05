/**
 * Unified notification system for emoemu.
 * Sends notifications to both native OS (via node-notifier) and any subscribed listeners
 * (e.g., the emulator's status bar). Any part of the app can send notifications through
 * this module, and all subscribers will receive them.
 */

import notifier from 'node-notifier';
import { existsSync, writeFileSync } from 'fs';
import { ensureDirectory } from '../../utils/ensureDirectory';
import { join } from 'path';
import { getConfigDirectory } from '../../utils/paths';

export * from './consts';

import { APP_NAME, ICON_FILENAME, DEFAULT_NOTIFICATION_DURATION_MS } from './consts';

// App icon embedded at build time as base64
declare const __APP_ICON_BASE64__: string;
const APP_ICON_BASE64 = typeof __APP_ICON_BASE64__ !== 'undefined' ? __APP_ICON_BASE64__ : '';

/** Whether notifications are enabled (default: true) */
let notificationsEnabled = true;

/** Cached path to the extracted icon */
let iconPath: string | null = null;

/**
 * Notification severity - indicates how important/urgent a user-facing notification is.
 * Values match libretro's severity levels for SET_MESSAGE_EXT compatibility.
 */
export type NotificationSeverity = 'debug' | 'info' | 'warn' | 'error';

import { NOTIFICATION_SEVERITY } from './consts';

/**
 * Convert numeric severity to NotificationSeverity string.
 */
export const numericToSeverity = (value: number): NotificationSeverity => {
  switch (value) {
    case NOTIFICATION_SEVERITY.DEBUG: return 'debug';
    case NOTIFICATION_SEVERITY.WARN: return 'warn';
    case NOTIFICATION_SEVERITY.ERROR: return 'error';
    default: return 'info';
  }
};

/**
 * App-wide notification that can be displayed in multiple places
 * (native OS notifications, status bar, etc.)
 */
export interface AppNotification {
  /** Optional title (defaults to app name for OS notifications) */
  title?: string;
  /** Main message content */
  message: string;
  /** Duration in ms for transient displays like status bar (default: 3000) */
  duration?: number;
  /** Whether to play a sound (for OS notifications) */
  sound?: boolean;
  /** Severity/importance of the notification (default: 'info') */
  severity?: NotificationSeverity;
}

/** Callback for receiving notifications */
export type NotificationListener = (notification: AppNotification) => void;

/** Registered notification listeners */
const listeners = new Set<NotificationListener>();

/**
 * Subscribe to receive all app notifications.
 * Useful for displaying notifications in UI elements like the status bar.
 */
export const subscribeToNotifications = (listener: NotificationListener): void => {
  listeners.add(listener);
};

/**
 * Unsubscribe from notifications.
 */
export const unsubscribeFromNotifications = (listener: NotificationListener): void => {
  listeners.delete(listener);
};

/**
 * Set whether notifications are enabled.
 */
export const setNotificationsEnabled = (enabled: boolean): void => {
  notificationsEnabled = enabled;
};

/**
 * Check if notifications are enabled.
 */
export const isNotificationsEnabled = (): boolean => notificationsEnabled;

/**
 * Ensure the app icon exists in the config directory.
 * Extracts the embedded icon on first run.
 * @returns The absolute path to the icon, or undefined if not available
 */
export const ensureIcon = (): string | undefined => {
  // Return cached path if already extracted
  if (iconPath !== null) {
    return iconPath.length > 0 ? iconPath : undefined;
  }

  // No embedded icon available
  if (!APP_ICON_BASE64) {
    iconPath = '';
    return undefined;
  }

  // Wrap all icon operations in try-catch - icon is nice-to-have, not required
  try {
    const configDir = getConfigDirectory();
    const targetPath = join(configDir, ICON_FILENAME);

    // Check if icon already exists
    if (existsSync(targetPath)) {
      iconPath = targetPath;
      return iconPath;
    }

    ensureDirectory(configDir);

    // Extract icon from embedded base64
    const iconBuffer = Buffer.from(APP_ICON_BASE64, 'base64');
    writeFileSync(targetPath, iconBuffer);
    iconPath = targetPath;
    return iconPath;
  } catch {
    // Any failure with icon detection/extraction - continue without it
    iconPath = '';
    return undefined;
  }
};

/**
 * Send a notification to all channels (native OS and subscribed listeners).
 * This is the primary way to send notifications throughout the app.
 */
export const notify = (options: AppNotification): void => {
  if (!notificationsEnabled) {
    return;
  }

  // Broadcast to all listeners (e.g., status bar)
  const notification: AppNotification = {
    title: options.title,
    message: options.message,
    duration: options.duration ?? DEFAULT_NOTIFICATION_DURATION_MS,
    sound: options.sound,
    severity: options.severity ?? 'info',
  };
  for (const listener of listeners) {
    listener(notification);
  }

  // Send to native OS notification system
  const icon = ensureIcon();
  notifier.notify({
    title: options.title ?? APP_NAME,
    message: options.message,
    sound: options.sound ?? false,
    icon,
  });
};

/**
 * Notify that a screenshot was saved.
 */
export const notifyScreenshotSaved = (filename: string): void => {
  notify({
    title: 'Screenshot Saved',
    message: filename,
  });
};

/**
 * Notify that a gamepad was connected.
 */
export const notifyGamepadConnected = (name: string, playerNumber: number): void => {
  notify({
    title: 'Gamepad Connected',
    message: `${name} (Player ${playerNumber})`,
  });
};

/**
 * Notify that a gamepad was disconnected.
 */
export const notifyGamepadDisconnected = (name: string, playerNumber: number): void => {
  notify({
    title: 'Gamepad Disconnected',
    message: `${name} (Player ${playerNumber})`,
  });
};

/**
 * Notify with a core message (from libretro cores or internal events).
 */
export const notifyCoreMessage = (message: string, title?: string): void => {
  notify({
    title: title ?? 'emoemu',
    message,
  });
};

/**
 * Notify that a netplay client connected.
 */
export const notifyNetplayClientConnected = (nickname: string, playerNumber: number): void => {
  notify({
    title: 'Player Joined',
    message: `${nickname} joined as Player ${playerNumber}`,
  });
};

/**
 * Notify that a netplay client disconnected.
 */
export const notifyNetplayClientDisconnected = (nickname: string): void => {
  notify({
    title: 'Player Left',
    message: `${nickname} disconnected`,
  });
};

/**
 * Notify that a netplay spectator connected.
 */
export const notifyNetplaySpectatorConnected = (nickname: string): void => {
  notify({
    title: 'Spectator Joined',
    message: `${nickname} is now spectating`,
  });
};

/**
 * Notify that a netplay connection failed.
 */
export const notifyNetplayConnectionFailed = (nickname: string, reason: string): void => {
  notify({
    title: 'Connection Failed',
    message: `${nickname}: ${reason}`,
    severity: 'warn',
  });
};
