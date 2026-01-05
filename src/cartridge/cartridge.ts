import { readFileSync } from 'fs';
import { Mapper, createMapper } from './mappers/mapper.js';

export interface CartridgeHeader {
  prgRomBanks: number; // 16KB units
  chrRomBanks: number; // 8KB units
  mapper: number;
  mirrorMode: number; // 0: horizontal, 1: vertical
  hasBattery: boolean;
  hasTrainer: boolean;
}

export class Cartridge {
  header: CartridgeHeader;
  prgRom: Uint8Array;
  chrRom: Uint8Array;
  prgRam: Uint8Array;
  chrRam: Uint8Array;

  private mapper: Mapper;

  get mirrorMode(): number {
    return this.mapper.mirrorMode ?? this.header.mirrorMode;
  }

  constructor(romPath: string) {
    const data = readFileSync(romPath);
    const buffer = new Uint8Array(data);

    // Parse iNES header
    this.header = this.parseHeader(buffer);

    // Calculate offsets
    const trainerOffset = this.header.hasTrainer ? 512 : 0;
    const prgRomOffset = 16 + trainerOffset;
    const prgRomSize = this.header.prgRomBanks * 16384;
    const chrRomOffset = prgRomOffset + prgRomSize;
    const chrRomSize = this.header.chrRomBanks * 8192;

    // Extract ROM data
    this.prgRom = buffer.slice(prgRomOffset, prgRomOffset + prgRomSize);

    if (chrRomSize > 0) {
      this.chrRom = buffer.slice(chrRomOffset, chrRomOffset + chrRomSize);
      this.chrRam = new Uint8Array(0);
    } else {
      // Use CHR RAM if no CHR ROM
      this.chrRom = new Uint8Array(0);
      this.chrRam = new Uint8Array(8192);
    }

    // PRG RAM (battery-backed or not)
    this.prgRam = new Uint8Array(8192);

    // Create mapper
    this.mapper = createMapper(this.header.mapper, this);

    console.log(`Loaded ROM: ${romPath}`);
    console.log(`  PRG ROM: ${this.header.prgRomBanks} x 16KB`);
    console.log(`  CHR ROM: ${this.header.chrRomBanks} x 8KB`);
    console.log(`  Mapper: ${this.header.mapper}`);
    console.log(`  Mirror: ${this.header.mirrorMode === 0 ? 'Horizontal' : 'Vertical'}`);
  }

  private parseHeader(data: Uint8Array): CartridgeHeader {
    // Check magic number "NES\x1A"
    if (data[0] !== 0x4e || data[1] !== 0x45 || data[2] !== 0x53 || data[3] !== 0x1a) {
      throw new Error('Invalid iNES file');
    }

    const flags6 = data[6];
    const flags7 = data[7];

    return {
      prgRomBanks: data[4],
      chrRomBanks: data[5],
      mapper: ((flags6 >> 4) & 0x0f) | (flags7 & 0xf0),
      mirrorMode: flags6 & 0x01,
      hasBattery: (flags6 & 0x02) !== 0,
      hasTrainer: (flags6 & 0x04) !== 0,
    };
  }

  cpuRead(address: number): number {
    return this.mapper.cpuRead(address);
  }

  cpuWrite(address: number, data: number): void {
    this.mapper.cpuWrite(address, data);
  }

  ppuRead(address: number): number {
    return this.mapper.ppuRead(address);
  }

  ppuWrite(address: number, data: number): void {
    this.mapper.ppuWrite(address, data);
  }
}
