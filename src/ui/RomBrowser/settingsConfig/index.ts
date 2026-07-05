import { isString, isBoolean } from 'remeda';
import { isVideoDriver, isPostProcessingMode, updateConfigValue, resetConfigValue } from '@/frontend/config';
import type { Config } from '@/frontend/config';
import { setNotificationsEnabled } from '@/frontend/notifications';
import type { SettingsOption, SettingsCategory } from '..';

/** Setter for config values via dynamic key */
export const setConfigField = (config: Config, key: keyof Config, value: Config[keyof Config]) => {
  Object.assign(config, { [key]: value });
};

/** Factory for simple boolean toggle settings */
export const createToggleOption = (key: keyof Config, label: string): SettingsOption => ({
  id: key,
  label,
  type: 'toggle',
  getValue: (config) => isBoolean(config[key]) ? config[key] : false,
  setValue: (config, value, configPath) => {
    if (!isBoolean(value)) { return; }
    setConfigField(config, key, value);
    updateConfigValue(key, value, configPath);
  },
});

/** Factory for numeric select settings (parsed with parseFloat) */
export const createFloatSelectOption = (
  key: keyof Config,
  label: string,
  options: { value: string; label: string }[],
): SettingsOption => ({
  id: key,
  label,
  type: 'select',
  options,
  getValue: (config) => String(config[key]),
  setValue: (config, value, configPath) => {
    if (!isString(value)) { return; }
    const parsed = parseFloat(value);
    setConfigField(config, key, parsed);
    updateConfigValue(key, parsed, configPath);
  },
});

/** Factory for integer select settings (parsed with parseInt) */
export const createIntSelectOption = (
  key: keyof Config,
  label: string,
  options: { value: string; label: string }[],
): SettingsOption => ({
  id: key,
  label,
  type: 'select',
  options,
  getValue: (config) => String(config[key]),
  setValue: (config, value, configPath) => {
    if (!isString(value)) { return; }
    const parsed = parseInt(value, 10);
    setConfigField(config, key, parsed);
    updateConfigValue(key, parsed, configPath);
  },
});

export const videoDriverOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'kitty', label: 'Kitty (best quality)' },
  { value: 'terminal', label: 'Terminal (Unicode blocks)' },
  { value: 'ascii', label: 'ASCII' },
  { value: 'emoji', label: 'Emoji' },
  { value: 'native', label: 'Native window (experimental)' },
];

export const scaleOptions = [
  { value: 'auto', label: 'Auto' },
  { value: '0.25', label: '0.25x' },
  { value: '0.5', label: '0.5x' },
  { value: '1', label: '1x' },
  { value: '2', label: '2x' },
  { value: '3', label: '3x' },
  { value: '4', label: '4x' },
];

export const menuScaleOptions = [
  { value: 'auto', label: 'Auto' },
  { value: '1.0', label: '1x' },
  { value: '1.5', label: '1.5x' },
  { value: '2.0', label: '2x' },
  { value: '2.5', label: '2.5x' },
  { value: '3.0', label: '3x' },
  { value: '4.0', label: '4x' },
];

export const postProcessingModeOptions = [
  { value: 'off', label: 'Off' },
  { value: 'crt', label: 'CRT' },
  { value: 'custom', label: 'Custom' },
];

// Post-processing effect options that are only visible in 'custom' mode
export const customOnlyEffectIds = new Set([
  'video_gamma',
  'video_scanlines',
  'video_saturation',
  'video_vignette',
  'video_curvature',
  'video_chromatic_aberration',
]);

// Settings that are only visible when native render mode is selected
export const nativeOnlyIds = new Set([
  'menu_scale_factor',
]);

export const settingsCategories: SettingsCategory[] = [
  {
    name: 'Emulation',
    options: [
      {
        id: 'video_driver',
        label: 'Render Mode',
        type: 'select',
        options: videoDriverOptions,
        getValue: (config) => config.video_driver === null ? 'auto' : config.video_driver,
        setValue: (config, value, configPath) => {
          if (value === 'auto') {
            config.video_driver = null;
            resetConfigValue('video_driver', configPath);
          } else if (isVideoDriver(value)) {
            config.video_driver = value;
            updateConfigValue('video_driver', config.video_driver, configPath);
          }
        },
      },
      {
        id: 'video_scale',
        label: 'Video Scale',
        type: 'select',
        options: scaleOptions,
        getValue: (config) => config.video_scale === null ? 'auto' : String(config.video_scale),
        setValue: (config, value, configPath) => {
          if (!isString(value)) { return; }
          if (value === 'auto') {
            config.video_scale = null;
            resetConfigValue('video_scale', configPath);
          } else {
            config.video_scale = parseFloat(value);
            updateConfigValue('video_scale', config.video_scale, configPath);
          }
        },
      },
      {
        id: 'menu_scale_factor',
        label: 'Native UI Scale',
        type: 'select',
        options: menuScaleOptions,
        getValue: (config) => config.menu_scale_factor === null ? 'auto' : config.menu_scale_factor.toFixed(1),
        setValue: (config, value, configPath) => {
          if (!isString(value)) { return; }
          if (value === 'auto') {
            config.menu_scale_factor = null;
            resetConfigValue('menu_scale_factor', configPath);
          } else {
            config.menu_scale_factor = parseFloat(value);
            updateConfigValue('menu_scale_factor', config.menu_scale_factor, configPath);
          }
        },
      },
      {
        id: 'audio_enable',
        label: 'Audio',
        type: 'toggle',
        // Audio is effectively ON when enabled and not muted
        getValue: (config) => config.audio_enable && !config.audio_mute_enable,
        setValue: (config, value, configPath) => {
          if (!isBoolean(value)) { return; }
          // Toggle mute state (keep audio_enable as master switch)
          // ON = unmute, OFF = mute
          config.audio_mute_enable = !value;
          updateConfigValue('audio_mute_enable', config.audio_mute_enable, configPath);
        },
      },
      createToggleOption('input_joypad_enable', 'Gamepad Support'),
      {
        id: 'notifications_enable',
        label: 'Notifications',
        type: 'toggle',
        getValue: (config) => config.notifications_enable,
        setValue: (config, value, configPath) => {
          if (!isBoolean(value)) { return; }
          config.notifications_enable = value;
          updateConfigValue('notifications_enable', value, configPath);
          setNotificationsEnabled(value);
        },
      },
      createToggleOption('savestate_auto_load', 'Auto-load Save States'),
      createToggleOption('savestate_auto_save', 'Auto-save Save States'),
      createToggleOption('savestates_in_content_dir', 'Save States to ROM Dir'),
      createToggleOption('savefiles_in_content_dir', 'Battery Saves to ROM Dir'),
      createToggleOption('fps_show_enable', 'Status Bar'),
      createIntSelectOption('video_frame_limit', 'Frame Limit', [
        { value: '15', label: '15 fps' },
        { value: '30', label: '30 fps' },
        { value: '0', label: 'Off' },
      ]),
    ],
  },
  {
    name: 'Post-Processing',
    options: [
      {
        id: 'video_postprocessing_mode',
        label: 'Mode',
        type: 'select',
        options: postProcessingModeOptions,
        getValue: (config) => config.video_postprocessing_mode,
        setValue: (config, value, configPath) => {
          if (!isPostProcessingMode(value)) { return; }
          config.video_postprocessing_mode = value;
          updateConfigValue('video_postprocessing_mode', config.video_postprocessing_mode, configPath);
        },
      },
      createFloatSelectOption('video_gamma', 'Gamma', [
        { value: '1.0', label: '1.0 (Linear)' },
        { value: '1.1', label: '1.1' },
        { value: '1.2', label: '1.2' },
        { value: '1.3', label: '1.3 (CRT)' },
        { value: '1.4', label: '1.4' },
        { value: '1.8', label: '1.8 (Mac)' },
        { value: '2.0', label: '2.0' },
        { value: '2.2', label: '2.2 (sRGB)' },
        { value: '2.4', label: '2.4 (Rec. 709)' },
      ]),
      createFloatSelectOption('video_scanlines', 'Scanlines', [
        { value: '0', label: 'Off' },
        { value: '0.1', label: '0.1 (Subtle)' },
        { value: '0.2', label: '0.2' },
        { value: '0.3', label: '0.3' },
        { value: '0.4', label: '0.4 (Heavy)' },
      ]),
      createFloatSelectOption('video_saturation', 'Saturation', [
        { value: '0.8', label: '0.8' },
        { value: '0.9', label: '0.9' },
        { value: '1.0', label: '1.0 (Default)' },
        { value: '1.1', label: '1.1' },
        { value: '1.2', label: '1.2' },
        { value: '1.3', label: '1.3' },
      ]),
      createFloatSelectOption('video_vignette', 'Vignette', [
        { value: '0', label: 'Off' },
        { value: '0.2', label: '0.2 (Subtle)' },
        { value: '0.3', label: '0.3' },
        { value: '0.5', label: '0.5 (CRT)' },
        { value: '0.7', label: '0.7 (Strong)' },
      ]),
      createFloatSelectOption('video_curvature', 'Curvature', [
        { value: '0', label: 'Off' },
        { value: '0.05', label: '0.05 (Subtle)' },
        { value: '0.1', label: '0.1 (CRT)' },
        { value: '0.15', label: '0.15' },
        { value: '0.2', label: '0.2 (Strong)' },
      ]),
      createFloatSelectOption('video_chromatic_aberration', 'Chromatic Aberration', [
        { value: '0', label: 'Off' },
        { value: '0.3', label: '0.3 (CRT)' },
        { value: '0.5', label: '0.5' },
        { value: '1.0', label: '1.0' },
        { value: '1.5', label: '1.5' },
        { value: '2.0', label: '2.0' },
        { value: '2.5', label: '2.5' },
        { value: '3.0', label: '3.0' },
      ]),
    ],
  },
];

/**
 * Filter settings categories based on post-processing mode and terminal capabilities.
 * Custom effect options are only shown when mode is 'custom'.
 * Kitty option is hidden if Kitty graphics protocol is not supported.
 * Native window option is hidden if the native window backend is not available.
 */
export const filterSettingsCategories = (isCustomMode: boolean, isNativeMode: boolean, kittySupported: boolean, nativeSupported: boolean): SettingsCategory[] =>
  settingsCategories.map(cat => ({
    ...cat,
    options: cat.options.map(opt => {
      // Filter unsupported video drivers from options
      if (opt.id === 'video_driver' && opt.options) {
        return {
          ...opt,
          options: opt.options.filter(o => {
            if (o.value === 'kitty' && !kittySupported) {
              return false;
            }
            if (o.value === 'native' && !nativeSupported) {
              return false;
            }
            return true;
          }),
        };
      }
      return opt;
    }).filter(opt =>
      (!customOnlyEffectIds.has(opt.id) || isCustomMode) &&
      (!nativeOnlyIds.has(opt.id) || isNativeMode)
    ),
  })).filter(cat => cat.options.length > 0);

// Flatten categories into a single list for navigation
export const allSettingsOptions = settingsCategories.flatMap(cat => cat.options);

// Action items for settings panel (dynamic based on whether there's a game to resume)
export const getSettingsActions = (hasResumeGame: boolean) => {
  const actions = [];
  if (hasResumeGame) {
    actions.push({ id: 'resume', label: 'Resume Game', icon: '\u25B6' });
  }
  actions.push({ id: 'back', label: 'Back to Browser', icon: '\u2190' });
  actions.push({ id: 'reset', label: 'Reset All Settings', icon: '\u21BA' });
  actions.push({ id: 'exit', label: 'Exit emoemu', icon: '\u2717' });
  return actions;
};

/** Option ids that belong to the Post-Processing category (locked as a unit). */
export const postProcessingOptionIds: ReadonlySet<string> = new Set(
  settingsCategories.find(cat => cat.name === 'Post-Processing')?.options.map(opt => opt.id) ?? [],
);

export interface OptionLock {
  locked: boolean;
  flag?: string;
}

const POST_PROCESSING_MODE_KEY = 'video_postprocessing_mode';

/**
 * Decide whether a settings row is locked by a CLI flag.
 * Post-Processing is locked as a whole category when its mode key is overridden.
 */
export const getOptionLock = (
  optionId: string,
  lockedKeys: ReadonlySet<string>,
  lockedFlagByKey: ReadonlyMap<string, string>,
): OptionLock => {
  if (postProcessingOptionIds.has(optionId) && lockedKeys.has(POST_PROCESSING_MODE_KEY)) {
    return { locked: true, flag: lockedFlagByKey.get(POST_PROCESSING_MODE_KEY) };
  }
  if (lockedKeys.has(optionId)) {
    return { locked: true, flag: lockedFlagByKey.get(optionId) };
  }
  return { locked: false };
};
