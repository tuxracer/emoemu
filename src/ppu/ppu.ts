import { Cartridge } from '../cartridge/cartridge.js';

// PPU registers
const PPUCTRL = 0x2000;
const PPUMASK = 0x2001;
const PPUSTATUS = 0x2002;
const OAMADDR = 0x2003;
const OAMDATA = 0x2004;
const PPUSCROLL = 0x2005;
const PPUADDR = 0x2006;
const PPUDATA = 0x2007;

// Control register flags
export const CtrlFlag = {
  NAMETABLE_X: 0x01,
  NAMETABLE_Y: 0x02,
  INCREMENT: 0x04,
  SPRITE_PATTERN: 0x08,
  BACKGROUND_PATTERN: 0x10,
  SPRITE_SIZE: 0x20,
  MASTER_SLAVE: 0x40,
  NMI_ENABLE: 0x80,
} as const;

// Mask register flags
export const MaskFlag = {
  GRAYSCALE: 0x01,
  SHOW_LEFT_BG: 0x02,
  SHOW_LEFT_SPRITES: 0x04,
  SHOW_BG: 0x08,
  SHOW_SPRITES: 0x10,
  EMPHASIZE_RED: 0x20,
  EMPHASIZE_GREEN: 0x40,
  EMPHASIZE_BLUE: 0x80,
} as const;

// Status register flags
export const StatusFlag = {
  SPRITE_OVERFLOW: 0x20,
  SPRITE_ZERO_HIT: 0x40,
  VBLANK: 0x80,
} as const;

export class PPU {
  // Frame buffer (256x240 pixels, each pixel is a palette index)
  frameBuffer: Uint8Array = new Uint8Array(256 * 240);

  // PPU memory
  private vram: Uint8Array = new Uint8Array(2048); // 2KB internal VRAM
  private paletteRam: Uint8Array = new Uint8Array(32);
  private oam: Uint8Array = new Uint8Array(256); // Object Attribute Memory (sprites)

  // PPU registers
  private ctrl: number = 0;
  private mask: number = 0;
  private status: number = 0;
  private oamAddr: number = 0;

  // Internal registers
  private v: number = 0; // Current VRAM address (15 bits)
  private t: number = 0; // Temporary VRAM address (15 bits)
  private x: number = 0; // Fine X scroll (3 bits)
  private w: boolean = false; // Write toggle

  // Data buffer for PPUDATA reads
  private dataBuffer: number = 0;

  // Timing
  scanline: number = 0;
  cycle: number = 0;
  frameComplete: boolean = false;

  // NMI flag
  nmiOccurred: boolean = false;
  nmiOutput: boolean = false;

  private cartridge: Cartridge | null = null;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.ctrl = 0;
    this.mask = 0;
    this.status = 0;
    this.oamAddr = 0;
    this.v = 0;
    this.t = 0;
    this.x = 0;
    this.w = false;
    this.dataBuffer = 0;
    this.scanline = 0;
    this.cycle = 0;
    this.frameComplete = false;
    this.nmiOccurred = false;
    this.nmiOutput = false;
  }

  connectCartridge(cartridge: Cartridge): void {
    this.cartridge = cartridge;
  }

  // CPU reads from PPU registers
  cpuRead(address: number): number {
    let data = 0;

    switch (address) {
      case PPUSTATUS:
        data = (this.status & 0xe0) | (this.dataBuffer & 0x1f);
        this.status &= ~StatusFlag.VBLANK;
        this.w = false;
        break;

      case OAMDATA:
        data = this.oam[this.oamAddr];
        break;

      case PPUDATA:
        data = this.dataBuffer;
        this.dataBuffer = this.ppuRead(this.v);

        // Palette reads are not buffered
        if (this.v >= 0x3f00) {
          data = this.dataBuffer;
        }

        this.v += (this.ctrl & CtrlFlag.INCREMENT) ? 32 : 1;
        this.v &= 0x7fff;
        break;
    }

    return data;
  }

  // CPU writes to PPU registers
  cpuWrite(address: number, data: number): void {
    switch (address) {
      case PPUCTRL:
        this.ctrl = data;
        this.nmiOutput = (data & CtrlFlag.NMI_ENABLE) !== 0;
        this.t = (this.t & 0xf3ff) | ((data & 0x03) << 10);
        break;

      case PPUMASK:
        this.mask = data;
        break;

      case OAMADDR:
        this.oamAddr = data;
        break;

      case OAMDATA:
        this.oam[this.oamAddr] = data;
        this.oamAddr = (this.oamAddr + 1) & 0xff;
        break;

      case PPUSCROLL:
        if (!this.w) {
          this.t = (this.t & 0xffe0) | (data >> 3);
          this.x = data & 0x07;
        } else {
          this.t = (this.t & 0x8c1f) | ((data & 0x07) << 12) | ((data & 0xf8) << 2);
        }
        this.w = !this.w;
        break;

      case PPUADDR:
        if (!this.w) {
          this.t = (this.t & 0x00ff) | ((data & 0x3f) << 8);
        } else {
          this.t = (this.t & 0xff00) | data;
          this.v = this.t;
        }
        this.w = !this.w;
        break;

      case PPUDATA:
        this.ppuWrite(this.v, data);
        this.v += (this.ctrl & CtrlFlag.INCREMENT) ? 32 : 1;
        this.v &= 0x7fff;
        break;
    }
  }

  // OAM DMA transfer
  oamDma(data: Uint8Array): void {
    for (let i = 0; i < 256; i++) {
      this.oam[(this.oamAddr + i) & 0xff] = data[i];
    }
  }

  // PPU internal memory read
  private ppuRead(address: number): number {
    address &= 0x3fff;

    if (address < 0x2000) {
      // Pattern tables (CHR ROM/RAM)
      return this.cartridge?.ppuRead(address) ?? 0;
    } else if (address < 0x3f00) {
      // Nametables
      return this.vram[this.mirrorAddress(address)];
    } else {
      // Palette RAM
      let paletteAddr = address & 0x1f;
      // Mirrors of $3F10/$3F14/$3F18/$3F1C
      if (paletteAddr >= 0x10 && (paletteAddr & 0x03) === 0) {
        paletteAddr -= 0x10;
      }
      return this.paletteRam[paletteAddr];
    }
  }

  // PPU internal memory write
  private ppuWrite(address: number, data: number): void {
    address &= 0x3fff;

    if (address < 0x2000) {
      // Pattern tables (CHR ROM/RAM)
      this.cartridge?.ppuWrite(address, data);
    } else if (address < 0x3f00) {
      // Nametables
      this.vram[this.mirrorAddress(address)] = data;
    } else {
      // Palette RAM
      let paletteAddr = address & 0x1f;
      if (paletteAddr >= 0x10 && (paletteAddr & 0x03) === 0) {
        paletteAddr -= 0x10;
      }
      this.paletteRam[paletteAddr] = data;
    }
  }

  // Nametable mirroring
  private mirrorAddress(address: number): number {
    address = (address - 0x2000) & 0x0fff;
    const nametable = address >> 10;
    const offset = address & 0x03ff;

    const mirrorMode = this.cartridge?.mirrorMode ?? 0;

    switch (mirrorMode) {
      case 0: // Horizontal mirroring
        return ((nametable >> 1) << 10) + offset;
      case 1: // Vertical mirroring
        return ((nametable & 1) << 10) + offset;
      case 2: // Single-screen lower
        return offset;
      case 3: // Single-screen upper
        return 0x400 + offset;
      default:
        return address & 0x07ff;
    }
  }

  // Run one PPU cycle
  clock(): void {
    // Visible scanlines (0-239)
    if (this.scanline < 240) {
      this.renderPixel();
    }

    // Post-render scanline (240) - idle

    // Vertical blank starts at scanline 241
    if (this.scanline === 241 && this.cycle === 1) {
      this.status |= StatusFlag.VBLANK;
      this.nmiOccurred = true;
    }

    // Pre-render scanline (261)
    if (this.scanline === 261) {
      if (this.cycle === 1) {
        this.status &= ~StatusFlag.VBLANK;
        this.status &= ~StatusFlag.SPRITE_ZERO_HIT;
        this.status &= ~StatusFlag.SPRITE_OVERFLOW;
        this.nmiOccurred = false;
      }
    }

    // Advance cycle/scanline
    this.cycle++;
    if (this.cycle > 340) {
      this.cycle = 0;
      this.scanline++;
      if (this.scanline > 261) {
        this.scanline = 0;
        this.frameComplete = true;
      }
    }
  }

  // Render a single pixel
  private renderPixel(): void {
    if (this.cycle >= 1 && this.cycle <= 256) {
      const x = this.cycle - 1;
      const y = this.scanline;

      let bgPixel = 0;
      let bgPalette = 0;

      // Background rendering
      if (this.mask & MaskFlag.SHOW_BG) {
        // Simplified background rendering
        const nametableAddr = 0x2000 | (this.v & 0x0fff);
        const tileIndex = this.ppuRead(nametableAddr);

        const patternAddr = ((this.ctrl & CtrlFlag.BACKGROUND_PATTERN) ? 0x1000 : 0) +
          (tileIndex << 4) + ((this.v >> 12) & 0x07);

        const patternLo = this.ppuRead(patternAddr);
        const patternHi = this.ppuRead(patternAddr + 8);

        const bitPos = 7 - this.x;
        bgPixel = ((patternLo >> bitPos) & 1) | (((patternHi >> bitPos) & 1) << 1);

        // Get attribute
        const attrAddr = 0x23c0 | (this.v & 0x0c00) |
          ((this.v >> 4) & 0x38) | ((this.v >> 2) & 0x07);
        const attrByte = this.ppuRead(attrAddr);
        const attrShift = ((this.v >> 4) & 0x04) | (this.v & 0x02);
        bgPalette = (attrByte >> attrShift) & 0x03;
      }

      // Get final color from palette
      let paletteIndex = 0;
      if (bgPixel !== 0) {
        paletteIndex = this.ppuRead(0x3f00 + (bgPalette << 2) + bgPixel);
      } else {
        paletteIndex = this.ppuRead(0x3f00);
      }

      this.frameBuffer[y * 256 + x] = paletteIndex;
    }
  }

  shouldGenerateNMI(): boolean {
    return this.nmiOccurred && this.nmiOutput;
  }
}
