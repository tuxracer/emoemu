import { CPU } from './cpu/cpu.js';
import { PPU } from './ppu/ppu.js';
import { Bus } from './memory/bus.js';
import { Cartridge } from './cartridge/cartridge.js';
import { Controller, defaultKeyMap } from './input/controller.js';
import { TerminalRenderer } from './ppu/renderer.js';
import { KittyRenderer } from './ppu/kitty-renderer.js';

export type RenderMode = 'terminal' | 'kitty';

// Common renderer interface
interface Renderer {
  render(frameBuffer: Uint8Array): string;
  clearScreen(): string;
  hideCursor(): string;
  showCursor(): string;
  getStatusRow(): number;
  moveCursorToRow(row: number): string;
}

export interface EmulatorOptions {
  romPath: string;
  width?: number;
  height?: number;
  useColor?: boolean;
  renderMode?: RenderMode;
  scale?: number;  // For Kitty renderer
}

export class Emulator {
  private cpu: CPU;
  private ppu: PPU;
  private bus: Bus;
  private cartridge: Cartridge;
  private controller1: Controller;
  private controller2: Controller;
  private renderer: Renderer;
  private renderMode: RenderMode;

  private running: boolean = false;
  private frameCount: number = 0;
  private lastFrameTime: number = 0;
  private targetFrameTime: number = 1000 / 60; // ~16.67ms for 60 FPS

  // Track held keys and their release timeouts
  private heldKeys: Map<string, NodeJS.Timeout> = new Map();
  private readonly keyReleaseDelay: number = 80; // ms - key repeat is ~30ms, so 80ms detects release

  constructor(options: EmulatorOptions) {
    // Initialize components
    this.cartridge = new Cartridge(options.romPath);
    this.bus = new Bus();
    this.ppu = new PPU();
    this.cpu = new CPU(this.bus);
    this.controller1 = new Controller();
    this.controller2 = new Controller();

    // Connect components
    this.bus.connectPPU(this.ppu);
    this.bus.connectCartridge(this.cartridge);
    this.bus.connectController(1, this.controller1);
    this.bus.connectController(2, this.controller2);
    this.ppu.connectCartridge(this.cartridge);

    // Initialize renderer based on mode
    this.renderMode = options.renderMode ?? 'kitty';

    if (this.renderMode === 'kitty') {
      this.renderer = new KittyRenderer({
        scale: options.scale ?? 2,
      });
    } else {
      this.renderer = new TerminalRenderer({
        width: options.width ?? 128,
        height: options.height ?? 60,
        useColor: options.useColor ?? true,
      });
    }
  }

  reset(): void {
    this.cpu.reset();
    this.ppu.reset();
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

    // Setup input handling
    this.setupInput();

    this.lastFrameTime = performance.now();

    const loop = (): void => {
      if (!this.running) {
        this.cleanup();
        return;
      }

      const now = performance.now();
      const elapsed = now - this.lastFrameTime;

      if (elapsed >= this.targetFrameTime) {
        // Run emulation for one frame
        this.runFrame();

        // Render to terminal (diff-based, includes cursor positioning)
        process.stdout.write(this.renderFrame());

        // Calculate actual FPS and display on fixed status line
        const fps = 1000 / elapsed;
        const buttons = this.controller1.getPressedButtons();
        const statusRow = this.renderer.getStatusRow();
        process.stdout.write(this.renderer.moveCursorToRow(statusRow));
        process.stdout.write(`FPS: ${fps.toFixed(1)} | Frame: ${this.frameCount} | Keys: ${buttons.padEnd(20)}`);

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

  private setupInput(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key: string) => {
      // Handle Ctrl+C
      if (key === '\u0003') {
        this.stop();
        return;
      }

      // Handle escape (but not arrow keys which start with escape)
      if (key === '\u001b') {
        this.stop();
        return;
      }

      // Handle each key in the input (allows multiple simultaneous keys)
      // Arrow keys come as escape sequences, handle them specially
      const keys = this.parseKeys(key);

      for (const k of keys) {
        const button = defaultKeyMap[k];
        if (button !== undefined) {
          this.handleKeyPress(k, button);
        }
      }
    });
  }

  // Parse input into individual keys (handles escape sequences for arrow keys)
  private parseKeys(input: string): string[] {
    const keys: string[] = [];
    let i = 0;

    while (i < input.length) {
      // Check for arrow key escape sequences
      if (input[i] === '\u001b' && input[i + 1] === '[') {
        if (input[i + 2] === 'A') {
          keys.push('\u001b[A'); // Up arrow
          i += 3;
          continue;
        } else if (input[i + 2] === 'B') {
          keys.push('\u001b[B'); // Down arrow
          i += 3;
          continue;
        } else if (input[i + 2] === 'C') {
          keys.push('\u001b[C'); // Right arrow
          i += 3;
          continue;
        } else if (input[i + 2] === 'D') {
          keys.push('\u001b[D'); // Left arrow
          i += 3;
          continue;
        }
      }

      // Regular character
      keys.push(input[i]);
      i++;
    }

    return keys;
  }

  // Handle key press with hold detection
  private handleKeyPress(key: string, button: number): void {
    // Clear any existing release timeout for this key
    const existingTimeout = this.heldKeys.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Press the button (may already be pressed, that's fine)
    this.controller1.setButton(button, true);

    // Set a new timeout to release the key if no repeat events come
    const timeout = setTimeout(() => {
      this.controller1.setButton(button, false);
      this.heldKeys.delete(key);
    }, this.keyReleaseDelay);

    this.heldKeys.set(key, timeout);
  }

  private cleanup(): void {
    // Clear all pending key release timeouts
    for (const timeout of this.heldKeys.values()) {
      clearTimeout(timeout);
    }
    this.heldKeys.clear();

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
