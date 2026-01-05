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

// Sprite attributes byte flags
const SpriteAttr = {
  PALETTE: 0x03,       // Bits 0-1: Palette (4 to 7)
  PRIORITY: 0x20,      // Bit 5: Priority (0 = in front, 1 = behind)
  FLIP_H: 0x40,        // Bit 6: Flip sprite horizontally
  FLIP_V: 0x80,        // Bit 7: Flip sprite vertically
} as const;

// Sprite data for rendering (8 sprites per scanline max)
interface SpriteData {
  x: number;           // X position
  patternLo: number;   // Low pattern byte
  patternHi: number;   // High pattern byte
  attributes: number;  // Sprite attributes
  index: number;       // Original OAM index (for sprite 0 hit)
}

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

  // Sprite rendering data
  private spriteCount: number = 0;
  private sprites: SpriteData[] = [];
  private spriteZeroOnLine: boolean = false;
  private spriteZeroBeingRendered: boolean = false;

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
    this.spriteCount = 0;
    this.sprites = [];
    this.spriteZeroOnLine = false;
    this.spriteZeroBeingRendered = false;
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
    const renderingEnabled = (this.mask & (MaskFlag.SHOW_BG | MaskFlag.SHOW_SPRITES)) !== 0;
    const visibleLine = this.scanline < 240;
    const preLine = this.scanline === 261;
    const visibleCycle = this.cycle >= 1 && this.cycle <= 256;
    const fetchCycle = this.cycle >= 1 && this.cycle <= 256 || this.cycle >= 321 && this.cycle <= 336;

    // Visible scanlines (0-239)
    if (visibleLine && visibleCycle) {
      this.renderPixel();
    }

    // Scrolling updates during rendering
    if (renderingEnabled) {
      if (visibleLine || preLine) {
        // Increment horizontal scroll after each tile
        if (fetchCycle && (this.cycle % 8 === 0)) {
          this.incrementX();
        }

        // Increment vertical scroll at end of scanline
        if (this.cycle === 256) {
          this.incrementY();
        }

        // Copy horizontal bits at start of each scanline
        if (this.cycle === 257) {
          this.copyX();
          // Evaluate sprites for NEXT scanline
          if (visibleLine || this.scanline === 261) {
            this.evaluateSprites();
          }
        }
      }

      // Copy vertical bits during pre-render scanline
      if (preLine && this.cycle >= 280 && this.cycle <= 304) {
        this.copyY();
      }
    }

    // Vertical blank starts at scanline 241
    if (this.scanline === 241 && this.cycle === 1) {
      this.status |= StatusFlag.VBLANK;
      this.nmiOccurred = true;
    }

    // Pre-render scanline (261)
    if (preLine && this.cycle === 1) {
      this.status &= ~StatusFlag.VBLANK;
      this.status &= ~StatusFlag.SPRITE_ZERO_HIT;
      this.status &= ~StatusFlag.SPRITE_OVERFLOW;
      this.nmiOccurred = false;
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

  // Evaluate sprites for the current scanline
  private evaluateSprites(): void {
    const nextScanline = this.scanline;
    const spriteHeight = (this.ctrl & CtrlFlag.SPRITE_SIZE) ? 16 : 8;

    this.spriteCount = 0;
    this.sprites = [];
    this.spriteZeroOnLine = false;

    // Scan all 64 sprites in OAM
    for (let i = 0; i < 64 && this.spriteCount < 8; i++) {
      const oamIndex = i * 4;
      const spriteY = this.oam[oamIndex];
      const tileIndex = this.oam[oamIndex + 1];
      const attributes = this.oam[oamIndex + 2];
      const spriteX = this.oam[oamIndex + 3];

      // Check if sprite is on this scanline
      const diff = nextScanline - spriteY;
      if (diff >= 0 && diff < spriteHeight) {
        if (this.spriteCount < 8) {
          // Fetch sprite pattern data
          let row = diff;

          // Handle vertical flip
          if (attributes & SpriteAttr.FLIP_V) {
            row = spriteHeight - 1 - row;
          }

          let patternAddr: number;

          if (spriteHeight === 16) {
            // 8x16 sprites: bit 0 of tile index selects pattern table
            const table = (tileIndex & 0x01) * 0x1000;
            const tile = tileIndex & 0xFE;
            if (row < 8) {
              patternAddr = table + (tile * 16) + row;
            } else {
              patternAddr = table + ((tile + 1) * 16) + (row - 8);
            }
          } else {
            // 8x8 sprites: use PPUCTRL sprite pattern table
            const table = (this.ctrl & CtrlFlag.SPRITE_PATTERN) ? 0x1000 : 0;
            patternAddr = table + (tileIndex * 16) + row;
          }

          let patternLo = this.ppuRead(patternAddr);
          let patternHi = this.ppuRead(patternAddr + 8);

          // Handle horizontal flip
          if (attributes & SpriteAttr.FLIP_H) {
            patternLo = this.reverseBits(patternLo);
            patternHi = this.reverseBits(patternHi);
          }

          this.sprites.push({
            x: spriteX,
            patternLo,
            patternHi,
            attributes,
            index: i,
          });

          if (i === 0) {
            this.spriteZeroOnLine = true;
          }

          this.spriteCount++;
        }
      }
    }

    // Check for sprite overflow (more than 8 sprites on scanline)
    if (this.spriteCount >= 8) {
      // Continue scanning for more sprites
      for (let i = 8; i < 64; i++) {
        const oamIndex = i * 4;
        const spriteY = this.oam[oamIndex];
        const diff = nextScanline - spriteY;
        if (diff >= 0 && diff < spriteHeight) {
          this.status |= StatusFlag.SPRITE_OVERFLOW;
          break;
        }
      }
    }
  }

  // Reverse bits in a byte (for horizontal flip)
  private reverseBits(b: number): number {
    b = ((b & 0xF0) >> 4) | ((b & 0x0F) << 4);
    b = ((b & 0xCC) >> 2) | ((b & 0x33) << 2);
    b = ((b & 0xAA) >> 1) | ((b & 0x55) << 1);
    return b;
  }

  // Render a single pixel
  private renderPixel(): void {
    const x = this.cycle - 1;
    const y = this.scanline;

    let bgPixel = 0;
    let bgPalette = 0;

    // Background rendering
    if (this.mask & MaskFlag.SHOW_BG) {
      // Check if we should render background in left 8 pixels
      if (x >= 8 || (this.mask & MaskFlag.SHOW_LEFT_BG)) {
        // Calculate fine X position within the tile
        const fineX = (this.x + (this.cycle - 1)) % 8;

        // Get nametable address from v register
        const nametableAddr = 0x2000 | (this.v & 0x0fff);
        const tileIndex = this.ppuRead(nametableAddr);

        // Get fine Y from v register (bits 12-14)
        const fineY = (this.v >> 12) & 0x07;

        // Calculate pattern table address
        const patternAddr = ((this.ctrl & CtrlFlag.BACKGROUND_PATTERN) ? 0x1000 : 0) +
          (tileIndex << 4) + fineY;

        const patternLo = this.ppuRead(patternAddr);
        const patternHi = this.ppuRead(patternAddr + 8);

        // Get pixel from pattern (bit 7 is leftmost pixel)
        const bitPos = 7 - fineX;
        bgPixel = ((patternLo >> bitPos) & 1) | (((patternHi >> bitPos) & 1) << 1);

        // Get attribute byte for palette selection
        const attrAddr = 0x23c0 | (this.v & 0x0c00) |
          ((this.v >> 4) & 0x38) | ((this.v >> 2) & 0x07);
        const attrByte = this.ppuRead(attrAddr);

        // Calculate which quadrant of the attribute byte to use
        const attrShift = ((this.v >> 4) & 0x04) | (this.v & 0x02);
        bgPalette = (attrByte >> attrShift) & 0x03;
      }
    }

    // Sprite rendering
    let spritePixel = 0;
    let spritePalette = 0;
    let spritePriority = false;
    let spriteZeroRendered = false;

    if (this.mask & MaskFlag.SHOW_SPRITES) {
      // Check if we should render sprites in left 8 pixels
      if (x >= 8 || (this.mask & MaskFlag.SHOW_LEFT_SPRITES)) {
        // Check each sprite to see if it covers this pixel
        for (let i = 0; i < this.spriteCount; i++) {
          const sprite = this.sprites[i];
          const spriteX = x - sprite.x;

          // Check if this pixel is within the sprite's horizontal range
          if (spriteX >= 0 && spriteX < 8) {
            // Get pixel from sprite pattern
            const bitPos = 7 - spriteX;
            const pixel = ((sprite.patternLo >> bitPos) & 1) |
                         (((sprite.patternHi >> bitPos) & 1) << 1);

            // Only render non-transparent pixels
            if (pixel !== 0) {
              spritePixel = pixel;
              spritePalette = (sprite.attributes & SpriteAttr.PALETTE) + 4; // Sprite palettes start at 4
              spritePriority = (sprite.attributes & SpriteAttr.PRIORITY) !== 0;

              // Check for sprite 0 hit
              if (sprite.index === 0) {
                spriteZeroRendered = true;
              }

              // First opaque sprite wins (lowest index has priority)
              break;
            }
          }
        }
      }
    }

    // Sprite 0 hit detection
    // Hit occurs when both background and sprite 0 pixels are opaque
    if (this.spriteZeroOnLine && spriteZeroRendered && bgPixel !== 0 && spritePixel !== 0) {
      // Sprite 0 hit doesn't trigger at x=255 or if rendering is off
      if (x < 255 && (this.mask & MaskFlag.SHOW_BG) && (this.mask & MaskFlag.SHOW_SPRITES)) {
        // Also doesn't trigger in left 8 pixels if either left clipping is enabled
        if (x >= 8 || ((this.mask & MaskFlag.SHOW_LEFT_BG) && (this.mask & MaskFlag.SHOW_LEFT_SPRITES))) {
          this.status |= StatusFlag.SPRITE_ZERO_HIT;
        }
      }
    }

    // Compose final pixel based on priority
    let paletteIndex: number;

    if (bgPixel === 0 && spritePixel === 0) {
      // Both transparent - use background color
      paletteIndex = this.ppuRead(0x3f00);
    } else if (bgPixel === 0 && spritePixel !== 0) {
      // Only sprite is opaque - use sprite
      paletteIndex = this.ppuRead(0x3f00 + (spritePalette << 2) + spritePixel);
    } else if (bgPixel !== 0 && spritePixel === 0) {
      // Only background is opaque - use background
      paletteIndex = this.ppuRead(0x3f00 + (bgPalette << 2) + bgPixel);
    } else {
      // Both opaque - priority determines which is shown
      if (spritePriority) {
        // Sprite behind background - show background
        paletteIndex = this.ppuRead(0x3f00 + (bgPalette << 2) + bgPixel);
      } else {
        // Sprite in front of background - show sprite
        paletteIndex = this.ppuRead(0x3f00 + (spritePalette << 2) + spritePixel);
      }
    }

    this.frameBuffer[y * 256 + x] = paletteIndex;
  }

  shouldGenerateNMI(): boolean {
    return this.nmiOccurred && this.nmiOutput;
  }

  clearNMI(): void {
    this.nmiOccurred = false;
  }

  // Increment coarse X (horizontal scroll)
  private incrementX(): void {
    if ((this.v & 0x001f) === 31) {
      this.v &= ~0x001f; // Clear coarse X
      this.v ^= 0x0400;  // Switch horizontal nametable
    } else {
      this.v++;
    }
  }

  // Increment Y (vertical scroll)
  private incrementY(): void {
    if ((this.v & 0x7000) !== 0x7000) {
      this.v += 0x1000; // Increment fine Y
    } else {
      this.v &= ~0x7000; // Clear fine Y
      let y = (this.v & 0x03e0) >> 5; // Coarse Y
      if (y === 29) {
        y = 0;
        this.v ^= 0x0800; // Switch vertical nametable
      } else if (y === 31) {
        y = 0;
      } else {
        y++;
      }
      this.v = (this.v & ~0x03e0) | (y << 5);
    }
  }

  // Copy horizontal bits from t to v
  private copyX(): void {
    // v: ....A.. ...BCDEF <- t: ....A.. ...BCDEF
    this.v = (this.v & 0xfbe0) | (this.t & 0x041f);
  }

  // Copy vertical bits from t to v
  private copyY(): void {
    // v: GHIA.BC DEF..... <- t: GHIA.BC DEF.....
    this.v = (this.v & 0x841f) | (this.t & 0x7be0);
  }
}
