import { readFileSync, writeFileSync, existsSync } from 'fs';
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
  private srmPath: string;

  get mirrorMode(): number {
    return this.mapper.mirrorMode ?? this.header.mirrorMode;
  }

  constructor(romPath: string) {
    const data = readFileSync(romPath);
    const buffer = new Uint8Array(data);

    // Parse iNES header
    this.header = this.parseHeader(buffer);

    // Calculate .srm path (same as ROM path but with .srm extension)
    this.srmPath = romPath.replace(/\.nes$/i, '.srm');

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

    // Load battery-backed save data if it exists
    if (this.header.hasBattery && existsSync(this.srmPath)) {
      try {
        const srmData = readFileSync(this.srmPath);
        const srmBuffer = new Uint8Array(srmData);
        // Copy save data to PRG RAM (up to 8KB)
        const copySize = Math.min(srmBuffer.length, this.prgRam.length);
        this.prgRam.set(srmBuffer.subarray(0, copySize));
        console.log(`Loaded save data: ${this.srmPath}`);
      } catch {
        console.warn(`Failed to load save data: ${this.srmPath}`);
      }
    }

    // Create mapper
    this.mapper = createMapper(this.header.mapper, this);

    console.log(`Loaded ROM: ${romPath}`);
    console.log(`  PRG ROM: ${this.header.prgRomBanks} x 16KB`);
    console.log(`  CHR ROM: ${this.header.chrRomBanks} x 8KB`);
    console.log(`  Mapper: ${this.header.mapper}`);
    console.log(`  Mirror: ${this.header.mirrorMode === 0 ? 'Horizontal' : 'Vertical'}`);
    console.log(`  Battery: ${this.header.hasBattery ? 'Yes' : 'No'}`);
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

  /**
   * Check if the mapper has a pending IRQ (used by MMC3, etc.)
   */
  irqPending(): boolean {
    return this.mapper.irqPending?.() ?? false;
  }

  /**
   * Acknowledge and clear the mapper IRQ
   */
  acknowledgeIrq(): void {
    this.mapper.acknowledgeIrq?.();
  }

  /**
   * Notify the mapper of a scanline for IRQ counter (MMC3)
   * Called once per scanline at a specific cycle
   */
  notifyScanline(scanline: number, renderingEnabled: boolean): void {
    this.mapper.notifyScanline?.(scanline, renderingEnabled);
  }

  /**
   * Save battery-backed RAM to .srm file
   * Should be called on emulator shutdown
   */
  saveSram(): void {
    if (!this.header.hasBattery) {
      return;
    }

    try {
      writeFileSync(this.srmPath, this.prgRam);
      console.log(`Saved game data: ${this.srmPath}`);
    } catch (err) {
      console.error(`Failed to save game data: ${this.srmPath}`, err);
    }
  }
}
