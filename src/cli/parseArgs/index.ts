import { clamp } from 'remeda';
import type { RenderMode } from '../../Emulator';
import type { Config, VideoDriver, CliOverride } from '../../frontend/config';
import { loadConfig, getPlaylistsDirectory } from '../../frontend/config';
import { initializeServices } from '../../frontend/serviceProvider';
import { setNotificationsEnabled } from '../../frontend/notifications';
import { PNG_COMPRESSION_MIN, PNG_COMPRESSION_MAX } from '../../rendering';
import { MAX_INPUT_DELAY_FRAMES } from '../../netplay';
import type { CliOptions } from './types';
import {
  DEFAULT_SCANLINES,
  DEFAULT_VIGNETTE,
  DEFAULT_BLOOM,
  MIN_FRAME_LIMIT,
  DEFAULT_NTSC,
  DEFAULT_CURVATURE,
  DEFAULT_CHROMATIC_ABERRATION,
  CRT_SCALE,
  CRT_NTSC,
  CRT_SCANLINES,
  CRT_GAMMA,
  CRT_VIGNETTE,
  CRT_CURVATURE,
  CRT_CHROMATIC_ABERRATION,
} from './consts';

export * from './consts';
export * from './types';

// Map config video_driver to RenderMode (null = Auto, use system-specific default)
const videoDriverToRenderMode = (driver: VideoDriver | null): RenderMode | undefined => {
  switch (driver) {
    case null: return undefined;  // Auto (system-specific default)
    case "native": return "native";
    case "kitty": return "kitty";
    case "terminal": return "terminal";
    case "ascii": return "ascii";
    case "emoji": return "emoji";
    default: return "kitty";
  }
};

/** Merge CLI override values onto a config object (used at every config load point). */
export const applyCliOverrides = (config: Config, overrides: CliOverride[]): void => {
  for (const o of overrides) {
    Object.assign(config, { [o.key]: o.value });
  }
};

/** Rewrite a video_driver override's value (used when a startup fallback degrades the driver). */
export const remapDriverOverride = (overrides: CliOverride[], from: VideoDriver, to: VideoDriver): void => {
  for (const o of overrides) {
    if (o.key === 'video_driver' && o.value === from) {
      o.value = to;
    }
  }
};

export const parseArgs = (args: string[]): CliOptions => {
  // First pass: find --config flag to load config file before processing other args
  let configPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = args[i + 1];
      break;
    }
  }

  // Load config (will use defaults if no config file exists)
  const { config, loadedFrom: _loadedFrom } = loadConfig(configPath);

  // Initialize services with config (makes them available globally)
  initializeServices(config);

  // Initialize notifications setting from config
  setNotificationsEnabled(config.notifications_enable);

  // Initialize result with values from config (CLI flags will override)
  const result: CliOptions = {
    romPath: undefined,
    width: config.custom_viewport_width ?? undefined,
    height: config.custom_viewport_height ?? undefined,
    colorEnabled: config.video_color_enable,
    renderMode: videoDriverToRenderMode(config.video_driver),  // undefined = Auto
    cliOverrides: [],
    scale: config.video_scale ?? undefined,  // null = Auto (system-specific default)
    help: false,
    showVersion: false,
    listGamepads: false,
    listCoresFlag: false,
    installCore: undefined,
    removeCore: undefined,
    core: config.core_default || undefined,
    enableGamepad: config.input_joypad_enable,
    enableAudio: config.audio_enable,
    startMuted: config.audio_mute_enable,
    enableSaveState: config.savestate_auto_load && config.savestate_auto_save,
    enableBatterySave: config.battery_save_enable,
    showStatusBar: config.fps_show_enable,
    enableDiffRendering: config.video_diff_render,
    noRender: false,
    debugGamepad: false,
    fpsLimit: config.fps_limit || undefined,
    loadRetroArch: config.retroarch_cores_enable,
    pngCompressionLevel: config.kitty_png_level,
    // Post-processing effects based on mode: off (no effects), crt (presets), or custom (user values)
    gamma: config.video_postprocessing_mode === 'crt' ? config.crt_gamma :
           config.video_postprocessing_mode === 'custom' ? config.video_gamma : 1.0,
    scanlines: config.video_postprocessing_mode === 'crt' ? config.crt_scanlines :
               config.video_postprocessing_mode === 'custom' ? config.video_scanlines : 0,
    saturation: config.video_postprocessing_mode === 'crt' ? config.crt_saturation :
                config.video_postprocessing_mode === 'custom' ? config.video_saturation : 1.0,
    brightness: config.video_postprocessing_mode === 'custom' ? config.video_brightness : 1.0,
    contrast: config.video_postprocessing_mode === 'custom' ? config.video_contrast : 1.0,
    vignette: config.video_postprocessing_mode === 'crt' ? config.crt_vignette :
              config.video_postprocessing_mode === 'custom' ? config.video_vignette : 0,
    bloom: config.video_postprocessing_mode === 'custom' ? config.video_bloom : 0,
    bloomThreshold: config.video_bloom_threshold,
    ntsc: config.video_postprocessing_mode === 'crt' ? config.crt_ntsc :
          config.video_postprocessing_mode === 'custom' ? config.video_ntsc : 0,
    curvature: config.video_postprocessing_mode === 'crt' ? config.crt_curvature :
               config.video_postprocessing_mode === 'custom' ? config.video_curvature : 0,
    chromaticAberration: config.video_postprocessing_mode === 'crt' ? config.crt_chromatic_aberration :
                         config.video_postprocessing_mode === 'custom' ? config.video_chromatic_aberration : 0,
    hasUserEffects: false,  // Will be set to true if any effect flag is specified
    configPath,
    config,
    scanDepth: config.browser_scan_depth,
    // Playlist generation options
    generatePlaylist: false,
    playlistOutput: getPlaylistsDirectory(config),
    singlePlaylist: undefined,
    windowsPaths: false,
    // Netplay options
    netplayHost: false,
    netplayConnect: undefined,
    netplayPort: 55435,
    netplayPassword: undefined,
    netplaySpectate: false,
    netplayNickname: 'Player',
    netplayInputDelay: 0,
    clearLogs: false,
    verbose: false,
    frameLimit: config.video_frame_limit,
  };

  const addOverride = <K extends keyof Config>(key: K, value: Config[K], flag: string): void => {
    result.cliOverrides.push({ key, value, flag });
  };

  // Track if config had non-default effect values (for hasUserEffects)
  const configHasEffects = config.video_gamma !== 1.0 ||
    config.video_scanlines !== 0 ||
    config.video_saturation !== 1.0 ||
    config.video_brightness !== 1.0 ||
    config.video_contrast !== 1.0 ||
    config.video_vignette !== 0 ||
    config.video_bloom !== 0 ||
    config.video_ntsc !== 0 ||
    config.video_curvature !== 0 ||
    config.video_chromatic_aberration !== 0;

  // Track which CRT-related flags were explicitly set (for --crt override logic)
  let crtMode = false;
  let scaleExplicit = false;
  let gammaExplicit = false;
  let scanlinesExplicit = false;
  let saturationExplicit = false;
  let brightnessExplicit = false;
  let contrastExplicit = false;
  let ntscExplicit = false;
  let vignetteExplicit = false;
  let bloomExplicit = false;
  let bloomThresholdExplicit = false;
  let curvatureExplicit = false;
  let chromaticAberrationExplicit = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-V") {
      result.showVersion = true;
    } else if (arg === "--width" && args[i + 1]) {
      result.width = parseInt(args[++i], 10);
    } else if (arg === "--height" && args[i + 1]) {
      result.height = parseInt(args[++i], 10);
    } else if (arg === "--scale" && args[i + 1]) {
      result.scale = parseFloat(args[++i]);
      scaleExplicit = true;
      addOverride('video_scale', result.scale, '--scale');
    } else if (arg === "--png-level" && args[i + 1]) {
      const level = parseInt(args[++i], 10);
      result.pngCompressionLevel = clamp(level, { min: PNG_COMPRESSION_MIN, max: PNG_COMPRESSION_MAX });
    } else if (arg === "--ascii") {
      result.renderMode = "ascii";
      result.config.video_driver = "ascii";
      addOverride('video_driver', 'ascii', '--ascii');
    } else if (arg === "--emoji") {
      result.renderMode = "emoji";
      result.config.video_driver = "emoji";
      addOverride('video_driver', 'emoji', '--emoji');
    } else if (arg === "--no-color") {
      result.colorEnabled = false;
    } else if (arg === "--native") {
      result.renderMode = "native";
      result.config.video_driver = "native";
      addOverride('video_driver', 'native', '--native');
    } else if (arg === "--kitty") {
      result.renderMode = "kitty";
      result.config.video_driver = "kitty";
      addOverride('video_driver', 'kitty', '--kitty');
    } else if (arg === "--terminal") {
      result.renderMode = "terminal";
      result.config.video_driver = "terminal";
      addOverride('video_driver', 'terminal', '--terminal');
    } else if (arg === "--list-gamepads") {
      result.listGamepads = true;
    } else if (arg === "--list-cores") {
      result.listCoresFlag = true;
    } else if (arg === "--install-core" && args[i + 1]) {
      result.installCore = args[++i];
    } else if (arg === "--remove-core" && args[i + 1]) {
      result.removeCore = args[++i];
    } else if (arg === "--core" && args[i + 1]) {
      result.core = args[++i];
    } else if (arg === "--no-gamepad") {
      result.enableGamepad = false;
      addOverride('input_joypad_enable', false, '--no-gamepad');
    } else if (arg === "--no-audio") {
      result.enableAudio = false;
      addOverride('audio_enable', false, '--no-audio');
      addOverride('audio_mute_enable', true, '--no-audio');
    } else if (arg === "--no-save-state") {
      result.enableSaveState = false;
      addOverride('savestate_auto_load', false, '--no-save-state');
      addOverride('savestate_auto_save', false, '--no-save-state');
    } else if (arg === "--no-battery-save") {
      result.enableBatterySave = false;
    } else if (arg === "--status") {
      result.showStatusBar = true;
      addOverride('fps_show_enable', true, '--status');
    } else if (arg === "--no-diff-render") {
      result.enableDiffRendering = false;
    } else if (arg === "--no-render") {
      result.noRender = true;
    } else if (arg === "--debug-gamepad") {
      result.debugGamepad = true;
    } else if (arg === "--clear-logs") {
      result.clearLogs = true;
    } else if (arg === "--verbose" || arg === "-v") {
      result.verbose = true;
    } else if (arg === "--fps-limit" && args[i + 1]) {
      result.fpsLimit = parseInt(args[++i], 10);
    } else if (arg === "--frame-limit" && args[i + 1]) {
      const limit = parseInt(args[++i], 10);
      result.frameLimit = limit <= 0 ? 0 : Math.max(MIN_FRAME_LIMIT, limit);  // 0 = off, otherwise min 1
      addOverride('video_frame_limit', result.frameLimit, '--frame-limit');
    } else if (arg === "--retroarch") {
      result.loadRetroArch = true;
    } else if (arg === "--crt") {
      crtMode = true;
    } else if (arg === "--gamma" && args[i + 1]) {
      result.gamma = parseFloat(args[++i]);
      gammaExplicit = true;
    } else if (arg === "--scanlines") {
      // Check if next arg is a number (not another flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-") && !isNaN(parseFloat(nextArg))) {
        result.scanlines = parseFloat(args[++i]);
      } else {
        result.scanlines = DEFAULT_SCANLINES;
      }
      scanlinesExplicit = true;
    } else if (arg === "--saturation" && args[i + 1]) {
      result.saturation = parseFloat(args[++i]);
      saturationExplicit = true;
    } else if (arg === "--brightness" && args[i + 1]) {
      result.brightness = parseFloat(args[++i]);
      brightnessExplicit = true;
    } else if (arg === "--contrast" && args[i + 1]) {
      result.contrast = parseFloat(args[++i]);
      contrastExplicit = true;
    } else if (arg === "--vignette") {
      // Check if next arg is a number (not another flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-") && !isNaN(parseFloat(nextArg))) {
        result.vignette = parseFloat(args[++i]);
      } else {
        result.vignette = DEFAULT_VIGNETTE;
      }
      vignetteExplicit = true;
    } else if (arg === "--bloom") {
      // Check if next arg is a number (not another flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-") && !isNaN(parseFloat(nextArg))) {
        result.bloom = parseFloat(args[++i]);
      } else {
        result.bloom = DEFAULT_BLOOM;
      }
      bloomExplicit = true;
    } else if (arg === "--bloom-threshold" && args[i + 1]) {
      result.bloomThreshold = parseFloat(args[++i]);
      bloomThresholdExplicit = true;
    } else if (arg === "--ntsc") {
      // Check if next arg is a number (not another flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-") && !isNaN(parseFloat(nextArg))) {
        result.ntsc = parseFloat(args[++i]);
      } else {
        result.ntsc = DEFAULT_NTSC;
      }
      ntscExplicit = true;
    } else if (arg === "--curvature") {
      // Check if next arg is a number (not another flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-") && !isNaN(parseFloat(nextArg))) {
        result.curvature = parseFloat(args[++i]);
      } else {
        result.curvature = DEFAULT_CURVATURE;
      }
      curvatureExplicit = true;
    } else if (arg === "--chromatic-aberration") {
      // Check if next arg is a number (not another flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-") && !isNaN(parseFloat(nextArg))) {
        result.chromaticAberration = parseFloat(args[++i]);
      } else {
        result.chromaticAberration = DEFAULT_CHROMATIC_ABERRATION;
      }
      chromaticAberrationExplicit = true;
    } else if (arg === "--scan-depth" && args[i + 1]) {
      result.scanDepth = parseInt(args[++i], 10);
    } else if (arg === "--generate-playlist") {
      // Check if next arg is a path (not another flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        result.generatePlaylist = args[++i];
      } else {
        result.generatePlaylist = true; // Use cwd
      }
    } else if (arg === "--playlist-output" && args[i + 1]) {
      result.playlistOutput = args[++i];
    } else if (arg === "--single-playlist" && args[i + 1]) {
      result.singlePlaylist = args[++i];
    } else if (arg === "--windows-paths") {
      result.windowsPaths = true;
    } else if (arg === "--config" && args[i + 1]) {
      // Already handled in first pass, just skip the argument
      i++;
    } else if (arg === "--netplay-host") {
      result.netplayHost = true;
    } else if (arg === "--netplay-connect") {
      // Check if next arg is a host (not another flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        result.netplayConnect = args[++i];
      } else {
        // No host specified - use LAN discovery
        result.netplayConnect = '';
      }
    } else if (arg === "--netplay-port" && args[i + 1]) {
      result.netplayPort = parseInt(args[++i], 10);
    } else if (arg === "--netplay-password" && args[i + 1]) {
      result.netplayPassword = args[++i];
    } else if (arg === "--netplay-spectate") {
      result.netplaySpectate = true;
    } else if (arg === "--netplay-nick" && args[i + 1]) {
      result.netplayNickname = args[++i];
    } else if (arg === "--netplay-frames" && args[i + 1]) {
      const frames = parseInt(args[++i], 10);
      result.netplayInputDelay = clamp(frames, { min: 0, max: MAX_INPUT_DELAY_FRAMES });
    } else if (!arg.startsWith("-")) {
      result.romPath = arg;
    }
  }

  // Apply --crt preset defaults for flags not explicitly set
  if (crtMode) {
    if (!scaleExplicit) {
      result.scale = CRT_SCALE;
    }
    if (!ntscExplicit) {
      result.ntsc = CRT_NTSC;
    }
    if (!scanlinesExplicit) {
      result.scanlines = CRT_SCANLINES;
    }
    if (!gammaExplicit) {
      result.gamma = CRT_GAMMA;
    }
    if (!vignetteExplicit) {
      result.vignette = CRT_VIGNETTE;
    }
    if (!curvatureExplicit) {
      result.curvature = CRT_CURVATURE;
    }
    if (!chromaticAberrationExplicit) {
      result.chromaticAberration = CRT_CHROMATIC_ABERRATION;
    }
  }

  // Record post-processing overrides so effect flags are sticky and the whole
  // Post-Processing settings category locks. --crt selects the CRT preset (crt_*
  // config defaults apply); individual effect flags select custom mode and pin
  // each passed value onto its video_* config key.
  const effectFlagToKey: Array<{ explicit: boolean; key: keyof Config; value: number; flag: string }> = [
    { explicit: gammaExplicit, key: 'video_gamma', value: result.gamma, flag: '--gamma' },
    { explicit: scanlinesExplicit, key: 'video_scanlines', value: result.scanlines, flag: '--scanlines' },
    { explicit: saturationExplicit, key: 'video_saturation', value: result.saturation, flag: '--saturation' },
    { explicit: brightnessExplicit, key: 'video_brightness', value: result.brightness, flag: '--brightness' },
    { explicit: contrastExplicit, key: 'video_contrast', value: result.contrast, flag: '--contrast' },
    { explicit: vignetteExplicit, key: 'video_vignette', value: result.vignette, flag: '--vignette' },
    { explicit: bloomExplicit, key: 'video_bloom', value: result.bloom, flag: '--bloom' },
    { explicit: bloomThresholdExplicit, key: 'video_bloom_threshold', value: result.bloomThreshold, flag: '--bloom-threshold' },
    { explicit: ntscExplicit, key: 'video_ntsc', value: result.ntsc, flag: '--ntsc' },
    { explicit: curvatureExplicit, key: 'video_curvature', value: result.curvature, flag: '--curvature' },
    { explicit: chromaticAberrationExplicit, key: 'video_chromatic_aberration', value: result.chromaticAberration, flag: '--chromatic-aberration' },
  ];
  const explicitEffects = effectFlagToKey.filter(e => e.explicit);

  if (crtMode) {
    addOverride('video_postprocessing_mode', 'crt', '--crt');
  } else if (explicitEffects.length > 0) {
    addOverride('video_postprocessing_mode', 'custom', explicitEffects[0].flag);
    for (const e of explicitEffects) {
      addOverride(e.key, e.value, e.flag);
    }
  }

  // Determine if user explicitly specified any post-processing effects
  // --crt counts as having user effects since it's an explicit choice
  // video_postprocessing_mode !== 'off' means effects are enabled in config
  // configHasEffects means the config file had non-default custom effect values
  result.hasUserEffects = crtMode ||
    config.video_postprocessing_mode !== 'off' ||
    configHasEffects ||
    gammaExplicit ||
    scanlinesExplicit ||
    saturationExplicit ||
    brightnessExplicit ||
    contrastExplicit ||
    vignetteExplicit ||
    bloomExplicit ||
    bloomThresholdExplicit ||
    ntscExplicit ||
    curvatureExplicit ||
    chromaticAberrationExplicit;

  // Make config the authoritative carrier of CLI overrides from the start.
  applyCliOverrides(result.config, result.cliOverrides);

  return result;
};

/**
 * Update runtime options from a fresh config (for settings changed in browser)
 * Only updates settings that can be changed at runtime, preserving CLI overrides
 */
export const updateOptionsFromConfig = (options: CliOptions, config: Config): void => {
  // Video settings. `config` has already been merged with any CLI overrides
  // (applyCliOverrides), so reading video_driver here yields the CLI value when set.
  options.renderMode = videoDriverToRenderMode(config.video_driver);  // undefined = Auto
  options.scale = config.video_scale ?? undefined;  // null = Auto (system-specific default)

  // Update audio/input settings
  options.enableAudio = config.audio_enable;
  options.startMuted = config.audio_mute_enable;
  options.enableGamepad = config.input_joypad_enable;

  // Update save state settings
  options.enableSaveState = config.savestate_auto_load && config.savestate_auto_save;

  // Update status bar setting
  options.showStatusBar = config.fps_show_enable;

  // Update frame limit setting
  options.frameLimit = config.video_frame_limit;

  // Update notifications
  setNotificationsEnabled(config.notifications_enable);

  // Update post-processing effects based on mode
  if (config.video_postprocessing_mode === 'crt') {
    options.gamma = config.crt_gamma;
    options.scanlines = config.crt_scanlines;
    options.saturation = config.crt_saturation;
    options.vignette = config.crt_vignette;
    options.ntsc = config.crt_ntsc;
    options.curvature = config.crt_curvature;
    options.chromaticAberration = config.crt_chromatic_aberration;
    options.hasUserEffects = true;
  } else if (config.video_postprocessing_mode === 'custom') {
    options.gamma = config.video_gamma;
    options.scanlines = config.video_scanlines;
    options.saturation = config.video_saturation;
    options.brightness = config.video_brightness;
    options.contrast = config.video_contrast;
    options.vignette = config.video_vignette;
    options.bloom = config.video_bloom;
    options.ntsc = config.video_ntsc;
    options.curvature = config.video_curvature;
    options.chromaticAberration = config.video_chromatic_aberration;
    options.hasUserEffects = true;
  } else {
    // 'off' mode - reset to defaults
    options.gamma = 1.0;
    options.scanlines = 0;
    options.saturation = 1.0;
    options.brightness = 1.0;
    options.contrast = 1.0;
    options.vignette = 0;
    options.bloom = 0;
    options.ntsc = 0;
    options.curvature = 0;
    options.chromaticAberration = 0;
    options.hasUserEffects = false;
  }

  // Update browser scan depth
  options.scanDepth = config.browser_scan_depth;
};
