// Game Boy / Game Boy Color Cartridge and MBC implementations

import * as fs from 'fs';
import * as zlib from 'zlib';

export interface CartridgeState {
  romBank: number;
  ramBank: number;
  ramEnabled: boolean;
  bankingMode: number;
  // MBC3 specific
  rtcSelect: number;
  rtcLatched: boolean;
  // MBC5 specific
  romBankHigh: number;
}

// Cartridge header constants
const HEADER_TITLE = 0x0134;
const HEADER_CGB_FLAG = 0x0143;
const HEADER_CARTRIDGE_TYPE = 0x0147;
const HEADER_ROM_SIZE = 0x0148;
const HEADER_RAM_SIZE = 0x0149;

// MBC types
enum MBCType {
  None,
  MBC1,
  MBC2,
  MBC3,
  MBC5,
}

export class Cartridge {
  private rom: Uint8Array;
  private ram: Uint8Array;
  private mbcType: MBCType = MBCType.None;
  private hasBattery = false;
  private hasRTC = false;

  // Header info
  private title = '';
  private isCgb = false;
  private romBanks = 2;
  private ramSize = 0;

  // MBC state
  private romBank = 1;
  private ramBank = 0;
  private ramEnabled = false;
  private bankingMode = 0; // MBC1: 0 = ROM mode, 1 = RAM mode

  // MBC3 RTC
  private rtcSelect = 0;
  private rtcLatched = false;

  // MBC5
  private romBankHigh = 0;

  constructor(romPath: string) {
    // Load ROM
    let data = fs.readFileSync(romPath);

    // Check for gzip compression (magic bytes: 1f 8b)
    if (data[0] === 0x1f && data[1] === 0x8b) {
      data = zlib.gunzipSync(data);
    }

    this.rom = new Uint8Array(data);

    // Parse header
    this.parseHeader();

    // Initialize RAM based on header
    this.ram = new Uint8Array(this.ramSize);
  }

  private parseHeader(): void {
    // Title (up to 16 bytes, may be null-padded)
    const titleBytes: number[] = [];
    for (let i = 0; i < 16; i++) {
      const byte = this.rom[HEADER_TITLE + i];
      if (byte === 0) break;
      titleBytes.push(byte);
    }
    this.title = String.fromCharCode(...titleBytes);

    // CGB flag
    const cgbFlag = this.rom[HEADER_CGB_FLAG];
    this.isCgb = cgbFlag === 0x80 || cgbFlag === 0xc0;

    // Cartridge type
    const cartType = this.rom[HEADER_CARTRIDGE_TYPE];
    this.mbcType = this.getMbcType(cartType);
    this.hasBattery = this.cartridgeHasBattery(cartType);
    this.hasRTC = cartType === 0x0f || cartType === 0x10;

    // ROM size
    const romSizeCode = this.rom[HEADER_ROM_SIZE];
    this.romBanks = 2 << romSizeCode;

    // RAM size
    const ramSizeCode = this.rom[HEADER_RAM_SIZE];
    switch (ramSizeCode) {
      case 0x00:
        this.ramSize = 0;
        break;
      case 0x01:
        this.ramSize = 2048;
        break;
      case 0x02:
        this.ramSize = 8192;
        break;
      case 0x03:
        this.ramSize = 32768;
        break;
      case 0x04:
        this.ramSize = 131072;
        break;
      case 0x05:
        this.ramSize = 65536;
        break;
      default:
        this.ramSize = 0;
    }

    // MBC2 has built-in 512x4 bits RAM
    if (this.mbcType === MBCType.MBC2) {
      this.ramSize = 512;
    }
  }

  private getMbcType(cartType: number): MBCType {
    switch (cartType) {
      case 0x00:
        return MBCType.None;
      case 0x01:
      case 0x02:
      case 0x03:
        return MBCType.MBC1;
      case 0x05:
      case 0x06:
        return MBCType.MBC2;
      case 0x0f:
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
        return MBCType.MBC3;
      case 0x19:
      case 0x1a:
      case 0x1b:
      case 0x1c:
      case 0x1d:
      case 0x1e:
        return MBCType.MBC5;
      default:
        // Treat unknown as no MBC
        return MBCType.None;
    }
  }

  private cartridgeHasBattery(cartType: number): boolean {
    return [0x03, 0x06, 0x09, 0x0d, 0x0f, 0x10, 0x13, 0x1b, 0x1e, 0xff].includes(
      cartType
    );
  }

  getTitle(): string {
    return this.title;
  }

  isCgbGame(): boolean {
    return this.isCgb;
  }

  hasBatterySave(): boolean {
    return this.hasBattery && this.ramSize > 0;
  }

  getRam(): Uint8Array {
    return this.ram;
  }

  setRam(data: Uint8Array): void {
    const copyLength = Math.min(data.length, this.ram.length);
    this.ram.set(data.subarray(0, copyLength));
  }

  getState(): CartridgeState {
    return {
      romBank: this.romBank,
      ramBank: this.ramBank,
      ramEnabled: this.ramEnabled,
      bankingMode: this.bankingMode,
      rtcSelect: this.rtcSelect,
      rtcLatched: this.rtcLatched,
      romBankHigh: this.romBankHigh,
    };
  }

  setState(state: CartridgeState): void {
    this.romBank = state.romBank;
    this.ramBank = state.ramBank;
    this.ramEnabled = state.ramEnabled;
    this.bankingMode = state.bankingMode;
    this.rtcSelect = state.rtcSelect;
    this.rtcLatched = state.rtcLatched;
    this.romBankHigh = state.romBankHigh;
  }

  // Read from cartridge address space
  read(address: number): number {
    switch (this.mbcType) {
      case MBCType.None:
        return this.readNoMbc(address);
      case MBCType.MBC1:
        return this.readMbc1(address);
      case MBCType.MBC2:
        return this.readMbc2(address);
      case MBCType.MBC3:
        return this.readMbc3(address);
      case MBCType.MBC5:
        return this.readMbc5(address);
      default:
        return this.readNoMbc(address);
    }
  }

  // Write to cartridge address space (MBC registers and RAM)
  write(address: number, value: number): void {
    switch (this.mbcType) {
      case MBCType.None:
        this.writeNoMbc(address, value);
        break;
      case MBCType.MBC1:
        this.writeMbc1(address, value);
        break;
      case MBCType.MBC2:
        this.writeMbc2(address, value);
        break;
      case MBCType.MBC3:
        this.writeMbc3(address, value);
        break;
      case MBCType.MBC5:
        this.writeMbc5(address, value);
        break;
    }
  }

  // No MBC - simple 32KB ROM
  private readNoMbc(address: number): number {
    if (address < 0x8000) {
      return this.rom[address] ?? 0xff;
    }
    if (address >= 0xa000 && address < 0xc000 && this.ramSize > 0) {
      return this.ram[address - 0xa000] ?? 0xff;
    }
    return 0xff;
  }

  private writeNoMbc(address: number, value: number): void {
    if (address >= 0xa000 && address < 0xc000 && this.ramSize > 0) {
      this.ram[address - 0xa000] = value;
    }
  }

  // MBC1
  private readMbc1(address: number): number {
    // ROM Bank 0 ($0000-$3FFF)
    if (address < 0x4000) {
      if (this.bankingMode === 1) {
        // In RAM banking mode, bank 0 can be 0x00, 0x20, 0x40, or 0x60
        const bank = (this.ramBank << 5) % this.romBanks;
        return this.rom[(bank * 0x4000 + address) % this.rom.length] ?? 0xff;
      }
      return this.rom[address] ?? 0xff;
    }

    // ROM Bank 1-127 ($4000-$7FFF)
    if (address < 0x8000) {
      let bank = this.romBank;
      if (this.bankingMode === 1) {
        bank |= this.ramBank << 5;
      }
      bank %= this.romBanks;
      const romAddr = bank * 0x4000 + (address - 0x4000);
      return this.rom[romAddr % this.rom.length] ?? 0xff;
    }

    // RAM ($A000-$BFFF)
    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled || this.ramSize === 0) {
        return 0xff;
      }
      let ramAddr = address - 0xa000;
      if (this.bankingMode === 1 && this.ramSize > 0x2000) {
        ramAddr += this.ramBank * 0x2000;
      }
      return this.ram[ramAddr % this.ram.length] ?? 0xff;
    }

    return 0xff;
  }

  private writeMbc1(address: number, value: number): void {
    // RAM Enable ($0000-$1FFF)
    if (address < 0x2000) {
      this.ramEnabled = (value & 0x0f) === 0x0a;
      return;
    }

    // ROM Bank Number ($2000-$3FFF)
    if (address < 0x4000) {
      this.romBank = value & 0x1f;
      if (this.romBank === 0) {
        this.romBank = 1;
      }
      return;
    }

    // RAM Bank Number / Upper ROM Bank ($4000-$5FFF)
    if (address < 0x6000) {
      this.ramBank = value & 0x03;
      return;
    }

    // Banking Mode Select ($6000-$7FFF)
    if (address < 0x8000) {
      this.bankingMode = value & 0x01;
      return;
    }

    // RAM Write ($A000-$BFFF)
    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled || this.ramSize === 0) {
        return;
      }
      let ramAddr = address - 0xa000;
      if (this.bankingMode === 1 && this.ramSize > 0x2000) {
        ramAddr += this.ramBank * 0x2000;
      }
      this.ram[ramAddr % this.ram.length] = value;
    }
  }

  // MBC2
  private readMbc2(address: number): number {
    // ROM Bank 0 ($0000-$3FFF)
    if (address < 0x4000) {
      return this.rom[address] ?? 0xff;
    }

    // ROM Bank 1-15 ($4000-$7FFF)
    if (address < 0x8000) {
      const bank = this.romBank % this.romBanks;
      const romAddr = bank * 0x4000 + (address - 0x4000);
      return this.rom[romAddr % this.rom.length] ?? 0xff;
    }

    // Built-in RAM ($A000-$A1FF) - only lower 4 bits valid
    if (address >= 0xa000 && address < 0xa200) {
      if (!this.ramEnabled) {
        return 0xff;
      }
      return (this.ram[address - 0xa000] ?? 0xff) | 0xf0;
    }

    return 0xff;
  }

  private writeMbc2(address: number, value: number): void {
    // RAM Enable / ROM Bank ($0000-$3FFF)
    if (address < 0x4000) {
      if (address & 0x0100) {
        // ROM bank (bit 8 set)
        this.romBank = value & 0x0f;
        if (this.romBank === 0) {
          this.romBank = 1;
        }
      } else {
        // RAM enable (bit 8 clear)
        this.ramEnabled = (value & 0x0f) === 0x0a;
      }
      return;
    }

    // RAM Write ($A000-$A1FF) - only lower 4 bits stored
    if (address >= 0xa000 && address < 0xa200) {
      if (this.ramEnabled) {
        this.ram[address - 0xa000] = value & 0x0f;
      }
    }
  }

  // MBC3
  private readMbc3(address: number): number {
    // ROM Bank 0 ($0000-$3FFF)
    if (address < 0x4000) {
      return this.rom[address] ?? 0xff;
    }

    // ROM Bank 1-127 ($4000-$7FFF)
    if (address < 0x8000) {
      const bank = this.romBank % this.romBanks;
      const romAddr = bank * 0x4000 + (address - 0x4000);
      return this.rom[romAddr % this.rom.length] ?? 0xff;
    }

    // RAM / RTC ($A000-$BFFF)
    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled) {
        return 0xff;
      }

      // RTC registers ($08-$0C)
      if (this.ramBank >= 0x08 && this.ramBank <= 0x0c && this.hasRTC) {
        return this.readRtc(this.ramBank);
      }

      // RAM banks 0-3
      if (this.ramBank < 4 && this.ramSize > 0) {
        const ramAddr = this.ramBank * 0x2000 + (address - 0xa000);
        return this.ram[ramAddr % this.ram.length] ?? 0xff;
      }

      return 0xff;
    }

    return 0xff;
  }

  private writeMbc3(address: number, value: number): void {
    // RAM/RTC Enable ($0000-$1FFF)
    if (address < 0x2000) {
      this.ramEnabled = (value & 0x0f) === 0x0a;
      return;
    }

    // ROM Bank Number ($2000-$3FFF)
    if (address < 0x4000) {
      this.romBank = value & 0x7f;
      if (this.romBank === 0) {
        this.romBank = 1;
      }
      return;
    }

    // RAM Bank / RTC Register Select ($4000-$5FFF)
    if (address < 0x6000) {
      this.ramBank = value;
      return;
    }

    // Latch Clock Data ($6000-$7FFF)
    if (address < 0x8000) {
      // Writing 0x00 then 0x01 latches RTC
      if (value === 0x01 && !this.rtcLatched) {
        this.rtcLatched = true;
      } else if (value === 0x00) {
        this.rtcLatched = false;
      }
      return;
    }

    // RAM / RTC Write ($A000-$BFFF)
    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled) {
        return;
      }

      // RTC registers
      if (this.ramBank >= 0x08 && this.ramBank <= 0x0c && this.hasRTC) {
        this.writeRtc(this.ramBank, value);
        return;
      }

      // RAM banks 0-3
      if (this.ramBank < 4 && this.ramSize > 0) {
        const ramAddr = this.ramBank * 0x2000 + (address - 0xa000);
        this.ram[ramAddr % this.ram.length] = value;
      }
    }
  }

  // RTC stub (not fully implemented for first milestone)
  private readRtc(_register: number): number {
    return 0;
  }

  private writeRtc(_register: number, _value: number): void {
    // Stub - RTC not implemented for first milestone
  }

  // MBC5
  private readMbc5(address: number): number {
    // ROM Bank 0 ($0000-$3FFF)
    if (address < 0x4000) {
      return this.rom[address] ?? 0xff;
    }

    // ROM Bank 0-511 ($4000-$7FFF)
    if (address < 0x8000) {
      const bank = (this.romBank | (this.romBankHigh << 8)) % this.romBanks;
      const romAddr = bank * 0x4000 + (address - 0x4000);
      return this.rom[romAddr % this.rom.length] ?? 0xff;
    }

    // RAM ($A000-$BFFF)
    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled || this.ramSize === 0) {
        return 0xff;
      }
      const ramAddr = (this.ramBank & 0x0f) * 0x2000 + (address - 0xa000);
      return this.ram[ramAddr % this.ram.length] ?? 0xff;
    }

    return 0xff;
  }

  private writeMbc5(address: number, value: number): void {
    // RAM Enable ($0000-$1FFF)
    if (address < 0x2000) {
      this.ramEnabled = (value & 0x0f) === 0x0a;
      return;
    }

    // ROM Bank Low ($2000-$2FFF)
    if (address < 0x3000) {
      this.romBank = value;
      return;
    }

    // ROM Bank High ($3000-$3FFF)
    if (address < 0x4000) {
      this.romBankHigh = value & 0x01;
      return;
    }

    // RAM Bank ($4000-$5FFF)
    if (address < 0x6000) {
      this.ramBank = value & 0x0f;
      return;
    }

    // RAM Write ($A000-$BFFF)
    if (address >= 0xa000 && address < 0xc000) {
      if (!this.ramEnabled || this.ramSize === 0) {
        return;
      }
      const ramAddr = (this.ramBank & 0x0f) * 0x2000 + (address - 0xa000);
      this.ram[ramAddr % this.ram.length] = value;
    }
  }
}
