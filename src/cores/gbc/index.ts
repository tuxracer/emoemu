// Game Boy Color Core Implementation
// Implements the Core interface for GBC/GB emulation

import type {
  Core,
  SystemInfo,
  AudioConfig,
  CoreState,
  ButtonDefinition,
} from '../../core/core.js';
import { registerCore } from '../../frontend/core-registry.js';
import { CPU, type CpuState } from './cpu.js';
import { PPU, type PpuState } from './ppu.js';
import { Bus, type BusState } from './bus.js';
import { Timer, type TimerState } from './timer.js';
import { Cartridge, type CartridgeState } from './cartridge.js';
import { APU, type APUState } from './apu.js';
import { basename } from 'path';

// Combined state for all GBC components
interface GBCState {
  cpu: CpuState;
  ppu: PpuState;
  bus: BusState;
  timer: TimerState;
  cartridge: CartridgeState;
  cartridgeRam: number[];
  apu: APUState;
}

// GBC Button IDs (matching joypad register bit positions)
export const GBCButton = {
  A: 0, // Bit 0 of action buttons
  B: 1, // Bit 1 of action buttons
  Select: 2, // Bit 2 of action buttons
  Start: 3, // Bit 3 of action buttons
  Right: 4, // Bit 0 of direction buttons (mapped to 4)
  Left: 5, // Bit 1 of direction buttons (mapped to 5)
  Up: 6, // Bit 2 of direction buttons (mapped to 6)
  Down: 7, // Bit 3 of direction buttons (mapped to 7)
} as const;

// Button definitions for input mapping
const GBC_BUTTONS: ButtonDefinition[] = [
  { id: GBCButton.A, name: 'A', defaultKey: 'k', defaultGamepad: 'a' },
  { id: GBCButton.B, name: 'B', defaultKey: 'j', defaultGamepad: 'b' },
  { id: GBCButton.Select, name: 'Select', defaultKey: ' ', defaultGamepad: 'back' },
  { id: GBCButton.Start, name: 'Start', defaultKey: 'Enter', defaultGamepad: 'start' },
  { id: GBCButton.Up, name: 'Up', defaultKey: 'w', defaultGamepad: 'dpUp' },
  { id: GBCButton.Down, name: 'Down', defaultKey: 's', defaultGamepad: 'dpDown' },
  { id: GBCButton.Left, name: 'Left', defaultKey: 'a', defaultGamepad: 'dpLeft' },
  { id: GBCButton.Right, name: 'Right', defaultKey: 'd', defaultGamepad: 'dpRight' },
];

// System information
const GBC_SYSTEM_INFO: SystemInfo = {
  id: 'gbc',
  name: 'Game Boy Color',
  extensions: ['.gbc', '.gb'],
  width: 160,
  height: 144,
  fps: 59.7275, // 4194304 Hz / 70224 cycles per frame
  sampleRate: 44100,
  pixelAspectRatio: 1.0, // Square pixels
  maxPlayers: 1,
  buttons: GBC_BUTTONS,
  colorSpace: 'rgb15',
};

// State version for save/load compatibility
const GBC_STATE_VERSION = 1;

// Cycles per frame (4194304 Hz / 59.7275 fps)
const CYCLES_PER_FRAME = 70224;

export class GBCCore implements Core {
  private cpu: CPU | null = null;
  private ppu: PPU | null = null;
  private bus: Bus | null = null;
  private timer: Timer | null = null;
  private cartridge: Cartridge | null = null;
  private apu: APU | null = null;

  private romPath = '';
  private buttonState = new Map<number, boolean>();

  constructor() {
    // Initialize button states
    for (const button of GBC_BUTTONS) {
      this.buttonState.set(button.id, false);
    }
  }

  getSystemInfo(): SystemInfo {
    return GBC_SYSTEM_INFO;
  }

  loadRom(romPath: string): void {
    this.romPath = romPath;

    // Create cartridge from ROM
    this.cartridge = new Cartridge(romPath);

    // Create components
    this.bus = new Bus();
    this.timer = new Timer(() => this.bus!.requestInterrupt(0x04)); // Timer interrupt
    this.apu = new APU();
    this.bus.setCartridge(this.cartridge);
    this.bus.setTimer(this.timer);
    this.bus.setApu(this.apu);

    // Create CPU with memory callbacks
    this.cpu = new CPU(
      (addr) => this.bus!.read(addr),
      (addr, value) => this.bus!.write(addr, value)
    );

    // Create PPU (always start in CGB mode for .gbc files)
    const isCgb = this.cartridge.isCgbGame() || romPath.toLowerCase().endsWith('.gbc');
    this.ppu = new PPU(this.bus, isCgb);

    this.reset();
  }

  reset(): void {
    this.cpu?.reset();
    this.ppu?.reset();
    this.bus?.reset();
    this.timer?.reset();
    this.apu?.reset();

    // Reset button states
    for (const button of GBC_BUTTONS) {
      this.buttonState.set(button.id, false);
    }
  }

  destroy(): void {
    this.cpu = null;
    this.ppu = null;
    this.bus = null;
    this.timer = null;
    this.cartridge = null;
    this.apu = null;
  }

  runFrame(): void {
    if (!this.cpu || !this.ppu || !this.bus || !this.timer) {
      return;
    }

    this.ppu.clearFrameComplete();

    let cyclesThisFrame = 0;

    while (cyclesThisFrame < CYCLES_PER_FRAME && !this.ppu.isFrameComplete()) {
      // Handle interrupts
      const intBit = this.cpu.handleInterrupt(
        this.bus.getInterruptFlags(),
        this.bus.getInterruptEnable()
      );
      if (intBit) {
        this.bus.clearInterruptFlag(intBit);
      }

      // Execute one CPU instruction
      const cycles = this.cpu.step();
      cyclesThisFrame += cycles;

      // Handle GBC speed switch (STOP instruction with speed switch pending)
      if (this.cpu.isStopped() && this.bus.isSpeedSwitchPending()) {
        this.bus.performSpeedSwitch();
        this.cpu.clearStopped();
      }

      // Tick timer
      this.timer.tick(cycles);

      // Tick PPU (runs at same rate as CPU in normal speed mode)
      // In double speed mode, PPU still runs at normal speed
      const ppuCycles = this.bus.isDoubleSpeed() ? cycles / 2 : cycles;
      this.ppu.tick(ppuCycles);

      // Tick APU (always runs at normal speed, even in double speed mode)
      if (this.apu) {
        const apuCycles = this.bus.isDoubleSpeed() ? cycles / 2 : cycles;
        this.apu.tick(apuCycles);
      }
    }
  }

  isFrameComplete(): boolean {
    return this.ppu?.isFrameComplete() ?? false;
  }

  getFramebuffer(): Uint16Array {
    return this.ppu?.getFramebuffer() ?? new Uint16Array(160 * 144);
  }

  getAudioConfig(): AudioConfig {
    return {
      sampleRate: 44100,
      channels: 2, // GBC has stereo audio
    };
  }

  setAudioCallback(callback: ((samples: Float32Array) => void) | null): void {
    if (this.apu) {
      this.apu.onSamplesReady = callback;
    }
  }

  setButtonState(port: number, button: number, pressed: boolean): void {
    if (port !== 0) return; // GBC only has one controller port

    this.buttonState.set(button, pressed);

    // Update joypad state in bus
    // Buttons are active low in the register
    // Bits 0-3: Right, Left, Up, Down (direction)
    // Bits 4-7: A, B, Select, Start (action) - mapped differently in our enum

    if (this.bus) {
      this.bus.setButtonState(button, pressed);

      // Request joypad interrupt on any button press
      if (pressed) {
        this.bus.requestInterrupt(0x10); // Joypad interrupt
      }
    }
  }

  getButtonState(port: number): Map<number, boolean> {
    if (port !== 0) return new Map();
    return new Map(this.buttonState);
  }

  getState(): CoreState {
    if (!this.cpu || !this.ppu || !this.bus || !this.timer || !this.cartridge || !this.apu) {
      throw new Error('Cannot save state: emulator not initialized');
    }

    const gbcState: GBCState = {
      cpu: this.cpu.getState(),
      ppu: this.ppu.getState(),
      bus: this.bus.getState(),
      timer: this.timer.getState(),
      cartridge: this.cartridge.getState(),
      cartridgeRam: Array.from(this.cartridge.getRam()),
      apu: this.apu.getState(),
    };

    return {
      version: GBC_STATE_VERSION,
      coreId: 'gbc',
      gameId: basename(this.romPath),
      data: gbcState as unknown as Record<string, unknown>,
    };
  }

  setState(state: CoreState): void {
    if (!this.cpu || !this.ppu || !this.bus || !this.timer || !this.cartridge || !this.apu) {
      throw new Error('Cannot restore state: emulator not initialized');
    }

    if (state.coreId !== 'gbc') {
      throw new Error(`Invalid state: expected coreId 'gbc', got '${state.coreId}'`);
    }

    if (state.version !== GBC_STATE_VERSION) {
      throw new Error(`Incompatible state version: expected ${GBC_STATE_VERSION}, got ${state.version}`);
    }

    const gbcState = state.data as unknown as GBCState;

    this.cpu.setState(gbcState.cpu);
    this.ppu.setState(gbcState.ppu);
    this.bus.setState(gbcState.bus);
    this.timer.setState(gbcState.timer);
    this.cartridge.setState(gbcState.cartridge);
    this.cartridge.setRam(new Uint8Array(gbcState.cartridgeRam));
    this.apu.setState(gbcState.apu);
  }

  getStateVersion(): number {
    return GBC_STATE_VERSION;
  }

  hasBatterySave(): boolean {
    return this.cartridge?.hasBatterySave() ?? false;
  }

  getBatteryRam(): Uint8Array | null {
    return this.cartridge?.getRam() ?? null;
  }

  setBatteryRam(data: Uint8Array): void {
    this.cartridge?.setRam(data);
  }
}

// Register the core with the registry
registerCore('gbc', {
  create: () => new GBCCore(),
  extensions: ['.gbc', '.gb'],
  getSystemInfo: () => GBC_SYSTEM_INFO,
});
