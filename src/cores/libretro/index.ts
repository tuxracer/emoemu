/**
 * LibretroCore - Wrapper for native libretro cores
 *
 * This class implements the Core interface by wrapping a native libretro
 * core (.dylib/.so/.dll) using FFI. It allows emoemu to run games using
 * existing libretro cores like genesis_plus_gx, mGBA, snes9x, etc.
 */

import { readFileSync } from "fs";
import { extname } from "path";
import koffi from "koffi";
import type {
  Core,
  SystemInfo,
  AudioConfig,
  ButtonDefinition,
  CoreMessage,
  CoreMessageCallback,
} from "../../core/core";
import { LibretroAPI } from "./api";
import { EnvironmentHandler } from "./environment";
import { CallbackManager } from "./callbacks";
import { convertFramebuffer, detectContentBounds, hasFrameContent, type ContentBounds } from "./pixelFormat";
import {
  RETRO_DEVICE_ID_JOYPAD,
  RETRO_MEMORY,
  RETRO_DEVICE,
  RETRO_MESSAGE_TYPE,
  RETRO_LOG,
  LibretroError,
} from "./types";
import type { MessageSeverity } from "../../core/core";
import { DEFAULT_SAMPLE_RATE, RGB24_BYTES_PER_PIXEL, ASPECT_RATIO_DECIMALS, FPS_DECIMALS, INT16_MAX_POSITIVE, DEBUG_INITIAL_FRAME_LOG_COUNT, ANALOG_NORMALIZED_THRESHOLD } from "./consts";
import { logger } from "../../utils/logger";

/**
 * Options for creating a LibretroCore instance
 */
export interface LibretroCoreOptions {
  /** Core options in RetroArch format (e.g., {"mupen64plus-rdp-plugin": "angrylion"}) */
  coreOptions?: Record<string, string>;
  /** System directory path for BIOS files */
  systemDirectory?: string;
  /** Save directory path */
  saveDirectory?: string;
}

/**
 * LibretroCore implements the Core interface for libretro cores
 */
export class LibretroCore implements Core {
  private api: LibretroAPI;
  private envHandler: EnvironmentHandler;
  private callbacks: CallbackManager;
  private systemInfo: SystemInfo;
  private romData: Buffer | null = null;
  private audioCallback: ((samples: Float32Array) => void) | null = null;
  private gameLoaded = false;
  // Cached pixel format to avoid method call overhead in hot path
  private cachedPixelFormat: number = 0;
  // Detected content bounds for auto-cropping (null = no cropping needed)
  private contentBounds: ContentBounds | null = null;
  // Original display aspect ratio from AV info (used for cropping to preserve intended aspect)
  private originalDisplayAspect: number = 0;
  // Cached RGB24 framebuffer to avoid double conversion during bounds detection
  // The cache is valid only for the current frame (invalidated on next runFrame)
  private cachedRgb24Framebuffer: Uint8Array | null = null;
  private cachedRgb24FrameId: number = 0;  // Unique ID to track frame validity
  private currentFrameId: number = 0;      // Incremented each runFrame()
  // Reusable buffer for cropping to avoid allocations
  private cropOutputBuffer: Uint8Array | null = null;
  private cropOutputCapacity: number = 0;

  constructor(corePath: string, options?: LibretroCoreOptions) {
    this.envHandler = new EnvironmentHandler();

    // Configure directories before core init
    if (options?.systemDirectory) {
      this.envHandler.setSystemDirectory(options.systemDirectory);
    }
    if (options?.saveDirectory) {
      this.envHandler.setSaveDirectory(options.saveDirectory);
    }

    // Set core options before init (some cores query options during init)
    if (options?.coreOptions) {
      this.envHandler.setCoreOptions(options.coreOptions);
    }

    this.api = new LibretroAPI(corePath);
    this.callbacks = new CallbackManager(this.envHandler);

    // Set up callbacks BEFORE retro_init (required by some cores)
    this.callbacks.createCallbacks(this.api);

    // Initialize the core
    this.api.retro_init();

    // Build initial system info from core
    this.systemInfo = this.buildSystemInfo();
  }

  /**
   * Build SystemInfo from the libretro core's system info
   */
  private buildSystemInfo(): SystemInfo {
    const info = this.api.getSystemInfo();

    // Generate a unique ID from the library name
    // No "libretro-" prefix - core type is identified by path !== "native"
    // Uses underscores to match buildbot naming convention (e.g., mupen64plus_next)
    const id = info.library_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    // Parse extensions (format: "md|gen|sms|gg")
    const extensions = info.valid_extensions
      .split("|")
      .map((ext) => `.${ext.toLowerCase()}`);

    return {
      id,
      name: `${info.library_name} ${info.library_version}`,
      coreName: info.library_name,
      coreVersion: info.library_version,
      extensions,
      // Default values - updated after ROM load
      width: 320,
      height: 240,
      fps: 60,
      sampleRate: DEFAULT_SAMPLE_RATE,
      pixelAspectRatio: 1,
      maxPlayers: 2,
      buttons: this.getDefaultButtons(),
      colorSpace: "rgb24", // We convert all formats to RGB24
    };
  }

  /**
   * Get default button definitions for libretro joypad
   */
  private getDefaultButtons(): ButtonDefinition[] {
    return [
      {
        id: RETRO_DEVICE_ID_JOYPAD.B,
        name: "B",
        defaultKey: "j",
        defaultGamepad: "B",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.Y,
        name: "Y",
        defaultKey: "u",
        defaultGamepad: "Y",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.SELECT,
        name: "Select",
        defaultKey: " ",
        defaultGamepad: "Back",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.START,
        name: "Start",
        defaultKey: "Enter",
        defaultGamepad: "Start",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.UP,
        name: "Up",
        defaultKey: "w",
        defaultGamepad: "DPadUp",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.DOWN,
        name: "Down",
        defaultKey: "s",
        defaultGamepad: "DPadDown",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.LEFT,
        name: "Left",
        defaultKey: "a",
        defaultGamepad: "DPadLeft",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.RIGHT,
        name: "Right",
        defaultKey: "d",
        defaultGamepad: "DPadRight",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.A,
        name: "A",
        defaultKey: "k",
        defaultGamepad: "A",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.X,
        name: "X",
        defaultKey: "i",
        defaultGamepad: "X",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.L,
        name: "L",
        defaultKey: "q",
        defaultGamepad: "LB",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.R,
        name: "R",
        defaultKey: "e",
        defaultGamepad: "RB",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.L2,
        name: "L2",
        defaultKey: "1",
        defaultGamepad: "LT",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.R2,
        name: "R2",
        defaultKey: "3",
        defaultGamepad: "RT",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.L3,
        name: "L3",
        defaultKey: "z",
        defaultGamepad: "LS",
      },
      {
        id: RETRO_DEVICE_ID_JOYPAD.R3,
        name: "R3",
        defaultKey: "c",
        defaultGamepad: "RS",
      },
    ];
  }

  //==========================================================================
  // Lifecycle
  //==========================================================================

  getSystemInfo(): SystemInfo {
    // Start with base system info
    const info = { ...this.systemInfo };

    // Use actual frame dimensions if we've received frames
    if (this.callbacks.frameWidth > 0 && this.callbacks.frameHeight > 0) {
      info.width = this.callbacks.frameWidth;
      info.height = this.callbacks.frameHeight;
    }

    // If we detected content bounds (auto-crop), use those dimensions
    // and adjust PAR to preserve the original display aspect ratio from AV info
    if (this.contentBounds) {
      info.width = this.contentBounds.width;
      info.height = this.contentBounds.height;
      // Use the original display aspect ratio (e.g., 4:3 for N64) from AV info
      // newPAR = originalDisplayAspect * croppedHeight / croppedWidth
      if (this.originalDisplayAspect > 0) {
        info.pixelAspectRatio = (this.originalDisplayAspect * info.height) / info.width;
      }
    }

    // If core reported geometry via SET_GEOMETRY, use that aspect ratio
    // This gives us the actual content dimensions (some cores report cropped content)
    const geometry = this.envHandler.getGeometry();
    if (geometry) {
      info.pixelAspectRatio = geometry.aspectRatio / (info.width / info.height);
    }

    return info;
  }

  /**
   * Detect content bounds in the current framebuffer for auto-cropping.
   * Call this after running bootstrap frames to detect blank borders.
   * Bounds can only expand, never shrink - this handles cases where early
   * frames (logos, menus) have smaller content than actual gameplay.
   *
   * @returns object with:
   *   - hasContent: true if frame had content (not blank)
   *   - boundsChanged: true if bounds expanded and renderer needs update
   */
  detectContentBounds(): { hasContent: boolean; boundsChanged: boolean } {
    const fb = this.callbacks.framebuffer;
    if (!fb || this.callbacks.frameWidth === 0 || this.callbacks.frameHeight === 0) {
      logger.debug(
        `detectContentBounds: no framebuffer (fb=${!!fb}, w=${this.callbacks.frameWidth}, h=${this.callbacks.frameHeight})`,
        'Core'
      );
      return { hasContent: false, boundsChanged: false };
    }

    // Quick pre-check: sample native framebuffer to detect blank frames
    // Avoids expensive RGB24 conversion during N64 startup blank frames
    if (this.isFramebufferUniform(fb)) {
      logger.debug('detectContentBounds: native framebuffer is uniform, skipping', 'Core');
      return { hasContent: false, boundsChanged: false };
    }

    // Convert framebuffer to RGB24 for analysis
    // Cache the result so getFramebuffer() can reuse it (avoids double conversion)
    const rgb24 = convertFramebuffer(
      fb,
      this.callbacks.frameWidth,
      this.callbacks.frameHeight,
      this.callbacks.framePitch,
      this.cachedPixelFormat
    );
    this.cachedRgb24Framebuffer = rgb24;
    this.cachedRgb24FrameId = this.currentFrameId;

    // Check if frame has actual content (not all black/uniform)
    // N64 games may output many blank frames before video starts
    if (!hasFrameContent(rgb24, this.callbacks.frameWidth, this.callbacks.frameHeight)) {
      logger.debug('detectContentBounds: frame is blank, will retry', 'Core');
      return { hasContent: false, boundsChanged: false };
    }

    const newBounds = detectContentBounds(rgb24, this.callbacks.frameWidth, this.callbacks.frameHeight);
    if (!newBounds) {
      // Content fills the entire frame - no cropping needed
      if (this.contentBounds) {
        // We had bounds before, now content fills frame - expand to full
        logger.info(
          `Auto-crop expanded to full frame: ${this.contentBounds.width}x${this.contentBounds.height} -> ` +
          `${this.callbacks.frameWidth}x${this.callbacks.frameHeight}`,
          'Core'
        );
        this.contentBounds = null;
        return { hasContent: true, boundsChanged: true };
      }
      return { hasContent: true, boundsChanged: false };
    }

    // Expand bounds - only grow, never shrink
    if (!this.contentBounds) {
      // First detection
      this.contentBounds = newBounds;
      logger.info(
        `Auto-crop: ${this.callbacks.frameWidth}x${this.callbacks.frameHeight} -> ` +
        `${newBounds.width}x${newBounds.height} (top=${newBounds.top}, left=${newBounds.left})`,
        'Core'
      );
      return { hasContent: true, boundsChanged: true };
    }

    // Expand existing bounds (top/left can decrease, bottom/right can increase)
    const expanded: ContentBounds = {
      top: Math.min(this.contentBounds.top, newBounds.top),
      left: Math.min(this.contentBounds.left, newBounds.left),
      bottom: Math.max(this.contentBounds.bottom, newBounds.bottom),
      right: Math.max(this.contentBounds.right, newBounds.right),
      width: 0, // Calculated below
      height: 0, // Calculated below
    };
    expanded.width = expanded.right - expanded.left + 1;
    expanded.height = expanded.bottom - expanded.top + 1;

    // Check if bounds actually expanded
    if (expanded.width > this.contentBounds.width || expanded.height > this.contentBounds.height) {
      logger.info(
        `Auto-crop expanded: ${this.contentBounds.width}x${this.contentBounds.height} -> ` +
        `${expanded.width}x${expanded.height}`,
        'Core'
      );
      this.contentBounds = expanded;
      return { hasContent: true, boundsChanged: true };
    }

    return { hasContent: true, boundsChanged: false };
  }

  loadRom(romPath: string): void {
    // Read the ROM file
    try {
      this.romData = readFileSync(romPath);
    } catch (err) {
      throw new LibretroError('ROM_READ_FAILED', romPath);
    }

    // Clear recent logs to get fresh messages for this load attempt
    this.envHandler.clearRecentLogs();

    // Load the game into the core
    const success = this.api.loadGame(romPath, this.romData, null);
    if (!success) {
      // Log diagnostic info to help debug ROM rejection
      const coreInfo = this.api.getSystemInfo();
      const romExt = extname(romPath).toLowerCase();
      const romSize = this.romData.length;
      const systemDir = this.envHandler.getSystemDirectory();

      // Log diagnostic details (the error message itself will be logged when caught)
      logger.error(`Core: ${coreInfo.library_name} ${coreInfo.library_version}`, 'Core');
      logger.error(`ROM extension: ${romExt}`, 'Core');
      logger.error(`Valid extensions: ${coreInfo.valid_extensions || '(none reported)'}`, 'Core');
      logger.error(`ROM size: ${romSize.toLocaleString()} bytes`, 'Core');
      logger.error(`System directory: ${systemDir}`, 'Core');

      // Include any log messages from the core (already formatted)
      const coreLogs = this.envHandler.getRecentLogsFormatted();
      for (const log of coreLogs) {
        // These are already formatted as [LEVEL] [Core] message, log raw
        console.error(log);
      }

      throw new LibretroError('ROM_REJECTED', romPath);
    }

    this.gameLoaded = true;

    // Update system info with actual AV info from the core
    try {
      const avInfo = this.api.getSystemAVInfo();
      this.systemInfo.width = avInfo.geometry.base_width;
      this.systemInfo.height = avInfo.geometry.base_height;
      this.systemInfo.fps = avInfo.timing.fps;
      this.systemInfo.sampleRate = avInfo.timing.sample_rate || DEFAULT_SAMPLE_RATE;

      // Store original display aspect ratio for use when cropping
      // This is the intended display aspect (e.g., 4:3 for N64) regardless of actual frame dimensions
      if (avInfo.geometry.aspect_ratio > 0) {
        this.originalDisplayAspect = avInfo.geometry.aspect_ratio;
      } else {
        this.originalDisplayAspect = avInfo.geometry.base_width / avInfo.geometry.base_height;
      }

      // Calculate pixel aspect ratio if provided
      if (avInfo.geometry.aspect_ratio > 0) {
        // aspect_ratio is display aspect ratio (e.g., 4:3)
        // pixelAspectRatio = display_aspect / pixel_aspect
        // pixel_aspect = width / height
        const pixelAspect =
          avInfo.geometry.base_width / avInfo.geometry.base_height;
        this.systemInfo.pixelAspectRatio =
          avInfo.geometry.aspect_ratio / pixelAspect;
      }

      // Log core geometry info (RetroArch-style)
      const aspectStr = avInfo.geometry.aspect_ratio > 0
        ? avInfo.geometry.aspect_ratio.toFixed(ASPECT_RATIO_DECIMALS)
        : (avInfo.geometry.base_width / avInfo.geometry.base_height).toFixed(ASPECT_RATIO_DECIMALS);
      logger.info(
        `Geometry: ${avInfo.geometry.base_width}x${avInfo.geometry.base_height}, ` +
        `Aspect: ${aspectStr}, FPS: ${avInfo.timing.fps.toFixed(FPS_DECIMALS)}, ` +
        `Sample rate: ${this.systemInfo.sampleRate.toFixed(FPS_DECIMALS)} Hz`,
        'Core'
      );
    } catch {
      // Use defaults if AV info fails
    }

    // Set up controller ports using the best available controller type from the core
    // Device type selection priority:
    // 1. Device subtypes (id >= 256) - core-specific controllers like N64Pad (257)
    // 2. Standard JOYPAD (id=1) - works for most cores (SNES, Genesis, etc.)
    // 3. First available type - fallback
    // This avoids selecting Mouse (2), Keyboard (3), etc. over JOYPAD
    const DEVICE_SUBTYPE_THRESHOLD = 256;
    for (let port = 0; port < 2; port++) {
      const types = this.envHandler.getControllerTypes(port);
      if (types.length === 0) {
        // No controller info from core, use default JOYPAD
        this.api.retro_set_controller_port_device(port, RETRO_DEVICE.JOYPAD);
        logger.debug(`Controller port ${port} set to device ${RETRO_DEVICE.JOYPAD} (JOYPAD)`, 'Core');
        continue;
      }
      // Prefer device subtypes (like N64Pad=257), then JOYPAD, then first available
      const subtypeController = types.find(t => t.id >= DEVICE_SUBTYPE_THRESHOLD);
      const joypadController = types.find(t => t.id === RETRO_DEVICE.JOYPAD);
      const selectedType = subtypeController ?? joypadController ?? types[0];
      this.api.retro_set_controller_port_device(port, selectedType.id);
      logger.debug(`Controller port ${port} set to device ${selectedType.id} (${selectedType.desc})`, 'Core');
    }

    // Cache pixel format (set by core during init/load via SET_PIXEL_FORMAT)
    this.cachedPixelFormat = this.envHandler.getPixelFormat();
  }

  reset(): void {
    if (this.gameLoaded) {
      this.api.retro_reset();
    }
  }

  destroy(): void {
    if (this.gameLoaded) {
      this.api.retro_unload_game();
      this.gameLoaded = false;
    }
    this.api.retro_deinit();
    this.callbacks.destroy();
    this.envHandler.cleanup();
    this.api.destroy();
    this.romData = null;
  }

  //==========================================================================
  // Emulation
  //==========================================================================

  // Debug: track frame count
  private runFrameCount = 0;

  runFrame(): void {
    if (!this.gameLoaded) {return;}

    // Increment frame ID to invalidate any cached framebuffer from previous frame
    this.currentFrameId++;

    // Debug: Log initial frames with timing
    this.runFrameCount++;
    const startTime = performance.now();

    // Run one frame
    this.api.retro_run();

    if (this.runFrameCount <= DEBUG_INITIAL_FRAME_LOG_COUNT) {
      const elapsed = performance.now() - startTime;
      logger.debug(`runFrame() frame ${this.runFrameCount}: took ${elapsed.toFixed(2)}ms`, 'Core');
    }

    // Push audio samples if callback is set
    if (this.audioCallback && this.callbacks.hasAudio()) {
      const samples = this.callbacks.drainAudio();
      this.audioCallback(samples);
    }
  }

  isFrameComplete(): boolean {
    // libretro cores always complete one frame per retro_run()
    return true;
  }

  //==========================================================================
  // Video Output
  //==========================================================================

  getFramebuffer(): Uint8Array {
    const fb = this.callbacks.framebuffer;
    if (!fb) {
      // Return empty framebuffer
      const info = this.getSystemInfo();
      return new Uint8Array(info.width * info.height * RGB24_BYTES_PER_PIXEL);
    }

    // Check if we have a cached RGB24 framebuffer from bounds detection (same frame)
    // This avoids expensive double conversion during periodic bounds checks
    if (this.cachedRgb24Framebuffer && this.cachedRgb24FrameId === this.currentFrameId) {
      if (!this.contentBounds) {
        // No cropping needed - return cached buffer directly
        return this.cachedRgb24Framebuffer;
      }
      // Cropping needed - extract the region from cached buffer
      return this.cropRgb24Framebuffer(
        this.cachedRgb24Framebuffer,
        this.callbacks.frameWidth,
        this.contentBounds
      );
    }

    // No cache available - convert from native format
    // Apply cropping during conversion (more efficient than converting then cropping)
    const bounds = this.contentBounds ? {
      top: this.contentBounds.top,
      left: this.contentBounds.left,
      width: this.contentBounds.width,
      height: this.contentBounds.height,
    } : undefined;

    return convertFramebuffer(
      fb,
      this.callbacks.frameWidth,
      this.callbacks.frameHeight,
      this.callbacks.framePitch,
      this.cachedPixelFormat,
      bounds
    );
  }

  /**
   * Crop an RGB24 framebuffer to the specified bounds.
   * Used to extract content region from cached full-frame buffer.
   * Uses a reusable buffer to avoid per-frame allocations.
   */
  private cropRgb24Framebuffer(
    source: Uint8Array,
    sourceWidth: number,
    bounds: ContentBounds
  ): Uint8Array {
    const { top, left, width, height } = bounds;
    const outputSize = width * height * RGB24_BYTES_PER_PIXEL;

    // Reuse buffer if possible, otherwise allocate
    if (!this.cropOutputBuffer || this.cropOutputCapacity < outputSize) {
      this.cropOutputCapacity = outputSize;
      this.cropOutputBuffer = new Uint8Array(outputSize);
    }

    const output = this.cropOutputBuffer;
    for (let y = 0; y < height; y++) {
      const srcRow = (top + y) * sourceWidth + left;
      const srcOffset = srcRow * RGB24_BYTES_PER_PIXEL;
      const dstOffset = y * width * RGB24_BYTES_PER_PIXEL;
      output.set(
        source.subarray(srcOffset, srcOffset + width * RGB24_BYTES_PER_PIXEL),
        dstOffset
      );
    }

    return output.subarray(0, outputSize);
  }

  /**
   * Quick check if framebuffer appears uniform (all same color).
   * Samples bytes across the buffer to detect blank frames without
   * expensive RGB24 conversion. Used to skip bounds detection on blank frames.
   */
  private isFramebufferUniform(fb: Uint8Array): boolean {
    // Sample 32 positions across the buffer, comparing 4 bytes at each position
    // (4 bytes covers all pixel formats: XRGB8888=4, RGB565=2, RGB555=2)
    const SAMPLE_COUNT = 32;
    const BYTES_PER_SAMPLE = 4;
    const step = Math.max(1, Math.floor(fb.length / SAMPLE_COUNT));

    // Compare against first pixel's bytes
    const ref0 = fb[0];
    const ref1 = fb[1];
    const ref2 = fb[2];
    const ref3 = fb[3];

    for (let i = step; i < fb.length - BYTES_PER_SAMPLE; i += step) {
      // Compare 4 bytes at this position against reference
      const mismatch = fb[i] !== ref0 || fb[i + 1] !== ref1 ||
        fb[i + 2] !== ref2 || fb[i + BYTES_PER_SAMPLE - 1] !== ref3;
      if (mismatch) {
        return false; // Found variation
      }
    }

    return true; // All samples matched - likely blank frame
  }

  //==========================================================================
  // Audio Output
  //==========================================================================

  getAudioConfig(): AudioConfig {
    return {
      sampleRate: this.systemInfo.sampleRate,
      channels: 2, // libretro is always stereo
    };
  }

  setAudioCallback(callback: ((samples: Float32Array) => void) | null): void {
    this.audioCallback = callback;
  }

  /**
   * Set audio enable flag
   * Tells the core whether to generate audio samples via GET_AUDIO_VIDEO_ENABLE
   */
  setAudioEnabled(enabled: boolean): void {
    this.envHandler.setAudioEnabled(enabled);
  }

  /**
   * Set message callback for core notifications (e.g., "State saved", "Disk inserted")
   */
  setMessageCallback(callback: CoreMessageCallback | null): void {
    if (!callback) {
      this.envHandler.setMessageCallback(null);
      return;
    }

    // Adapter: convert libretro RetroMessageExt to CoreMessage
    this.envHandler.setMessageCallback((retroMsg) => {
      // Map libretro message type to CoreMessage type
      let type: CoreMessage['type'] = 'notification';
      if (retroMsg.type === RETRO_MESSAGE_TYPE.STATUS) {
        type = 'status';
      } else if (retroMsg.type === RETRO_MESSAGE_TYPE.PROGRESS) {
        type = 'progress';
      }

      // Map libretro severity level to MessageSeverity
      let severity: MessageSeverity = 'info';
      switch (retroMsg.level) {
        case RETRO_LOG.DEBUG: severity = 'debug'; break;
        case RETRO_LOG.WARN: severity = 'warn'; break;
        case RETRO_LOG.ERROR: severity = 'error'; break;
      }

      const coreMsg: CoreMessage = {
        msg: retroMsg.msg,
        duration: retroMsg.duration,
        priority: retroMsg.priority,
        type,
        progress: retroMsg.progress,
        severity,
      };

      callback(coreMsg);
    });
  }

  //==========================================================================
  // Input
  //==========================================================================

  setButtonState(port: number, button: number, pressed: boolean): void {
    this.callbacks.setButtonState(port, button, pressed);
  }

  getButtonState(port: number): Map<number, boolean> {
    return this.callbacks.getButtonState(port);
  }

  /**
   * Set analog stick axis value.
   * @param port - Controller port (0-based)
   * @param index - Analog stick (0=left, 1=right from RETRO_DEVICE_INDEX_ANALOG)
   * @param axis - Axis (0=X, 1=Y from RETRO_DEVICE_ID_ANALOG)
   * @param value - Analog value from -32768 to 32767 (or -1.0 to 1.0 normalized)
   */
  setAnalogState(port: number, index: number, axis: number, value: number): void {
    // If value is in approximate normalized range, convert to int16
    // We use a threshold > 1.0 to handle floating-point precision issues at boundaries
    // (e.g., -32768/32767 = -1.00003 which is slightly outside -1 to 1)
    const int16Value = Math.abs(value) <= ANALOG_NORMALIZED_THRESHOLD ? Math.round(value * INT16_MAX_POSITIVE) : value;
    this.callbacks.setAnalogState(port, index, axis, int16Value);
  }

  /**
   * Get all analog states for a port.
   * Returns a map of "index.axis" -> value (e.g., "0.0" for left stick X)
   */
  getAnalogStates(port: number): Map<string, number> {
    return this.callbacks.getAnalogStates(port);
  }

  //==========================================================================
  // State Management
  //==========================================================================

  /**
   * Get raw binary state data (RetroArch-compatible format).
   * Always returns a fresh buffer safe to retain (save states).
   */
  getState(): Buffer | null {
    return this.getStateInto(null);
  }

  /**
   * Serialize state into a reusable buffer (see Core.getStateInto).
   * Avoids a fresh allocation per frame on the netplay hot path.
   */
  getStateInto(target: Buffer | null): Buffer | null {
    if (!this.gameLoaded) {
      throw new LibretroError('NO_GAME_LOADED');
    }

    const size = this.api.retro_serialize_size();
    if (size === 0) {
      // Core doesn't support save states
      return null;
    }

    const buffer = target !== null && target.length >= size
      ? target.subarray(0, size)
      : Buffer.allocUnsafe(size);
    const success = this.api.retro_serialize(buffer, size);

    return success ? buffer : null;
  }

  /**
   * Get a view of the core's system/work RAM (see Core.getSystemRam).
   * Returns null when the core doesn't expose RETRO_MEMORY_SYSTEM_RAM.
   */
  getSystemRam(): Uint8Array | null {
    if (!this.gameLoaded) {
      return null;
    }
    return this.api.getMemoryData(RETRO_MEMORY.SYSTEM_RAM);
  }

  /**
   * Restore state from raw binary data (RetroArch-compatible format).
   */
  setState(state: Buffer): void {
    if (!this.gameLoaded) {
      throw new LibretroError('NO_GAME_LOADED');
    }

    const success = this.api.retro_unserialize(state, state.length);

    if (!success) {
      throw new LibretroError('STATE_LOAD_FAILED');
    }
  }

  //==========================================================================
  // Battery/SRAM
  //==========================================================================

  hasBatterySave(): boolean {
    if (!this.gameLoaded) {return false;}

    // Check standard API first
    const size = this.api.retro_get_memory_size(RETRO_MEMORY.SAVE_RAM);
    if (size > 0) {return true;}

    // Fall back to memory map SRAM (for cores like bsnes)
    const memMapSram = this.envHandler.getMemoryMapSram();
    return memMapSram !== null && memMapSram.size > 0;
  }

  getBatteryRam(): Uint8Array | null {
    if (!this.gameLoaded) {return null;}

    // Try standard API first
    const stdData = this.api.getMemoryData(RETRO_MEMORY.SAVE_RAM);
    if (stdData) {return stdData;}

    // Fall back to memory map SRAM (for cores like bsnes)
    const memMapSram = this.envHandler.getMemoryMapSram();
    if (!memMapSram || !memMapSram.ptr) {return null;}

    // Read from memory map pointer using koffi.view
    const arrayBuffer = koffi.view(memMapSram.ptr, memMapSram.size) as ArrayBuffer;
    const view = new Uint8Array(arrayBuffer);

    // Copy to a new buffer
    const result = new Uint8Array(memMapSram.size);
    result.set(view);
    return result;
  }

  setBatteryRam(data: Uint8Array): void {
    if (!this.gameLoaded) {return;}

    // Try standard API first
    const size = this.api.retro_get_memory_size(RETRO_MEMORY.SAVE_RAM);
    if (size > 0) {
      this.api.setMemoryData(RETRO_MEMORY.SAVE_RAM, data);
      return;
    }

    // Fall back to memory map SRAM (for cores like bsnes)
    const memMapSram = this.envHandler.getMemoryMapSram();
    if (!memMapSram || !memMapSram.ptr) {return;}

    // Write to memory map pointer using koffi.view
    const copySize = Math.min(data.length, memMapSram.size);
    const arrayBuffer = koffi.view(memMapSram.ptr, copySize) as ArrayBuffer;
    const target = new Uint8Array(arrayBuffer);
    target.set(data.subarray(0, copySize));
  }

  //==========================================================================
  // Core Options
  //==========================================================================

  /**
   * Set a core option value at runtime.
   * Uses RetroArch-compatible key format (e.g., "mupen64plus-rdp-plugin").
   * Changes take effect on the next frame.
   */
  setCoreOption(key: string, value: string): void {
    this.envHandler.setCoreOption(key, value);
  }

  /**
   * Set multiple core options at once.
   * @param options Record of key-value pairs in RetroArch format
   */
  setCoreOptions(options: Record<string, string>): void {
    this.envHandler.setCoreOptions(options);
  }

  /**
   * Get the current value of a core option.
   * Returns the user-configured value, or the default if not set.
   */
  getCoreOption(key: string): string | undefined {
    return this.envHandler.getCoreOption(key);
  }

  /**
   * Get all configured core options.
   */
  getCoreOptions(): Map<string, string> {
    return this.envHandler.getCoreOptions();
  }

  /**
   * Get available core option definitions (reported by the core).
   * Each definition includes the key, description, valid values, and default.
   */
  getAvailableCoreOptions(): Array<{
    key: string;
    description: string;
    values: string[];
    defaultValue: string;
    currentValue: string | undefined;
  }> {
    const defs = this.envHandler.getCoreOptionDefs();
    return Array.from(defs.values()).map(def => ({
      key: def.key,
      description: def.description,
      values: def.values,
      defaultValue: def.defaultValue,
      currentValue: this.envHandler.getCoreOption(def.key),
    }));
  }

  /**
   * Check if a core option exists.
   */
  hasCoreOption(key: string): boolean {
    return this.envHandler.hasCoreOption(key);
  }

  /**
   * Clear all user-configured core options (revert to defaults).
   */
  clearCoreOptions(): void {
    this.envHandler.clearCoreOptions();
  }
}

export { LibretroAPI } from "./api";
export { EnvironmentHandler } from "./environment";
export { CallbackManager } from "./callbacks";
export * from "./types";
export * from "./consts";
export {
  registerLibretroCore,
  unloadLibretroCore,
  isInUserCoresDirectory,
} from "./loader";
export {
  loadCoreOptions,
  saveCoreOptions,
  saveCoreSpecificOptions,
  getDefaultCoreOptionsPath,
  getCoreSpecificOptionsPath,
  getGameSpecificOptionsPath,
  getDefaultCoreOptions,
  DEFAULT_CORE_OPTIONS,
} from "./coreOptions";
