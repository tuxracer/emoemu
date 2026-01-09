// Game Boy Color Memory Bus
// Handles address decoding, banking, and I/O register access

import type { Cartridge } from './cartridge.js';
import type { Timer } from './timer.js';

export interface BusState {
  wram: number[][];
  hram: number[];
  oam: number[];
  vram: number[][];
  vramBank: number;
  wramBank: number;
  ie: number;
  interruptFlags: number;
  joypadState: number;
  joypadSelect: number;
  // GBC registers
  speedMode: number;
  prepareSpeedSwitch: boolean;
  hdmaSource: number;
  hdmaDest: number;
  hdmaLength: number;
  hdmaActive: boolean;
  // Palette registers
  bgPaletteIndex: number;
  bgPaletteAutoInc: boolean;
  bgPaletteData: number[];
  objPaletteIndex: number;
  objPaletteAutoInc: boolean;
  objPaletteData: number[];
}

export class Bus {
  // Work RAM - 8 banks of 4KB each (32KB total on GBC)
  private wram: Uint8Array[] = [];
  private wramBank = 1; // Bank 1-7 switchable at $D000-$DFFF

  // Video RAM - 2 banks of 8KB each (16KB total on GBC)
  private vram: Uint8Array[] = [];
  private vramBank = 0;

  // High RAM (127 bytes at $FF80-$FFFE)
  private hram = new Uint8Array(127);

  // Object Attribute Memory (160 bytes at $FE00-$FE9F)
  private oam = new Uint8Array(160);

  // Interrupt registers
  private ie = 0; // $FFFF - Interrupt Enable
  private interruptFlags = 0; // $FF0F - Interrupt Flags

  // Joypad
  private joypadState = 0xff; // All buttons released
  private joypadSelect = 0;

  // GBC-specific registers
  private speedMode = 0; // 0 = normal speed, 1 = double speed
  private prepareSpeedSwitch = false;

  // HDMA (H-Blank DMA)
  private hdmaSource = 0;
  private hdmaDest = 0;
  private hdmaLength = 0;
  private hdmaActive = false;

  // Color palettes (GBC)
  private bgPaletteIndex = 0;
  private bgPaletteAutoInc = false;
  private bgPaletteData = new Uint8Array(64); // 8 palettes * 4 colors * 2 bytes
  private objPaletteIndex = 0;
  private objPaletteAutoInc = false;
  private objPaletteData = new Uint8Array(64);

  // DMG palettes (for compatibility)
  private bgp = 0;
  private obp0 = 0;
  private obp1 = 0;

  // External components
  private cartridge: Cartridge | null = null;
  private timer: Timer | null = null;

  // PPU register callbacks
  private ppuRead: ((addr: number) => number) | null = null;
  private ppuWrite: ((addr: number, value: number) => void) | null = null;

  constructor() {
    // Initialize WRAM (8 banks)
    for (let i = 0; i < 8; i++) {
      this.wram.push(new Uint8Array(0x1000)); // 4KB per bank
    }

    // Initialize VRAM (2 banks)
    for (let i = 0; i < 2; i++) {
      this.vram.push(new Uint8Array(0x2000)); // 8KB per bank
    }
  }

  reset(): void {
    // Clear memory
    for (const bank of this.wram) {
      bank.fill(0);
    }
    for (const bank of this.vram) {
      bank.fill(0);
    }
    this.hram.fill(0);
    this.oam.fill(0);
    this.bgPaletteData.fill(0xff);
    this.objPaletteData.fill(0xff);

    // Reset registers
    this.wramBank = 1;
    this.vramBank = 0;
    this.ie = 0;
    this.interruptFlags = 0xe1;
    this.joypadState = 0xff;
    this.joypadSelect = 0;
    this.speedMode = 0;
    this.prepareSpeedSwitch = false;
    this.hdmaSource = 0;
    this.hdmaDest = 0;
    this.hdmaLength = 0;
    this.hdmaActive = false;
    this.bgPaletteIndex = 0;
    this.bgPaletteAutoInc = false;
    this.objPaletteIndex = 0;
    this.objPaletteAutoInc = false;
    this.bgp = 0xfc;
    this.obp0 = 0xff;
    this.obp1 = 0xff;
  }

  getState(): BusState {
    return {
      wram: this.wram.map((bank) => Array.from(bank)),
      hram: Array.from(this.hram),
      oam: Array.from(this.oam),
      vram: this.vram.map((bank) => Array.from(bank)),
      vramBank: this.vramBank,
      wramBank: this.wramBank,
      ie: this.ie,
      interruptFlags: this.interruptFlags,
      joypadState: this.joypadState,
      joypadSelect: this.joypadSelect,
      speedMode: this.speedMode,
      prepareSpeedSwitch: this.prepareSpeedSwitch,
      hdmaSource: this.hdmaSource,
      hdmaDest: this.hdmaDest,
      hdmaLength: this.hdmaLength,
      hdmaActive: this.hdmaActive,
      bgPaletteIndex: this.bgPaletteIndex,
      bgPaletteAutoInc: this.bgPaletteAutoInc,
      bgPaletteData: Array.from(this.bgPaletteData),
      objPaletteIndex: this.objPaletteIndex,
      objPaletteAutoInc: this.objPaletteAutoInc,
      objPaletteData: Array.from(this.objPaletteData),
    };
  }

  setState(state: BusState): void {
    for (let i = 0; i < 8; i++) {
      this.wram[i] = new Uint8Array(state.wram[i]);
    }
    this.hram = new Uint8Array(state.hram);
    this.oam = new Uint8Array(state.oam);
    for (let i = 0; i < 2; i++) {
      this.vram[i] = new Uint8Array(state.vram[i]);
    }
    this.vramBank = state.vramBank;
    this.wramBank = state.wramBank;
    this.ie = state.ie;
    this.interruptFlags = state.interruptFlags;
    this.joypadState = state.joypadState;
    this.joypadSelect = state.joypadSelect;
    this.speedMode = state.speedMode;
    this.prepareSpeedSwitch = state.prepareSpeedSwitch;
    this.hdmaSource = state.hdmaSource;
    this.hdmaDest = state.hdmaDest;
    this.hdmaLength = state.hdmaLength;
    this.hdmaActive = state.hdmaActive;
    this.bgPaletteIndex = state.bgPaletteIndex;
    this.bgPaletteAutoInc = state.bgPaletteAutoInc;
    this.bgPaletteData = new Uint8Array(state.bgPaletteData);
    this.objPaletteIndex = state.objPaletteIndex;
    this.objPaletteAutoInc = state.objPaletteAutoInc;
    this.objPaletteData = new Uint8Array(state.objPaletteData);
  }

  setCartridge(cartridge: Cartridge): void {
    this.cartridge = cartridge;
  }

  setTimer(timer: Timer): void {
    this.timer = timer;
  }

  setPPUCallbacks(
    read: (addr: number) => number,
    write: (addr: number, value: number) => void
  ): void {
    this.ppuRead = read;
    this.ppuWrite = write;
  }

  // Request interrupt by setting flag
  requestInterrupt(bit: number): void {
    this.interruptFlags |= bit;
  }

  // Get pending interrupts for CPU
  getInterruptFlags(): number {
    return this.interruptFlags;
  }

  getInterruptEnable(): number {
    return this.ie;
  }

  // Clear interrupt flag (called by CPU after handling)
  clearInterruptFlag(bit: number): void {
    this.interruptFlags &= ~bit;
  }

  // Joypad input - buttons are active low
  setButtonState(button: number, pressed: boolean): void {
    if (pressed) {
      this.joypadState &= ~(1 << button);
    } else {
      this.joypadState |= 1 << button;
    }
  }

  // VRAM access for PPU
  readVram(address: number, bank?: number): number {
    const b = bank !== undefined ? bank : this.vramBank;
    return this.vram[b][address & 0x1fff];
  }

  writeVram(address: number, value: number): void {
    this.vram[this.vramBank][address & 0x1fff] = value;
  }

  // OAM access for PPU
  readOam(address: number): number {
    return this.oam[address & 0xff];
  }

  // Palette access for PPU
  getBgPalette(index: number): number {
    // Return 16-bit color from palette data
    const offset = index * 2;
    return this.bgPaletteData[offset] | (this.bgPaletteData[offset + 1] << 8);
  }

  getObjPalette(index: number): number {
    const offset = index * 2;
    return this.objPaletteData[offset] | (this.objPaletteData[offset + 1] << 8);
  }

  // DMG palette for compatibility mode
  getBgp(): number {
    return this.bgp;
  }

  getObp0(): number {
    return this.obp0;
  }

  getObp1(): number {
    return this.obp1;
  }

  // Speed mode
  isDoubleSpeed(): boolean {
    return this.speedMode === 1;
  }

  // Check if speed switch is pending (for STOP instruction handling)
  isSpeedSwitchPending(): boolean {
    return this.prepareSpeedSwitch;
  }

  // Perform the speed switch (called when STOP is executed with pending switch)
  performSpeedSwitch(): void {
    if (this.prepareSpeedSwitch) {
      this.speedMode = this.speedMode === 0 ? 1 : 0;
      this.prepareSpeedSwitch = false;
    }
  }

  // Main memory read
  read(address: number): number {
    address &= 0xffff;

    // ROM ($0000-$7FFF)
    if (address < 0x8000) {
      return this.cartridge?.read(address) ?? 0xff;
    }

    // VRAM ($8000-$9FFF)
    if (address < 0xa000) {
      return this.vram[this.vramBank][address - 0x8000];
    }

    // External RAM ($A000-$BFFF)
    if (address < 0xc000) {
      return this.cartridge?.read(address) ?? 0xff;
    }

    // WRAM Bank 0 ($C000-$CFFF)
    if (address < 0xd000) {
      return this.wram[0][address - 0xc000];
    }

    // WRAM Bank 1-7 ($D000-$DFFF)
    if (address < 0xe000) {
      return this.wram[this.wramBank][address - 0xd000];
    }

    // Echo RAM ($E000-$FDFF) - mirrors $C000-$DDFF
    if (address < 0xfe00) {
      return this.read(address - 0x2000);
    }

    // OAM ($FE00-$FE9F)
    if (address < 0xfea0) {
      return this.oam[address - 0xfe00];
    }

    // Not usable ($FEA0-$FEFF)
    if (address < 0xff00) {
      return 0xff;
    }

    // I/O Registers ($FF00-$FF7F)
    if (address < 0xff80) {
      return this.readIO(address);
    }

    // HRAM ($FF80-$FFFE)
    if (address < 0xffff) {
      return this.hram[address - 0xff80];
    }

    // IE ($FFFF)
    return this.ie;
  }

  // Main memory write
  write(address: number, value: number): void {
    address &= 0xffff;
    value &= 0xff;

    // ROM ($0000-$7FFF) - handled by cartridge/MBC
    if (address < 0x8000) {
      this.cartridge?.write(address, value);
      return;
    }

    // VRAM ($8000-$9FFF)
    if (address < 0xa000) {
      this.vram[this.vramBank][address - 0x8000] = value;
      return;
    }

    // External RAM ($A000-$BFFF)
    if (address < 0xc000) {
      this.cartridge?.write(address, value);
      return;
    }

    // WRAM Bank 0 ($C000-$CFFF)
    if (address < 0xd000) {
      this.wram[0][address - 0xc000] = value;
      return;
    }

    // WRAM Bank 1-7 ($D000-$DFFF)
    if (address < 0xe000) {
      this.wram[this.wramBank][address - 0xd000] = value;
      return;
    }

    // Echo RAM ($E000-$FDFF) - mirrors $C000-$DDFF
    if (address < 0xfe00) {
      this.write(address - 0x2000, value);
      return;
    }

    // OAM ($FE00-$FE9F)
    if (address < 0xfea0) {
      this.oam[address - 0xfe00] = value;
      return;
    }

    // Not usable ($FEA0-$FEFF)
    if (address < 0xff00) {
      return;
    }

    // I/O Registers ($FF00-$FF7F)
    if (address < 0xff80) {
      this.writeIO(address, value);
      return;
    }

    // HRAM ($FF80-$FFFE)
    if (address < 0xffff) {
      this.hram[address - 0xff80] = value;
      return;
    }

    // IE ($FFFF)
    this.ie = value;
  }

  // I/O register read
  private readIO(address: number): number {
    switch (address) {
      // Joypad ($FF00)
      case 0xff00: {
        let result = 0xcf; // Bits 6-7 unused, bits 0-3 = 1 (not pressed)

        if (!(this.joypadSelect & 0x10)) {
          // Direction buttons selected
          result &= 0xf0 | ((this.joypadState >> 4) & 0x0f);
        }
        if (!(this.joypadSelect & 0x20)) {
          // Action buttons selected
          result &= 0xf0 | (this.joypadState & 0x0f);
        }

        return (result & 0x0f) | (this.joypadSelect & 0x30) | 0xc0;
      }

      // Serial ($FF01-$FF02)
      case 0xff01:
        return 0xff; // Serial data (stub)
      case 0xff02:
        return 0x7e; // Serial control (stub)

      // Timer ($FF04-$FF07)
      case 0xff04:
      case 0xff05:
      case 0xff06:
      case 0xff07:
        return this.timer?.read(address) ?? 0xff;

      // Interrupt flags ($FF0F)
      case 0xff0f:
        return this.interruptFlags | 0xe0;

      // Audio registers ($FF10-$FF3F) - stub, return 0 for now
      case 0xff10:
      case 0xff11:
      case 0xff12:
      case 0xff13:
      case 0xff14:
      case 0xff16:
      case 0xff17:
      case 0xff18:
      case 0xff19:
      case 0xff1a:
      case 0xff1b:
      case 0xff1c:
      case 0xff1d:
      case 0xff1e:
      case 0xff20:
      case 0xff21:
      case 0xff22:
      case 0xff23:
      case 0xff24:
      case 0xff25:
      case 0xff26:
        return 0xff;

      // Wave RAM ($FF30-$FF3F)
      case 0xff30:
      case 0xff31:
      case 0xff32:
      case 0xff33:
      case 0xff34:
      case 0xff35:
      case 0xff36:
      case 0xff37:
      case 0xff38:
      case 0xff39:
      case 0xff3a:
      case 0xff3b:
      case 0xff3c:
      case 0xff3d:
      case 0xff3e:
      case 0xff3f:
        return 0xff;

      // PPU registers ($FF40-$FF4B)
      case 0xff40:
      case 0xff41:
      case 0xff42:
      case 0xff43:
      case 0xff44:
      case 0xff45:
      case 0xff46:
      case 0xff47:
      case 0xff48:
      case 0xff49:
      case 0xff4a:
      case 0xff4b:
        return this.ppuRead?.(address) ?? 0xff;

      // GBC: Speed switch ($FF4D)
      case 0xff4d:
        return (this.speedMode << 7) | (this.prepareSpeedSwitch ? 1 : 0) | 0x7e;

      // GBC: VRAM bank ($FF4F)
      case 0xff4f:
        return this.vramBank | 0xfe;

      // GBC: HDMA ($FF51-$FF55)
      case 0xff51:
        return (this.hdmaSource >> 8) & 0xff;
      case 0xff52:
        return this.hdmaSource & 0xf0;
      case 0xff53:
        return (this.hdmaDest >> 8) & 0x1f;
      case 0xff54:
        return this.hdmaDest & 0xf0;
      case 0xff55:
        return this.hdmaActive ? this.hdmaLength & 0x7f : 0xff;

      // GBC: Infrared ($FF56) - stub
      case 0xff56:
        return 0xff;

      // GBC: Background palette ($FF68-$FF69)
      case 0xff68:
        return this.bgPaletteIndex | (this.bgPaletteAutoInc ? 0x80 : 0) | 0x40;
      case 0xff69:
        return this.bgPaletteData[this.bgPaletteIndex & 0x3f];

      // GBC: Object palette ($FF6A-$FF6B)
      case 0xff6a:
        return this.objPaletteIndex | (this.objPaletteAutoInc ? 0x80 : 0) | 0x40;
      case 0xff6b:
        return this.objPaletteData[this.objPaletteIndex & 0x3f];

      // GBC: WRAM bank ($FF70)
      case 0xff70:
        return this.wramBank | 0xf8;

      default:
        return 0xff;
    }
  }

  // I/O register write
  private writeIO(address: number, value: number): void {
    switch (address) {
      // Joypad ($FF00)
      case 0xff00:
        this.joypadSelect = value & 0x30;
        break;

      // Serial ($FF01-$FF02) - stub
      case 0xff01:
      case 0xff02:
        break;

      // Timer ($FF04-$FF07)
      case 0xff04:
      case 0xff05:
      case 0xff06:
      case 0xff07:
        this.timer?.write(address, value);
        break;

      // Interrupt flags ($FF0F)
      case 0xff0f:
        this.interruptFlags = value & 0x1f;
        break;

      // Audio registers ($FF10-$FF3F) - stub for now
      case 0xff10:
      case 0xff11:
      case 0xff12:
      case 0xff13:
      case 0xff14:
      case 0xff16:
      case 0xff17:
      case 0xff18:
      case 0xff19:
      case 0xff1a:
      case 0xff1b:
      case 0xff1c:
      case 0xff1d:
      case 0xff1e:
      case 0xff20:
      case 0xff21:
      case 0xff22:
      case 0xff23:
      case 0xff24:
      case 0xff25:
      case 0xff26:
        break;

      // Wave RAM ($FF30-$FF3F)
      case 0xff30:
      case 0xff31:
      case 0xff32:
      case 0xff33:
      case 0xff34:
      case 0xff35:
      case 0xff36:
      case 0xff37:
      case 0xff38:
      case 0xff39:
      case 0xff3a:
      case 0xff3b:
      case 0xff3c:
      case 0xff3d:
      case 0xff3e:
      case 0xff3f:
        break;

      // PPU registers ($FF40-$FF4B)
      case 0xff40:
      case 0xff41:
      case 0xff42:
      case 0xff43:
      case 0xff44:
      case 0xff45:
      case 0xff46:
      case 0xff47:
      case 0xff48:
      case 0xff49:
      case 0xff4a:
      case 0xff4b:
        this.ppuWrite?.(address, value);
        break;

      // GBC: Speed switch ($FF4D)
      case 0xff4d:
        this.prepareSpeedSwitch = (value & 0x01) !== 0;
        break;

      // GBC: VRAM bank ($FF4F)
      case 0xff4f:
        this.vramBank = value & 0x01;
        break;

      // GBC: HDMA ($FF51-$FF55)
      case 0xff51:
        this.hdmaSource = (this.hdmaSource & 0x00ff) | ((value & 0xff) << 8);
        break;
      case 0xff52:
        this.hdmaSource = (this.hdmaSource & 0xff00) | (value & 0xf0);
        break;
      case 0xff53:
        this.hdmaDest = (this.hdmaDest & 0x00ff) | ((value & 0x1f) << 8);
        break;
      case 0xff54:
        this.hdmaDest = (this.hdmaDest & 0xff00) | (value & 0xf0);
        break;
      case 0xff55:
        this.startHdma(value);
        break;

      // GBC: Infrared ($FF56) - stub
      case 0xff56:
        break;

      // GBC: Background palette ($FF68-$FF69)
      case 0xff68:
        this.bgPaletteIndex = value & 0x3f;
        this.bgPaletteAutoInc = (value & 0x80) !== 0;
        break;
      case 0xff69:
        this.bgPaletteData[this.bgPaletteIndex & 0x3f] = value;
        if (this.bgPaletteAutoInc) {
          this.bgPaletteIndex = (this.bgPaletteIndex + 1) & 0x3f;
        }
        break;

      // GBC: Object palette ($FF6A-$FF6B)
      case 0xff6a:
        this.objPaletteIndex = value & 0x3f;
        this.objPaletteAutoInc = (value & 0x80) !== 0;
        break;
      case 0xff6b:
        this.objPaletteData[this.objPaletteIndex & 0x3f] = value;
        if (this.objPaletteAutoInc) {
          this.objPaletteIndex = (this.objPaletteIndex + 1) & 0x3f;
        }
        break;

      // GBC: WRAM bank ($FF70)
      case 0xff70:
        this.wramBank = (value & 0x07) || 1; // Bank 0 maps to bank 1
        break;
    }
  }

  // Start HDMA transfer
  private startHdma(value: number): void {
    if (this.hdmaActive && (value & 0x80) === 0) {
      // Cancel HDMA
      this.hdmaActive = false;
      return;
    }

    this.hdmaLength = (value & 0x7f) + 1;
    const isHblank = (value & 0x80) !== 0;

    if (isHblank) {
      // H-Blank DMA (transfers 16 bytes per H-Blank)
      this.hdmaActive = true;
    } else {
      // General Purpose DMA (immediate transfer)
      this.executeGdma();
    }
  }

  // Execute general purpose DMA (immediate)
  private executeGdma(): void {
    const length = this.hdmaLength * 16;
    const source = this.hdmaSource & 0xfff0;
    const dest = (this.hdmaDest & 0x1ff0) | 0x8000;

    for (let i = 0; i < length; i++) {
      const value = this.read(source + i);
      this.vram[this.vramBank][(dest + i) & 0x1fff] = value;
    }

    this.hdmaSource += length;
    this.hdmaDest += length;
    this.hdmaLength = 0;
    this.hdmaActive = false;
  }

  // Execute one chunk of H-Blank DMA (called by PPU during H-Blank)
  executeHdmaChunk(): void {
    if (!this.hdmaActive || this.hdmaLength === 0) {
      return;
    }

    const source = this.hdmaSource & 0xfff0;
    const dest = (this.hdmaDest & 0x1ff0) | 0x8000;

    // Transfer 16 bytes
    for (let i = 0; i < 16; i++) {
      const value = this.read(source + i);
      this.vram[this.vramBank][(dest + i) & 0x1fff] = value;
    }

    this.hdmaSource += 16;
    this.hdmaDest += 16;
    this.hdmaLength--;

    if (this.hdmaLength === 0) {
      this.hdmaActive = false;
    }
  }

  // OAM DMA transfer ($FF46)
  executeOamDma(value: number): void {
    const source = value << 8;
    for (let i = 0; i < 160; i++) {
      this.oam[i] = this.read(source + i);
    }
  }
}
