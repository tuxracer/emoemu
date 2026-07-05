/**
 * Centralized Settings Manager
 *
 * Provides a single source of truth for runtime settings that need to:
 * 1. Be toggled during gameplay (e.g., M key for audio mute)
 * 2. Be displayed/edited in the settings UI
 * 3. Persist to the config file
 * 4. Apply changes immediately (e.g., stop/start audio)
 *
 * This replaces the scattered one-off code for each setting with a consistent pattern.
 */

import type { Config, PostProcessingMode } from '../config';
import { updateConfigValue } from '../config';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/getErrorMessage';

/** Render mode for the emulator display */
export type RenderMode = 'native' | 'kitty' | 'terminal' | 'ascii' | 'emoji';

/**
 * Runtime settings that can be toggled during gameplay and synced with config.
 * These are the "live" settings that affect current emulator behavior.
 */
export interface RuntimeSettings {
  /** Whether audio is currently muted */
  audioMuted: boolean;
  /** Current render mode (null = auto, use system-specific default) */
  renderMode: RenderMode | null;
  /** Current post-processing mode */
  postProcessingMode: PostProcessingMode;
  /** Whether to show the status bar */
  showStatusBar: boolean;
  /** Whether gamepad input is enabled */
  gamepadEnabled: boolean;
  /** Frame limit value (0=off, or FPS limit like 30, 60) */
  frameLimit: number;
  /** Menu scale factor (null = auto-detect) */
  menuScaleFactor: number | null;
}

/** Keys of RuntimeSettings that are boolean (for toggle) */
type BooleanSettingKey = { [K in keyof RuntimeSettings]: RuntimeSettings[K] extends boolean ? K : never }[keyof RuntimeSettings];

/** Callback type for setting change listeners */
type SettingChangeCallback<T> = (newValue: T, oldValue: T) => void;

/** Maps runtime setting keys to their config key equivalents */
const SETTING_TO_CONFIG_KEY: Record<keyof RuntimeSettings, keyof Config> = {
  audioMuted: 'audio_mute_enable',
  renderMode: 'video_driver',
  postProcessingMode: 'video_postprocessing_mode',
  showStatusBar: 'fps_show_enable',
  gamepadEnabled: 'input_joypad_enable',
  frameLimit: 'video_frame_limit',
  menuScaleFactor: 'menu_scale_factor',
};

/**
 * Centralized manager for runtime settings.
 *
 * Usage:
 * ```typescript
 * const settings = new SettingsManager(config, configPath);
 *
 * // Register listener for changes (e.g., to stop/start audio)
 * settings.onChange('audioMuted', (muted) => {
 *   if (muted) stopAudio();
 *   else startAudio();
 * });
 *
 * // Toggle a setting (persists to config and notifies listeners)
 * settings.set('audioMuted', !settings.get('audioMuted'));
 *
 * // Cycle through options
 * settings.cycle('renderMode', ['kitty', 'terminal', 'ascii', 'emoji']);
 * ```
 */
export class SettingsManager {
  private settings: RuntimeSettings;
  private config: Config;
  private configPath?: string;
  private listeners: Map<keyof RuntimeSettings, Set<SettingChangeCallback<unknown>>>;

  constructor(config: Config, configPath?: string) {
    this.config = config;
    this.configPath = configPath;
    this.listeners = new Map();

    // Initialize runtime settings from config
    this.settings = {
      audioMuted: config.audio_mute_enable,
      renderMode: config.video_driver,
      postProcessingMode: config.video_postprocessing_mode,
      showStatusBar: config.fps_show_enable,
      gamepadEnabled: config.input_joypad_enable,
      frameLimit: config.video_frame_limit,
      menuScaleFactor: config.menu_scale_factor,
    };
  }

  /**
   * Get the current value of a setting.
   */
  get<K extends keyof RuntimeSettings>(key: K): RuntimeSettings[K] {
    return this.settings[key];
  }

  /**
   * Set a setting value, persist to config, and notify listeners.
   */
  set<K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]): void {
    const oldValue = this.settings[key];
    if (oldValue === value) {
      return; // No change
    }

    // Update runtime state
    this.settings[key] = value;

    // Persist to config file
    this.persistToConfig(key, value);

    // Notify listeners
    this.notifyListeners(key, value, oldValue);
  }

  /**
   * Toggle a boolean setting.
   */
  toggle(key: BooleanSettingKey): void {
    this.set(key, !this.settings[key]);
  }

  /**
   * Cycle through a list of values for a setting.
   * Returns the new value.
   */
  cycle<K extends keyof RuntimeSettings>(
    key: K,
    values: RuntimeSettings[K][]
  ): RuntimeSettings[K] {
    const current = this.settings[key];
    const currentIndex = values.indexOf(current);
    const nextIndex = (currentIndex + 1) % values.length;
    const nextValue = values[nextIndex];
    this.set(key, nextValue);
    return nextValue;
  }

  /**
   * Register a callback to be called when a setting changes.
   * Returns an unsubscribe function.
   */
  onChange<K extends keyof RuntimeSettings>(
    key: K,
    callback: SettingChangeCallback<RuntimeSettings[K]>
  ): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    const callbacks = this.listeners.get(key)!;
    callbacks.add(callback as SettingChangeCallback<unknown>);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback as SettingChangeCallback<unknown>);
    };
  }

  /**
   * Get all current settings (for passing to components that need the full state).
   */
  getAll(): Readonly<RuntimeSettings> {
    return { ...this.settings };
  }

  /**
   * Reload settings from config (e.g., after config file changes externally).
   */
  reloadFromConfig(config: Config): void {
    this.config = config;

    // Update each setting, triggering listeners if values changed
    this.set('audioMuted', config.audio_mute_enable);
    this.set('renderMode', config.video_driver);
    this.set('postProcessingMode', config.video_postprocessing_mode);
    this.set('showStatusBar', config.fps_show_enable);
    this.set('gamepadEnabled', config.input_joypad_enable);
    this.set('frameLimit', config.video_frame_limit);
    this.set('menuScaleFactor', config.menu_scale_factor);
  }

  /**
   * Get the underlying config object (for settings not managed by this class).
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * Get the config file path.
   */
  getConfigPath(): string | undefined {
    return this.configPath;
  }

  /**
   * Persist a setting value to the config file.
   */
  private persistToConfig<K extends keyof RuntimeSettings>(
    key: K,
    value: RuntimeSettings[K]
  ): void {
    const configKey = SETTING_TO_CONFIG_KEY[key];

    // Update the in-memory config object
    // TypeScript can't verify the relationship between RuntimeSettings and Config keys
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (this.config as any)[configKey] = value;

    // Persist to file
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      updateConfigValue(configKey, value as any, this.configPath);
    } catch {
      // Silently ignore config save errors during gameplay
    }
  }

  /**
   * Notify all listeners for a setting that it has changed.
   */
  private notifyListeners<K extends keyof RuntimeSettings>(
    key: K,
    newValue: RuntimeSettings[K],
    oldValue: RuntimeSettings[K]
  ): void {
    const callbacks = this.listeners.get(key);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(newValue, oldValue);
        } catch (err) {
          logger.error(`Error in settings change listener for '${key}': ${getErrorMessage(err)}`, 'Settings');
        }
      }
    }
  }
}
