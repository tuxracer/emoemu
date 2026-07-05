/**
 * Core Interface Definitions
 *
 * Defines the interface that all system emulator cores must implement.
 * This enables a multi-core architecture similar to libretro where
 * different gaming systems can share common infrastructure.
 */

/**
 * Button definition for input mapping
 */
export interface ButtonDefinition {
  /** Button ID (0-based index used in setButtonState) */
  id: number;

  /** Display name (e.g., "A", "Start", "L") */
  name: string;

  /** Suggested keyboard key */
  defaultKey: string;

  /** Suggested gamepad button */
  defaultGamepad: string;
}

/**
 * System information describing a core's capabilities and requirements.
 * This is used by the frontend to configure rendering, audio, and input.
 */
export interface SystemInfo {
  /** Unique identifier (e.g., "nes", "gba") */
  id: string;

  /** Human-readable name (e.g., "Nintendo Entertainment System") */
  name: string;

  /** File extensions this core handles (e.g., [".nes", ".unf"]) */
  extensions: string[];

  /** Native framebuffer width in pixels */
  width: number;

  /** Native framebuffer height in pixels */
  height: number;

  /** Target frames per second (e.g., 60.0988 for NES NTSC) */
  fps: number;

  /** Preferred audio sample rate in Hz */
  sampleRate: number;

  /** Pixel aspect ratio for correct display (e.g., 8/7 for NES) */
  pixelAspectRatio: number;

  /** Maximum number of controller ports */
  maxPlayers: number;

  /** Button definitions for this system */
  buttons: ButtonDefinition[];

  /**
   * Framebuffer color format:
   * - 'rgb15': Uint16Array of 15-bit RGB (xBBBBBGGGGGRRRRR)
   * - 'rgb24': Uint8Array of RGB triplets
   */
  colorSpace: 'rgb15' | 'rgb24';

  /** Core name for netplay (e.g., "PicoDrive") - defaults to name if not set */
  coreName?: string;

  /** Core version for netplay (e.g., "2.05-3365b17") */
  coreVersion?: string;
}

/**
 * Audio configuration returned by the core
 */
export interface AudioConfig {
  /** Sample rate in Hz */
  sampleRate: number;

  /** Number of audio channels (1 = mono, 2 = stereo) */
  channels: 1 | 2;
}

/**
 * Severity/importance of a user-facing message.
 * Values align with libretro SET_MESSAGE_EXT severity levels.
 */
export type MessageSeverity = 'debug' | 'info' | 'warn' | 'error';

/**
 * Message from core to frontend for display to user
 */
export interface CoreMessage {
  /** Message text */
  msg: string;

  /** Duration in milliseconds (0 = use default) */
  duration: number;

  /** Priority (higher = more important, displaces lower priority messages) */
  priority: number;

  /** Message type: 'notification' | 'status' | 'progress' */
  type: 'notification' | 'status' | 'progress';

  /** Progress value: -1 = indeterminate, 0-100 = percentage (for type='progress') */
  progress: number;

  /** Severity/importance of the message (default: 'info') */
  severity: MessageSeverity;
}

/** Callback for receiving core messages */
export type CoreMessageCallback = (message: CoreMessage) => void;

/**
 * Main Core interface that all system emulators must implement.
 *
 * The lifecycle is:
 * 1. Construct the core
 * 2. Call getSystemInfo() to get capabilities
 * 3. Call loadRom() to load a game
 * 4. Optionally call setState() to restore a save state
 * 5. Call reset() if starting fresh (skipped if restoring state)
 * 6. Main loop: runFrame(), getFramebuffer(), render
 * 7. Call destroy() when done
 */
export interface Core {
  //==========================================================================
  // Lifecycle
  //==========================================================================

  /**
   * Get system information describing the core's capabilities.
   * Can be called before loadRom() to determine if this core handles a ROM.
   */
  getSystemInfo(): SystemInfo;

  /**
   * Load a ROM/game file.
   * @param romPath Path to the ROM file
   * @throws Error if ROM is invalid or unsupported
   */
  loadRom(romPath: string): void;

  /**
   * Reset the emulated system to power-on state.
   * Should be called after loadRom() unless restoring a save state.
   */
  reset(): void;

  /**
   * Clean up resources (close files, release audio, etc.).
   * Called before destroying the core instance.
   */
  destroy(): void;

  //==========================================================================
  // Emulation
  //==========================================================================

  /**
   * Run emulation for one frame.
   * Updates the framebuffer and generates audio samples via callback.
   */
  runFrame(): void;

  /**
   * Check if the core completed a frame.
   * Useful for cores with variable-rate timing.
   */
  isFrameComplete(): boolean;

  //==========================================================================
  // Video Output
  //==========================================================================

  /**
   * Get the current framebuffer.
   * Format depends on SystemInfo.colorSpace:
   * - 'rgb15': Uint16Array of 15-bit RGB values
   * - 'rgb24': Uint8Array of RGB triplets
   */
  getFramebuffer(): Uint8Array | Uint16Array;

  //==========================================================================
  // Audio Output
  //==========================================================================

  /**
   * Get audio configuration (sample rate, channels).
   */
  getAudioConfig(): AudioConfig;

  /**
   * Set callback for audio sample output.
   * The core calls this callback when audio samples are ready.
   * @param callback Function to receive Float32Array of samples, or null to disable
   */
  setAudioCallback(callback: ((samples: Float32Array) => void) | null): void;

  /**
   * Set audio enable flag (optional).
   * Tells the core whether to generate audio samples, allowing cores to
   * skip audio processing when muted. Not all cores implement this.
   * @param enabled Whether audio generation is enabled
   */
  setAudioEnabled?(enabled: boolean): void;

  /**
   * Set message callback for core notifications (optional).
   * Receives messages like "State saved", "Disk inserted", etc.
   * @param callback Function to receive messages, or null to disable
   */
  setMessageCallback?(callback: CoreMessageCallback | null): void;

  //==========================================================================
  // Input
  //==========================================================================

  /**
   * Set button state for a controller.
   * @param port Controller port (0-based, up to maxPlayers-1)
   * @param button Button ID from SystemInfo.buttons
   * @param pressed Whether the button is currently pressed
   */
  setButtonState(port: number, button: number, pressed: boolean): void;

  /**
   * Get current button state for a controller (for status display).
   * @param port Controller port (0-based)
   * @returns Map of button ID to pressed state
   */
  getButtonState(port: number): Map<number, boolean>;

  /**
   * Set analog stick axis value (optional - only for cores that support analog input).
   * @param port Controller port (0-based)
   * @param index Analog stick (0=left, 1=right)
   * @param axis Axis (0=X, 1=Y)
   * @param value Normalized value from -1.0 to 1.0 (or raw int16)
   */
  setAnalogState?(port: number, index: number, axis: number, value: number): void;

  //==========================================================================
  // State Management
  //==========================================================================

  /**
   * Serialize the current emulation state for saving.
   * Returns raw binary data that can be written directly to a file.
   */
  getState(): Buffer | null;

  /**
   * Serialize the current emulation state into a reusable buffer.
   * If `target` is large enough it is filled and returned (as a view of
   * the state's exact size); otherwise a new buffer is allocated. Lets
   * per-frame callers (netplay rollback) avoid an allocation per frame.
   * The returned buffer is only valid until the next call with the same
   * target — copy it if it must outlive the next frame.
   */
  getStateInto?(target: Buffer | null): Buffer | null;

  /**
   * Get a view of the core's system/work RAM, if exposed. The returned
   * view aliases live core memory — copy it before running another frame.
   * Netplay hashes this instead of the full savestate for desync checks:
   * game logic lives here, while savestates can contain volatile bytes
   * that some cores normalize on load.
   */
  getSystemRam?(): Uint8Array | null;

  /**
   * Restore emulation state from a previous save.
   * @param state Raw binary state data
   * @throws Error if state is invalid
   */
  setState(state: Buffer): void;

  //==========================================================================
  // Battery/SRAM (Optional - for games with save functionality)
  //==========================================================================

  /**
   * Check if the current game has battery-backed save data.
   * @returns true if the game supports saving to SRAM
   */
  hasBatterySave(): boolean;

  /**
   * Get battery-backed RAM contents for saving to disk.
   * @returns SRAM data or null if not supported
   */
  getBatteryRam(): Uint8Array | null;

  /**
   * Load battery-backed RAM from disk.
   * @param data SRAM data to restore
   */
  setBatteryRam(data: Uint8Array): void;
}

/** Type alias for framebuffer data */
export type FrameBuffer = Uint8Array | Uint16Array;

/** Narrows a framebuffer to Uint16Array when colorSpace is 'rgb15' */
export const isRgb15Buffer = (
  colorSpace: 'rgb15' | 'rgb24',
  _buffer: FrameBuffer,
): _buffer is Uint16Array => colorSpace === 'rgb15';

/** Narrows a framebuffer to Uint8Array when colorSpace is 'rgb24' */
export const isRgb24Buffer = (
  colorSpace: 'rgb15' | 'rgb24',
  _buffer: FrameBuffer,
): _buffer is Uint8Array => colorSpace === 'rgb24';
