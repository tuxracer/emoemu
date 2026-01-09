/**
 * NES Core
 *
 * Implements the Core interface for Nintendo Entertainment System emulation.
 * This wraps the existing NES emulation components (CPU, PPU, APU, Bus, Cartridge)
 * to provide a standardized interface for the multi-core frontend.
 */

import type {
  Core,
  SystemInfo,
  AudioConfig,
  CoreState,
  ButtonDefinition,
} from '../../core/core.js';
import { registerCore } from '../../frontend/core-registry.js';
import { CPU } from './cpu.js';
import { PPU } from './ppu.js';
import { APU } from './apu.js';
import { Bus } from './bus.js';
import { Cartridge } from './cartridge.js';
import { Controller, Button } from '../../input/controller.js';
import { nesPaletteFlat } from '../../rendering/palette.js';
import { basename } from 'path';

/**
 * NES button IDs (matches the Button enum from controller.ts)
 */
export enum NESButton {
  A = 0,
  B = 1,
  Select = 2,
  Start = 3,
  Up = 4,
  Down = 5,
  Left = 6,
  Right = 7,
}

/**
 * Button definitions for NES
 */
const NES_BUTTONS: ButtonDefinition[] = [
  { id: NESButton.A, name: 'A', defaultKey: 'k', defaultGamepad: 'A' },
  { id: NESButton.B, name: 'B', defaultKey: 'j', defaultGamepad: 'B' },
  { id: NESButton.Select, name: 'Select', defaultKey: ' ', defaultGamepad: 'Back' },
  { id: NESButton.Start, name: 'Start', defaultKey: 'Enter', defaultGamepad: 'Start' },
  { id: NESButton.Up, name: 'Up', defaultKey: 'w', defaultGamepad: 'DPadUp' },
  { id: NESButton.Down, name: 'Down', defaultKey: 's', defaultGamepad: 'DPadDown' },
  { id: NESButton.Left, name: 'Left', defaultKey: 'a', defaultGamepad: 'DPadLeft' },
  { id: NESButton.Right, name: 'Right', defaultKey: 'd', defaultGamepad: 'DPadRight' },
];

/**
 * NES system information
 */
const NES_SYSTEM_INFO: SystemInfo = {
  id: 'nes',
  name: 'Nintendo Entertainment System',
  extensions: ['.nes', '.unf'],
  width: 256,
  height: 240,
  fps: 60.0988, // NTSC
  sampleRate: 44100,
  pixelAspectRatio: 8 / 7, // NES pixels are slightly wider than square
  maxPlayers: 2,
  buttons: NES_BUTTONS,
  colorSpace: 'palette',
  palette: nesPaletteFlat,
};

/**
 * State format version for NES save states
 */
const NES_STATE_VERSION = 2;

/**
 * Map from NESButton to Controller Button enum
 */
const BUTTON_MAP: Map<NESButton, Button> = new Map([
  [NESButton.A, Button.A],
  [NESButton.B, Button.B],
  [NESButton.Select, Button.Select],
  [NESButton.Start, Button.Start],
  [NESButton.Up, Button.Up],
  [NESButton.Down, Button.Down],
  [NESButton.Left, Button.Left],
  [NESButton.Right, Button.Right],
]);

/**
 * NES Core implementation
 */
export class NESCore implements Core {
  private cpu!: CPU;
  private ppu!: PPU;
  private apu!: APU;
  private bus!: Bus;
  private cartridge!: Cartridge;

  // Controllers for each port
  private controller1!: Controller;
  private controller2!: Controller;

  // Audio callback
  private audioCallback: ((samples: Float32Array) => void) | null = null;

  // ROM path for state validation
  private romPath: string = '';

  // Whether ROM has been loaded
  private romLoaded: boolean = false;

  /**
   * Get NES system information
   */
  getSystemInfo(): SystemInfo {
    return NES_SYSTEM_INFO;
  }

  /**
   * Load an NES ROM file
   */
  loadRom(romPath: string): void {
    this.romPath = romPath;

    // Initialize components
    this.cartridge = new Cartridge(romPath);
    this.bus = new Bus();
    this.ppu = new PPU();
    this.cpu = new CPU(this.bus);
    this.apu = new APU();

    // Initialize controllers
    this.controller1 = new Controller();
    this.controller2 = new Controller();

    // Connect components
    this.bus.connectPPU(this.ppu);
    this.bus.connectCartridge(this.cartridge);
    this.bus.connectController(1, this.controller1);
    this.bus.connectController(2, this.controller2);
    this.bus.connectAPU(this.apu);
    this.ppu.connectCartridge(this.cartridge);

    // Set up APU memory reader for DMC
    this.apu.setMemoryReader((addr) => this.bus.read(addr));

    // Wire audio output
    this.apu.onSamplesReady = (samples) => {
      this.audioCallback?.(samples);
    };

    this.romLoaded = true;
  }

  /**
   * Reset the NES to power-on state
   */
  reset(): void {
    if (!this.romLoaded) {
      throw new Error('Cannot reset: no ROM loaded');
    }
    this.cpu.reset();
    this.ppu.reset();
    this.apu.reset();
    this.bus.reset();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Save battery-backed RAM if needed
    this.cartridge?.saveSram(true);

    // Clear audio callback
    if (this.apu) {
      this.apu.onSamplesReady = null;
    }
    this.audioCallback = null;
  }

  /**
   * Run one frame of NES emulation
   */
  runFrame(): void {
    if (!this.romLoaded) {
      throw new Error('Cannot run frame: no ROM loaded');
    }

    this.ppu.frameComplete = false;

    while (!this.ppu.frameComplete) {
      // Execute one CPU instruction
      const cpuCycles = this.cpu.step();

      // PPU clocks at 3x CPU rate
      for (let i = 0; i < cpuCycles * 3; i++) {
        this.ppu.clock();

        // Check for NMI
        if (this.ppu.shouldGenerateNMI()) {
          this.ppu.clearNMI();
          this.cpu.nmi();
        }

        // Check for mapper IRQ (e.g., MMC3)
        if (this.cartridge.irqPending()) {
          this.cpu.irq();
        }
      }

      // APU clocks at CPU rate
      for (let i = 0; i < cpuCycles; i++) {
        this.apu.clock();
      }

      // Check for APU IRQ
      if (this.apu.irqPending()) {
        this.cpu.irq();
      }

      // Handle OAM DMA
      const dma = this.bus.doDma();
      if (dma.active && dma.data) {
        this.ppu.oamDma(dma.data);
      }
    }
  }

  /**
   * Check if frame is complete
   */
  isFrameComplete(): boolean {
    return this.ppu?.frameComplete ?? false;
  }

  /**
   * Get the current framebuffer (256x240 palette indices)
   */
  getFramebuffer(): Uint8Array {
    return this.ppu.frameBuffer;
  }

  /**
   * Get audio configuration
   */
  getAudioConfig(): AudioConfig {
    return {
      sampleRate: 44100,
      channels: 1, // NES is mono
    };
  }

  /**
   * Set audio sample callback
   */
  setAudioCallback(callback: ((samples: Float32Array) => void) | null): void {
    this.audioCallback = callback;
  }

  /**
   * Set button state for a controller
   */
  setButtonState(port: number, button: number, pressed: boolean): void {
    const controller = port === 0 ? this.controller1 : this.controller2;
    if (!controller) return;

    const nesButton = button as NESButton;
    const controllerButton = BUTTON_MAP.get(nesButton);
    if (controllerButton !== undefined) {
      controller.setButton(controllerButton, pressed);
    }
  }

  /**
   * Get current button state for a controller
   */
  getButtonState(port: number): Map<number, boolean> {
    const controller = port === 0 ? this.controller1 : this.controller2;
    const state = new Map<number, boolean>();

    if (!controller) return state;

    for (const [nesButton, controllerButton] of BUTTON_MAP) {
      state.set(nesButton, controller.getButton(controllerButton));
    }

    return state;
  }

  /**
   * Serialize current state for saving
   */
  getState(): CoreState {
    return {
      version: NES_STATE_VERSION,
      coreId: 'nes',
      gameId: basename(this.romPath),
      data: {
        cpu: this.cpu.getState(),
        ppu: this.ppu.getState(),
        apu: this.apu.getState(),
        bus: this.bus.getState(),
        cartridge: this.cartridge.getState(),
      },
    };
  }

  /**
   * Restore state from a previous save
   */
  setState(state: CoreState): void {
    if (state.coreId !== 'nes') {
      throw new Error(`Invalid core: expected 'nes', got '${state.coreId}'`);
    }

    if (state.version !== NES_STATE_VERSION) {
      throw new Error(
        `Incompatible state version: expected ${NES_STATE_VERSION}, got ${state.version}`
      );
    }

    const data = state.data as {
      cpu: ReturnType<CPU['getState']>;
      ppu: ReturnType<PPU['getState']>;
      apu: ReturnType<APU['getState']>;
      bus: ReturnType<Bus['getState']>;
      cartridge: ReturnType<Cartridge['getState']>;
    };

    this.cpu.setState(data.cpu);
    this.ppu.setState(data.ppu);
    this.apu.setState(data.apu);
    this.bus.setState(data.bus);
    this.cartridge.setState(data.cartridge);
  }

  /**
   * Get state format version
   */
  getStateVersion(): number {
    return NES_STATE_VERSION;
  }

  /**
   * Check if current game has battery-backed saves
   */
  hasBatterySave(): boolean {
    return this.cartridge?.header.hasBattery ?? false;
  }

  /**
   * Get battery-backed RAM
   */
  getBatteryRam(): Uint8Array | null {
    if (!this.hasBatterySave()) return null;
    return this.cartridge.prgRam;
  }

  /**
   * Set battery-backed RAM
   */
  setBatteryRam(data: Uint8Array): void {
    if (!this.hasBatterySave()) return;
    this.cartridge.prgRam.set(data.subarray(0, this.cartridge.prgRam.length));
  }

  //==========================================================================
  // NES-specific accessors (for compatibility with existing emulator.ts)
  //==========================================================================

  /** Get the CPU instance */
  getCPU(): CPU {
    return this.cpu;
  }

  /** Get the PPU instance */
  getPPU(): PPU {
    return this.ppu;
  }

  /** Get the APU instance */
  getAPU(): APU {
    return this.apu;
  }

  /** Get the Bus instance */
  getBus(): Bus {
    return this.bus;
  }

  /** Get the Cartridge instance */
  getCartridge(): Cartridge {
    return this.cartridge;
  }

  /** Get controller 1 */
  getController1(): Controller {
    return this.controller1;
  }

  /** Get controller 2 */
  getController2(): Controller {
    return this.controller2;
  }
}

// Register the NES core with the registry
registerCore('nes', {
  create: () => new NESCore(),
  extensions: ['.nes', '.unf'],
  getSystemInfo: () => NES_SYSTEM_INFO,
});

// Re-export component types for convenience
export type { CPUState } from './cpu.js';
export type { PPUState } from './ppu.js';
export type { APUState } from './apu.js';
export type { BusState } from './bus.js';
export type { CartridgeState, CartridgeHeader } from './cartridge.js';
