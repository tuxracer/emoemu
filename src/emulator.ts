import { CPU } from './cpu/cpu.js';
import { PPU } from './ppu/ppu.js';
import { Bus } from './memory/bus.js';
import { Cartridge } from './cartridge/cartridge.js';
import { Controller } from './input/controller.js';
import { InputManager } from './input/input-manager.js';
import { GamepadManager } from './input/gamepad-manager.js';
import { TerminalRenderer } from './ppu/renderer.js';
import { KittyRenderer } from './ppu/kitty-renderer.js';
import { APU } from './apu/apu.js';
import Speaker from 'speaker';

export type RenderMode = 'terminal' | 'kitty' | 'ascii';

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

// Calculate optimal dimensions for terminal/ASCII rendering
function calculateTerminalDimensions(asciiMode: boolean): { width: number; height: number } {
  const termCols = process.stdout.columns || 80;
  const termRows = process.stdout.rows || 24;

  // Leave 2 rows for status line
  const availableRows = termRows - 2;

  // NES is 256x240 (8:7.5 aspect ratio, displayed on 4:3 TV)
  // Terminal cells are roughly 1:2 (width:height)
  // For terminal mode (half-blocks): each row = 2 NES pixels vertically
  // For ASCII mode: each row = 1 NES pixel

  if (asciiMode) {
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
  private speaker: Speaker | null = null;
  private audioEnabled: boolean = true;
  private autoResize: boolean = false; // Whether to handle terminal resize events
  private showStatusBar: boolean = true;

  private running: boolean = false;
  private frameCount: number = 0;
  private lastFrameTime: number = 0;
  private targetFrameTime: number = 1000 / 60; // ~16.67ms for 60 FPS
  private resizeHandler: (() => void) | null = null;
  // Pre-allocated audio buffer pool to avoid allocation per sample batch
  // Using 3 buffers to handle async speaker writes safely
  private audioBufferPool: Buffer[] = [];
  private audioBufferIndex: number = 0;
  private static readonly AUDIO_BUFFER_COUNT = 3;

  constructor(options: EmulatorOptions) {
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
    } else if (this.renderMode === 'ascii') {
      // Auto-size to terminal if no explicit dimensions given
      const explicitDims = options.width && options.height;
      const dims = explicitDims
        ? { width: options.width!, height: options.height! }
        : calculateTerminalDimensions(true);
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
        : calculateTerminalDimensions(false);
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
  async run(): Promise<void> {
    this.running = true;
    this.reset();

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
          const isAscii = this.renderMode === 'ascii';
          const dims = calculateTerminalDimensions(isAscii);
          (this.renderer as TerminalRenderer).setDimensions(dims.width, dims.height);
        }
        process.stdout.write(this.renderer.clearScreen());
      };
      process.stdout.on('resize', this.resizeHandler);
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

    // Create speaker for direct audio output
    this.speaker = new Speaker({
      channels: 1,
      bitDepth: 16,
      sampleRate: sampleRate,
    });

    // Handle speaker errors silently
    this.speaker.on('error', () => {
      this.audioEnabled = false;
      this.speaker = null;
    });

    // Track audio timing to stay in sync with real-time
    let audioStartTime = performance.now();
    let samplesWritten = 0;
    const maxAheadMs = 15; // Drop audio if more than 15ms ahead

    // Connect APU sample output directly to speaker
    this.apu.onSamplesReady = (samples: Float32Array) => {
      if (this.speaker && this.audioEnabled) {
        const now = performance.now();
        const elapsedMs = now - audioStartTime;
        const expectedSamples = (elapsedMs / 1000) * sampleRate;
        const aheadSamples = samplesWritten - expectedSamples;
        const aheadMs = (aheadSamples / sampleRate) * 1000;

        // If we're too far ahead, skip this batch (don't reset counters)
        if (aheadMs > maxAheadMs) {
          // Adjust samplesWritten to pretend we wrote, keeping us in sync
          // This effectively "catches up" without resetting
          samplesWritten = expectedSamples + (maxAheadMs / 1000) * sampleRate;
          return;
        }

        // If we've drifted too far behind (negative aheadMs), resync
        if (aheadMs < -100) {
          audioStartTime = now;
          samplesWritten = 0;
        }

        // Use pre-allocated buffer pool to avoid allocation per batch
        // Rotate through buffers to handle async speaker writes safely
        const requiredSize = samples.length * 2;
        let buffer = this.audioBufferPool[this.audioBufferIndex];

        // Lazily allocate buffers on first use or if size changed
        if (!buffer || buffer.length < requiredSize) {
          buffer = Buffer.alloc(requiredSize);
          this.audioBufferPool[this.audioBufferIndex] = buffer;
        }

        for (let i = 0; i < samples.length; i++) {
          const sample = Math.max(-1, Math.min(1, samples[i]));
          const int16 = (sample * 32767) | 0;
          buffer.writeInt16LE(int16, i * 2);
        }
        this.speaker.write(buffer);
        samplesWritten += samples.length;

        // Rotate to next buffer in pool
        this.audioBufferIndex = (this.audioBufferIndex + 1) % Emulator.AUDIO_BUFFER_COUNT;
      }
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

  // Cycle through render modes: kitty -> terminal -> ascii -> kitty
  private cycleRenderMode(): void {
    const modes: RenderMode[] = ['kitty', 'terminal', 'ascii'];
    const currentIndex = modes.indexOf(this.renderMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];

    // Create new renderer based on mode
    if (nextMode === 'kitty') {
      this.renderer = new KittyRenderer();
      this.autoResize = true;
    } else if (nextMode === 'ascii') {
      const dims = calculateTerminalDimensions(true);
      this.renderer = new TerminalRenderer({
        width: dims.width,
        height: dims.height,
        useColor: true,
        asciiMode: true,
      });
      this.autoResize = true;
    } else {
      const dims = calculateTerminalDimensions(false);
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
    if (this.speaker) {
      this.apu.onSamplesReady = null;
      this.speaker.end();
      this.speaker = null;
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
}
