import type { Cartridge } from '../cartridge.js';

export interface Mapper {
  cpuRead(address: number): number;
  cpuWrite(address: number, data: number): void;
  ppuRead(address: number): number;
  ppuWrite(address: number, data: number): void;
  mirrorMode?: number;
}

export function createMapper(mapperNumber: number, cartridge: Cartridge): Mapper {
  switch (mapperNumber) {
    case 0:
      return new Mapper0(cartridge);
    case 1:
      return new Mapper1(cartridge);
    case 2:
      return new Mapper2(cartridge);
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
