import type { Cartridge } from '../cartridge.js';

export interface Mapper {
  cpuRead(address: number): number;
  cpuWrite(address: number, data: number): void;
  ppuRead(address: number): number;
  ppuWrite(address: number, data: number): void;
  mirrorMode?: number;

  // IRQ support for mappers like MMC3
  irqPending?(): boolean;
  acknowledgeIrq?(): void;

  // Scanline counter notification (for MMC3)
  // Called by PPU at the point where scanline counter should clock
  notifyScanline?(scanline: number, renderingEnabled: boolean): void;
}

export function createMapper(mapperNumber: number, cartridge: Cartridge): Mapper {
  switch (mapperNumber) {
    case 0:
      return new Mapper0(cartridge);
    case 1:
      return new Mapper1(cartridge);
    case 2:
      return new Mapper2(cartridge);
    case 3:
      return new Mapper3(cartridge);
    case 4:
      return new Mapper4(cartridge);
    case 7:
      return new Mapper7(cartridge);
    case 9:
      return new Mapper9(cartridge);
    default:
      console.warn(`Mapper ${mapperNumber} not implemented, using Mapper 0`);
      return new Mapper0(cartridge);
  }
}

// Mapper 0: NROM - No mapper
export class Mapper0 implements Mapper {
  private cartridge: Cartridge;

  constructor(cartridge: Cartridge) {
    this.cartridge = cartridge;
  }

  cpuRead(address: number): number {
    if (address >= 0x8000) {
      // PRG ROM
      // If only one 16KB bank, mirror it
      const prgAddr = address & (this.cartridge.prgRom.length > 16384 ? 0x7fff : 0x3fff);
      return this.cartridge.prgRom[prgAddr];
    } else if (address >= 0x6000) {
      // PRG RAM
      return this.cartridge.prgRam[address & 0x1fff];
    }
    return 0;
  }

  cpuWrite(address: number, data: number): void {
    if (address >= 0x6000 && address < 0x8000) {
      // PRG RAM
      this.cartridge.prgRam[address & 0x1fff] = data;
    }
  }

  ppuRead(address: number): number {
    if (address < 0x2000) {
      if (this.cartridge.chrRom.length > 0) {
        return this.cartridge.chrRom[address];
      }
      return this.cartridge.chrRam[address];
    }
    return 0;
  }

  ppuWrite(address: number, data: number): void {
    if (address < 0x2000 && this.cartridge.chrRom.length === 0) {
      this.cartridge.chrRam[address] = data;
    }
  }
}

// Mapper 1: MMC1
export class Mapper1 implements Mapper {
  private cartridge: Cartridge;

  // Shift register
  private shiftRegister: number = 0x10;
  private writeCount: number = 0;

  // Control registers
  private control: number = 0x0c;
  private chrBank0: number = 0;
  private chrBank1: number = 0;
  private prgBank: number = 0;

  mirrorMode: number = 0;

  constructor(cartridge: Cartridge) {
    this.cartridge = cartridge;
    this.mirrorMode = cartridge.header.mirrorMode;
  }

  cpuRead(address: number): number {
    if (address >= 0x8000) {
      const prgMode = (this.control >> 2) & 0x03;
      let bank: number;
      let offset: number;

      if (address < 0xc000) {
        // First bank
        switch (prgMode) {
          case 0:
          case 1:
            // 32KB mode - use prgBank ignoring low bit
            bank = (this.prgBank & 0x0e) >> 1;
            offset = address - 0x8000;
            return this.cartridge.prgRom[(bank * 32768 + offset) % this.cartridge.prgRom.length];
          case 2:
            // Fix first bank at $8000
            return this.cartridge.prgRom[address - 0x8000];
          case 3:
            // Switch 16KB bank at $8000
            bank = this.prgBank & 0x0f;
            return this.cartridge.prgRom[(bank * 16384 + (address - 0x8000)) % this.cartridge.prgRom.length];
        }
      } else {
        // Second bank ($C000-$FFFF)
        switch (prgMode) {
          case 0:
          case 1:
            // 32KB mode
            bank = (this.prgBank & 0x0e) >> 1;
            offset = address - 0x8000;
            return this.cartridge.prgRom[(bank * 32768 + offset) % this.cartridge.prgRom.length];
          case 2:
            // Switch 16KB bank at $C000
            bank = this.prgBank & 0x0f;
            return this.cartridge.prgRom[(bank * 16384 + (address - 0xc000)) % this.cartridge.prgRom.length];
          case 3:
            // Fix last bank at $C000
            const lastBank = (this.cartridge.prgRom.length / 16384) - 1;
            return this.cartridge.prgRom[lastBank * 16384 + (address - 0xc000)];
        }
      }
    } else if (address >= 0x6000) {
      return this.cartridge.prgRam[address & 0x1fff];
    }
    return 0;
  }

  cpuWrite(address: number, data: number): void {
    if (address >= 0x8000) {
      if (data & 0x80) {
        // Reset shift register
        this.shiftRegister = 0x10;
        this.writeCount = 0;
        this.control |= 0x0c;
      } else {
        // Write to shift register
        this.shiftRegister = ((data & 1) << 4) | (this.shiftRegister >> 1);
        this.writeCount++;

        if (this.writeCount === 5) {
          // Write to internal register
          const register = (address >> 13) & 0x03;

          switch (register) {
            case 0: // Control
              this.control = this.shiftRegister;
              const mirrorBits = this.control & 0x03;
              if (mirrorBits === 2) this.mirrorMode = 1; // Vertical
              else if (mirrorBits === 3) this.mirrorMode = 0; // Horizontal
              else this.mirrorMode = mirrorBits + 2; // Single-screen
              break;
            case 1: // CHR bank 0
              this.chrBank0 = this.shiftRegister;
              break;
            case 2: // CHR bank 1
              this.chrBank1 = this.shiftRegister;
              break;
            case 3: // PRG bank
              this.prgBank = this.shiftRegister;
              break;
          }

          this.shiftRegister = 0x10;
          this.writeCount = 0;
        }
      }
    } else if (address >= 0x6000) {
      this.cartridge.prgRam[address & 0x1fff] = data;
    }
  }

  ppuRead(address: number): number {
    if (address < 0x2000) {
      const chrMode = (this.control >> 4) & 0x01;
      let bank: number;

      if (this.cartridge.chrRom.length === 0) {
        return this.cartridge.chrRam[address];
      }

      if (chrMode === 0) {
        // 8KB mode
        bank = (this.chrBank0 & 0x1e) >> 1;
        return this.cartridge.chrRom[(bank * 8192 + address) % this.cartridge.chrRom.length];
      } else {
        // 4KB mode
        if (address < 0x1000) {
          bank = this.chrBank0;
          return this.cartridge.chrRom[(bank * 4096 + address) % this.cartridge.chrRom.length];
        } else {
          bank = this.chrBank1;
          return this.cartridge.chrRom[(bank * 4096 + (address - 0x1000)) % this.cartridge.chrRom.length];
        }
      }
    }
    return 0;
  }

  ppuWrite(address: number, data: number): void {
    if (address < 0x2000 && this.cartridge.chrRom.length === 0) {
      this.cartridge.chrRam[address] = data;
    }
  }
}

// Mapper 2: UxROM
export class Mapper2 implements Mapper {
  private cartridge: Cartridge;
  private prgBank: number = 0;

  constructor(cartridge: Cartridge) {
    this.cartridge = cartridge;
  }

  cpuRead(address: number): number {
    if (address >= 0xc000) {
      // Fixed last bank
      const lastBank = (this.cartridge.prgRom.length / 16384) - 1;
      return this.cartridge.prgRom[lastBank * 16384 + (address - 0xc000)];
    } else if (address >= 0x8000) {
      // Switchable bank
      return this.cartridge.prgRom[this.prgBank * 16384 + (address - 0x8000)];
    } else if (address >= 0x6000) {
      return this.cartridge.prgRam[address & 0x1fff];
    }
    return 0;
  }

  cpuWrite(address: number, data: number): void {
    if (address >= 0x8000) {
      this.prgBank = data & 0x0f;
    } else if (address >= 0x6000) {
      this.cartridge.prgRam[address & 0x1fff] = data;
    }
  }

  ppuRead(address: number): number {
    if (address < 0x2000) {
      if (this.cartridge.chrRom.length > 0) {
        return this.cartridge.chrRom[address];
      }
      return this.cartridge.chrRam[address];
    }
    return 0;
  }

  ppuWrite(address: number, data: number): void {
    if (address < 0x2000 && this.cartridge.chrRom.length === 0) {
      this.cartridge.chrRam[address] = data;
    }
  }
}

// Mapper 3: CNROM
// Simple CHR ROM bank switching, used by ~150 games including Arkanoid, Gradius
export class Mapper3 implements Mapper {
  private cartridge: Cartridge;
  private chrBank: number = 0;

  constructor(cartridge: Cartridge) {
    this.cartridge = cartridge;
  }

  cpuRead(address: number): number {
    if (address >= 0x8000) {
      // PRG ROM - same as NROM (16KB or 32KB, mirrored if 16KB)
      const prgAddr = address & (this.cartridge.prgRom.length > 16384 ? 0x7fff : 0x3fff);
      return this.cartridge.prgRom[prgAddr];
    } else if (address >= 0x6000) {
      // PRG RAM
      return this.cartridge.prgRam[address & 0x1fff];
    }
    return 0;
  }

  cpuWrite(address: number, data: number): void {
    if (address >= 0x8000) {
      // Select CHR bank (8KB banks)
      // Mask to number of banks available (typically 2-4 bits used)
      const bankCount = Math.max(1, this.cartridge.chrRom.length / 8192);
      this.chrBank = data & (bankCount - 1);
    } else if (address >= 0x6000) {
      // PRG RAM
      this.cartridge.prgRam[address & 0x1fff] = data;
    }
  }

  ppuRead(address: number): number {
    if (address < 0x2000) {
      // CHR ROM with bank switching
      return this.cartridge.chrRom[(this.chrBank * 8192 + address) % this.cartridge.chrRom.length];
    }
    return 0;
  }

  ppuWrite(_address: number, _data: number): void {
    // CNROM uses CHR ROM, not RAM, so writes are ignored
  }
}

// Mapper 7: AxROM
// 32KB PRG bank switching with single-screen mirroring
// Used by Battletoads, Marble Madness, Wizards & Warriors
export class Mapper7 implements Mapper {
  private cartridge: Cartridge;
  private prgBank: number = 0;
  mirrorMode: number = 2; // Single-screen lower by default

  constructor(cartridge: Cartridge) {
    this.cartridge = cartridge;
  }

  cpuRead(address: number): number {
    if (address >= 0x8000) {
      // 32KB switchable PRG bank
      const bankOffset = this.prgBank * 32768;
      return this.cartridge.prgRom[(bankOffset + (address - 0x8000)) % this.cartridge.prgRom.length];
    } else if (address >= 0x6000) {
      // PRG RAM (not all AxROM boards have this)
      return this.cartridge.prgRam[address & 0x1fff];
    }
    return 0;
  }

  cpuWrite(address: number, data: number): void {
    if (address >= 0x8000) {
      // Bits 0-2: PRG bank select (some variants use more bits)
      this.prgBank = data & 0x07;
      // Bit 4: Nametable select (0 = single-screen lower, 1 = single-screen upper)
      this.mirrorMode = (data & 0x10) ? 3 : 2;
    } else if (address >= 0x6000) {
      this.cartridge.prgRam[address & 0x1fff] = data;
    }
  }

  ppuRead(address: number): number {
    if (address < 0x2000) {
      // AxROM uses CHR RAM
      return this.cartridge.chrRam[address];
    }
    return 0;
  }

  ppuWrite(address: number, data: number): void {
    if (address < 0x2000) {
      // CHR RAM is writable
      this.cartridge.chrRam[address] = data;
    }
  }
}

// Mapper 9: MMC2
// Used only by Punch-Out!! - has unique tile-based CHR bank switching for animation
export class Mapper9 implements Mapper {
  private cartridge: Cartridge;

  // PRG bank (8KB at $8000-$9FFF)
  private prgBank: number = 0;

  // CHR banks - two banks per 4KB region, switched by tile fetch
  private chrBank0Latch0: number = 0; // $0000-$0FFF when latch0 is active
  private chrBank0Latch1: number = 0; // $0000-$0FFF when latch1 is active
  private chrBank1Latch0: number = 0; // $1000-$1FFF when latch0 is active
  private chrBank1Latch1: number = 0; // $1000-$1FFF when latch1 is active

  // Latches (select which CHR bank register is active)
  private latch0: number = 0; // 0 = use chrBank0Latch0, 1 = use chrBank0Latch1
  private latch1: number = 0; // 0 = use chrBank1Latch0, 1 = use chrBank1Latch1

  mirrorMode: number = 0;

  constructor(cartridge: Cartridge) {
    this.cartridge = cartridge;
    this.mirrorMode = cartridge.header.mirrorMode;
  }

  cpuRead(address: number): number {
    if (address >= 0xa000) {
      // $A000-$FFFF: Fixed to last three 8KB banks
      const lastBanks = this.cartridge.prgRom.length - 24576; // Last 24KB
      return this.cartridge.prgRom[lastBanks + (address - 0xa000)];
    } else if (address >= 0x8000) {
      // $8000-$9FFF: Switchable 8KB bank
      return this.cartridge.prgRom[(this.prgBank * 8192 + (address - 0x8000)) % this.cartridge.prgRom.length];
    } else if (address >= 0x6000) {
      return this.cartridge.prgRam[address & 0x1fff];
    }
    return 0;
  }

  cpuWrite(address: number, data: number): void {
    if (address >= 0xf000) {
      // $F000-$FFFF: Mirroring
      this.mirrorMode = (data & 0x01) ? 0 : 1; // 0=horizontal, 1=vertical
    } else if (address >= 0xe000) {
      // $E000-$EFFF: CHR bank 1, latch 1
      this.chrBank1Latch1 = data & 0x1f;
    } else if (address >= 0xd000) {
      // $D000-$DFFF: CHR bank 1, latch 0
      this.chrBank1Latch0 = data & 0x1f;
    } else if (address >= 0xc000) {
      // $C000-$CFFF: CHR bank 0, latch 1
      this.chrBank0Latch1 = data & 0x1f;
    } else if (address >= 0xb000) {
      // $B000-$BFFF: CHR bank 0, latch 0
      this.chrBank0Latch0 = data & 0x1f;
    } else if (address >= 0xa000) {
      // $A000-$AFFF: PRG bank select
      this.prgBank = data & 0x0f;
    } else if (address >= 0x6000) {
      this.cartridge.prgRam[address & 0x1fff] = data;
    }
  }

  ppuRead(address: number): number {
    if (address < 0x2000) {
      let bank: number;
      let offset: number;

      if (address < 0x1000) {
        // $0000-$0FFF: Use latch0 to select bank
        bank = this.latch0 === 0 ? this.chrBank0Latch0 : this.chrBank0Latch1;
        offset = address;
      } else {
        // $1000-$1FFF: Use latch1 to select bank
        bank = this.latch1 === 0 ? this.chrBank1Latch0 : this.chrBank1Latch1;
        offset = address - 0x1000;
      }

      const result = this.cartridge.chrRom[(bank * 4096 + offset) % this.cartridge.chrRom.length];

      // Update latches based on tile fetched
      // Tiles $FD and $FE trigger latch changes (checked after the read)
      this.updateLatches(address);

      return result;
    }
    return 0;
  }

  ppuWrite(_address: number, _data: number): void {
    // MMC2 uses CHR ROM, writes are ignored
  }

  /**
   * Update latches based on the address being read
   * The latch switches when reading from specific tile addresses
   */
  private updateLatches(address: number): void {
    if (address >= 0x0fd8 && address <= 0x0fdf) {
      // Reading tile $FD from pattern table 0
      this.latch0 = 0;
    } else if (address >= 0x0fe8 && address <= 0x0fef) {
      // Reading tile $FE from pattern table 0
      this.latch0 = 1;
    } else if (address >= 0x1fd8 && address <= 0x1fdf) {
      // Reading tile $FD from pattern table 1
      this.latch1 = 0;
    } else if (address >= 0x1fe8 && address <= 0x1fef) {
      // Reading tile $FE from pattern table 1
      this.latch1 = 1;
    }
  }
}

// Mapper 4: MMC3
// Used by ~25% of NES games including Super Mario Bros 3, Kirby's Adventure
export class Mapper4 implements Mapper {
  private cartridge: Cartridge;

  // Bank registers R0-R7
  private bankRegisters: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

  // $8000 - Bank select register
  private bankSelect: number = 0;     // Bits 0-2: Select which register (R0-R7)
  private prgBankMode: number = 0;    // Bit 6: PRG ROM bank mode
  private chrA12Inversion: number = 0; // Bit 7: CHR A12 inversion

  // Mirroring ($A000)
  mirrorMode: number = 0;


  // IRQ counter ($C000-$E001)
  private irqLatch: number = 0;
  private irqCounter: number = 0;
  private irqEnable: boolean = false;
  private irqReload: boolean = false;
  private irqPendingFlag: boolean = false;

  // PRG bank count (8KB banks)
  private prgBankCount: number;

  constructor(cartridge: Cartridge) {
    this.cartridge = cartridge;
    this.mirrorMode = cartridge.header.mirrorMode;
    this.prgBankCount = Math.floor(cartridge.prgRom.length / 8192);
  }

  /**
   * Called by PPU once per scanline at the point where MMC3 counter should clock.
   * This is a simplified approach that works for most games.
   * Real hardware uses A12 rising edge detection, but that's complex to emulate
   * accurately given our per-pixel rendering approach.
   */
  notifyScanline(scanline: number, renderingEnabled: boolean): void {
    // Only clock counter during visible and pre-render scanlines when rendering is enabled
    // Scanlines 0-239 are visible, 261 is pre-render
    if (renderingEnabled && (scanline < 240 || scanline === 261)) {
      this.clockIrqCounter();
    }
  }

  cpuRead(address: number): number {
    if (address >= 0x8000) {
      // PRG ROM - 4 x 8KB banks
      const bank = this.getPrgBank(address);
      const offset = address & 0x1fff;
      return this.cartridge.prgRom[(bank * 8192 + offset) % this.cartridge.prgRom.length];
    } else if (address >= 0x6000) {
      // PRG RAM ($6000-$7FFF)
      return this.cartridge.prgRam[address & 0x1fff];
    }
    return 0;
  }

  cpuWrite(address: number, data: number): void {
    if (address >= 0x8000) {
      // MMC3 register writes
      const isEven = (address & 1) === 0;

      if (address < 0xa000) {
        // $8000-$9FFF: Bank select / Bank data
        if (isEven) {
          // $8000, $8002, etc: Bank select
          this.bankSelect = data & 0x07;
          this.prgBankMode = (data >> 6) & 1;
          this.chrA12Inversion = (data >> 7) & 1;
        } else {
          // $8001, $8003, etc: Bank data
          this.bankRegisters[this.bankSelect] = data;
        }
      } else if (address < 0xc000) {
        // $A000-$BFFF: Mirroring / PRG RAM protect
        if (isEven) {
          // $A000: Mirroring (0 = vertical, 1 = horizontal)
          this.mirrorMode = (data & 1) === 0 ? 1 : 0;
        } else {
          // $A001: PRG RAM protect (not commonly used, ignored)
        }
      } else if (address < 0xe000) {
        // $C000-$DFFF: IRQ latch / IRQ reload
        if (isEven) {
          // $C000: IRQ latch value
          this.irqLatch = data;
        } else {
          // $C001: IRQ reload - counter will be reloaded on next scanline
          this.irqCounter = 0;
          this.irqReload = true;
        }
      } else {
        // $E000-$FFFF: IRQ disable / IRQ enable
        if (isEven) {
          // $E000: IRQ disable and acknowledge
          this.irqEnable = false;
          this.irqPendingFlag = false;
        } else {
          // $E001: IRQ enable
          this.irqEnable = true;
        }
      }
    } else if (address >= 0x6000) {
      // PRG RAM write
      this.cartridge.prgRam[address & 0x1fff] = data;
    }
  }

  /**
   * Get the PRG bank for a given address (8KB banks)
   */
  private getPrgBank(address: number): number {
    const region = (address - 0x8000) >> 13; // 0-3 for $8000-$9FFF, $A000-$BFFF, $C000-$DFFF, $E000-$FFFF
    const lastBank = this.prgBankCount - 1;
    const secondLastBank = this.prgBankCount - 2;

    if (this.prgBankMode === 0) {
      // Mode 0: $8000-$9FFF swappable, $C000-$DFFF fixed to second-last
      switch (region) {
        case 0: return this.bankRegisters[6] & (this.prgBankCount - 1); // R6 at $8000
        case 1: return this.bankRegisters[7] & (this.prgBankCount - 1); // R7 at $A000
        case 2: return secondLastBank;  // Fixed second-last at $C000
        case 3: return lastBank;        // Fixed last at $E000
      }
    } else {
      // Mode 1: $C000-$DFFF swappable, $8000-$9FFF fixed to second-last
      switch (region) {
        case 0: return secondLastBank;  // Fixed second-last at $8000
        case 1: return this.bankRegisters[7] & (this.prgBankCount - 1); // R7 at $A000
        case 2: return this.bankRegisters[6] & (this.prgBankCount - 1); // R6 at $C000
        case 3: return lastBank;        // Fixed last at $E000
      }
    }
    return 0;
  }

  ppuRead(address: number): number {
    if (address < 0x2000) {
      const bank = this.getChrBank(address);

      if (this.cartridge.chrRom.length > 0) {
        return this.cartridge.chrRom[(bank * 1024 + (address & 0x3ff)) % this.cartridge.chrRom.length];
      }
      return this.cartridge.chrRam[address];
    }
    return 0;
  }

  ppuWrite(address: number, data: number): void {
    if (address < 0x2000) {
      if (this.cartridge.chrRom.length === 0) {
        this.cartridge.chrRam[address] = data;
      }
    }
  }

  /**
   * Get the CHR bank for a given address (1KB banks)
   */
  private getChrBank(address: number): number {
    const region = address >> 10; // 0-7 for each 1KB region

    if (this.chrA12Inversion === 0) {
      // Normal mode: 2KB banks at $0000-$0FFF, 1KB banks at $1000-$1FFF
      switch (region) {
        case 0:
        case 1: return (this.bankRegisters[0] & 0xfe) + (region & 1); // R0 (2KB)
        case 2:
        case 3: return (this.bankRegisters[1] & 0xfe) + (region & 1); // R1 (2KB)
        case 4: return this.bankRegisters[2]; // R2 (1KB)
        case 5: return this.bankRegisters[3]; // R3 (1KB)
        case 6: return this.bankRegisters[4]; // R4 (1KB)
        case 7: return this.bankRegisters[5]; // R5 (1KB)
      }
    } else {
      // Inverted mode: 1KB banks at $0000-$0FFF, 2KB banks at $1000-$1FFF
      switch (region) {
        case 0: return this.bankRegisters[2]; // R2 (1KB)
        case 1: return this.bankRegisters[3]; // R3 (1KB)
        case 2: return this.bankRegisters[4]; // R4 (1KB)
        case 3: return this.bankRegisters[5]; // R5 (1KB)
        case 4:
        case 5: return (this.bankRegisters[0] & 0xfe) + (region & 1); // R0 (2KB)
        case 6:
        case 7: return (this.bankRegisters[1] & 0xfe) + (region & 1); // R1 (2KB)
      }
    }
    return 0;
  }

  /**
   * Clock the IRQ counter (called once per scanline)
   */
  private clockIrqCounter(): void {
    if (this.irqCounter === 0 || this.irqReload) {
      this.irqCounter = this.irqLatch;
      this.irqReload = false;
    } else {
      this.irqCounter--;
    }

    if (this.irqCounter === 0 && this.irqEnable) {
      this.irqPendingFlag = true;
    }
  }

  /**
   * Check if IRQ is pending
   */
  irqPending(): boolean {
    return this.irqPendingFlag;
  }

  /**
   * Acknowledge and clear IRQ
   */
  acknowledgeIrq(): void {
    this.irqPendingFlag = false;
  }
}
