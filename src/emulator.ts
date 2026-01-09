import { readFileSync, writeFileSync, existsSync } from 'fs';
import { gzipSync, gunzipSync, constants } from 'zlib';
import { CPU, CPUState } from './cpu/cpu.js';
import { PPU, PPUState } from './ppu/ppu.js';
import { Bus, BusState } from './memory/bus.js';
import { Cartridge, CartridgeState } from './cartridge/cartridge.js';
import { Controller } from './input/controller.js';
import { InputManager } from './input/input-manager.js';
import { GamepadManager } from './input/gamepad-manager.js';
import { TerminalRenderer } from './ppu/renderer.js';
import { KittyRenderer } from './ppu/kitty-renderer.js';
import { APU, APUState } from './apu/apu.js';
import pkg from 'audify';
const { RtAudio, RtAudioFormat } = pkg;

export interface SaveState {
  version: number;
  romPath: string;
  cpu: CPUState;
  ppu: PPUState;
  apu: APUState;
  bus: BusState;
  cartridge: CartridgeState;
  frameCount: number;
}

export type RenderMode = 'terminal' | 'kitty' | 'ascii' | 'emoji';

// Common renderer interface
interface Renderer {
  render(frameBuffer: Uint8Array): string;
  clearScreen(): string;
  hideCursor(): string;
  showCursor(): string;
  getStatusRow(): number;
  moveCursorToRow(row: number): string;
  setDimensions?(width: number, height: number): void;
}

export interface EmulatorOptions {
  romPath: string;
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
function calculateTerminalDimensions(mode: 'terminal' | 'ascii' | 'emoji'): { width: number; height: number } {
  const termCols = process.stdout.columns || 80;
  const termRows = process.stdout.rows || 24;

  // Leave 2 rows for status line
  const availableRows = termRows - 2;

  // NES is 256x240 (8:7.5 aspect ratio, displayed on 4:3 TV)
  // Terminal cells are roughly 1:2 (width:height)
  // For terminal mode (half-blocks): each row = 2 NES pixels vertically
  // For ASCII mode: each row = 1 NES pixel
  // For emoji mode: each emoji = 1 NES pixel, but 2 terminal columns wide

  if (mode === 'emoji') {
    // Emoji: 1 emoji = 1 pixel, each emoji is 2 terminal columns wide
    // Emojis appear roughly square (2 cols × 1 row ≈ square due to cell aspect)
    // For NES 256x240 with 8:7 PAR, display aspect ratio ≈ 1.219:1
    // With square emojis: width / height = 1.219
    // width = height * 256 * 8 / (240 * 7) = height * 2048/1680 ≈ height * 1.219
    let height = availableRows;
    let width = Math.floor(height * 2048 / 1680);
    const displayCols = width * 2; // Actual terminal columns needed

    if (displayCols > termCols) {
      width = Math.floor(termCols / 2);
      height = Math.floor(width * 1680 / 2048);
    }

    return { width, height };
  } else if (mode === 'ascii') {
    // ASCII: 1 char = 1 pixel
    // Maintain ~4:3 display aspect ratio accounting for cell aspect
    // cols / (rows * 2) = 4/3 => cols = rows * 8/3
    let height = availableRows;
    let width = Math.floor(height * 8 / 3);

    if (width > termCols) {
      width = termCols;
      height = Math.floor(width * 3 / 8);
    }

    return { width, height };
  } else {
    // Terminal half-block mode: 1 char = 1x2 NES pixels
    // Terminal cells are ~1:2 aspect (twice as tall as wide)
    // Display aspect = width / (height * 2) = 4/3 => width = height * 8/3
    let height = availableRows;
    let width = Math.floor(height * 8 / 3);

    if (width > termCols) {
      width = termCols;
      height = Math.floor(width * 3 / 8);
    }

    return { width, height };
  }
}

export class Emulator {
  private cpu: CPU;
  private ppu: PPU;
  private bus: Bus;
  private cartridge: Cartridge;
  private controller1: Controller;
  private controller2: Controller;
  private inputManager: InputManager;
  private gamepadManager: GamepadManager | null = null;
  private renderer: Renderer;
  private renderMode: RenderMode;
  private apu: APU;
  private rtAudio: RtAudio | null = null;
  private audioEnabled: boolean = true;
  private autoResize: boolean = false; // Whether to handle terminal resize events
  private showStatusBar: boolean = true;
  private romPath: string;

  private running: boolean = false;
  private frameCount: number = 0;
  private lastFrameTime: number = 0;
  private targetFrameTime: number = 1000 / 60; // ~16.67ms for 60 FPS
  private resizeHandler: (() => void) | null = null;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly AUTO_SAVE_INTERVAL_MS = 30000; // 30 seconds (only saves if SRAM was modified)
  // Pre-allocated audio buffer pool to avoid allocation per sample batch
  // Using 3 buffers to handle async audio writes safely
  private audioBufferPool: Buffer[] = [];
  private audioBufferIndex: number = 0;
  private static readonly AUDIO_BUFFER_COUNT = 3;

  constructor(options: EmulatorOptions) {
    // Store ROM path for save states
    this.romPath = options.romPath;

    // Initialize components
    this.cartridge = new Cartridge(options.romPath);
    this.bus = new Bus();
    this.ppu = new PPU();
    this.cpu = new CPU(this.bus);
    this.controller1 = new Controller();
    this.controller2 = new Controller();
    this.apu = new APU();
    this.audioEnabled = options.enableAudio !== false;
    this.showStatusBar = options.showStatusBar !== false;

    // Connect components
    this.bus.connectPPU(this.ppu);
    this.bus.connectCartridge(this.cartridge);
    this.bus.connectController(1, this.controller1);
    this.bus.connectController(2, this.controller2);
    this.bus.connectAPU(this.apu);
    this.ppu.connectCartridge(this.cartridge);

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
      });
      // Enable auto-resize when no explicit scale is provided
      this.autoResize = options.scale === undefined;
    } else if (this.renderMode === 'emoji') {
      // Auto-size to terminal if no explicit dimensions given
      const explicitDims = options.width && options.height;
      const dims = explicitDims
        ? { width: options.width!, height: options.height! }
        : calculateTerminalDimensions('emoji');
      this.autoResize = !explicitDims;
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: false,
        emojiMode: true,
      });
    } else if (this.renderMode === 'ascii') {
      // Auto-size to terminal if no explicit dimensions given
      const explicitDims = options.width && options.height;
      const dims = explicitDims
        ? { width: options.width!, height: options.height! }
        : calculateTerminalDimensions('ascii');
      this.autoResize = !explicitDims;
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: options.useColor ?? true,
        asciiMode: true,
      });
    } else {
      // Auto-size to terminal if no explicit dimensions given
      const explicitDims = options.width && options.height;
      const dims = explicitDims
        ? { width: options.width!, height: options.height! }
        : calculateTerminalDimensions('terminal');
      this.autoResize = !explicitDims;
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: options.useColor ?? true,
      });
    }
  }

  reset(): void {
    this.cpu.reset();
    this.ppu.reset();
    this.apu.reset();
    this.bus.reset();
    this.frameCount = 0;
  }

  // Run one CPU instruction and corresponding PPU cycles
  step(): void {
    // Execute one CPU instruction
    const cpuCycles = this.cpu.step();

    // PPU runs 3 times faster than CPU
    for (let i = 0; i < cpuCycles * 3; i++) {
      this.ppu.clock();

      // Check for NMI (only trigger once)
      if (this.ppu.shouldGenerateNMI()) {
        this.ppu.clearNMI();
        this.cpu.nmi();
      }

      // Check for mapper IRQ each PPU cycle (used by MMC3 scanline counter)
      // This allows more accurate IRQ timing
      if (this.cartridge.irqPending()) {
        this.cpu.irq();
        // Don't acknowledge here - let the game do it by writing to $E000
      }
    }

    // APU runs at CPU speed
    for (let i = 0; i < cpuCycles; i++) {
      this.apu.clock();
    }

    // Check for APU IRQ
    if (this.apu.irqPending()) {
      this.cpu.irq();
    }

    // Handle DMA if needed
    const dma = this.bus.doDma();
    if (dma.active && dma.data) {
      this.ppu.oamDma(dma.data);
      // DMA takes 513 or 514 cycles - simplified here
    }
  }

  // Run one complete frame
  runFrame(): void {
    this.ppu.frameComplete = false;

    while (!this.ppu.frameComplete) {
      this.step();
    }

    this.frameCount++;
  }

  // Render current frame to terminal
  renderFrame(): string {
    return this.renderer.render(this.ppu.frameBuffer);
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
          const dims = calculateTerminalDimensions(mode);
          (this.renderer as TerminalRenderer).setDimensions(dims.width, dims.height);
        }
        process.stdout.write(this.renderer.clearScreen());
      };
      process.stdout.on('resize', this.resizeHandler);
    }

    // Set up auto-save for battery-backed games
    if (this.cartridge.header.hasBattery) {
      this.autoSaveInterval = setInterval(() => {
        this.cartridge.saveSram();
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
    const sampleRate = this.apu.getSampleRate();
    // Frame size for audio buffer (~20ms at sample rate)
    const frameSize = Math.floor(sampleRate * 0.02);
    // Buffer size in bytes (16-bit stereo = 4 bytes per sample frame)
    const frameBytes = frameSize * 2 * 2; // frameSize * 2 channels * 2 bytes

    // Fixed-size ring buffer for sample accumulation (prevents unbounded growth)
    // Size: enough for ~100ms of audio (5 frames worth)
    const ringBufferSize = frameSize * 5;
    const ringBuffer = new Float32Array(ringBufferSize);
    let ringWritePos = 0;
    let ringReadPos = 0;
    let ringCount = 0; // Number of samples in buffer

    // Pre-allocated output buffer for RtAudio (exact frame size required)
    const outputBuffer = Buffer.alloc(frameBytes);

    // Flow control using frameOutputCallback
    let framesWritten = 0;
    let framesPlayed = 0;
    const maxQueuedFrames = 3; // Maximum frames to buffer ahead (reduced for lower latency)

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
      // Log error for debugging (type codes from RtAudioErrorType enum)
      const errorTypes = ['WARNING', 'DEBUG_WARNING', 'UNSPECIFIED', 'NO_DEVICES_FOUND',
        'INVALID_DEVICE', 'MEMORY_ERROR', 'INVALID_PARAMETER', 'INVALID_USE',
        'DRIVER_ERROR', 'SYSTEM_ERROR', 'THREAD_ERROR'];
      const typeName = errorTypes[type] || `UNKNOWN(${type})`;
      console.error(`Audio error [${typeName}]: ${msg}`);

      // Attempt recovery for recoverable errors (not during recovery)
      if (!isRecovering && type >= 3) { // Errors more severe than warnings
        isRecovering = true;
        setTimeout(() => {
          try {
            createAudio();
          } catch {
            // If recreation fails, disable audio
            this.audioEnabled = false;
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
        undefined, // Default flags
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

    // Connect APU sample output to RtAudio
    this.apu.onSamplesReady = (samples: Float32Array) => {
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
    };
  }

  private setupStdin(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }

  private setupInputHandler(): void {
    process.stdin.on('data', (key: string) => {
      // Process input through InputManager
      const result = this.inputManager.processInput(key);

      if (result.quit) {
        this.stop();
      }

      if (result.cycleRenderMode) {
        this.cycleRenderMode();
      }
    });
  }

  // Cycle through render modes: kitty -> terminal -> ascii -> emoji -> kitty
  private cycleRenderMode(): void {
    const modes: RenderMode[] = ['kitty', 'terminal', 'ascii', 'emoji'];
    const currentIndex = modes.indexOf(this.renderMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];

    // Create new renderer based on mode
    if (nextMode === 'kitty') {
      this.renderer = new KittyRenderer();
      this.autoResize = true;
    } else if (nextMode === 'emoji') {
      const dims = calculateTerminalDimensions('emoji');
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: false,
        emojiMode: true,
      });
      this.autoResize = true;
    } else if (nextMode === 'ascii') {
      const dims = calculateTerminalDimensions('ascii');
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: true,
        asciiMode: true,
      });
      this.autoResize = true;
    } else {
      const dims = calculateTerminalDimensions('terminal');
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: true,
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

    // Save battery-backed RAM if the cartridge supports it (force save on exit)
    this.cartridge.saveSram(true);

    // Save state on exit
    this.saveState();

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
      this.apu.onSamplesReady = null;
      try {
        this.rtAudio.closeStream();
      } catch {
        // Ignore cleanup errors
      }
      this.rtAudio = null;
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
  }

  // Expose controller for external input handling
  getController(port: 1 | 2): Controller {
    return port === 1 ? this.controller1 : this.controller2;
  }

  // Get current frame buffer for external rendering
  getFrameBuffer(): Uint8Array {
    return this.ppu.frameBuffer;
  }

  // Save state management
  private static readonly SAVE_STATE_VERSION = 1;

  /**
   * Get the path for the save state file
   */
  private getStatePath(): string {
    return this.romPath.replace(/\.nes$/i, '.state');
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
      cpu: this.cpu.getState(),
      ppu: this.ppu.getState(),
      apu: this.apu.getState(),
      bus: this.bus.getState(),
      cartridge: this.cartridge.getState(),
      frameCount: this.frameCount,
    };
  }

  /**
   * Restore emulator state from a save state
   */
  setState(state: SaveState): void {
    if (state.version !== Emulator.SAVE_STATE_VERSION) {
      console.warn(`Save state version mismatch: expected ${Emulator.SAVE_STATE_VERSION}, got ${state.version}`);
    }

    this.cpu.setState(state.cpu);
    this.ppu.setState(state.ppu);
    this.apu.setState(state.apu);
    this.bus.setState(state.bus);
    this.cartridge.setState(state.cartridge);
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
   * Load state from a .state file (gzipped or plain JSON)
   * @returns true if state was loaded successfully
   */
  loadState(): boolean {
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
