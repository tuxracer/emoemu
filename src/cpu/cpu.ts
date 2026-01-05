import { Bus } from '../memory/bus.js';
import { opcodes } from './opcodes.js';

export interface CPUState {
  a: number;      // Accumulator
  x: number;      // Index Register X
  y: number;      // Index Register Y
  sp: number;     // Stack Pointer
  pc: number;     // Program Counter
  status: number; // Status Register (flags)
}

// Status register flags
export const Flag = {
  C: 0x01, // Carry
  Z: 0x02, // Zero
  I: 0x04, // Interrupt Disable
  D: 0x08, // Decimal Mode (unused on NES)
  B: 0x10, // Break
  U: 0x20, // Unused (always 1)
  V: 0x40, // Overflow
  N: 0x80, // Negative
} as const;

export class CPU {
  // Registers
  a: number = 0x00;
  x: number = 0x00;
  y: number = 0x00;
  sp: number = 0xfd;
  pc: number = 0x0000;
  status: number = 0x24; // I and U flags set

  // Cycle counting
  cycles: number = 0;
  totalCycles: number = 0;

  private bus: Bus;

  constructor(bus: Bus) {
    this.bus = bus;
  }

  reset(): void {
    this.a = 0x00;
    this.x = 0x00;
    this.y = 0x00;
    this.sp = 0xfd;
    this.status = 0x24;

    // Read reset vector at $FFFC-$FFFD
    const lo = this.bus.read(0xfffc);
    const hi = this.bus.read(0xfffd);
    this.pc = (hi << 8) | lo;

    this.cycles = 8; // Reset takes 8 cycles
  }

  getFlag(flag: number): boolean {
    return (this.status & flag) !== 0;
  }

  setFlag(flag: number, value: boolean): void {
    if (value) {
      this.status |= flag;
    } else {
      this.status &= ~flag;
    }
  }

  read(address: number): number {
    return this.bus.read(address);
  }

  write(address: number, value: number): void {
    this.bus.write(address, value);
  }

  // Push a byte onto the stack
  push(value: number): void {
    this.write(0x0100 + this.sp, value);
    this.sp = (this.sp - 1) & 0xff;
  }

  // Pull a byte from the stack
  pull(): number {
    this.sp = (this.sp + 1) & 0xff;
    return this.read(0x0100 + this.sp);
  }

  // Push 16-bit value onto stack (high byte first)
  push16(value: number): void {
    this.push((value >> 8) & 0xff);
    this.push(value & 0xff);
  }

  // Pull 16-bit value from stack
  pull16(): number {
    const lo = this.pull();
    const hi = this.pull();
    return (hi << 8) | lo;
  }

  // Non-maskable interrupt
  nmi(): void {
    this.push16(this.pc);
    this.setFlag(Flag.B, false);
    this.setFlag(Flag.U, true);
    this.setFlag(Flag.I, true);
    this.push(this.status);

    const lo = this.read(0xfffa);
    const hi = this.read(0xfffb);
    this.pc = (hi << 8) | lo;

    this.cycles = 8;
  }

  // Interrupt request
  irq(): void {
    if (!this.getFlag(Flag.I)) {
      this.push16(this.pc);
      this.setFlag(Flag.B, false);
      this.setFlag(Flag.U, true);
      this.setFlag(Flag.I, true);
      this.push(this.status);

      const lo = this.read(0xfffe);
      const hi = this.read(0xffff);
      this.pc = (hi << 8) | lo;

      this.cycles = 7;
    }
  }

  // Execute one instruction
  step(): number {
    // Read opcode and advance PC
    const opcode = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;

    // Look up instruction
    const instruction = opcodes[opcode];

    if (instruction) {
      // Set base cycle count
      this.cycles = instruction.cycles;

      // Execute the instruction handler
      instruction.handler(this, instruction.mode);
    } else {
      // Unknown opcode - treat as NOP with 2 cycles
      // Many unofficial opcodes exist; for now we skip them
      this.cycles = 2;
    }

    const cycles = this.cycles;
    this.totalCycles += cycles;
    this.cycles = 0;

    return cycles;
  }

  getState(): CPUState {
    return {
      a: this.a,
      x: this.x,
      y: this.y,
      sp: this.sp,
      pc: this.pc,
      status: this.status,
    };
  }
}
