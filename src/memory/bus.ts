import { PPU } from '../ppu/ppu.js';
import { Cartridge } from '../cartridge/cartridge.js';
import { Controller } from '../input/controller.js';

export class Bus {
  // 2KB internal RAM
  private ram: Uint8Array = new Uint8Array(2048);

  // Connected components
  private ppu: PPU | null = null;
  private cartridge: Cartridge | null = null;
  private controller1: Controller | null = null;
  private controller2: Controller | null = null;

  // DMA
  private dmaPage: number = 0;
  private dmaTransfer: boolean = false;

  constructor() {
    this.ram.fill(0);
  }

  connectPPU(ppu: PPU): void {
    this.ppu = ppu;
  }

  connectCartridge(cartridge: Cartridge): void {
    this.cartridge = cartridge;
  }

  connectController(port: 1 | 2, controller: Controller): void {
    if (port === 1) {
      this.controller1 = controller;
    } else {
      this.controller2 = controller;
    }
  }

  read(address: number): number {
    address &= 0xffff;

    if (address < 0x2000) {
      // Internal RAM (mirrored every 2KB)
      return this.ram[address & 0x07ff];
    } else if (address < 0x4000) {
      // PPU registers (mirrored every 8 bytes)
      return this.ppu?.cpuRead(0x2000 + (address & 0x07)) ?? 0;
    } else if (address < 0x4018) {
      // APU and I/O registers
      if (address === 0x4016) {
        return this.controller1?.read() ?? 0;
      } else if (address === 0x4017) {
        return this.controller2?.read() ?? 0;
      }
      // APU registers - TODO
      return 0;
    } else if (address < 0x4020) {
      // Normally disabled
      return 0;
    } else {
      // Cartridge space
      return this.cartridge?.cpuRead(address) ?? 0;
    }
  }

  write(address: number, data: number): void {
    address &= 0xffff;
    data &= 0xff;

    if (address < 0x2000) {
      // Internal RAM (mirrored every 2KB)
      this.ram[address & 0x07ff] = data;
    } else if (address < 0x4000) {
      // PPU registers (mirrored every 8 bytes)
      this.ppu?.cpuWrite(0x2000 + (address & 0x07), data);
    } else if (address < 0x4018) {
      // APU and I/O registers
      if (address === 0x4014) {
        // OAM DMA
        this.dmaPage = data;
        this.dmaTransfer = true;
      } else if (address === 0x4016) {
        this.controller1?.write(data);
        this.controller2?.write(data);
      }
      // APU registers - TODO
    } else if (address < 0x4020) {
      // Normally disabled
    } else {
      // Cartridge space
      this.cartridge?.cpuWrite(address, data);
    }
  }

  // Handle DMA transfer (called from emulator loop)
  doDma(): { active: boolean; data?: Uint8Array } {
    if (!this.dmaTransfer) {
      return { active: false };
    }

    const data = new Uint8Array(256);
    const baseAddr = this.dmaPage << 8;

    for (let i = 0; i < 256; i++) {
      data[i] = this.read(baseAddr + i);
    }

    this.dmaTransfer = false;
    return { active: true, data };
  }

  reset(): void {
    this.ram.fill(0);
    this.dmaTransfer = false;
  }
}
