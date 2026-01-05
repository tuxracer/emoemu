import { CPU } from './cpu/cpu.js';
import { PPU } from './ppu/ppu.js';
import { Bus } from './memory/bus.js';
import { Cartridge } from './cartridge/cartridge.js';
import { Controller, defaultKeyMap } from './input/controller.js';
import { TerminalRenderer } from './ppu/renderer.js';

export interface EmulatorOptions {
  romPath: string;
  width?: number;
  height?: number;
  useColor?: boolean;
}

export class Emulator {
  private cpu: CPU;
  private ppu: PPU;
  private bus: Bus;
  private cartridge: Cartridge;
  private controller1: Controller;
  private controller2: Controller;
  private renderer: TerminalRenderer;

  private running: boolean = false;
  private frameCount: number = 0;
  private lastFrameTime: number = 0;
  private targetFrameTime: number = 1000 / 60; // ~16.67ms for 60 FPS

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

    // Initialize renderer
    this.renderer = new TerminalRenderer({
      width: options.width ?? 128,
      height: options.height ?? 60,
      useColor: options.useColor ?? true,
    });
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

      // Check for NMI
      if (this.ppu.shouldGenerateNMI()) {
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

        // Render to terminal
        process.stdout.write(this.renderer.moveCursorHome());
        process.stdout.write(this.renderFrame());

        // Calculate actual FPS
        const fps = 1000 / elapsed;
        process.stdout.write(`\n FPS: ${fps.toFixed(1)} | Frame: ${this.frameCount}`);

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

      // Handle escape
      if (key === '\u001b') {
        this.stop();
        return;
      }

      // Map key to button
      const button = defaultKeyMap[key];
      if (button !== undefined) {
        this.controller1.setButton(button, true);
        // Release after a short delay
        setTimeout(() => {
          this.controller1.setButton(button, false);
        }, 100);
      }
    });
  }

  private cleanup(): void {
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
