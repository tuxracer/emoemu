import { readFileSync, writeFileSync, existsSync } from 'fs';
import { gzipSync, gunzipSync, constants } from 'zlib';
import { Controller, Button } from './input/controller.js';
import { InputManager } from './input/input-manager.js';
import { GamepadManager } from './input/gamepad-manager.js';
import { TerminalRenderer } from './rendering/renderer.js';
import { KittyRenderer } from './rendering/kitty-renderer.js';
import type { Core, CoreState, SystemInfo } from './core/core.js';
import type { CoreFactory } from './frontend/core-registry.js';
import pkg from 'audify';
const { RtAudio, RtAudioFormat } = pkg;

export interface SaveState {
  version: number;
  romPath: string;
  coreState: CoreState;
  frameCount: number;
}

export type RenderMode = 'terminal' | 'kitty' | 'ascii' | 'emoji';

// Common renderer interface
interface Renderer {
  render(frameBuffer: Uint8Array): string;
  renderRgb15?(frameBuffer: Uint16Array): string;  // For RGB15 cores (GBC, GBA)
  clearScreen(): string;
  hideCursor(): string;
  showCursor(): string;
  getStatusRow(): number;
  moveCursorToRow(row: number): string;
  setDimensions?(width: number, height: number): void;
}

export interface EmulatorOptions {
  romPath: string;
  coreFactory: CoreFactory;  // Core factory for creating the emulator core
  width?: number;
  height?: number;
  useColor?: boolean;
  renderMode?: RenderMode;
  scale?: number;  // For Kitty renderer
  enableGamepad?: boolean;  // Enable gamepad/controller support
  enableAudio?: boolean;  // Enable audio output (default: true)
  showStatusBar?: boolean;  // Show status bar (default: true)
}

// Calculate optimal dimensions for terminal/ASCII/emoji rendering
// sourceWidth/sourceHeight: core framebuffer dimensions
// pixelAspectRatio: PAR for the core (e.g., 8/7 for NES, 1.0 for GBC)
function calculateTerminalDimensions(
  mode: 'terminal' | 'ascii' | 'emoji',
  sourceWidth: number = 256,
  sourceHeight: number = 240,
  pixelAspectRatio: number = 8 / 7
): { width: number; height: number } {
  const termCols = process.stdout.columns || 80;
  const termRows = process.stdout.rows || 24;

  // Leave 2 rows for status line
  const availableRows = termRows - 2;

  // Calculate display aspect ratio from source dimensions and PAR
  // displayAspect = (sourceWidth * PAR) / sourceHeight
  const displayAspect = (sourceWidth * pixelAspectRatio) / sourceHeight;

  // Terminal cells are roughly 1:2 (width:height), so we multiply by 2 below
  // to compensate when calculating character columns from pixel dimensions

  if (mode === 'emoji') {
    // Emoji: 1 emoji = 1 pixel, each emoji is 2 terminal columns wide
    // Emojis appear roughly square (2 cols × 1 row ≈ square due to cell aspect)
    // width / height = displayAspect
    let height = availableRows;
    let width = Math.floor(height * displayAspect);
    const displayCols = width * 2; // Actual terminal columns needed

    if (displayCols > termCols) {
      width = Math.floor(termCols / 2);
      height = Math.floor(width / displayAspect);
    }

    return { width, height };
  } else if (mode === 'ascii') {
    // ASCII: 1 char = 1 pixel
    // To maintain display aspect, account for cell aspect ratio
    // displayAspect = (cols * cellWidth) / (rows * cellHeight)
    // displayAspect = cols / (rows * 2) => cols = rows * 2 * displayAspect
    let height = availableRows;
    let width = Math.floor(height * 2 * displayAspect);

    if (width > termCols) {
      width = termCols;
      height = Math.floor(width / (2 * displayAspect));
    }

    return { width, height };
  } else {
    // Terminal half-block mode: 1 char = 1x2 pixels
    // Each half-block character covers 2 vertical pixels
    // displayAspect = (cols * cellWidth) / ((rows * 2) * cellHeight)
    // With cellAspect = 0.5: displayAspect = cols / (rows * 4)
    // But half-blocks double vertical resolution: cols = rows * 2 * displayAspect
    let height = availableRows;
    let width = Math.floor(height * 2 * displayAspect);

    if (width > termCols) {
      width = termCols;
      height = Math.floor(width / (2 * displayAspect));
    }

    return { width, height };
  }
}

export class Emulator {
  private core: Core;
  private systemInfo: SystemInfo;
  private controller1: Controller;
  private controller2: Controller;
  private inputManager: InputManager;
  private gamepadManager: GamepadManager | null = null;
  private renderer: Renderer;
  private renderMode: RenderMode;
  private rtAudio: InstanceType<typeof RtAudio> | null = null;
  private audioEnabled: boolean = true;
  private autoResize: boolean = false; // Whether to handle terminal resize events
  private showStatusBar: boolean = true;
  private romPath: string;

  private running: boolean = false;
  private frameCount: number = 0;
  private lastFrameTime: number = 0;
  private targetFrameTime: number; // Set based on core's FPS
  private resizeHandler: (() => void) | null = null;
  private inputHandler: ((key: string) => void) | null = null;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly AUTO_SAVE_INTERVAL_MS = 30000; // 30 seconds (only saves if SRAM was modified)

  constructor(options: EmulatorOptions) {
    // Store ROM path for save states
    this.romPath = options.romPath;

    // Create core and load ROM
    this.core = options.coreFactory.create();
    this.systemInfo = this.core.getSystemInfo();
    this.core.loadRom(options.romPath);

    // Set target frame time based on core's FPS
    this.targetFrameTime = 1000 / this.systemInfo.fps;

    // Initialize controllers (used for NES-style input mapping)
    this.controller1 = new Controller();
    this.controller2 = new Controller();
    this.audioEnabled = options.enableAudio !== false;
    this.showStatusBar = options.showStatusBar !== false;

    // Initialize input manager with controllers
    this.inputManager = new InputManager(this.controller1, this.controller2);

    // Initialize gamepad manager if enabled (default: enabled)
    if (options.enableGamepad !== false) {
      this.gamepadManager = new GamepadManager(this.controller1, this.controller2);
    }

    // Initialize renderer based on mode
    this.renderMode = options.renderMode ?? 'kitty';

    if (this.renderMode === 'kitty') {
      this.renderer = new KittyRenderer({
        scale: options.scale,  // undefined = auto-fit to terminal
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
        colorSpace: this.systemInfo.colorSpace === 'rgb15' ? 'rgb15' : 'indexed',
      });
      // Enable auto-resize when no explicit scale is provided
      this.autoResize = options.scale === undefined;
    } else if (this.renderMode === 'emoji') {
      // Auto-size to terminal if no explicit dimensions given
      const explicitDims = options.width && options.height;
      const dims = explicitDims
        ? { width: options.width!, height: options.height! }
        : calculateTerminalDimensions('emoji', this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);
      this.autoResize = !explicitDims;
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: false,
        emojiMode: true,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
      });
    } else if (this.renderMode === 'ascii') {
      // Auto-size to terminal if no explicit dimensions given
      const explicitDims = options.width && options.height;
      const dims = explicitDims
        ? { width: options.width!, height: options.height! }
        : calculateTerminalDimensions('ascii', this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);
      this.autoResize = !explicitDims;
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: options.useColor ?? true,
        asciiMode: true,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
      });
    } else {
      // Auto-size to terminal if no explicit dimensions given
      const explicitDims = options.width && options.height;
      const dims = explicitDims
        ? { width: options.width!, height: options.height! }
        : calculateTerminalDimensions('terminal', this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);
      this.autoResize = !explicitDims;
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: options.useColor ?? true,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
      });
    }
  }

  reset(): void {
    this.core.reset();
    this.frameCount = 0;
  }

  // Run one complete frame
  runFrame(): void {
    // Sync input state from controllers to core
    this.syncInputToCore();

    // Run the core for one frame
    this.core.runFrame();

    this.frameCount++;
  }

  // Sync controller state to core's input system
  private syncInputToCore(): void {
    const buttons = this.systemInfo.buttons;

    // Map controller buttons to core buttons
    for (const buttonDef of buttons) {
      // Try to find a matching controller button
      let pressed = false;

      // Map common button names
      switch (buttonDef.name.toLowerCase()) {
        case 'a':
          pressed = this.controller1.getButton(Button.A);
          break;
        case 'b':
          pressed = this.controller1.getButton(Button.B);
          break;
        case 'start':
          pressed = this.controller1.getButton(Button.Start);
          break;
        case 'select':
          pressed = this.controller1.getButton(Button.Select);
          break;
        case 'up':
          pressed = this.controller1.getButton(Button.Up);
          break;
        case 'down':
          pressed = this.controller1.getButton(Button.Down);
          break;
        case 'left':
          pressed = this.controller1.getButton(Button.Left);
          break;
        case 'right':
          pressed = this.controller1.getButton(Button.Right);
          break;
        // GBA-specific buttons (L/R) - map to controller's optional buttons if available
        case 'l':
          // Could be mapped to a specific key
          break;
        case 'r':
          // Could be mapped to a specific key
          break;
      }

      this.core.setButtonState(0, buttonDef.id, pressed);
    }
  }

  // Render current frame to terminal
  renderFrame(): string {
    const framebuffer = this.core.getFramebuffer();

    // Convert framebuffer based on color space
    if (this.systemInfo.colorSpace === 'rgb15') {
      // Use native RGB15 rendering for all renderers that support it
      if (this.renderer.renderRgb15) {
        return this.renderer.renderRgb15(framebuffer as Uint16Array);
      } else {
        // Fallback: Convert RGB15 to palette indices (grayscale)
        return this.renderer.render(this.convertRgb15ToPalette(framebuffer as Uint16Array));
      }
    } else {
      // NES uses palette indices
      return this.renderer.render(framebuffer as Uint8Array);
    }
  }

  // Convert RGB15 framebuffer to 8-bit indexed for terminal rendering (fallback)
  private convertRgb15ToPalette(rgb15: Uint16Array): Uint8Array {
    // Create a grayscale approximation for renderers that don't support RGB15
    const width = this.systemInfo.width;
    const height = this.systemInfo.height;
    const output = new Uint8Array(width * height);

    for (let i = 0; i < rgb15.length; i++) {
      const color = rgb15[i];
      const r = (color & 0x1F) << 3;
      const g = ((color >> 5) & 0x1F) << 3;
      const b = ((color >> 10) & 0x1F) << 3;

      // Convert to grayscale luminance and map to palette index 0-63
      const lum = (r * 0.299 + g * 0.587 + b * 0.114);
      output[i] = Math.floor(lum / 4); // Map 0-255 to 0-63
    }

    return output;
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

    // Setup audio output
    if (this.audioEnabled) {
      this.setupAudio();
    }

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

    // Set up auto-save for battery-backed games (core handles its own periodic saves,
    // but this ensures saves on a timer in case of crash)
    if (this.core.hasBatterySave()) {
      this.autoSaveInterval = setInterval(() => {
        // Get and set battery RAM to trigger save through core
        const batteryRam = this.core.getBatteryRam();
        if (batteryRam) {
          this.core.setBatteryRam(batteryRam);
        }
      }, Emulator.AUTO_SAVE_INTERVAL_MS);
    }

    this.lastFrameTime = performance.now();

    const loop = (): void => {
      // Check for quit from global keyboard listener
      if (this.inputManager.shouldQuit()) {
        this.stop();
      }

      if (!this.running) {
        this.cleanup();
        return;
      }

      const now = performance.now();
      const elapsed = now - this.lastFrameTime;

      if (elapsed >= this.targetFrameTime) {
        // Update input state (no-op with true keyup, but kept for API)
        this.inputManager.update();

        // Run emulation for one frame
        this.runFrame();

        // Render to terminal (diff-based, includes cursor positioning)
        process.stdout.write(this.renderFrame());

        // Display status bar if enabled
        if (this.showStatusBar) {
          const fps = 1000 / elapsed;
          const statusRow = this.renderer.getStatusRow();
          process.stdout.write(this.renderer.moveCursorToRow(statusRow));
          process.stdout.write(this.buildStatusBar(fps));
        }

        this.lastFrameTime = now;
      }

      // Schedule next iteration
      setImmediate(loop);
    };

    loop();
  }

  stop(): void {
    this.running = false;
  }

  private setupAudio(): void {
    const audioConfig = this.core.getAudioConfig();
    const sampleRate = audioConfig.sampleRate;
    // Frame size for audio buffer (~10ms at sample rate for low latency)
    const frameSize = Math.floor(sampleRate * 0.01);
    // Buffer size in bytes (16-bit stereo = 4 bytes per sample frame)
    const frameBytes = frameSize * 2 * 2; // frameSize * 2 channels * 2 bytes

    // Fixed-size ring buffer for sample accumulation (prevents unbounded growth)
    // Size: enough for ~100ms of audio (10 frames worth at 10ms each)
    const ringBufferSize = frameSize * 10;
    const ringBuffer = new Float32Array(ringBufferSize);
    let ringWritePos = 0;
    let ringReadPos = 0;
    let ringCount = 0; // Number of samples in buffer

    // Pre-allocated output buffer for RtAudio (exact frame size required)
    const outputBuffer = Buffer.alloc(frameBytes);

    // Flow control using frameOutputCallback
    let framesWritten = 0;
    let framesPlayed = 0;
    const maxQueuedFrames = 4; // Maximum frames to buffer ahead

    // Forward declaration for writeFrame (used in callback)
    let tryWriteFrames: () => void;

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
      if (!this.running) return;

      // Log error for debugging (type codes from RtAudioErrorType enum)
      const errorTypes = ['WARNING', 'DEBUG_WARNING', 'UNSPECIFIED', 'NO_DEVICES_FOUND',
        'INVALID_DEVICE', 'MEMORY_ERROR', 'INVALID_PARAMETER', 'INVALID_USE',
        'DRIVER_ERROR', 'SYSTEM_ERROR', 'THREAD_ERROR'];
      const typeName = errorTypes[type] || `UNKNOWN(${type})`;
      console.error(`Audio error [${typeName}]: ${msg}`);

      // Attempt recovery for recoverable errors (not during recovery or shutdown)
      if (!isRecovering && this.running && type >= 3) { // Errors more severe than warnings
        isRecovering = true;
        setTimeout(() => {
          // Double-check we're still running before recovery
          if (this.running) {
            try {
              createAudio();
            } catch {
              // If recreation fails, disable audio
              this.audioEnabled = false;
            }
          }
          isRecovering = false;
        }, 100);
      }
    };

    // Function to create/recreate RtAudio
    const createAudio = () => {
      if (this.rtAudio) {
        try {
          this.rtAudio.closeStream();
        } catch {
          // Ignore cleanup errors
        }
      }

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
        'TUI-NES',
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

    createAudio();

    // Helper to write a single frame to RtAudio from ring buffer
    const writeFrame = (): boolean => {
      if (!this.rtAudio || ringCount < frameSize) return false;

      // Flow control: don't queue too many frames ahead
      const queuedFrames = framesWritten - framesPlayed;
      if (queuedFrames >= maxQueuedFrames) {
        return false; // Wait for playback to catch up
      }

      // Convert float samples to int16 stereo in output buffer
      // Read from ring buffer, duplicate mono to both channels
      for (let i = 0; i < frameSize; i++) {
        const sample = Math.max(-1, Math.min(1, ringBuffer[ringReadPos]));
        const int16 = (sample * 32767) | 0;
        const offset = i * 4; // 4 bytes per stereo sample (2 channels * 2 bytes)
        outputBuffer.writeInt16LE(int16, offset);     // Left channel
        outputBuffer.writeInt16LE(int16, offset + 2); // Right channel
        ringReadPos = (ringReadPos + 1) % ringBufferSize;
      }
      ringCount -= frameSize;

      this.rtAudio.write(outputBuffer);
      framesWritten++;
      return true;
    };

    // Try to write all available frames to RtAudio's queue
    tryWriteFrames = () => {
      while (ringCount >= frameSize && writeFrame()) {
        // Keep writing until buffer is drained or queue is full
      }
    };

    // Connect core's audio output to RtAudio
    this.core.setAudioCallback((samples: Float32Array) => {
      if (!this.rtAudio || !this.audioEnabled) return;

      // Add incoming samples to ring buffer
      for (let i = 0; i < samples.length; i++) {
        // If buffer is full, overwrite oldest samples (drop audio rather than grow)
        if (ringCount >= ringBufferSize) {
          // Advance read pointer to drop oldest sample
          ringReadPos = (ringReadPos + 1) % ringBufferSize;
          ringCount--;
        }
        ringBuffer[ringWritePos] = samples[i];
        ringWritePos = (ringWritePos + 1) % ringBufferSize;
        ringCount++;
      }

      // Write complete frames to RtAudio's queue
      tryWriteFrames();
    });
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
    };
    process.stdin.on('data', this.inputHandler);
  }

  // Cycle through render modes: kitty -> terminal -> ascii -> emoji -> kitty
  private cycleRenderMode(): void {
    const modes: RenderMode[] = ['kitty', 'terminal', 'ascii', 'emoji'];
    const currentIndex = modes.indexOf(this.renderMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];

    // Create new renderer based on mode
    if (nextMode === 'kitty') {
      this.renderer = new KittyRenderer({
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
        colorSpace: this.systemInfo.colorSpace === 'rgb15' ? 'rgb15' : 'indexed',
      });
      this.autoResize = true;
    } else if (nextMode === 'emoji') {
      const dims = calculateTerminalDimensions('emoji', this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: false,
        emojiMode: true,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
      });
      this.autoResize = true;
    } else if (nextMode === 'ascii') {
      const dims = calculateTerminalDimensions('ascii', this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: true,
        asciiMode: true,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
      });
      this.autoResize = true;
    } else {
      const dims = calculateTerminalDimensions('terminal', this.systemInfo.width, this.systemInfo.height, this.systemInfo.pixelAspectRatio);
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: true,
        sourceWidth: this.systemInfo.width,
        sourceHeight: this.systemInfo.height,
      });
      this.autoResize = true;
    }

    this.renderMode = nextMode;

    // Clear screen for new renderer
    process.stdout.write(this.renderer.clearScreen());
  }

  private buildStatusBar(fps: number): string {
    const parts: string[] = [];

    // FPS
    parts.push(`FPS: ${fps.toFixed(1)}`);

    // Render mode (with shortcut hint)
    parts.push(`Render: ${this.renderMode} [R]`);

    // Audio status
    parts.push(`Audio: ${this.audioEnabled ? 'on' : 'off'}`);

    // Input mode - gamepad takes priority if connected
    const gamepadStatus = this.gamepadManager?.getPlayer1Status();
    const inputMode = gamepadStatus ?? (this.inputManager.isKittyMode() ? 'kitty' : 'legacy');
    parts.push(`Input: ${inputMode}`);

    // Current button presses
    const buttons = this.controller1.getPressedButtons();
    parts.push(`Buttons: ${buttons}`);

    // Build the status line and clear to end of line
    return parts.join(' | ') + '\x1b[K';
  }

  private cleanup(): void {
    // Clear auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Save state on exit (must happen before destroy)
    this.saveState();

    // Destroy core (handles battery-backed RAM save)
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

    // Clear Kitty graphics if using Kitty renderer
    if (this.renderMode === 'kitty') {
      process.stdout.write(this.renderer.clearScreen());
    }

    process.stdout.write(this.renderer.showCursor());
    process.stdout.write('\n');

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    console.log(`Emulation stopped. Total frames: ${this.frameCount}`);

    // Force exit - native audio module may keep handles open
    process.exit(0);
  }

  // Expose controller for external input handling
  getController(port: 1 | 2): Controller {
    return port === 1 ? this.controller1 : this.controller2;
  }

  // Get current frame buffer for external rendering
  getFrameBuffer(): Uint8Array | Uint16Array {
    return this.core.getFramebuffer();
  }

  // Save state management
  private static readonly SAVE_STATE_VERSION = 2;

  /**
   * Get the path for the save state file
   */
  private getStatePath(): string {
    // Append .state to the full ROM filename
    return this.romPath + '.state';
  }

  /**
   * Check if a save state exists for this ROM
   */
  hasSavedState(): boolean {
    return existsSync(this.getStatePath());
  }

  /**
   * Get the full emulator state for saving
   */
  getState(): SaveState {
    return {
      version: Emulator.SAVE_STATE_VERSION,
      romPath: this.romPath,
      coreState: this.core.getState(),
      frameCount: this.frameCount,
    };
  }

  /**
   * Restore emulator state from a save state
   */
  setState(state: SaveState): void {
    this.core.setState(state.coreState);
    this.frameCount = state.frameCount;
  }

  /**
   * Save the current state to a .state file (gzipped JSON)
   */
  saveState(): void {
    const statePath = this.getStatePath();
    try {
      const state = this.getState();
      const json = JSON.stringify(state);
      const compressed = gzipSync(json, { level: constants.Z_BEST_COMPRESSION });
      writeFileSync(statePath, compressed);
      console.log(`Saved state: ${statePath}`);
    } catch (err) {
      console.error(`Failed to save state: ${statePath}`, err);
    }
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
        if (resolved) return;
        resolved = true;
        process.stdin.setRawMode(wasRaw ?? false);
        process.stdin.pause();
        process.stdin.removeListener('data', onKeyPress);
        if (gamepadInterval) {
          clearInterval(gamepadInterval);
        }
        console.log(); // New line after prompt
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
            console.log(aPressed ? 'A' : 'Start'); // Echo the selection
            cleanup();
            resolve(true);
          }
          // Check if B is pressed (cancel)
          if (this.controller1.getButton(Button.B)) {
            console.log('B'); // Echo the selection
            cleanup();
            resolve(false);
          }
        }, 50);
      }
    });
  }

  /**
   * Load state from a .state file (gzipped or plain JSON)
   * @returns Promise<true> if state was loaded successfully
   */
  async loadState(): Promise<boolean> {
    const statePath = this.getStatePath();
    if (!existsSync(statePath)) {
      return false;
    }

    try {
      const data = readFileSync(statePath);
      // Check for gzip magic number (0x1f 0x8b)
      const isGzipped = data[0] === 0x1f && data[1] === 0x8b;
      const json = isGzipped ? gunzipSync(data).toString('utf-8') : data.toString('utf-8');
      const state = JSON.parse(json) as SaveState;

      // Validate version - prompt user for incompatible save states
      if (state.version !== Emulator.SAVE_STATE_VERSION) {
        console.log(`Incompatible save state (version ${state.version}, need ${Emulator.SAVE_STATE_VERSION}).`);
        const startFresh = await this.promptConfirmation('Delete old save and start fresh?');
        if (startFresh) {
          this.deleteSavedState();
          console.log('Old save state deleted.');
        }
        return false;
      }

      this.setState(state);
      console.log(`Loaded state: ${statePath}`);
      return true;
    } catch (err) {
      console.error(`Failed to load state: ${statePath}`, err);
      return false;
    }
  }

  /**
   * Delete the save state file
   */
  deleteSavedState(): void {
    const statePath = this.getStatePath();
    if (existsSync(statePath)) {
      try {
        const { unlinkSync } = require('fs');
        unlinkSync(statePath);
      } catch {
        // Ignore errors when deleting
      }
    }
  }
}
