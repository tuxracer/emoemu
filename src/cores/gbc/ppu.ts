// Game Boy Color PPU (Pixel Processing Unit) implementation
// Supports both DMG and CGB modes

import type { Bus } from './bus.js';

export interface PpuState {
  lcdc: number;
  stat: number;
  scy: number;
  scx: number;
  ly: number;
  lyc: number;
  wy: number;
  wx: number;
  bgp: number;
  obp0: number;
  obp1: number;
  mode: number;
  cycles: number;
  windowLine: number;
  frameComplete: boolean;
}

// LCDC bits
const LCDC_BG_ENABLE = 0x01;
const LCDC_OBJ_ENABLE = 0x02;
const LCDC_OBJ_SIZE = 0x04; // 0 = 8x8, 1 = 8x16
const LCDC_BG_TILE_MAP = 0x08; // 0 = $9800, 1 = $9C00
const LCDC_BG_TILE_DATA = 0x10; // 0 = $8800, 1 = $8000
const LCDC_WINDOW_ENABLE = 0x20;
const LCDC_WINDOW_TILE_MAP = 0x40; // 0 = $9800, 1 = $9C00
const LCDC_LCD_ENABLE = 0x80;

// STAT bits
const STAT_MODE_MASK = 0x03;
const STAT_LYC_FLAG = 0x04;
const STAT_HBLANK_INT = 0x08;
const STAT_VBLANK_INT = 0x10;
const STAT_OAM_INT = 0x20;
const STAT_LYC_INT = 0x40;

// PPU modes
const MODE_HBLANK = 0;
const MODE_VBLANK = 1;
const MODE_OAM_SCAN = 2;
const MODE_DRAWING = 3;

// Timing constants
const CYCLES_PER_LINE = 456;
const VISIBLE_LINES = 144;
const TOTAL_LINES = 154;
const OAM_SCAN_CYCLES = 80;
const DRAWING_MIN_CYCLES = 172;

// Display dimensions
const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;

export class PPU {
  // Registers
  private lcdc = 0x91; // LCD Control
  private stat = 0x00; // LCD Status
  private scy = 0; // Scroll Y
  private scx = 0; // Scroll X
  private ly = 0; // Current scanline
  private lyc = 0; // LY Compare
  private wy = 0; // Window Y
  private wx = 0; // Window X

  // DMG palettes
  private bgp = 0xfc;
  private obp0 = 0xff;
  private obp1 = 0xff;

  // PPU state
  private mode = MODE_OAM_SCAN;
  private cycles = 0;
  private windowLine = 0; // Internal window line counter
  private frameComplete = false;

  // Framebuffer (RGB15 format - 2 bytes per pixel)
  private framebuffer = new Uint16Array(SCREEN_WIDTH * SCREEN_HEIGHT);

  // Sprite buffer for current scanline (max 10 sprites)
  private spriteBuffer: Array<{
    x: number;
    y: number;
    tile: number;
    flags: number;
    oamIndex: number;
  }> = [];

  // Memory bus reference
  private bus: Bus;
  private isCgb: boolean;

  constructor(bus: Bus, isCgb: boolean = true) {
    this.bus = bus;
    this.isCgb = isCgb;

    // Set up PPU register callbacks on bus
    bus.setPPUCallbacks(
      (addr) => this.readRegister(addr),
      (addr, value) => this.writeRegister(addr, value)
    );
  }

  reset(): void {
    this.lcdc = 0x91;
    this.stat = 0x00;
    this.scy = 0;
    this.scx = 0;
    this.ly = 0;
    this.lyc = 0;
    this.wy = 0;
    this.wx = 0;
    this.bgp = 0xfc;
    this.obp0 = 0xff;
    this.obp1 = 0xff;
    this.mode = MODE_OAM_SCAN;
    this.cycles = 0;
    this.windowLine = 0;
    this.frameComplete = false;
    this.framebuffer.fill(0x7fff); // White
  }

  getState(): PpuState {
    return {
      lcdc: this.lcdc,
      stat: this.stat,
      scy: this.scy,
      scx: this.scx,
      ly: this.ly,
      lyc: this.lyc,
      wy: this.wy,
      wx: this.wx,
      bgp: this.bgp,
      obp0: this.obp0,
      obp1: this.obp1,
      mode: this.mode,
      cycles: this.cycles,
      windowLine: this.windowLine,
      frameComplete: this.frameComplete,
    };
  }

  setState(state: PpuState): void {
    this.lcdc = state.lcdc;
    this.stat = state.stat;
    this.scy = state.scy;
    this.scx = state.scx;
    this.ly = state.ly;
    this.lyc = state.lyc;
    this.wy = state.wy;
    this.wx = state.wx;
    this.bgp = state.bgp;
    this.obp0 = state.obp0;
    this.obp1 = state.obp1;
    this.mode = state.mode;
    this.cycles = state.cycles;
    this.windowLine = state.windowLine;
    this.frameComplete = state.frameComplete;
  }

  getFramebuffer(): Uint16Array {
    return this.framebuffer;
  }

  isFrameComplete(): boolean {
    return this.frameComplete;
  }

  clearFrameComplete(): void {
    this.frameComplete = false;
  }

  // Read PPU register
  readRegister(address: number): number {
    switch (address) {
      case 0xff40:
        return this.lcdc;
      case 0xff41:
        return (this.stat & 0x78) | (this.lyc === this.ly ? STAT_LYC_FLAG : 0) | this.mode | 0x80;
      case 0xff42:
        return this.scy;
      case 0xff43:
        return this.scx;
      case 0xff44:
        return this.ly;
      case 0xff45:
        return this.lyc;
      case 0xff46:
        return 0xff; // DMA register (write-only)
      case 0xff47:
        return this.bgp;
      case 0xff48:
        return this.obp0;
      case 0xff49:
        return this.obp1;
      case 0xff4a:
        return this.wy;
      case 0xff4b:
        return this.wx;
      default:
        return 0xff;
    }
  }

  // Write PPU register
  writeRegister(address: number, value: number): void {
    switch (address) {
      case 0xff40:
        const wasEnabled = (this.lcdc & LCDC_LCD_ENABLE) !== 0;
        this.lcdc = value;
        const isEnabled = (this.lcdc & LCDC_LCD_ENABLE) !== 0;

        // LCD turning off
        if (wasEnabled && !isEnabled) {
          this.ly = 0;
          this.mode = MODE_HBLANK;
          this.cycles = 0;
          this.stat &= ~STAT_MODE_MASK;
        }
        // LCD turning on
        if (!wasEnabled && isEnabled) {
          this.mode = MODE_OAM_SCAN;
          this.cycles = 0;
          this.checkStatInterrupt();
        }
        break;
      case 0xff41:
        this.stat = (value & 0x78) | (this.stat & 0x07);
        this.checkStatInterrupt();
        break;
      case 0xff42:
        this.scy = value;
        break;
      case 0xff43:
        this.scx = value;
        break;
      case 0xff44:
        // LY is read-only
        break;
      case 0xff45:
        this.lyc = value;
        this.checkStatInterrupt();
        break;
      case 0xff46:
        // OAM DMA transfer
        this.bus.executeOamDma(value);
        break;
      case 0xff47:
        this.bgp = value;
        break;
      case 0xff48:
        this.obp0 = value;
        break;
      case 0xff49:
        this.obp1 = value;
        break;
      case 0xff4a:
        this.wy = value;
        break;
      case 0xff4b:
        this.wx = value;
        break;
    }
  }

  // Tick PPU for given cycles
  tick(cycles: number): void {
    if (!(this.lcdc & LCDC_LCD_ENABLE)) {
      return;
    }

    this.cycles += cycles;

    switch (this.mode) {
      case MODE_OAM_SCAN:
        if (this.cycles >= OAM_SCAN_CYCLES) {
          this.cycles -= OAM_SCAN_CYCLES;
          this.mode = MODE_DRAWING;
          this.scanOam();
        }
        break;

      case MODE_DRAWING:
        if (this.cycles >= DRAWING_MIN_CYCLES) {
          this.cycles -= DRAWING_MIN_CYCLES;
          this.mode = MODE_HBLANK;
          this.renderScanline();
          this.checkStatInterrupt();

          // Execute HDMA chunk during H-Blank
          this.bus.executeHdmaChunk();
        }
        break;

      case MODE_HBLANK: {
        const hblankCycles = CYCLES_PER_LINE - OAM_SCAN_CYCLES - DRAWING_MIN_CYCLES;
        if (this.cycles >= hblankCycles) {
          this.cycles -= hblankCycles;
          this.ly++;

          if (this.ly === VISIBLE_LINES) {
            this.mode = MODE_VBLANK;
            this.frameComplete = true;
            this.bus.requestInterrupt(0x01); // VBlank interrupt
            this.checkStatInterrupt();
          } else {
            this.mode = MODE_OAM_SCAN;
            this.checkStatInterrupt();
          }
        }
        break;
      }

      case MODE_VBLANK:
        if (this.cycles >= CYCLES_PER_LINE) {
          this.cycles -= CYCLES_PER_LINE;
          this.ly++;

          if (this.ly >= TOTAL_LINES) {
            this.ly = 0;
            this.windowLine = 0;
            this.mode = MODE_OAM_SCAN;
            this.checkStatInterrupt();
          }
        }
        break;
    }
  }

  // Check and potentially request STAT interrupt
  private checkStatInterrupt(): void {
    let interrupt = false;

    // LYC=LY interrupt
    if ((this.stat & STAT_LYC_INT) && this.ly === this.lyc) {
      interrupt = true;
    }

    // Mode interrupts
    if ((this.stat & STAT_HBLANK_INT) && this.mode === MODE_HBLANK) {
      interrupt = true;
    }
    if ((this.stat & STAT_VBLANK_INT) && this.mode === MODE_VBLANK) {
      interrupt = true;
    }
    if ((this.stat & STAT_OAM_INT) && this.mode === MODE_OAM_SCAN) {
      interrupt = true;
    }

    if (interrupt) {
      this.bus.requestInterrupt(0x02); // STAT interrupt
    }
  }

  // Scan OAM for sprites on current scanline
  private scanOam(): void {
    this.spriteBuffer = [];
    const spriteHeight = (this.lcdc & LCDC_OBJ_SIZE) ? 16 : 8;

    for (let i = 0; i < 40 && this.spriteBuffer.length < 10; i++) {
      const oamAddr = i * 4;
      const y = this.bus.readOam(oamAddr) - 16;
      const x = this.bus.readOam(oamAddr + 1) - 8;
      const tile = this.bus.readOam(oamAddr + 2);
      const flags = this.bus.readOam(oamAddr + 3);

      // Check if sprite is on current scanline
      if (this.ly >= y && this.ly < y + spriteHeight) {
        this.spriteBuffer.push({ x, y, tile, flags, oamIndex: i });
      }
    }

    // Sort by X coordinate (lower X = higher priority), then by OAM index
    // In CGB mode, only OAM index matters for priority
    if (!this.isCgb) {
      this.spriteBuffer.sort((a, b) => {
        if (a.x !== b.x) return a.x - b.x;
        return a.oamIndex - b.oamIndex;
      });
    }
  }

  // Render current scanline
  private renderScanline(): void {
    if (this.ly >= VISIBLE_LINES) return;

    const lineOffset = this.ly * SCREEN_WIDTH;

    // Background priority array for sprite rendering
    const bgPriority = new Uint8Array(SCREEN_WIDTH);

    // Render background
    if (this.lcdc & LCDC_BG_ENABLE || this.isCgb) {
      this.renderBackground(lineOffset, bgPriority);
    } else {
      // In DMG mode with BG disabled, fill with white
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        this.framebuffer[lineOffset + x] = this.getColor(0, 0);
      }
    }

    // Render window
    if ((this.lcdc & LCDC_WINDOW_ENABLE) && this.wy <= this.ly && this.wx <= 166) {
      this.renderWindow(lineOffset, bgPriority);
    }

    // Render sprites
    if (this.lcdc & LCDC_OBJ_ENABLE) {
      this.renderSprites(lineOffset, bgPriority);
    }
  }

  // Render background layer
  private renderBackground(lineOffset: number, bgPriority: Uint8Array): void {
    const tileMapBase = (this.lcdc & LCDC_BG_TILE_MAP) ? 0x1c00 : 0x1800;
    const tileDataBase = (this.lcdc & LCDC_BG_TILE_DATA) ? 0x0000 : 0x0800;
    const signedTiles = !(this.lcdc & LCDC_BG_TILE_DATA);

    const y = (this.ly + this.scy) & 0xff;
    const tileRow = y >> 3;
    const pixelY = y & 7;

    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const bgX = (x + this.scx) & 0xff;
      const tileCol = bgX >> 3;
      const pixelX = bgX & 7;

      const tileMapAddr = tileMapBase + tileRow * 32 + tileCol;
      let tileIndex = this.bus.readVram(tileMapAddr, 0);

      // Get tile attributes (CGB only, from VRAM bank 1)
      let tileAttrs = 0;
      let vramBank = 0;
      let paletteIndex = 0;
      let flipX = false;
      let flipY = false;
      let bgPriorityFlag = false;

      if (this.isCgb) {
        tileAttrs = this.bus.readVram(tileMapAddr, 1);
        vramBank = (tileAttrs >> 3) & 1;
        paletteIndex = tileAttrs & 0x07;
        flipX = (tileAttrs & 0x20) !== 0;
        flipY = (tileAttrs & 0x40) !== 0;
        bgPriorityFlag = (tileAttrs & 0x80) !== 0;
      }

      // Adjust tile index for signed addressing
      if (signedTiles) {
        tileIndex = tileIndex < 128 ? tileIndex + 128 : tileIndex - 128;
      }

      // Get pixel color from tile
      const tileY = flipY ? 7 - pixelY : pixelY;
      const tileX = flipX ? pixelX : 7 - pixelX;
      const colorIndex = this.getTilePixel(tileDataBase, tileIndex, tileX, tileY, vramBank);

      // Set background priority for sprite rendering
      if (colorIndex !== 0 || bgPriorityFlag) {
        bgPriority[x] = bgPriorityFlag ? 2 : 1;
      }

      // Get actual color
      const color = this.isCgb
        ? this.getCgbBgColor(paletteIndex, colorIndex)
        : this.getDmgColor(this.bgp, colorIndex);

      this.framebuffer[lineOffset + x] = color;
    }
  }

  // Render window layer
  private renderWindow(lineOffset: number, bgPriority: Uint8Array): void {
    const windowX = this.wx - 7;
    if (windowX >= SCREEN_WIDTH) return;

    const tileMapBase = (this.lcdc & LCDC_WINDOW_TILE_MAP) ? 0x1c00 : 0x1800;
    const tileDataBase = (this.lcdc & LCDC_BG_TILE_DATA) ? 0x0000 : 0x0800;
    const signedTiles = !(this.lcdc & LCDC_BG_TILE_DATA);

    const tileRow = this.windowLine >> 3;
    const pixelY = this.windowLine & 7;

    let windowVisible = false;

    for (let x = Math.max(0, windowX); x < SCREEN_WIDTH; x++) {
      const winX = x - windowX;
      const tileCol = winX >> 3;
      const pixelX = winX & 7;

      const tileMapAddr = tileMapBase + tileRow * 32 + tileCol;
      let tileIndex = this.bus.readVram(tileMapAddr, 0);

      // Get tile attributes (CGB only)
      let vramBank = 0;
      let paletteIndex = 0;
      let flipX = false;
      let flipY = false;
      let bgPriorityFlag = false;

      if (this.isCgb) {
        const tileAttrs = this.bus.readVram(tileMapAddr, 1);
        vramBank = (tileAttrs >> 3) & 1;
        paletteIndex = tileAttrs & 0x07;
        flipX = (tileAttrs & 0x20) !== 0;
        flipY = (tileAttrs & 0x40) !== 0;
        bgPriorityFlag = (tileAttrs & 0x80) !== 0;
      }

      if (signedTiles) {
        tileIndex = tileIndex < 128 ? tileIndex + 128 : tileIndex - 128;
      }

      const tileY = flipY ? 7 - pixelY : pixelY;
      const tileX = flipX ? pixelX : 7 - pixelX;
      const colorIndex = this.getTilePixel(tileDataBase, tileIndex, tileX, tileY, vramBank);

      if (colorIndex !== 0 || bgPriorityFlag) {
        bgPriority[x] = bgPriorityFlag ? 2 : 1;
      }

      const color = this.isCgb
        ? this.getCgbBgColor(paletteIndex, colorIndex)
        : this.getDmgColor(this.bgp, colorIndex);

      this.framebuffer[lineOffset + x] = color;
      windowVisible = true;
    }

    if (windowVisible) {
      this.windowLine++;
    }
  }

  // Render sprites
  private renderSprites(lineOffset: number, bgPriority: Uint8Array): void {
    const spriteHeight = (this.lcdc & LCDC_OBJ_SIZE) ? 16 : 8;

    // Render sprites in reverse order (lower priority first, gets overwritten)
    for (let i = this.spriteBuffer.length - 1; i >= 0; i--) {
      const sprite = this.spriteBuffer[i];
      const spriteY = this.ly - sprite.y;

      let tileIndex = sprite.tile;
      if (spriteHeight === 16) {
        tileIndex &= 0xfe; // Ignore bit 0 for 8x16 sprites
      }

      const flipX = (sprite.flags & 0x20) !== 0;
      const flipY = (sprite.flags & 0x40) !== 0;
      const bgPriorityBit = (sprite.flags & 0x80) !== 0;

      let vramBank = 0;
      let paletteIndex = 0;

      if (this.isCgb) {
        vramBank = (sprite.flags >> 3) & 1;
        paletteIndex = sprite.flags & 0x07;
      } else {
        paletteIndex = (sprite.flags & 0x10) ? 1 : 0;
      }

      let tileY = flipY ? (spriteHeight - 1 - spriteY) : spriteY;

      // For 8x16 sprites, adjust tile index based on which half
      if (spriteHeight === 16) {
        if (tileY >= 8) {
          tileIndex++;
          tileY -= 8;
        }
      }

      for (let pixelX = 0; pixelX < 8; pixelX++) {
        const screenX = sprite.x + pixelX;
        if (screenX < 0 || screenX >= SCREEN_WIDTH) continue;

        const tileX = flipX ? pixelX : 7 - pixelX;
        const colorIndex = this.getTilePixel(0x0000, tileIndex, tileX, tileY, vramBank);

        // Sprite color 0 is transparent
        if (colorIndex === 0) continue;

        // Check background priority
        // In CGB mode: BG-to-OAM priority bit in LCDC.0 and tile attributes
        if (this.isCgb) {
          if (!(this.lcdc & LCDC_BG_ENABLE)) {
            // BG/Window disabled, sprites always on top
          } else if (bgPriorityBit || bgPriority[screenX] === 2) {
            // Sprite behind BG colors 1-3
            if (bgPriority[screenX] !== 0) continue;
          }
        } else {
          // DMG mode: BG priority bit
          if (bgPriorityBit && bgPriority[screenX] !== 0) {
            continue;
          }
        }

        const color = this.isCgb
          ? this.getCgbObjColor(paletteIndex, colorIndex)
          : this.getDmgColor(paletteIndex ? this.obp1 : this.obp0, colorIndex);

        this.framebuffer[lineOffset + screenX] = color;
      }
    }
  }

  // Get pixel from tile data
  private getTilePixel(base: number, tileIndex: number, x: number, y: number, vramBank: number): number {
    const tileAddr = base + tileIndex * 16 + y * 2;
    const lo = this.bus.readVram(tileAddr, vramBank);
    const hi = this.bus.readVram(tileAddr + 1, vramBank);
    const bit = x;
    return ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
  }

  // Get DMG color from palette
  private getDmgColor(palette: number, colorIndex: number): number {
    const shade = (palette >> (colorIndex * 2)) & 0x03;
    // Convert DMG shade to RGB15
    const shades = [0x7fff, 0x56b5, 0x294a, 0x0000]; // White, Light gray, Dark gray, Black
    return shades[shade];
  }

  // Get CGB background color
  private getCgbBgColor(paletteIndex: number, colorIndex: number): number {
    const index = paletteIndex * 4 + colorIndex;
    return this.bus.getBgPalette(index);
  }

  // Get CGB object color
  private getCgbObjColor(paletteIndex: number, colorIndex: number): number {
    const index = paletteIndex * 4 + colorIndex;
    return this.bus.getObjPalette(index);
  }

  // Placeholder for DMG compatibility color mapping
  private getColor(_palette: number, shade: number): number {
    const shades = [0x7fff, 0x56b5, 0x294a, 0x0000];
    return shades[shade & 0x03];
  }
}
