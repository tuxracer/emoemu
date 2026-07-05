import { clamp } from 'remeda';
import { readFileSync, existsSync } from 'fs';
import { basename, extname } from 'path';
import { Controller, Button } from '../input/Controller';
import { InputManager } from '../input/InputManager';
import { InputMapper } from '../input/InputMapper';
import { GamepadManager } from '../input/GamepadManager';
import { StandardButton } from '../core/button';
import { TerminalRenderer } from '../rendering/TerminalRenderer';
import { KittyRenderer } from '../rendering/KittyRenderer';
import { NativeRenderer } from '../rendering/NativeRenderer';
import { isRgb24Buffer, type Core, type SystemInfo, type CoreMessage } from '../core/core';
import { NetplayServer, createNetplayServer } from '../netplay/NetplayServer';
import { NetplayClient, createNetplayClient } from '../netplay/NetplayClient';
import { NetplayError, type NetplayServerOptions, type NetplayClientOptions } from '../netplay';
import { crc32 } from '../netplay/crc32';
import { DiscoveryListener } from '../netplay/NetplayDiscovery';
import { netplayLogger } from '../netplay/netplayLogger';
import { wireRollbackReplay } from '../netplay/rollbackReplay';
import { packAnalogStick, unpackAnalogX, unpackAnalogY } from '../netplay/analogInput';
import type { SyncManager } from '../netplay/SyncManager';
import {
  DEFAULT_PORT as NETPLAY_DEFAULT_PORT,
  MAX_CLIENTS as NETPLAY_MAX_CLIENTS,
  ROLLBACK_NOTIFICATION_THRESHOLD,
  DISCOVERY_QUERY_DELAY_MS,
  DISCOVERY_TIMEOUT_MS,
} from '../netplay';
import { type Config } from '../frontend/config';
import { getDefaultCoreOptions } from '../cores/libretro/coreOptions';
import { SettingsManager, type RenderMode } from '../frontend/SettingsManager';
import { getRomTitle } from '../frontend/romScanner';
import { getSystemName } from '../frontend/playlist';
import {
  notify,
  subscribeToNotifications,
  unsubscribeFromNotifications,
  type AppNotification,
} from '../frontend/notifications';
import { showNetplayPauseMenu, type PauseMenuChoice } from '../ui/NetplayPauseMenu';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/getErrorMessage';
import {
  LIBRETRO_BOOTSTRAP_FRAMES,
  MAX_FRAME_SKIP,
  MS_PER_SECOND,
  SAMPLE_RATE_44100,
  SAMPLE_RATE_48000,
  AUDIO_FRAME_DURATION_SEC,
  AUDIO_STEREO_CHANNELS,
  BYTES_PER_INT16_SAMPLE,
  AUDIO_RING_BUFFER_FRAMES,
  INT16_MAX_VALUE,
  MAX_AUDIO_QUEUED_FRAMES,
  BYTES_PER_STEREO_SAMPLE,
  RTAUDIO_RECOVERABLE_ERROR_THRESHOLD,
  AUDIO_RECOVERY_DELAY_MS,
  FLOAT_COMPARE_EPSILON,
  STEREO_NEXT_RIGHT_OFFSET,
  GAMEPAD_DIALOG_POLL_INTERVAL_MS,
  ASPECT_RATIO_DECIMALS,
} from '../frontend';
import {
  DEFAULT_BLOOM_THRESHOLD,
  DEFAULT_GAMMA,
  DEFAULT_SATURATION,
  DEFAULT_BRIGHTNESS,
  DEFAULT_CONTRAST,
  DEFAULT_SCANLINES,
  DEFAULT_VIGNETTE,
  DEFAULT_BLOOM,
  DEFAULT_NTSC,
  DEFAULT_CURVATURE,
  DEFAULT_CHROMATIC_ABERRATION,
  DEFAULT_NATIVE_SCALE,
  getDefaultScaleForSystem,
  getDefaultRenderModeForSystem,
} from '../rendering';
import { getTerminalDimensions } from '../utils/terminal';
import pkg from 'audify';
const { RtAudio, RtAudioFormat } = pkg;

// Sub-module imports
import type { PostProcessingMode, EffectValues, Renderer, EmulatorOptions } from './types';
import {
  BOUNDS_CHECK_INTERVAL_INITIAL,
  BOUNDS_CHECK_INTERVAL_LATER,
  BOUNDS_CHECK_MAX_COUNT,
  BOUNDS_CHECK_INITIAL_COUNT,
  AUTO_SAVE_INTERVAL_MS,
  STATUS_BAR_UPDATE_INTERVAL,
  DEFAULT_MESSAGE_DURATION_MS,
} from './consts';
import { calculateTerminalDimensions } from './terminalDimensions';
import { nextLoopDelayMs, PAUSE_MENU_POLL_MS } from './framePacer';
import { OutputGate } from './OutputGate';
import {
  takeScreenshot as takeScreenshotFn,
  saveThumbnailScreenshot as saveThumbnailScreenshotFn,
} from './screenshot';
import {
  getStatePath as getStatePathFn,
  loadBatterySave as loadBatterySaveFn,
  saveBatterySave as saveBatterySaveFn,
  hasSavedState as hasSavedStateFn,
  saveState as saveStateFn,
  loadStateFromFile,
  deleteSavedState as deleteSavedStateFn,
} from './saveState';

// Re-export types and consts from sub-modules
export * from './types';
export * from './consts';

export class Emulator {
  // Properties assigned in initializeCore()
  private core!: Core;
  private systemInfo!: SystemInfo;
  private targetFrameTime!: number;

  // Properties assigned in initializeInput()
  private controller1!: Controller;
  private controller2!: Controller;
  private inputManager!: InputManager;
  private inputMapper!: InputMapper;
  private gamepadManager: GamepadManager | null = null;
  private keyboardAnalogActive: boolean = false;  // Track keyboard->analog for proper release

  // Properties assigned in initializeRenderer()
  private renderer!: Renderer;
  private renderMode!: RenderMode;
  private rtAudio: InstanceType<typeof RtAudio> | null = null;
  private audioCallback: ((samples: Float32Array) => void) | null = null;
  private audioEnabled: boolean = true;
  private saveStateEnabled: boolean = true;
  private batterySaveEnabled: boolean = true;
  private autoResize: boolean = false; // Whether to handle terminal resize events
  private showStatusBar: boolean = true;
  private diffRenderingEnabled: boolean = true;  // Diff-based rendering for terminal/ascii/emoji modes
  private noRender: boolean = false;  // Disable video rendering output (for debugging)
  private frameLimit: number = 0;  // Limit rendering to N fps (0=off/unlimited)
  private lastRenderTime: number = 0;  // Timestamp of last render for frame limiting
  private renderInterval: number = 0;  // Minimum ms between renders (calculated from frameLimit)
  private outputGate = new OutputGate(process.stdout);  // Drops frames while stdout is backed up
  private colorEnabled: boolean = true;  // Color mode (false = grayscale)
  private kittyScale: number = 2;  // Scale factor for Kitty renderer (0.25-4)
  private nativeScale: number = DEFAULT_NATIVE_SCALE;  // Scale factor for native renderer
  private gamma: number = DEFAULT_GAMMA;  // Gamma correction for Kitty mode
  private scanlines: number = DEFAULT_SCANLINES;  // Scanline intensity for Kitty mode
  private saturation: number = DEFAULT_SATURATION;  // Color saturation for Kitty mode
  private brightness: number = DEFAULT_BRIGHTNESS;  // Brightness multiplier for Kitty mode
  private contrast: number = DEFAULT_CONTRAST;  // Contrast multiplier for Kitty mode
  private vignette: number = DEFAULT_VIGNETTE;  // Vignette intensity for Kitty mode
  private bloom: number = DEFAULT_BLOOM;  // Bloom/glow intensity for Kitty mode
  private bloomThreshold: number = DEFAULT_BLOOM_THRESHOLD;  // Brightness threshold for bloom
  private ntsc: number = DEFAULT_NTSC;  // NTSC artifact intensity for Kitty mode
  private curvature: number = DEFAULT_CURVATURE;  // CRT curvature for Kitty mode
  private chromaticAberration: number = DEFAULT_CHROMATIC_ABERRATION;  // Chromatic aberration for Kitty mode
  private postProcessingMode: PostProcessingMode = 'off';  // Current post-processing mode
  private hasCustomEffects: boolean = false;  // Whether user has custom effect values defined
  private customEffectValues: EffectValues | null = null;  // User's custom effect values (from config or CLI)
  private romPath: string;
  private config: Config | null = null;  // Config for reading values (CRT presets, directories)
  private settingsManager: SettingsManager | null = null;  // Centralized settings manager
  private settingsUnsubscribers: (() => void)[] = [];  // Cleanup functions for settings listeners

  private running: boolean = false;
  private frameCount: number = 0;
  private needsContentBoundsDetection: boolean = false;  // Detect content bounds on first contentful frame
  private lastBoundsCheckFrame: number = 0;  // Frame when bounds were last checked
  private boundsCheckCount: number = 0;  // Number of times bounds have been checked
  private lastFrameTime: number = 0;
  private resizeHandler: (() => void) | null = null;
  private inputHandler: ((key: string) => void) | null = null;
  private notificationHandler: ((notification: AppNotification) => void) | null = null;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  // Status bar throttling - update every N frames to reduce string building overhead
  private statusBarFrameCounter: number = 0;

  // FPS tracking - rolling average over 1 second window
  private fpsFrameCount: number = 0;
  private fpsWindowStart: number = 0;
  private currentFps: number = 0;
  // Render FPS tracking (frames actually drawn to terminal)
  private renderFpsFrameCount: number = 0;
  private currentRenderFps: number = 0;

  // Core message display
  private currentMessage: CoreMessage | null = null;
  private messageExpiry: number = 0;  // Timestamp when message should disappear

  // Netplay
  private netplayServer: NetplayServer | null = null;
  private netplayClient: NetplayClient | null = null;
  private netplayOptions: EmulatorOptions | null = null;  // Store for deferred netplay init
  private netplayMergedInput: number[] | null = null;  // Input merged from local + remote for current frame
  private netplayCatchUp: boolean = false;  // True when client is behind and should disable frame limiter
  private netplayStateScratch: Buffer | null = null;  // Reused serialize buffer (FrameBuffer copies it per frame)
  private netplayLocalAnalog = { lx: 0, ly: 0, rx: 0, ry: 0 };  // Last local stick axes (core units) for netplay capture
  private contentCrc: number = 0;  // CRC32 of ROM content for netplay validation
  private netplayDisconnected: boolean = false;  // Track if netplay disconnect caused stop
  private netplayDisconnectReason: string = '';  // Reason for disconnect
  private netplayHost: string = '';  // Host we connected/attempted to connect to
  private netplayPort: number = 0;  // Port we connected/attempted to connect to
  private intentionalDisconnect: boolean = false;  // Track if user explicitly chose to disconnect
  private pauseMenuPending: boolean = false;  // Track if pause menu is currently showing

  constructor(options: EmulatorOptions) {
    // Store paths and config
    this.romPath = options.romPath;
    this.config = options.config ?? null;
    this.settingsManager = options.settingsManager ?? null;

    // Initialize core subsystems
    this.initializeCore(options);
    this.initializeEffects(options);
    this.initializeInput(options);
    this.initializeRenderer(options);

    // Set up settings change listeners if manager is provided
    if (this.settingsManager) {
      this.initializeSettingsListeners();
    }
  }

  /**
   * Initialize settings change listeners.
   * These handlers apply setting changes during gameplay (e.g., stop/start audio).
   */
  private initializeSettingsListeners(): void {
    if (!this.settingsManager) {
      return;
    }

    // Audio mute changes
    this.settingsUnsubscribers.push(
      this.settingsManager.onChange('audioMuted', (muted) => {
        this.applyAudioMuteChange(muted);
      })
    );

    // Render mode changes
    this.settingsUnsubscribers.push(
      this.settingsManager.onChange('renderMode', (mode) => {
        if (mode) {
          this.applyRenderModeChange(mode);
        }
      })
    );

    // Post-processing mode changes
    this.settingsUnsubscribers.push(
      this.settingsManager.onChange('postProcessingMode', (mode) => {
        this.applyPostProcessingMode(mode);
        this.recreateRenderer();
      })
    );

    // Status bar visibility changes
    this.settingsUnsubscribers.push(
      this.settingsManager.onChange('showStatusBar', (show) => {
        this.showStatusBar = show;
      })
    );

    // Frame limit changes
    this.settingsUnsubscribers.push(
      this.settingsManager.onChange('frameLimit', (limit) => {
        this.frameLimit = limit;
        this.renderInterval = limit > 0 ? MS_PER_SECOND / limit : 0;
      })
    );
  }

  /**
   * Apply audio mute state change.
   */
  private applyAudioMuteChange(muted: boolean): void {
    this.audioEnabled = !muted;

    // Notify core of audio enable state (for libretro GET_AUDIO_VIDEO_ENABLE)
    this.core.setAudioEnabled?.(this.audioEnabled);

    if (muted) {
      // Mute: disconnect callback so core stops generating audio samples
      this.core.setAudioCallback(null);

      // Stop the audio stream
      if (this.rtAudio) {
        try {
          if (this.rtAudio.isStreamRunning()) {
            this.rtAudio.stop();
          }
        } catch {
          // Ignore errors
        }
      }
    } else {
      // Unmute: reconnect callback so core resumes generating audio
      if (this.audioCallback) {
        this.core.setAudioCallback(this.audioCallback);
      }

      // Restart the audio stream
      if (this.rtAudio) {
        try {
          if (!this.rtAudio.isStreamRunning()) {
            this.rtAudio.start();
          }
        } catch {
          // Ignore errors
        }
      }
    }
  }

  /**
   * Apply render mode change.
   */
  private applyRenderModeChange(mode: RenderMode): void {
    // Destroy old renderer first (cleanup native window, etc.)
    this.renderer.destroy?.();

    // Create new renderer for the mode
    this.renderer = this.createRendererForMode(mode);
    this.autoResize = true;
    this.renderMode = mode;

    // Clear screen for new renderer
    process.stdout.write(this.renderer.clearScreen());
  }

  /**
   * Initialize the emulation core, load ROM, and run bootstrap frames.
   */
  private initializeCore(options: EmulatorOptions): void {
    // Get system info from factory to determine core type before creating
    const factoryInfo = options.coreFactory.getSystemInfo();

    // Get default core options for this core (e.g., software rendering for N64)
    const coreOptions = factoryInfo.coreName
      ? getDefaultCoreOptions(factoryInfo.coreName)
      : undefined;

    if (coreOptions) {
      logger.info(`Applying default options for ${factoryInfo.coreName}: ${JSON.stringify(coreOptions)}`, 'Core');
    }

    // Create core and load ROM
    this.core = options.coreFactory.create({ coreOptions });
    this.systemInfo = this.core.getSystemInfo();

    this.core.loadRom(options.romPath);

    // Compute content CRC for netplay validation
    try {
      const romData = readFileSync(options.romPath);
      this.contentCrc = crc32(romData);
    } catch {
      // If we can't read the ROM, use 0 (netplay will still work but won't validate)
      this.contentCrc = 0;
    }

    // Store netplay options for deferred initialization (after run() starts)
    // netplayConnect can be empty string for LAN discovery, so check !== undefined
    if (options.netplayHost || options.netplayConnect !== undefined) {
      this.netplayOptions = options;
    }

    // For libretro cores, run bootstrap frames to get accurate dimensions
    // (actual frame dimensions from video callback may differ from AV info)
    const preBootstrapInfo = this.core.getSystemInfo();
    if (preBootstrapInfo.colorSpace === 'rgb24') {
      // Run multiple bootstrap frames - some cores need a few frames to stabilize
      for (let i = 0; i < LIBRETRO_BOOTSTRAP_FRAMES; i++) {
        this.core.runFrame();
      }
      // Enable auto-crop bounds detection for configured cores (e.g., N64)
      if (this.shouldEnableAutoCrop(preBootstrapInfo.id)) {
        this.needsContentBoundsDetection = true;
      }
    }

    // Re-fetch systemInfo after loading ROM (libretro cores update dimensions after game load)
    this.systemInfo = this.core.getSystemInfo();

    // Log frame dimensions and check for changes after bootstrap
    const dimsChanged = this.systemInfo.width !== preBootstrapInfo.width ||
                        this.systemInfo.height !== preBootstrapInfo.height;
    if (dimsChanged) {
      logger.info(
        `Frame size: ${preBootstrapInfo.width}x${preBootstrapInfo.height} -> ` +
        `${this.systemInfo.width}x${this.systemInfo.height}, ` +
        `PAR: ${this.systemInfo.pixelAspectRatio.toFixed(ASPECT_RATIO_DECIMALS)}`,
        'Core'
      );
    } else {
      logger.info(
        `Frame size: ${this.systemInfo.width}x${this.systemInfo.height}, ` +
        `PAR: ${this.systemInfo.pixelAspectRatio.toFixed(ASPECT_RATIO_DECIMALS)}`,
        'Core'
      );
    }

    // Load battery save (.srm) if available
    if (options.enableBatterySave !== false) {
      this.loadBatterySave();
    }

    // Set target frame time based on FPS limit or core's native FPS
    if (options.fpsLimit === 0) {
      this.targetFrameTime = 0; // Uncapped
    } else if (options.fpsLimit !== undefined) {
      this.targetFrameTime = MS_PER_SECOND / options.fpsLimit;
    } else {
      this.targetFrameTime = MS_PER_SECOND / this.systemInfo.fps;
    }
  }

  /**
   * Initialize effect values and post-processing mode.
   */
  private initializeEffects(options: EmulatorOptions): void {
    // Store basic options - prefer SettingsManager if available
    if (this.settingsManager) {
      this.audioEnabled = !this.settingsManager.get('audioMuted');
      this.showStatusBar = this.settingsManager.get('showStatusBar');
    } else {
      this.audioEnabled = options.enableAudio !== false && !options.startMuted;
      this.showStatusBar = options.showStatusBar !== false;
    }
    this.saveStateEnabled = options.enableSaveState !== false;
    this.batterySaveEnabled = options.enableBatterySave !== false;
    this.diffRenderingEnabled = options.enableDiffRendering !== false;
    this.noRender = options.noRender ?? false;
    this.frameLimit = options.frameLimit ?? 0;
    this.renderInterval = this.frameLimit > 0 ? MS_PER_SECOND / this.frameLimit : 0;
    this.colorEnabled = options.colorEnabled ?? true;

    // Initialize effect values from options
    this.gamma = options.gamma ?? DEFAULT_GAMMA;
    this.scanlines = options.scanlines ?? DEFAULT_SCANLINES;
    this.saturation = options.saturation ?? DEFAULT_SATURATION;
    this.brightness = options.brightness ?? DEFAULT_BRIGHTNESS;
    this.contrast = options.contrast ?? DEFAULT_CONTRAST;
    this.vignette = options.vignette ?? DEFAULT_VIGNETTE;
    this.bloom = options.bloom ?? DEFAULT_BLOOM;
    this.bloomThreshold = options.bloomThreshold ?? DEFAULT_BLOOM_THRESHOLD;
    this.ntsc = options.ntsc ?? DEFAULT_NTSC;
    this.curvature = options.curvature ?? DEFAULT_CURVATURE;
    this.chromaticAberration = options.chromaticAberration ?? DEFAULT_CHROMATIC_ABERRATION;

    // Store custom effect values from config (so they persist when switching modes)
    if (this.config) {
      this.customEffectValues = {
        gamma: this.config.video_gamma,
        scanlines: this.config.video_scanlines,
        saturation: this.config.video_saturation,
        brightness: this.config.video_brightness,
        contrast: this.config.video_contrast,
        vignette: this.config.video_vignette,
        bloom: this.config.video_bloom,
        bloomThreshold: this.config.video_bloom_threshold,
        ntsc: this.config.video_ntsc,
        curvature: this.config.video_curvature,
        chromaticAberration: this.config.video_chromatic_aberration,
      };
    }

    // Check if user has non-default custom effect values
    this.hasCustomEffects = this.customEffectValues !== null && (
      this.customEffectValues.gamma !== 1.0 ||
      this.customEffectValues.scanlines !== 0 ||
      this.customEffectValues.saturation !== 1.0 ||
      this.customEffectValues.brightness !== 1.0 ||
      this.customEffectValues.contrast !== 1.0 ||
      this.customEffectValues.vignette !== 0 ||
      this.customEffectValues.bloom !== 0 ||
      this.customEffectValues.ntsc !== 0 ||
      this.customEffectValues.curvature !== 0 ||
      this.customEffectValues.chromaticAberration !== 0
    );

    // Determine initial post-processing mode from config
    const configMode = this.config?.video_postprocessing_mode ?? 'off';
    this.postProcessingMode = configMode;

    // If mode is off, reset all effects to defaults
    if (configMode === 'off') {
      this.gamma = 1.0;
      this.scanlines = 0;
      this.saturation = 1.0;
      this.brightness = 1.0;
      this.contrast = 1.0;
      this.vignette = 0;
      this.bloom = 0;
      this.bloomThreshold = 0.6;
      this.ntsc = 0;
      this.curvature = 0;
      this.chromaticAberration = 0;
    }
  }

  /**
   * Initialize input handling: controllers, input manager, input mapper, and gamepad.
   */
  private initializeInput(options: EmulatorOptions): void {
    // Initialize controllers
    this.controller1 = new Controller();
    this.controller2 = new Controller();

    // Initialize input manager
    this.inputManager = new InputManager(this.controller1, this.controller2);

    // Log input driver (RetroArch-style)
    const inputMode = this.inputManager.isKittyMode() ? 'kitty' : 'legacy';
    logger.info(`Found input driver: "${inputMode}"`, 'Input');

    // Initialize input mapper for gamepad -> core button translation
    this.inputMapper = new InputMapper(this.systemInfo.buttons, this.systemInfo.maxPlayers);
    this.inputMapper.onButtonChange = (port, button, pressed) => {
      this.core.setButtonState(port, button, pressed);
    };

    // Initialize gamepad manager if enabled
    if (options.enableGamepad !== false) {
      this.gamepadManager = new GamepadManager();
      this.gamepadManager.onButtonChange = (port, button, pressed) => {
        // Guide/Xbox/PS button acts as Escape to exit emulator
        if (button === StandardButton.Guide && pressed) {
          this.stop();
          return;
        }
        this.inputMapper.handleGamepadButton(button, pressed, port);
      };

      // Connect analog stick input for cores that support it (e.g., libretro)
      this.gamepadManager.onAnalogChange = (port, index, axis, value) => {
        // Forward analog input to InputMapper
        this.inputMapper.handleAnalogAxis(index, axis, value, port);
      };
    }

    // Connect analog callback from InputMapper to core (only if core supports it)
    this.inputMapper.onAnalogChange = (port, index, axis, value) => {
      // Record local stick state for netplay capture (port 0 = local player)
      if (port === 0) {
        if (index === 0) {
          if (axis === 0) { this.netplayLocalAnalog.lx = value; } else { this.netplayLocalAnalog.ly = value; }
        } else if (index === 1) {
          if (axis === 0) { this.netplayLocalAnalog.rx = value; } else { this.netplayLocalAnalog.ry = value; }
        }
      }
      // During netplay the core only receives merged input via
      // syncInputToCore — writing directly here would bypass the rollback
      // input system and desync the peers
      if (this.core.setAnalogState && !this.isNetplayActive()) {
        this.core.setAnalogState(port, index, axis, value);
      }
    };
  }

  /**
   * Initialize renderer based on render mode and options.
   */
  private initializeRenderer(options: EmulatorOptions): void {
    // Get system name for system-specific defaults
    const systemName = getSystemName(this.systemInfo.extensions[0] ?? '');

    // Prefer SettingsManager for renderMode if available, then options, then system-specific default
    this.renderMode = this.settingsManager?.get('renderMode')
      ?? options.renderMode
      ?? getDefaultRenderModeForSystem(systemName);

    // Log video driver selection (RetroArch-style)
    logger.info(`Found video driver: "${this.renderMode}"`, 'Video');

    if (this.renderMode === 'native') {
      // Native window rendering - bypasses terminal I/O for best performance
      // Use explicit scale if provided, otherwise use system-specific default (same as Kitty)
      this.nativeScale = options.scale ?? getDefaultScaleForSystem(systemName);
      this.renderer = new NativeRenderer({
        scale: this.nativeScale,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
        pixelAspectRatio: this.systemInfo.pixelAspectRatio,
        colorEnabled: this.colorEnabled,
        title: `emoemu - ${getRomTitle(this.romPath) ?? basename(this.romPath, extname(this.romPath))}`,
        gamma: this.gamma,
        scanlines: this.scanlines,
        saturation: this.saturation,
        brightness: this.brightness,
        contrast: this.contrast,
        vignette: this.vignette,
        bloom: this.bloom,
        bloomThreshold: this.bloomThreshold,
        ntsc: this.ntsc,
        curvature: this.curvature,
        chromaticAberration: this.chromaticAberration,
      });
      this.autoResize = false;  // Native window handles its own resizing
      const windowWidth = Math.round(this.systemInfo.width * this.nativeScale * this.systemInfo.pixelAspectRatio);
      const windowHeight = this.systemInfo.height * this.nativeScale;
      logger.info(`Set video size to: ${windowWidth}x${windowHeight} (native window, scale: ${this.nativeScale}x)`, 'Video');

      // Connect native keyboard input to input mapper
      (this.renderer as NativeRenderer).onKeyboard = (key, pressed) => {
        this.inputMapper.handleKey(key, pressed, 0);
      };
    } else if (this.renderMode === 'kitty') {
      // Use explicit scale if provided, otherwise use system-specific default
      this.kittyScale = options.scale ?? getDefaultScaleForSystem(systemName);
      this.renderer = new KittyRenderer({
        scale: this.kittyScale,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
        colorSpace: this.systemInfo.colorSpace,
        pixelAspectRatio: this.systemInfo.pixelAspectRatio,
        enableDiffRendering: this.diffRenderingEnabled,
        colorEnabled: this.colorEnabled,
        pngCompressionLevel: options.pngCompressionLevel,
        gamma: this.gamma,
        scanlines: this.scanlines,
        saturation: this.saturation,
        brightness: this.brightness,
        contrast: this.contrast,
        vignette: this.vignette,
        bloom: this.bloom,
        bloomThreshold: this.bloomThreshold,
        ntsc: this.ntsc,
        curvature: this.curvature,
        chromaticAberration: this.chromaticAberration,
      });
      this.autoResize = options.scale === undefined;
      const scaledWidth = Math.round(this.systemInfo.width * this.kittyScale);
      const scaledHeight = Math.round(this.systemInfo.height * this.kittyScale);
      logger.info(`Set video size to: ${scaledWidth}x${scaledHeight} (scale: ${this.kittyScale}x)`, 'Video');
    } else {
      // Terminal-based renderers (terminal, ascii, emoji)
      const explicitDims = options.width && options.height;
      const terminalMode = this.renderMode === 'emoji' ? 'emoji' : this.renderMode === 'ascii' ? 'ascii' : 'terminal';
      const dims = explicitDims
        ? { width: options.width!, height: options.height! }
        : calculateTerminalDimensions(terminalMode, this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);

      this.autoResize = !explicitDims;
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        colorEnabled: this.colorEnabled,
        emojiMode: this.renderMode === 'emoji',
        asciiMode: this.renderMode === 'ascii',
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
        enableDiffRendering: this.diffRenderingEnabled,
        gamma: this.gamma,
        scanlines: this.scanlines,
        saturation: this.saturation,
        brightness: this.brightness,
        contrast: this.contrast,
        vignette: this.vignette,
      });
      logger.info(`Set video size to: ${dims.width}x${dims.height} (terminal chars)`, 'Video');
    }

    this.attachRendererSink();
  }

  // Deliver asynchronously encoded frames (worker offload) straight to stdout.
  // Routed through the output gate so frames drop instead of queueing when
  // the terminal can't keep up.
  private attachRendererSink(): void {
    this.renderer.setOutputSink?.((chunk) => {
      this.outputGate.write(chunk);
    });
  }

  reset(): void {
    // During netplay, resets are server-frame-synchronized events: the
    // host broadcasts RESET at the next frame boundary and resets its own
    // core via the server's 'reset' event; clients may not reset at all
    if (this.netplayServer) {
      this.netplayServer.requestReset();
      return;
    }
    if (this.netplayClient) {
      netplayLogger.warn('CLIENT', 'Core reset ignored — only the host may reset during netplay');
      return;
    }
    this.core.reset();
    this.frameCount = 0;
  }

  // Run one complete frame
  // Returns true if frame was executed, false if stalling for netplay
  runFrame(): boolean {
    // Netplay pre-frame: gather local input and get merged input
    if (this.isNetplayActive()) {
      const localInput = this.gatherLocalInput();

      // Call netplay preFrame with local input
      let preFrameResult: { input: number[]; shouldStall: boolean; shouldCatchUp: boolean } | null = null;
      if (this.netplayServer) {
        preFrameResult = this.netplayServer.preFrame(localInput);
      } else if (this.netplayClient) {
        preFrameResult = this.netplayClient.preFrame(localInput);
      }

      // Handle stalling (too far ahead of remote)
      if (preFrameResult === null || preFrameResult.shouldStall) {
        this.netplayCatchUp = false;
        return false;  // Skip this frame, wait for remote
      }

      // Store merged input for syncInputToCore
      this.netplayMergedInput = preFrameResult.input;

      // Track catch-up mode (client behind, should disable frame limiter)
      this.netplayCatchUp = preFrameResult.shouldCatchUp;
    } else {
      this.netplayCatchUp = false;
    }

    // Sync input state from controllers to core
    this.syncInputToCore();

    // Run the core for one frame
    this.core.runFrame();

    // Netplay post-frame: capture state for rollback
    if (this.isNetplayActive()) {
      // Serialize into a reused scratch buffer — safe because postFrame's
      // consumers (FrameBuffer.setState, savestate broadcast) copy the
      // bytes before returning
      const serializedState = this.core.getStateInto
        ? this.core.getStateInto(this.netplayStateScratch)
        : this.core.getState();
      if (serializedState && Buffer.isBuffer(serializedState)) {
        this.netplayStateScratch = serializedState;
        // Desync CRCs hash system RAM when available (stable across
        // savestate loads); postFrame copies it before the core runs again
        const crcBasis = this.core.getSystemRam?.() ?? undefined;
        if (this.netplayServer) {
          this.netplayServer.postFrame(serializedState, crcBasis);
        } else if (this.netplayClient) {
          this.netplayClient.postFrame(serializedState, crcBasis);
        }
      }
      this.netplayMergedInput = null;  // Clear for next frame
    }

    this.frameCount++;
    return true;
  }

  /**
   * Gather local input from keyboard and gamepad into an array.
   * Format: [joypad_state, analog_left, analog_right]
   */
  private gatherLocalInput(): number[] {
    let joypadState = 0;

    // Get gamepad state from InputMapper (already translated to core button IDs)
    const gamepadState = this.inputMapper.getButtonState(0);

    // Map controller buttons to joypad bitmask
    const buttons = this.systemInfo.buttons;
    for (const buttonDef of buttons) {
      // Check keyboard input via controller
      let keyboardPressed = false;
      switch (buttonDef.name.toLowerCase()) {
        case 'a': keyboardPressed = this.controller1.getButton(Button.A); break;
        case 'b': keyboardPressed = this.controller1.getButton(Button.B); break;
        case 'x': keyboardPressed = this.controller1.getButton(Button.X); break;
        case 'y': keyboardPressed = this.controller1.getButton(Button.Y); break;
        case 'l': keyboardPressed = this.controller1.getButton(Button.L); break;
        case 'r': keyboardPressed = this.controller1.getButton(Button.R); break;
        case 'start': keyboardPressed = this.controller1.getButton(Button.Start); break;
        case 'select': keyboardPressed = this.controller1.getButton(Button.Select); break;
        case 'up': keyboardPressed = this.controller1.getButton(Button.Up); break;
        case 'down': keyboardPressed = this.controller1.getButton(Button.Down); break;
        case 'left': keyboardPressed = this.controller1.getButton(Button.Left); break;
        case 'right': keyboardPressed = this.controller1.getButton(Button.Right); break;
      }

      // Check gamepad input via InputMapper
      const gamepadPressed = gamepadState.get(buttonDef.id) ?? false;

      // Button is pressed if either keyboard OR gamepad has it pressed
      if (keyboardPressed || gamepadPressed) {
        joypadState |= (1 << buttonDef.id);
      }
    }

    // Pack analog sticks (keyboard arrows act as the left stick when held,
    // matching local-play behavior where the keyboard writes last)
    let { lx, ly } = this.netplayLocalAnalog;
    const { rx, ry } = this.netplayLocalAnalog;
    const keyUp = this.controller1.getButton(Button.Up);
    const keyDown = this.controller1.getButton(Button.Down);
    const keyLeft = this.controller1.getButton(Button.Left);
    const keyRight = this.controller1.getButton(Button.Right);
    if (keyUp || keyDown || keyLeft || keyRight) {
      lx = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
      ly = (keyDown ? 1 : 0) - (keyUp ? 1 : 0);
    }

    return [joypadState, packAnalogStick(lx, ly), packAnalogStick(rx, ry)];
  }

  // Sync controller state to core's input system
  // Combines keyboard input (via controller) with gamepad input (via inputMapper)
  // When netplay is active, uses the merged input from netplay instead
  private syncInputToCore(): void {
    const buttons = this.systemInfo.buttons;

    // If netplay is active and we have merged input, use that instead
    if (this.netplayMergedInput !== null) {
      // Merged input has 3 values per device: [joypad, analog_left, analog_right]
      // Device 0 (Player 1) = indices 0,1,2
      // Device 1 (Player 2) = indices 3,4,5
      // etc.
      const INPUTS_PER_DEVICE = 3;
      const maxPorts = this.systemInfo.maxPlayers;

      for (let port = 0; port < maxPorts; port++) {
        const baseIndex = port * INPUTS_PER_DEVICE;
        const joypadState = this.netplayMergedInput[baseIndex] ?? 0;

        for (const buttonDef of buttons) {
          const pressed = (joypadState & (1 << buttonDef.id)) !== 0;
          this.core.setButtonState(port, buttonDef.id, pressed);
        }

        // Apply merged analog sticks (one packed word per stick); always
        // applied so releasing a stick re-centers it on every peer
        if (this.core.setAnalogState) {
          const leftWord = this.netplayMergedInput[baseIndex + 1] ?? 0;
          const rightWord = this.netplayMergedInput[baseIndex + 2] ?? 0;
          this.core.setAnalogState(port, 0, 0, unpackAnalogX(leftWord));
          this.core.setAnalogState(port, 0, 1, unpackAnalogY(leftWord));
          this.core.setAnalogState(port, 1, 0, unpackAnalogX(rightWord));
          this.core.setAnalogState(port, 1, 1, unpackAnalogY(rightWord));
        }
      }
      return;
    }

    // Normal mode: combine keyboard and gamepad input
    // Get gamepad state from InputMapper (already translated to core button IDs)
    const gamepadState = this.inputMapper.getButtonState(0);

    // Map controller buttons to core buttons
    for (const buttonDef of buttons) {
      // Check keyboard input via controller
      let keyboardPressed = false;

      // Map common button names to keyboard controller
      switch (buttonDef.name.toLowerCase()) {
        case 'a':
          keyboardPressed = this.controller1.getButton(Button.A);
          break;
        case 'b':
          keyboardPressed = this.controller1.getButton(Button.B);
          break;
        case 'x':
          keyboardPressed = this.controller1.getButton(Button.X);
          break;
        case 'y':
          keyboardPressed = this.controller1.getButton(Button.Y);
          break;
        case 'l':
          keyboardPressed = this.controller1.getButton(Button.L);
          break;
        case 'r':
          keyboardPressed = this.controller1.getButton(Button.R);
          break;
        case 'start':
          keyboardPressed = this.controller1.getButton(Button.Start);
          break;
        case 'select':
          keyboardPressed = this.controller1.getButton(Button.Select);
          break;
        case 'up':
          keyboardPressed = this.controller1.getButton(Button.Up);
          break;
        case 'down':
          keyboardPressed = this.controller1.getButton(Button.Down);
          break;
        case 'left':
          keyboardPressed = this.controller1.getButton(Button.Left);
          break;
        case 'right':
          keyboardPressed = this.controller1.getButton(Button.Right);
          break;
      }

      // Check gamepad input via InputMapper (already mapped to core button IDs)
      const gamepadPressed = gamepadState.get(buttonDef.id) ?? false;

      // Button is pressed if either keyboard OR gamepad has it pressed
      const pressed = keyboardPressed || gamepadPressed;

      this.core.setButtonState(0, buttonDef.id, pressed);
    }

    // Also send keyboard arrow keys as analog input for cores that support it (e.g., N64)
    if (this.core.setAnalogState) {
      const keyUp = this.controller1.getButton(Button.Up);
      const keyDown = this.controller1.getButton(Button.Down);
      const keyLeft = this.controller1.getButton(Button.Left);
      const keyRight = this.controller1.getButton(Button.Right);

      // Calculate analog values from keyboard (-1.0 to 1.0)
      const hasKeyboardDirection = keyUp || keyDown || keyLeft || keyRight;

      // Send keyboard analog if keys are pressed, OR if releasing (was active, now not)
      // This ensures the analog stick returns to center when keys are released
      if (hasKeyboardDirection || this.keyboardAnalogActive) {
        const analogX = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
        const analogY = (keyDown ? 1 : 0) - (keyUp ? 1 : 0);

        // Send analog values for left stick (index=0)
        // Axis 0 = X, Axis 1 = Y
        this.core.setAnalogState(0, 0, 0, analogX);  // port=0, index=0 (left stick), axis=0 (X)
        this.core.setAnalogState(0, 0, 1, analogY);  // port=0, index=0 (left stick), axis=1 (Y)

        // Track whether keyboard is actively controlling analog
        this.keyboardAnalogActive = hasKeyboardDirection;
      }
    }
  }

  // Render the current frame if the frame limit allows and stdout has drained.
  // While the terminal is backed up (slow terminal, SSH, pipe), frames are
  // dropped — emulation keeps running and rendering resumes on drain. Skipping
  // renderFrame() entirely keeps diff renderers' baseline at the last frame
  // actually written.
  private maybeRenderFrame(now: number): void {
    if (this.renderInterval !== 0 && now - this.lastRenderTime < this.renderInterval) {
      return;
    }
    if (!this.noRender) {
      if (!this.outputGate.isWritable()) {
        return;
      }
      this.outputGate.write(this.renderFrame());
      this.renderFpsFrameCount++;
    }
    this.lastRenderTime = now;
  }

  // Render current frame to terminal
  renderFrame(): string {
    let framebuffer = this.core.getFramebuffer();

    // Content bounds detection for libretro cores (N64 auto-crop)
    // - Initial detection: wait for first contentful frame
    // - Periodic re-detection: bounds can only expand as more of the game loads
    if (framebuffer.length > 0) {
      if ('detectContentBounds' in this.core && typeof this.core.detectContentBounds === 'function') {
        const coreWithCrop = this.core as { detectContentBounds: () => { hasContent: boolean; boundsChanged: boolean } };
        const shouldCheck = this.needsContentBoundsDetection || this.shouldPeriodicBoundsCheck();

        if (shouldCheck) {
          const result = coreWithCrop.detectContentBounds();

          if (result.hasContent) {
            // Frame had content - initial detection is complete
            if (this.needsContentBoundsDetection) {
              this.needsContentBoundsDetection = false;
              this.lastBoundsCheckFrame = this.frameCount;
              this.boundsCheckCount = 1;
            } else {
              // Periodic check
              this.lastBoundsCheckFrame = this.frameCount;
              this.boundsCheckCount++;
            }

            // If bounds changed, recreate renderer with new dimensions
            if (result.boundsChanged) {
              const newInfo = this.core.getSystemInfo();
              logger.info(
                `Content bounds updated: ${this.systemInfo.width}x${this.systemInfo.height} -> ${newInfo.width}x${newInfo.height}`,
                'Core'
              );
              this.systemInfo = newInfo;
              this.recreateRenderer();
              process.stdout.write(this.renderer.clearScreen());
              // Re-fetch framebuffer with new bounds - the cached version from
              // detectContentBounds() will be used and cropped to new dimensions
              framebuffer = this.core.getFramebuffer();
            }
          }
          // If !hasContent during initial detection, keep trying (needsContentBoundsDetection stays true)
        }
      } else if (this.needsContentBoundsDetection) {
        // Core doesn't support bounds detection
        this.needsContentBoundsDetection = false;
      }
    }

    // Debug: Log framebuffer info on first frame
    if (this.frameCount === 0 && isRgb24Buffer(this.systemInfo.colorSpace, framebuffer)) {
      const fb = framebuffer;
      const w = this.systemInfo.width;
      const h = this.systemInfo.height;
      const bpp = 3;
      // Sample top-left, center, and bottom-center pixels (offset from edge to avoid overscan)
      const BOTTOM_SAMPLE_OFFSET = 10;
      const topIdx = 0;
      const centerIdx = (Math.floor(h / 2) * w + Math.floor(w / 2)) * bpp;
      const bottomIdx = ((h - BOTTOM_SAMPLE_OFFSET) * w + Math.floor(w / 2)) * bpp;
      logger.debug(
        `Framebuffer ${w}x${h}: top=(${fb[topIdx]},${fb[topIdx+1]},${fb[topIdx+2]}) ` +
        `center=(${fb[centerIdx]},${fb[centerIdx+1]},${fb[centerIdx+2]}) ` +
        `bottom=(${fb[bottomIdx]},${fb[bottomIdx+1]},${fb[bottomIdx+2]})`,
        'Render'
      );
    }

    // Convert framebuffer based on color space
    if (isRgb24Buffer(this.systemInfo.colorSpace, framebuffer)) {
      return this.renderer.renderRgb24(framebuffer);
    } else {
      return this.renderer.renderRgb15(framebuffer);
    }
  }

  // Main emulation loop
  async run(skipReset: boolean = false): Promise<void> {
    this.running = true;
    if (!skipReset) {
      this.reset();
    }

    // Setup terminal
    process.stdout.write(this.renderer.hideCursor());
    process.stdout.write(this.renderer.clearScreen());

    // Setup audio output (always initialize infrastructure, even if muted)
    // This ensures rtAudio and audioCallback exist for later unmuting
    this.setupAudio();

    // Notify core of initial audio enable state (for libretro GET_AUDIO_VIDEO_ENABLE)
    this.core.setAudioEnabled?.(this.audioEnabled);

    // If starting muted, disconnect audio callback and stop stream
    if (!this.audioEnabled && this.rtAudio) {
      this.core.setAudioCallback(null);
      try {
        if (this.rtAudio.isStreamRunning()) {
          this.rtAudio.stop();
        }
      } catch {
        // Ignore errors
      }
    }

    // Set up message callback for core notifications (e.g., "State saved", "Disk inserted")
    this.core.setMessageCallback?.(this.handleCoreMessage.bind(this));

    // Setup stdin first (needed for Kitty detection)
    this.setupStdin();

    // Detect Kitty protocol and start keyboard listener
    await this.inputManager.start();

    // Now attach the main input handler
    this.setupInputHandler();

    // Start gamepad manager if available
    if (this.gamepadManager) {
      this.gamepadManager.start();
    }

    // Initialize netplay if options were specified
    await this.initializeNetplay();

    // Subscribe to app-wide notifications for status bar display
    this.notificationHandler = this.handleAppNotification.bind(this);
    subscribeToNotifications(this.notificationHandler);

    // Set up terminal resize handler
    if (this.autoResize) {
      this.resizeHandler = () => {
        if (this.renderMode === 'kitty') {
          // Kitty renderer recalculates display size internally
          (this.renderer as KittyRenderer).setDimensions();
        } else {
          const mode = this.renderMode === 'emoji' ? 'emoji' : this.renderMode === 'ascii' ? 'ascii' : 'terminal';
          const dims = calculateTerminalDimensions(mode, this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);
          (this.renderer as TerminalRenderer).setDimensions(dims.width, dims.height);
        }
        process.stdout.write(this.renderer.clearScreen());
      };
      process.stdout.on('resize', this.resizeHandler);
    }

    // Set up auto-save for battery-backed games
    // Saves to .srm file periodically in case of crash
    if (this.core.hasBatterySave() && this.batterySaveEnabled) {
      this.autoSaveInterval = setInterval(() => {
        this.saveBatterySave();
      }, AUTO_SAVE_INTERVAL_MS);
    }

    this.lastFrameTime = performance.now();
    this.fpsWindowStart = this.lastFrameTime;
    this.fpsFrameCount = 0;
    this.renderFpsFrameCount = 0;

    // Return a promise that resolves when emulation stops
    return new Promise<void>((resolve) => {
      const loop = (): void => {
        // Check for quit from global keyboard listener
        if (this.inputManager.shouldQuit()) {
          // If netplay is active, show pause menu instead of immediately quitting
          if (this.isNetplayActive() && !this.pauseMenuPending) {
            this.inputManager.clearQuitRequest();
            this.showPauseMenu();
          } else if (!this.pauseMenuPending) {
            this.stop();
          }
        }

        // Check for native window close
        if (this.renderer.shouldClose?.()) {
          this.stop();
        }

        if (!this.running) {
          void this.cleanup().then(resolve);
          return;
        }

        // Skip frame processing while pause menu is showing
        // Poll on a timer instead of spinning: emulation is idle anyway
        if (this.pauseMenuPending) {
          setTimeout(loop, PAUSE_MENU_POLL_MS);
          return;
        }

        const now = performance.now();

        // Handle uncapped mode (targetFrameTime = 0) separately
        if (this.targetFrameTime === 0) {
          this.inputManager.update();
          const frameRan = this.runFrame();
          if (frameRan) {
            this.maybeRenderFrame(now);
            this.fpsFrameCount++;
          }
        } else {
          // Calculate how many frames we should have run by now
          const framesBehind = Math.floor((now - this.lastFrameTime) / this.targetFrameTime);

          // Run frames if behind schedule OR if netplay catch-up mode is active
          // Catch-up mode disables frame limiter when client is behind remote
          if (framesBehind >= 1 || this.netplayCatchUp) {
            // Update input state once per iteration
            this.inputManager.update();

            // Determine how many frames to run
            let framesToRun = Math.max(1, framesBehind);

            // If too far behind OR in netplay catch-up, run multiple frames
            // But cap to prevent runaway behavior (e.g., after GC pause)
            if (framesBehind > MAX_FRAME_SKIP) {
              this.lastFrameTime = now - this.targetFrameTime;
              framesToRun = 1;
            } else if (this.netplayCatchUp && framesBehind < 1) {
              // In catch-up mode but frame timer hasn't triggered yet
              // Run one frame immediately to catch up faster
              framesToRun = 1;
            }

            // Run skipped frames without rendering to catch up
            // In netplay, we may stall - count only frames that actually ran
            let framesActuallyRan = 0;
            for (let i = 1; i < framesToRun; i++) {
              if (this.runFrame()) {
                framesActuallyRan++;
              }
            }

            // Run final frame and render (subject to frame limit)
            const finalFrameRan = this.runFrame();
            if (finalFrameRan) {
              this.maybeRenderFrame(now);
              framesActuallyRan++;
            }

            // Track FPS - count only frames that actually ran
            this.fpsFrameCount += framesActuallyRan;

            // Advance lastFrameTime by frames we attempted (prevents drift)
            // In catch-up mode with framesBehind < 1, advance by actual frames run
            if (framesBehind >= 1) {
              this.lastFrameTime += framesToRun * this.targetFrameTime;
            } else if (framesActuallyRan > 0) {
              // Catch-up mode: advance timing to current time to prevent accumulation
              this.lastFrameTime = now;
            }
          }
        }

        // Track FPS with rolling 1-second window
        const fpsElapsed = now - this.fpsWindowStart;
        if (fpsElapsed >= MS_PER_SECOND) {
          this.currentFps = (this.fpsFrameCount * MS_PER_SECOND) / fpsElapsed;
          this.currentRenderFps = (this.renderFpsFrameCount * MS_PER_SECOND) / fpsElapsed;
          this.fpsFrameCount = 0;
          this.renderFpsFrameCount = 0;
          this.fpsWindowStart = now;
        }

        // Display status bar if enabled (throttled to reduce string building overhead)
        if (this.showStatusBar) {
          this.statusBarFrameCounter++;
          if (this.statusBarFrameCounter >= STATUS_BAR_UPDATE_INTERVAL) {
            this.statusBarFrameCounter = 0;
            const { height: terminalRows } = getTerminalDimensions();
            this.outputGate.write(`\x1b[${terminalRows};1H${this.buildStatusBar(this.currentFps)}`);
          }
        }

        // Schedule next iteration: sleep off most of the inter-frame gap,
        // then spin via setImmediate for the last couple of ms for precision.
        // Netplay catch-up runs a frame per iteration, so it never sleeps.
        const delay = this.netplayCatchUp
          ? null
          : nextLoopDelayMs(performance.now(), this.lastFrameTime, this.targetFrameTime);
        if (delay === null) {
          setImmediate(loop);
        } else {
          setTimeout(loop, delay);
        }
      };

      loop();
    });
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Get the estimated session runtime in seconds based on frame count.
   */
  getSessionSeconds(): number {
    return Math.floor(this.frameCount / this.systemInfo.fps);
  }

  /**
   * Check if netplay disconnect caused the emulator to stop.
   */
  wasNetplayDisconnected(): boolean {
    return this.netplayDisconnected;
  }

  /**
   * Get info about the netplay disconnect (reason, host, port).
   */
  getNetplayDisconnectInfo(): { reason: string; host: string; port: number } {
    return {
      reason: this.netplayDisconnectReason,
      host: this.netplayHost,
      port: this.netplayPort,
    };
  }

  /**
   * Check if user explicitly chose to disconnect (e.g., from pause menu).
   * When true, the disconnect dialog should be skipped.
   */
  wasIntentionalDisconnect(): boolean {
    return this.intentionalDisconnect;
  }

  private setupAudio(): void {
    const audioConfig = this.core.getAudioConfig();
    const channels = audioConfig.channels; // 1 = mono, 2 = stereo (interleaved L,R,L,R,...)

    // Track source sample rate for resampling
    const sourceSampleRate = audioConfig.sampleRate;
    let outputSampleRate = audioConfig.sampleRate;
    let resampleRatio = 1.0;

    // Try the core's native sample rate first, then fall back to common rates
    const ratesToTry = [audioConfig.sampleRate];
    if (audioConfig.sampleRate !== SAMPLE_RATE_44100) {ratesToTry.push(SAMPLE_RATE_44100);}
    if (audioConfig.sampleRate !== SAMPLE_RATE_48000) {ratesToTry.push(SAMPLE_RATE_48000);}

    let sampleRate = audioConfig.sampleRate;
    // Frame size for audio buffer (~10ms at sample rate for low latency)
    let frameSize = Math.floor(sampleRate * AUDIO_FRAME_DURATION_SEC);
    // Buffer size in bytes (16-bit stereo output = 4 bytes per sample frame)
    let frameBytes = frameSize * AUDIO_STEREO_CHANNELS * BYTES_PER_INT16_SAMPLE; // frameSize * 2 output channels * 2 bytes

    // Fixed-size ring buffer for sample accumulation (prevents unbounded growth)
    // Size: enough for ~100ms of audio (10 frames worth at 10ms each)
    // For stereo input, we need 2x the samples (L and R interleaved)
    let samplesPerFrame = frameSize * channels;
    let ringBufferSize = samplesPerFrame * AUDIO_RING_BUFFER_FRAMES;
    let ringBuffer = new Float32Array(ringBufferSize);
    let ringWritePos = 0;
    let ringReadPos = 0;
    let ringCount = 0; // Number of samples in buffer

    // Pre-allocated output buffer for RtAudio (exact frame size required)
    let outputBuffer = Buffer.alloc(frameBytes);

    // Flow control using frameOutputCallback
    let framesWritten = 0;
    let framesPlayed = 0;
    const maxQueuedFrames = MAX_AUDIO_QUEUED_FRAMES; // Maximum frames to buffer ahead

    // Helper to write a single frame to RtAudio from ring buffer
    const writeFrame = (): boolean => {
      if (!this.rtAudio || ringCount < samplesPerFrame) {return false;}

      // Flow control: don't queue too many frames ahead
      const queuedFrames = framesWritten - framesPlayed;
      if (queuedFrames >= maxQueuedFrames) {
        return false; // Wait for playback to catch up
      }

      // Convert float samples to int16 stereo in output buffer
      if (channels === 1) {
        // Mono input: duplicate each sample to both L and R channels
        for (let i = 0; i < frameSize; i++) {
          const sample = clamp(ringBuffer[ringReadPos], { min: -1, max: 1 });
          const int16 = (sample * INT16_MAX_VALUE) | 0;
          const offset = i * BYTES_PER_STEREO_SAMPLE; // 4 bytes per stereo output (2 channels * 2 bytes)
          outputBuffer.writeInt16LE(int16, offset);     // Left channel
          outputBuffer.writeInt16LE(int16, offset + BYTES_PER_INT16_SAMPLE); // Right channel
          ringReadPos = (ringReadPos + 1) % ringBufferSize;
        }
      } else {
        // Stereo input: samples are interleaved L,R,L,R,...
        for (let i = 0; i < frameSize; i++) {
          const sampleL = clamp(ringBuffer[ringReadPos], { min: -1, max: 1 });
          ringReadPos = (ringReadPos + 1) % ringBufferSize;
          const sampleR = clamp(ringBuffer[ringReadPos], { min: -1, max: 1 });
          ringReadPos = (ringReadPos + 1) % ringBufferSize;
          const int16L = (sampleL * INT16_MAX_VALUE) | 0;
          const int16R = (sampleR * INT16_MAX_VALUE) | 0;
          const offset = i * BYTES_PER_STEREO_SAMPLE; // 4 bytes per stereo output (2 channels * 2 bytes)
          outputBuffer.writeInt16LE(int16L, offset);     // Left channel
          outputBuffer.writeInt16LE(int16R, offset + BYTES_PER_INT16_SAMPLE); // Right channel
        }
      }
      ringCount -= samplesPerFrame;

      this.rtAudio.write(outputBuffer);
      framesWritten++;
      return true;
    };

    // Try to write all available frames to RtAudio's queue
    const tryWriteFrames = () => {
      while (ringCount >= samplesPerFrame && writeFrame()) {
        // Keep writing until buffer is drained or queue is full
      }
    };

    // Frame output callback - called when a frame finishes playing
    // Leverages RtAudio's queue by reactively writing when space becomes available
    const onFramePlayed = () => {
      framesPlayed++;
      // Opportunistically write more frames when playback creates room
      tryWriteFrames();
    };

    // Track if we're currently recovering to prevent recursive recovery
    let isRecovering = false;

    // Error callback for graceful error recovery
    const onAudioError = (type: number, msg: string) => {
      // Don't process errors if we're shutting down
      if (!this.running) {return;}

      // Log error for debugging (type codes from RtAudioErrorType enum)
      const errorTypes = ['WARNING', 'DEBUG_WARNING', 'UNSPECIFIED', 'NO_DEVICES_FOUND',
        'INVALID_DEVICE', 'MEMORY_ERROR', 'INVALID_PARAMETER', 'INVALID_USE',
        'DRIVER_ERROR', 'SYSTEM_ERROR', 'THREAD_ERROR'];
      const typeName = errorTypes[type] || `UNKNOWN(${type})`;
      logger.error(`Audio error [${typeName}]: ${msg}`, 'Audio');

      // Attempt recovery for recoverable errors (not during recovery or shutdown)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- running can change asynchronously
if (!isRecovering && this.running && type >= RTAUDIO_RECOVERABLE_ERROR_THRESHOLD) { // Errors more severe than warnings
        isRecovering = true;
        setTimeout(() => {
          // Double-check we're still running before recovery
          if (this.running) {
            try {
              createAudio(sampleRate);
            } catch {
              // If recreation fails, disable audio
              this.audioEnabled = false;
            }
          }
          isRecovering = false;
        }, AUDIO_RECOVERY_DELAY_MS);
      }
    };

    // Function to create/recreate RtAudio with a specific sample rate
    const createAudio = (rate: number) => {
      if (this.rtAudio) {
        try {
          this.rtAudio.closeStream();
        } catch {
          // Ignore cleanup errors
        }
        this.rtAudio = null;
      }

      // Update audio parameters for new sample rate
      sampleRate = rate;
      outputSampleRate = rate;
      resampleRatio = sourceSampleRate / outputSampleRate;
      frameSize = Math.floor(rate * AUDIO_FRAME_DURATION_SEC);
      frameBytes = frameSize * AUDIO_STEREO_CHANNELS * BYTES_PER_INT16_SAMPLE;
      samplesPerFrame = frameSize * channels;
      ringBufferSize = samplesPerFrame * AUDIO_RING_BUFFER_FRAMES;
      ringBuffer = new Float32Array(ringBufferSize);
      outputBuffer = Buffer.alloc(frameBytes);

      this.rtAudio = new RtAudio();

      // Open output-only stream (stereo for proper speaker output)
      this.rtAudio.openStream(
        {
          deviceId: this.rtAudio.getDefaultOutputDevice(),
          nChannels: 2, // Stereo output
          firstChannel: 0,
        },
        null, // No input
        RtAudioFormat.RTAUDIO_SINT16,
        sampleRate,
        frameSize,
        'emoemu',
        null, // No input callback
        onFramePlayed, // Frame output callback for flow control
        0 as unknown as undefined, // Default flags - runtime expects number, types expect undefined
        onAudioError // Error callback for graceful recovery
      );

      this.rtAudio.start();
      // Reset state on audio recreation
      ringWritePos = 0;
      ringReadPos = 0;
      ringCount = 0;
      framesWritten = 0;
      framesPlayed = 0;
    };

    // Try each sample rate until one works
    let audioInitialized = false;
    let lastError: unknown;
    for (const rate of ratesToTry) {
      try {
        createAudio(rate);
        audioInitialized = true;
        // Log successful audio init (RetroArch-style)
        logger.info(`Set audio input rate to: ${rate.toFixed(2)} Hz`, 'Audio');
        logger.debug(`Audio buffer: ${frameSize} frames (${(frameSize / rate * MS_PER_SECOND).toFixed(1)} ms latency)`, 'Audio');
        break;
      } catch (err) {
        lastError = err;
        logger.debug(`Failed to init audio at ${rate} Hz, trying next rate`, 'Audio');
        // Try next sample rate
      }
    }

    if (!audioInitialized) {
      logger.error(`Audio initialization failed for all sample rates. Continuing without audio. ${getErrorMessage(lastError)}`, 'Audio');
      this.audioEnabled = false;
      return;
    }

    // Helper to add a sample to ring buffer
    const addSampleToRingBuffer = (sample: number) => {
      if (ringCount >= ringBufferSize) {
        ringReadPos = (ringReadPos + 1) % ringBufferSize;
        ringCount--;
      }
      ringBuffer[ringWritePos] = sample;
      ringWritePos = (ringWritePos + 1) % ringBufferSize;
      ringCount++;
    };

    // Create and store the audio callback so we can disconnect/reconnect it
    this.audioCallback = (samples: Float32Array) => {
      if (!this.rtAudio) {return;}

      // If no resampling needed, add directly to ring buffer
      if (Math.abs(resampleRatio - 1.0) < FLOAT_COMPARE_EPSILON) {
        for (let i = 0; i < samples.length; i++) {
          addSampleToRingBuffer(samples[i]);
        }
      } else {
        // Resample using linear interpolation (stereo)
        const numFrames = samples.length / 2;
        let srcPos = 0;

        while (srcPos < numFrames - 1) {
          const srcIdx = Math.floor(srcPos) * 2;
          const frac = srcPos - Math.floor(srcPos);

          // Get current and next stereo samples
          const l0 = samples[srcIdx];
          const r0 = samples[srcIdx + 1];
          const l1 = samples[srcIdx + AUDIO_STEREO_CHANNELS] ?? l0;
          const r1 = samples[srcIdx + STEREO_NEXT_RIGHT_OFFSET] ?? r0;

          // Linear interpolation
          const outL = l0 + (l1 - l0) * frac;
          const outR = r0 + (r1 - r0) * frac;

          addSampleToRingBuffer(outL);
          addSampleToRingBuffer(outR);

          // Advance source position by resample ratio
          srcPos += resampleRatio;
        }
      }

      // Write complete frames to RtAudio's queue
      tryWriteFrames();
    };

    // Connect core's audio output to RtAudio
    this.core.setAudioCallback(this.audioCallback);
  }

  private setupStdin(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }

  private setupInputHandler(): void {
    this.inputHandler = (key: string) => {
      // Process input through InputManager
      const result = this.inputManager.processInput(key);

      if (result.quit) {
        this.stop();
      }

      if (result.cycleRenderMode) {
        this.cycleRenderMode();
      }

      if (result.toggleAudio) {
        this.toggleAudio();
      }

      if (result.togglePostProcessing) {
        this.togglePostProcessing();
      }

      if (result.takeScreenshot) {
        this.takeScreenshot();
      }

      if (result.testNotification) {
        this.triggerTestNotification();
      }
    };
    process.stdin.on('data', this.inputHandler);
  }

  // Toggle audio on/off
  private toggleAudio(): void {
    // Use SettingsManager if available (handles persistence and notifies listeners)
    if (this.settingsManager) {
      this.settingsManager.toggle('audioMuted');
      return;
    }

    // Fallback: direct toggle without SettingsManager
    const nowMuted = this.audioEnabled;  // If was enabled, now muting
    this.applyAudioMuteChange(nowMuted);
  }

  // Cycle through render modes: kitty -> terminal -> ascii -> emoji -> kitty
  // (Moved here to be near toggleAudio for consistency)
  private cycleRenderMode(): void {
    const modes: RenderMode[] = ['kitty', 'terminal', 'ascii', 'emoji'];

    // Use SettingsManager if available
    if (this.settingsManager) {
      this.settingsManager.cycle('renderMode', modes);
      return;
    }

    // Fallback: direct cycle without SettingsManager
    const currentIndex = modes.indexOf(this.renderMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.applyRenderModeChange(modes[nextIndex]);
  }

  // Cycle post-processing mode: Off -> Custom (if defined) -> CRT -> Off
  private togglePostProcessing(): void {
    // Determine available modes
    const modes: PostProcessingMode[] = this.hasCustomEffects
      ? ['off', 'custom', 'crt']
      : ['off', 'crt'];

    // Use SettingsManager if available
    if (this.settingsManager) {
      this.settingsManager.cycle('postProcessingMode', modes);
      return;
    }

    // Fallback: direct cycle without SettingsManager
    const currentIndex = modes.indexOf(this.postProcessingMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.applyPostProcessingMode(modes[nextIndex]);
    this.recreateRenderer();
  }

  // Handle messages from the core (e.g., "State saved", "Disk inserted")
  // These come from libretro cores via setMessageCallback
  // Routes through the unified notification system for both OS and status bar display
  private handleCoreMessage(message: CoreMessage): void {
    const duration = message.duration > 0
      ? message.duration
      : DEFAULT_MESSAGE_DURATION_MS;

    // Send through unified notification system (will reach OS and status bar via listener)
    notify({
      message: message.msg,
      duration,
      severity: message.severity,
    });
  }

  // Handle app-wide notifications (gamepad, screenshots, etc.)
  // These come from the unified notification system via subscribeToNotifications
  private handleAppNotification(notification: AppNotification): void {
    // Convert to CoreMessage format for status bar display
    const message: CoreMessage = {
      msg: notification.title
        ? `${notification.title}: ${notification.message}`
        : notification.message,
      duration: notification.duration ?? DEFAULT_MESSAGE_DURATION_MS,
      priority: 0,
      type: 'notification',
      progress: -1,
      severity: notification.severity ?? 'info',
    };

    // Store for status bar display
    this.currentMessage = message;
    this.messageExpiry = performance.now() + message.duration;
  }

  // Trigger a test notification (for testing the notification system)
  private triggerTestNotification(): void {
    this.handleCoreMessage({
      msg: 'Test notification from emoemu',
      duration: DEFAULT_MESSAGE_DURATION_MS,
      priority: 0,
      type: 'notification',
      progress: -1,
      severity: 'info',
    });
  }

  // Apply a specific post-processing mode
  private applyPostProcessingMode(mode: PostProcessingMode): void {
    this.postProcessingMode = mode;

    switch (mode) {
      case 'off':
        // Set all effects to neutral/off values
        this.gamma = 1.0;
        this.scanlines = 0;
        this.saturation = 1.0;
        this.brightness = 1.0;
        this.contrast = 1.0;
        this.vignette = 0;
        this.bloom = 0;
        this.bloomThreshold = 0.6;
        this.ntsc = 0;
        this.curvature = 0;
        this.chromaticAberration = 0;
        break;

      case 'custom':
        // Apply user's custom effect values
        if (this.customEffectValues) {
          this.gamma = this.customEffectValues.gamma;
          this.scanlines = this.customEffectValues.scanlines;
          this.saturation = this.customEffectValues.saturation;
          this.brightness = this.customEffectValues.brightness;
          this.contrast = this.customEffectValues.contrast;
          this.vignette = this.customEffectValues.vignette;
          this.bloom = this.customEffectValues.bloom;
          this.bloomThreshold = this.customEffectValues.bloomThreshold;
          this.ntsc = this.customEffectValues.ntsc;
          this.curvature = this.customEffectValues.curvature;
          this.chromaticAberration = this.customEffectValues.chromaticAberration;
        }
        break;

      case 'crt':
        // Apply CRT preset values from config
        if (this.config) {
          this.gamma = this.config.crt_gamma;
          this.scanlines = this.config.crt_scanlines;
          this.saturation = this.config.crt_saturation;
          this.brightness = 1.0;  // CRT doesn't override brightness
          this.contrast = 1.0;    // CRT doesn't override contrast
          this.vignette = this.config.crt_vignette;
          this.bloom = 0;         // CRT doesn't use bloom
          this.bloomThreshold = 0.6;
          this.ntsc = this.config.crt_ntsc;
          this.curvature = this.config.crt_curvature;
          this.chromaticAberration = this.config.crt_chromatic_aberration;
        } else {
          // Fallback to defaults if no config
          this.gamma = 1.3;
          this.scanlines = 0.1;
          this.saturation = 1.0;
          this.brightness = 1.0;
          this.contrast = 1.0;
          this.vignette = 0.5;
          this.bloom = 0;
          this.bloomThreshold = 0.6;
          this.ntsc = 1.0;
          this.curvature = 0.1;
          this.chromaticAberration = 0;
        }
        break;
    }
  }

  /**
   * Create a renderer for the specified mode.
   * Uses current emulator effect values and system info.
   */
  private createRendererForMode(mode: RenderMode): Renderer {
    if (mode === 'native') {
      return new NativeRenderer({
        scale: this.nativeScale,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
        pixelAspectRatio: this.systemInfo.pixelAspectRatio,
        colorEnabled: this.colorEnabled,
        title: `emoemu - ${getRomTitle(this.romPath) ?? basename(this.romPath, extname(this.romPath))}`,
        gamma: this.gamma,
        scanlines: this.scanlines,
        saturation: this.saturation,
        brightness: this.brightness,
        contrast: this.contrast,
        vignette: this.vignette,
        bloom: this.bloom,
        bloomThreshold: this.bloomThreshold,
        ntsc: this.ntsc,
        curvature: this.curvature,
        chromaticAberration: this.chromaticAberration,
      });
    }

    if (mode === 'kitty') {
      return new KittyRenderer({
        scale: this.kittyScale,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
        colorSpace: this.systemInfo.colorSpace,
        pixelAspectRatio: this.systemInfo.pixelAspectRatio,
        enableDiffRendering: this.diffRenderingEnabled,
        colorEnabled: this.colorEnabled,
        gamma: this.gamma,
        scanlines: this.scanlines,
        saturation: this.saturation,
        brightness: this.brightness,
        contrast: this.contrast,
        vignette: this.vignette,
        bloom: this.bloom,
        bloomThreshold: this.bloomThreshold,
        ntsc: this.ntsc,
        curvature: this.curvature,
        chromaticAberration: this.chromaticAberration,
      });
    }

    // Terminal-based renderers share common options
    const terminalMode = mode === 'emoji' ? 'emoji' : mode === 'ascii' ? 'ascii' : 'terminal';
    const dims = calculateTerminalDimensions(terminalMode, this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);

    return new TerminalRenderer({
      width: dims.width,
      height: dims.height,
      colorEnabled: this.colorEnabled,
      emojiMode: mode === 'emoji',
      asciiMode: mode === 'ascii',
      sourceWidth: this.systemInfo.width,
      sourceHeight: this.systemInfo.height,
      enableDiffRendering: this.diffRenderingEnabled,
      gamma: this.gamma,
      scanlines: this.scanlines,
      saturation: this.saturation,
      brightness: this.brightness,
      contrast: this.contrast,
      vignette: this.vignette,
    });
  }

  // Recreate the current renderer with updated effect values
  private recreateRenderer(): void {
    // Destroy old renderer first (cleanup native window, encode worker, etc.)
    this.renderer.destroy?.();

    this.renderer = this.createRendererForMode(this.renderMode);
    this.attachRendererSink();
  }

  // Check if we should do a periodic bounds re-detection
  // More frequent at start (every ~1 sec), then less often (every ~5 sec)
  private shouldPeriodicBoundsCheck(): boolean {
    // Stop checking after max count reached
    if (this.boundsCheckCount >= BOUNDS_CHECK_MAX_COUNT) {
      return false;
    }

    // Haven't done initial detection yet
    if (this.boundsCheckCount === 0) {
      return false;
    }

    const framesSinceLastCheck = this.frameCount - this.lastBoundsCheckFrame;
    const interval = this.boundsCheckCount < BOUNDS_CHECK_INITIAL_COUNT
      ? BOUNDS_CHECK_INTERVAL_INITIAL
      : BOUNDS_CHECK_INTERVAL_LATER;

    return framesSinceLastCheck >= interval;
  }

  // Check if auto-crop should be enabled for the given core ID
  private shouldEnableAutoCrop(coreId: string): boolean {
    if (!this.config) {
      return false;
    }

    const configuredCores = this.config.video_auto_crop_cores;
    if (!configuredCores) {
      return false;
    }

    // Parse comma-separated list and check for exact match
    const coreIds = configuredCores.split(',').map(id => id.trim().toLowerCase());
    return coreIds.includes(coreId.toLowerCase());
  }

  private buildStatusBar(fps: number): string {
    // Check for active notification - if present, show only the notification
    const now = performance.now();
    if (this.currentMessage && now < this.messageExpiry) {
      let msgText = this.currentMessage.msg;
      if (this.currentMessage.type === 'progress' && this.currentMessage.progress >= 0) {
        msgText += ` (${this.currentMessage.progress}%)`;
      }
      // Color based on severity: debug=dim, info=yellow, warn=bright yellow, error=red
      let colorCode: string;
      switch (this.currentMessage.severity) {
        case 'debug': colorCode = '\x1b[2m'; break;      // Dim
        case 'warn': colorCode = '\x1b[93m'; break;      // Bright yellow
        case 'error': colorCode = '\x1b[91m'; break;     // Bright red
        default: colorCode = '\x1b[33m'; break;          // Yellow (info)
      }
      return `${colorCode}${msgText}\x1b[0m\x1b[K`;
    } else if (this.currentMessage && now >= this.messageExpiry) {
      // Clear expired message
      this.currentMessage = null;
    }

    // Normal status bar content
    const parts: string[] = [];

    // FPS - show both emulation and render FPS
    parts.push(`Emu: ${fps.toFixed(0)} | Render: ${this.currentRenderFps.toFixed(0)}`)

    // Netplay status (if active)
    if (this.netplayServer) {
      const clientCount = this.netplayServer.getClientCount();
      const lanStatus = this.netplayServer.isDiscoveryActive() ? ' \x1b[36m📡LAN\x1b[0m' : '';
      parts.push(`\x1b[32mHost\x1b[0m (${clientCount}p)${lanStatus}`);
    } else if (this.netplayClient) {
      const status = this.netplayClient.connected ? '\x1b[32mOnline\x1b[0m' : '\x1b[33mConnecting\x1b[0m';
      const player = this.netplayClient.isPlaying ? `P${this.netplayClient.playerNumber + 1}` : 'Spectate';
      parts.push(`${status} ${player}`);
    }

    // Render mode
    parts.push(`Render: ${this.noRender ? 'Disabled' : this.renderMode}`);

    // Audio status
    parts.push(`Audio: ${this.audioEnabled ? 'on' : 'off'}`);

    // Input mode
    const gamepadStatus = this.gamepadManager?.getPlayer1Status();
    const inputMode = gamepadStatus ?? (this.inputManager.isKittyMode() ? 'kitty' : 'legacy');
    parts.push(`Input: ${inputMode}`);

    // Pressed buttons
    const pressedButtons = this.inputMapper.getPressedButtons(0);
    parts.push(`Buttons: ${pressedButtons || '-'}`);

    // Build the status line and clear to end of line
    return parts.join(' | ') + '\x1b[K';
  }

  private async cleanup(): Promise<void> {
    // Unsubscribe from settings listeners
    for (const unsubscribe of this.settingsUnsubscribers) {
      unsubscribe();
    }
    this.settingsUnsubscribers = [];

    // Disconnect netplay
    this.disconnectNetplay();

    // Clear auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Save battery RAM to .srm file (must happen before destroy)
    if (this.batterySaveEnabled) {
      this.saveBatterySave();
    }

    // Save state on exit (must happen before destroy)
    if (this.saveStateEnabled) {
      await this.saveState();
    }

    // Destroy core
    this.core.destroy();

    // Remove resize handler
    if (this.resizeHandler) {
      process.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // Stop gamepad manager
    if (this.gamepadManager) {
      this.gamepadManager.stop();
    }

    // Unsubscribe from app-wide notifications
    if (this.notificationHandler) {
      unsubscribeFromNotifications(this.notificationHandler);
      this.notificationHandler = null;
    }

    // Stop audio
    if (this.rtAudio) {
      this.core.setAudioCallback(null);
      try {
        // Stop the stream first, then close it
        if (this.rtAudio.isStreamRunning()) {
          this.rtAudio.stop();
        }
        if (this.rtAudio.isStreamOpen()) {
          this.rtAudio.closeStream();
        }
      } catch {
        // Ignore cleanup errors
      }
      this.rtAudio = null;
    }

    // Remove stdin data listener
    if (this.inputHandler) {
      process.stdin.off('data', this.inputHandler);
      this.inputHandler = null;
    }

    // Stop global keyboard listener
    this.inputManager.stop();

    // Clear input state
    this.inputManager.clear();

    // Clear graphics if using image-based renderer
    if (this.renderMode === 'kitty') {
      process.stdout.write(this.renderer.clearScreen());
    }

    process.stdout.write(this.renderer.showCursor());
    process.stdout.write('\n');

    // Destroy renderer (cleanup native window, etc.)
    this.renderer.destroy?.();

    // Thoroughly reset stdin for the next consumer (e.g., ROM browser)
    // Remove ALL listeners to ensure a clean state
    process.stdin.removeAllListeners();

    // Reset TTY state
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    // Pause stdin so the next consumer can set it up fresh
    process.stdin.pause();

    // Drain any buffered input
    process.stdin.read();
  }

  // Expose controller for external input handling
  getController(port: 1 | 2): Controller {
    return port === 1 ? this.controller1 : this.controller2;
  }

  // Screenshot methods - delegate to ./screenshot sub-module

  private takeScreenshot(): void {
    takeScreenshotFn(this.core, this.systemInfo, this.romPath, this.config);
  }

  private async saveThumbnailScreenshot(): Promise<void> {
    return saveThumbnailScreenshotFn(this.core, this.systemInfo, this.romPath);
  }

  // Save state methods - delegate to ./saveState sub-module

  private getStatePath(): string {
    return getStatePathFn(this.config, this.romPath);
  }

  private loadBatterySave(): void {
    loadBatterySaveFn(this.core, this.config, this.romPath);
  }

  private saveBatterySave(): void {
    saveBatterySaveFn(this.core, this.config, this.romPath);
  }

  hasSavedState(): boolean {
    return hasSavedStateFn(this.config, this.romPath);
  }

  async saveState(): Promise<void> {
    saveStateFn(this.core, this.config, this.romPath);
    await this.saveThumbnailScreenshot();
  }

  deleteSavedState(): void {
    deleteSavedStateFn(this.config, this.romPath);
  }

  /**
   * Load state from a save state file.
   * If statePathToLoad is provided, loads from that file (used for legacy format migration).
   * Otherwise, looks for a .state.auto file.
   */
  async loadState(statePathToLoad?: string): Promise<boolean> {
    const statePath = statePathToLoad ?? this.getStatePath();
    const loaded = loadStateFromFile(this.core, statePath);
    if (!loaded && existsSync(statePath)) {
      // File existed but load failed
      const continueAnyway = await this.promptConfirmation('Continue without saved state?', true);
      if (!continueAnyway) {
        throw new Error('User cancelled due to save state load failure');
      }
    }
    return loaded;
  }

  // Netplay methods

  /**
   * Check if netplay is currently active (either as server or client).
   */
  isNetplayActive(): boolean {
    return this.netplayServer !== null || this.netplayClient !== null;
  }

  /**
   * Show the pause menu during netplay.
   * Pauses emulation and shows a menu to resume or disconnect.
   */
  private showPauseMenu(): void {
    if (this.pauseMenuPending) {
      return;
    }

    this.pauseMenuPending = true;

    // Pause audio to prevent buffer issues
    if (this.rtAudio?.isStreamRunning()) {
      try {
        this.rtAudio.stop();
      } catch {
        // Ignore errors
      }
    }

    // Clean up terminal state for menu display
    process.stdout.write(this.renderer.clearScreen());
    process.stdout.write(this.renderer.showCursor());

    // Clean up stdin for the menu
    process.stdin.removeAllListeners();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    // Get game name for display
    const gameName = getRomTitle(this.romPath);

    // Show the pause menu asynchronously
    void showNetplayPauseMenu({
      gameName,
      isConnecting: this.netplayClient !== null && !this.netplayClient.isPlaying,
      nativeMode: this.renderMode === 'native',
      scaleFactor: this.config?.menu_scale_factor,
    }).then((choice: PauseMenuChoice) => {
      this.handlePauseMenuChoice(choice);
    });
  }

  /**
   * Handle the user's choice from the pause menu.
   */
  private handlePauseMenuChoice(choice: PauseMenuChoice): void {
    if (choice === 'disconnect') {
      // User explicitly chose to disconnect - set intentional flag
      this.intentionalDisconnect = true;
      this.pauseMenuPending = false;
      this.stop();
    } else {
      // User chose to resume - restore emulator state
      this.resumeFromPauseMenu();
    }
  }

  /**
   * Resume emulation after closing the pause menu.
   */
  private resumeFromPauseMenu(): void {
    // Restore terminal state
    process.stdout.write(this.renderer.hideCursor());
    process.stdout.write(this.renderer.clearScreen());

    // Re-setup stdin
    this.setupStdin();

    // Re-start the input manager (it may have been paused)
    void this.inputManager.start().then(() => {
      this.setupInputHandler();
    });

    // Restart gamepad manager if available
    if (this.gamepadManager) {
      this.gamepadManager.start();
    }

    // Resume audio if it was enabled
    if (this.audioEnabled && this.rtAudio && !this.rtAudio.isStreamRunning()) {
      try {
        this.rtAudio.start();
      } catch {
        // Ignore errors
      }
    }

    // Reset timing to prevent frame catch-up
    this.lastFrameTime = performance.now();
    this.fpsWindowStart = this.lastFrameTime;
    this.fpsFrameCount = 0;
    this.renderFpsFrameCount = 0;

    // Clear the pending flag to resume the loop
    this.pauseMenuPending = false;
  }

  /**
   * Start a netplay server (host mode).
   */
  async startNetplayServer(options: Partial<NetplayServerOptions> = {}): Promise<void> {
    if (this.isNetplayActive()) {
      throw new NetplayError('ALREADY_ACTIVE');
    }



    this.netplayServer = createNetplayServer({
      port: options.port,
      password: options.password,
      requirePassword: !!options.password,
      maxClients: options.maxClients ?? NETPLAY_MAX_CLIENTS,
      inputDelayFrames: options.inputDelayFrames ?? 0,
      nickname: options.nickname ?? 'Host',
    });

    // Set up event handlers
    this.netplayServer.on('client-connected', (client) => {
      const message = `${client.nickname} connected`;
      netplayLogger.info('SERVER', message, { nickname: client.nickname });
      notify({ title: 'Netplay', message, severity: 'info' });
    });

    this.netplayServer.on('client-disconnected', (client, reason) => {
      const message = `${client.nickname} disconnected: ${reason}`;
      netplayLogger.info('SERVER', message, { nickname: client.nickname, reason });
      notify({ title: 'Netplay', message, severity: 'info' });
    });

    this.netplayServer.on('desync', (_clientId, frameNumber) => {
      const message = `Desync at frame ${frameNumber}, recovering...`;
      netplayLogger.warn('SERVER', message, { frameNumber });
      notify({ title: 'Netplay', message, severity: 'warn' });
    });

    // Wire rollback replay to the core
    this.wireNetplayRollback(this.netplayServer.getSyncManager());

    // Provide battery RAM for SYNC so joining clients adopt our save data
    this.netplayServer.setSramProvider(() => this.core.getBatteryRam());

    // Reset the host core when the synchronized reset broadcast goes out
    this.netplayServer.on('reset', (frameNumber) => {
      netplayLogger.info('SERVER', `Resetting core at frame ${frameNumber}`);
      this.core.reset();
    });

    // Set core info for compatibility checking and LAN discovery
    const contentName = basename(this.romPath, extname(this.romPath));
    this.netplayServer.setCoreInfo(
      this.systemInfo.coreName ?? this.systemInfo.name,
      this.systemInfo.coreVersion ?? '',
      this.contentCrc,
      contentName
    );

    await this.netplayServer.start();

    const port = options.port ?? NETPLAY_DEFAULT_PORT;
    const message = `Hosting on port ${port}`;
    netplayLogger.info('SERVER', message, { port });
    notify({ title: 'Netplay', message, severity: 'info' });
  }

  /**
   * Discover netplay hosts on the LAN.
   * Returns the first host found, or null if none found within timeout.
   */
  private async discoverLanHost(
    _port: number,
    timeoutMs: number
  ): Promise<{ address: string; port: number; nickname: string; contentName: string } | null> {
    return new Promise((resolve) => {
      const listener = new DiscoveryListener();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          listener.stop();
        }
      };

      // Set up callback for when a host is found
      listener.start((host) => {
        if (!resolved) {
          cleanup();
          resolve({
            address: host.address,
            port: host.port,
            nickname: host.nickname,
            contentName: host.contentName,
          });
        }
      });

      // Send discovery query to trigger immediate responses
      // Small delay to ensure listener is ready
      setTimeout(() => {
        if (!resolved) {
          listener.sendQuery();
        }
      }, DISCOVERY_QUERY_DELAY_MS);

      // Timeout if no host found
      setTimeout(() => {
        if (!resolved) {
          cleanup();
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  /**
   * Connect to a netplay server (client mode).
   */
  async connectToNetplay(options: Partial<NetplayClientOptions> = {}): Promise<void> {
    if (this.isNetplayActive()) {
      throw new NetplayError('ALREADY_ACTIVE');
    }



    // Parse host:port from connect string
    let host = options.host ?? '';
    let port = options.port ?? NETPLAY_DEFAULT_PORT;

    // If no host specified, use LAN discovery to find one
    if (!host) {
      const searchMsg = 'Searching for LAN hosts...';
      netplayLogger.info('CLIENT', searchMsg);
      notify({ title: 'Netplay', message: searchMsg, severity: 'info' });

      const discovered = await this.discoverLanHost(port, DISCOVERY_TIMEOUT_MS);

      if (!discovered) {
        netplayLogger.error('CLIENT', 'No netplay hosts found on LAN');
        throw new NetplayError('NO_HOSTS_FOUND');
      }

      host = discovered.address;
      port = discovered.port;

      const foundMsg = `Found: ${discovered.nickname} (${discovered.contentName})`;
      netplayLogger.info('CLIENT', foundMsg, {
        address: discovered.address,
        port: discovered.port,
        nickname: discovered.nickname,
        contentName: discovered.contentName,
      });
      notify({ title: 'Netplay', message: foundMsg, severity: 'info' });
    }

    // Parse host:port if combined
    if (host.includes(':')) {
      const parts = host.split(':');
      host = parts[0];
      port = parseInt(parts[1], 10) || port;
    }

    // Store connection info for potential reconnection
    this.netplayHost = host;
    this.netplayPort = port;

    this.netplayClient = createNetplayClient({
      host,
      port,
      password: options.password ?? '',
      nickname: options.nickname ?? 'Player',
      inputDelayFrames: options.inputDelayFrames ?? 0,
      spectate: options.spectate ?? false,
    });

    // Set up event handlers
    this.netplayClient.on('connected', () => {
      const message = `Connected to ${host}:${port}`;
      netplayLogger.info('CLIENT', message, { host, port });
      notify({ title: 'Netplay', message, severity: 'info' });
    });

    this.netplayClient.on('disconnected', (reason) => {
      const message = `Disconnected: ${reason}`;
      netplayLogger.warn('CLIENT', message, { reason });
      notify({ title: 'Netplay', message, severity: 'warn' });
      this.netplayClient = null;
      // Mark netplay disconnect with reason and stop the emulator
      this.netplayDisconnected = true;
      this.netplayDisconnectReason = reason;
      this.stop();
    });

    this.netplayClient.on('synced', (frameNumber) => {
      const message = `Synced at frame ${frameNumber}`;
      netplayLogger.info('CLIENT', message, { frameNumber });
      notify({ title: 'Netplay', message, severity: 'info' });
    });

    this.netplayClient.on('desync', (frameNumber, localCrc, remoteCrc) => {
      const message = `Desync at frame ${frameNumber}, requesting recovery...`;
      netplayLogger.warn('CLIENT', message, { frameNumber, localCrc, remoteCrc });
      notify({ title: 'Netplay', message, severity: 'warn' });
    });

    this.netplayClient.on('rollback', (frames) => {
      // Only notify on significant rollbacks, but always log
      const message = `Rollback: ${frames} frames`;
      netplayLogger.debug('CLIENT', message, { frames });
      if (frames >= ROLLBACK_NOTIFICATION_THRESHOLD) {
        notify({ title: 'Netplay', message, severity: 'debug' });
      }
    });

    this.netplayClient.on('paused', (by) => {
      const message = `Paused by ${by}`;
      netplayLogger.info('CLIENT', message, { by });
      notify({ title: 'Netplay', message, severity: 'info' });
    });

    this.netplayClient.on('resumed', () => {
      const message = 'Resumed';
      netplayLogger.info('CLIENT', message);
      notify({ title: 'Netplay', message, severity: 'info' });
    });

    this.netplayClient.on('chat', (from, chatMessage) => {
      netplayLogger.info('CLIENT', `Chat from ${from}: ${chatMessage}`, { from, chatMessage });
      notify({ title: from, message: chatMessage, severity: 'info' });
    });

    this.netplayClient.on('reset', (frameNumber) => {
      netplayLogger.info('CLIENT', `Resetting core at frame ${frameNumber} (host reset)`);
      this.core.reset();
    });

    this.netplayClient.on('sram-load', (sram) => {
      // Per RetroArch, adopt the host's SRAM only when sizes agree
      const localSram = this.core.getBatteryRam();
      if (localSram !== null && localSram.length === sram.length) {
        this.core.setBatteryRam(sram);
        netplayLogger.info('CLIENT', 'Loaded host SRAM from SYNC', { size: sram.length });
      } else {
        netplayLogger.warn('CLIENT', 'Ignoring host SRAM (size mismatch)', {
          localSize: localSram?.length ?? 0,
          remoteSize: sram.length,
        });
      }
    });

    this.netplayClient.on('state-load', (frameNumber, state) => {
      // Load the state from server into the core
      try {
        this.core.setState(state);
        const message = `State loaded at frame ${frameNumber}`;
        netplayLogger.info('CLIENT', message, { frameNumber, stateSize: state.length });
        notify({ title: 'Netplay', message, severity: 'info' });
      } catch (err) {
        const errorMessage = `Failed to load state: ${getErrorMessage(err)}`;
        netplayLogger.error('CLIENT', errorMessage, { frameNumber, error: getErrorMessage(err) });
        notify({ title: 'Netplay Error', message: errorMessage, severity: 'error' });
      }
    });

    this.netplayClient.on('error', (error) => {
      netplayLogger.error('CLIENT', error.message, { error: error.message });
      notify({ title: 'Netplay Error', message: error.message, severity: 'error' });
    });

    // Wire rollback replay to the core
    this.wireNetplayRollback(this.netplayClient.getSyncManager());

    // Set core info for compatibility checking
    this.netplayClient.setCoreInfo(
      this.systemInfo.coreName ?? this.systemInfo.name,
      this.systemInfo.coreVersion ?? '',
      this.contentCrc
    );

    await this.netplayClient.connect();
  }

  /**
   * Wire rollback replay to the core: when the sync manager rolls back,
   * restore the pre-divergence savestate, re-run each frame with the
   * corrected input, and re-capture the states into the frame ring.
   * Audio is suppressed during replay so re-run frames don't queue
   * duplicate samples.
   */
  private wireNetplayRollback(syncManager: SyncManager): void {
    wireRollbackReplay(syncManager, {
      beginReplay: () => {
        this.core.setAudioCallback(null);
      },
      endReplay: () => {
        if (this.audioEnabled && this.audioCallback) {
          this.core.setAudioCallback(this.audioCallback);
        }
      },
      restoreState: (state) => {
        try {
          this.core.setState(state);
        } catch (err) {
          // Keep running on the uncorrected timeline; CRC checks will
          // trigger savestate-based desync recovery if we truly diverged
          netplayLogger.error('SYNC', `Rollback state restore failed: ${getErrorMessage(err)}`);
        }
      },
      applyInput: (input) => {
        this.netplayMergedInput = input;
        this.syncInputToCore();
      },
      runFrame: () => {
        this.core.runFrame();
      },
      captureState: (scratch) =>
        this.core.getStateInto ? this.core.getStateInto(scratch) : this.core.getState(),
      captureCrcBasis: () => this.core.getSystemRam?.() ?? null,
    });
  }

  /**
   * Disconnect from netplay (both server and client modes).
   */
  disconnectNetplay(): void {
    if (this.netplayServer) {
      this.netplayServer.stop();
      this.netplayServer = null;
    }
    if (this.netplayClient) {
      this.netplayClient.disconnect();
      this.netplayClient = null;
    }
  }

  /**
   * Initialize netplay from stored options (called from run()).
   */
  private async initializeNetplay(): Promise<void> {
    if (!this.netplayOptions) {
      return;
    }

    const opts = this.netplayOptions;
    this.netplayOptions = null;  // Clear so we don't re-init

    try {
      if (opts.netplayHost) {
        await this.startNetplayServer({
          port: opts.netplayPort,
          password: opts.netplayPassword,
          inputDelayFrames: opts.netplayInputDelay,
          nickname: opts.netplayNickname,
        });
      } else if (opts.netplayConnect !== undefined) {
        // netplayConnect can be empty string for LAN discovery
        await this.connectToNetplay({
          host: opts.netplayConnect,
          port: opts.netplayPort,
          password: opts.netplayPassword,
          inputDelayFrames: opts.netplayInputDelay,
          nickname: opts.netplayNickname,
          spectate: opts.netplaySpectate,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      netplayLogger.error('CLIENT', `Setup failed: ${error.message}`, { error: error.message });
      notify({ title: 'Netplay Error', message: error.message, severity: 'error' });
      // Re-throw to prevent game from starting without netplay
      throw error;
    }
  }

  // Get current frame buffer for external rendering
  getFrameBuffer(): Uint8Array | Uint16Array {
    return this.core.getFramebuffer();
  }

  /**
   * Prompt user for confirmation with keyboard and gamepad (A=yes, B=no) support
   * @param message The question to ask
   * @param defaultYes If true, default is Y. If false, default is N.
   * @returns Promise that resolves to true if user confirms, false otherwise
   */
  private promptConfirmation(message: string, defaultYes: boolean = false): Promise<boolean> {
    return new Promise((resolve) => {
      // Check if gamepad is available
      const hasGamepad = this.gamepadManager !== null;

      // Build prompt with appropriate default and gamepad hint
      const defaultHint = defaultYes ? '[Y/n]' : '[y/N]';
      const gamepadHint = hasGamepad ? ', A/B' : '';
      process.stdout.write(`${message} (${defaultHint}${gamepadHint}): `);

      // Set up keyboard input
      const wasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();

      let resolved = false;
      let gamepadInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (resolved) {return;}
        resolved = true;
        process.stdin.setRawMode(wasRaw);
        process.stdin.pause();
        process.stdin.removeListener('data', onKeyPress);
        if (gamepadInterval) {
          clearInterval(gamepadInterval);
        }
        logger.info(''); // New line after prompt
      };

      const onKeyPress = (data: Buffer) => {
        const key = data.toString().toLowerCase();
        if (key === 'y') {
          cleanup();
          resolve(true);
        } else if (key === 'n') {
          cleanup();
          resolve(false);
        } else if (key === '\r' || key === '\n') {
          // Enter = use default
          cleanup();
          resolve(defaultYes);
        } else if (key === '\x1b') {
          // Escape = no
          cleanup();
          resolve(false);
        }
      };

      process.stdin.on('data', onKeyPress);

      // Set up gamepad input if available
      if (hasGamepad) {
        gamepadInterval = setInterval(() => {
          if (resolved) {
            return;
          }
          // Check if A or Start is pressed (confirm)
          const aPressed = this.controller1.getButton(Button.A);
          const startPressed = this.controller1.getButton(Button.Start);
          if (aPressed || startPressed) {
            logger.info(aPressed ? 'A' : 'Start'); // Echo the selection
            cleanup();
            resolve(true);
          }
          // Check if B is pressed (cancel)
          if (this.controller1.getButton(Button.B)) {
            logger.info('B'); // Echo the selection
            cleanup();
            resolve(false);
          }
        }, GAMEPAD_DIALOG_POLL_INTERVAL_MS);
      }
    });
  }
}
