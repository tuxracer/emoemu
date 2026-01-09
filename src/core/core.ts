/**
 * Core Interface Definitions
 *
 * Defines the interface that all system emulator cores must implement.
 * This enables a multi-core architecture similar to libretro where
 * different gaming systems (NES, GBA, etc.) can share common infrastructure.
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
   * - 'palette': Uint8Array of palette indices (use palette field for colors)
   * - 'rgb15': Uint16Array of 15-bit RGB (xBBBBBGGGGGRRRRR)
   * - 'rgb24': Uint8Array of RGB triplets
   */
  colorSpace: 'palette' | 'rgb15' | 'rgb24';

  /** For palette mode: RGB triplets (e.g., 64×3 = 192 bytes for NES) */
  palette?: Uint8Array;
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
 * Serialized state for save/load operations.
 * The data field is opaque to the frontend - only the core understands its format.
 */
export interface CoreState {
  /** State format version (for migration/compatibility) */
  version: number;

  /** Core identifier (validates correct core) */
  coreId: string;

  /** Game identifier (ROM path or checksum) */
  gameId: string;

  /** Serialized state data (opaque to frontend) */
  data: Record<string, unknown>;
}

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
   * - 'palette': Uint8Array of palette indices
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

  //==========================================================================
  // State Management
  //==========================================================================

  /**
   * Serialize the current emulation state for saving.
   * @returns CoreState object that can be JSON-serialized
   */
  getState(): CoreState;

  /**
   * Restore emulation state from a previous save.
   * @param state Previously saved CoreState
   * @throws Error if state is incompatible (wrong core, version, etc.)
   */
  setState(state: CoreState): void;

  /**
   * Get the current state format version.
   * Used for compatibility checking before attempting to load.
   */
  getStateVersion(): number;

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
