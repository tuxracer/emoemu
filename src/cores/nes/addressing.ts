import { CPU } from './cpu.js';

export enum AddressingMode {
  Implied,
  Accumulator,
  Immediate,
  ZeroPage,
  ZeroPageX,
  ZeroPageY,
  Relative,
  Absolute,
  AbsoluteX,
  AbsoluteY,
  Indirect,
  IndirectX,
  IndirectY,
}

export function pageCrossed(addr1: number, addr2: number): boolean {
  return (addr1 & 0xff00) !== (addr2 & 0xff00);
}

export function getAddress(cpu: CPU, mode: AddressingMode): number {
  switch (mode) {
    case AddressingMode.Implied:
    case AddressingMode.Accumulator:
      return 0;

    case AddressingMode.Immediate: {
      const addr = cpu.pc;
      cpu.pc = (cpu.pc + 1) & 0xffff;
      return addr;
    }

    case AddressingMode.ZeroPage: {
      const addr = cpu.read(cpu.pc);
      cpu.pc = (cpu.pc + 1) & 0xffff;
      return addr;
    }

    case AddressingMode.ZeroPageX: {
      const addr = (cpu.read(cpu.pc) + cpu.x) & 0xff;
      cpu.pc = (cpu.pc + 1) & 0xffff;
      return addr;
    }

    case AddressingMode.ZeroPageY: {
      const addr = (cpu.read(cpu.pc) + cpu.y) & 0xff;
      cpu.pc = (cpu.pc + 1) & 0xffff;
      return addr;
    }

    case AddressingMode.Relative: {
      // Note: Relative addressing is handled directly in branch instructions
      return cpu.pc;
    }

    case AddressingMode.Absolute: {
      const lo = cpu.read(cpu.pc);
      const hi = cpu.read(cpu.pc + 1);
      cpu.pc = (cpu.pc + 2) & 0xffff;
      return (hi << 8) | lo;
    }

    case AddressingMode.AbsoluteX: {
      const lo = cpu.read(cpu.pc);
      const hi = cpu.read(cpu.pc + 1);
      cpu.pc = (cpu.pc + 2) & 0xffff;
      const baseAddr = (hi << 8) | lo;
      const addr = (baseAddr + cpu.x) & 0xffff;
      if (pageCrossed(baseAddr, addr)) {
        cpu.cycles += 1;
      }
      return addr;
    }

    case AddressingMode.AbsoluteY: {
      const lo = cpu.read(cpu.pc);
      const hi = cpu.read(cpu.pc + 1);
      cpu.pc = (cpu.pc + 2) & 0xffff;
      const baseAddr = (hi << 8) | lo;
      const addr = (baseAddr + cpu.y) & 0xffff;
      if (pageCrossed(baseAddr, addr)) {
        cpu.cycles += 1;
      }
      return addr;
    }

    case AddressingMode.Indirect: {
      const ptrLo = cpu.read(cpu.pc);
      const ptrHi = cpu.read(cpu.pc + 1);
      cpu.pc = (cpu.pc + 2) & 0xffff;
      const ptr = (ptrHi << 8) | ptrLo;

      // 6502 bug: if pointer is at page boundary, wraps within page
      const lo = cpu.read(ptr);
      const hi = cpu.read((ptr & 0xff00) | ((ptr + 1) & 0x00ff));
      return (hi << 8) | lo;
    }

    case AddressingMode.IndirectX: {
      const ptr = (cpu.read(cpu.pc) + cpu.x) & 0xff;
      cpu.pc = (cpu.pc + 1) & 0xffff;
      const lo = cpu.read(ptr);
      const hi = cpu.read((ptr + 1) & 0xff);
      return (hi << 8) | lo;
    }

    case AddressingMode.IndirectY: {
      const ptr = cpu.read(cpu.pc);
      cpu.pc = (cpu.pc + 1) & 0xffff;
      const lo = cpu.read(ptr);
      const hi = cpu.read((ptr + 1) & 0xff);
      const baseAddr = (hi << 8) | lo;
      const addr = (baseAddr + cpu.y) & 0xffff;
      if (pageCrossed(baseAddr, addr)) {
        cpu.cycles += 1;
      }
      return addr;
    }

    default:
      throw new Error(`Unknown addressing mode: ${mode}`);
  }
}
