import { CPU, Flag } from './cpu.js';
import { AddressingMode, getAddress, pageCrossed } from './addressing.js';

export type OpcodeHandler = (cpu: CPU, mode: AddressingMode) => void;

export interface Instruction {
  name: string;
  mode: AddressingMode;
  cycles: number;
  handler: OpcodeHandler;
}

// Update zero and negative flags based on value
function updateZN(cpu: CPU, value: number): void {
  cpu.setFlag(Flag.Z, value === 0);
  cpu.setFlag(Flag.N, (value & 0x80) !== 0);
}

// Load/Store Operations
const LDA: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.a = cpu.read(address);
  updateZN(cpu, cpu.a);
};

const LDX: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.x = cpu.read(address);
  updateZN(cpu, cpu.x);
};

const LDY: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.y = cpu.read(address);
  updateZN(cpu, cpu.y);
};

const STA: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.write(address, cpu.a);
};

const STX: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.write(address, cpu.x);
};

const STY: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.write(address, cpu.y);
};

// Register Transfers
const TAX: OpcodeHandler = (cpu) => {
  cpu.x = cpu.a;
  updateZN(cpu, cpu.x);
};

const TAY: OpcodeHandler = (cpu) => {
  cpu.y = cpu.a;
  updateZN(cpu, cpu.y);
};

const TXA: OpcodeHandler = (cpu) => {
  cpu.a = cpu.x;
  updateZN(cpu, cpu.a);
};

const TYA: OpcodeHandler = (cpu) => {
  cpu.a = cpu.y;
  updateZN(cpu, cpu.a);
};

// Stack Operations
const TSX: OpcodeHandler = (cpu) => {
  cpu.x = cpu.sp;
  updateZN(cpu, cpu.x);
};

const TXS: OpcodeHandler = (cpu) => {
  cpu.sp = cpu.x;
};

const PHA: OpcodeHandler = (cpu) => {
  cpu.push(cpu.a);
};

const PHP: OpcodeHandler = (cpu) => {
  cpu.push(cpu.status | Flag.B | Flag.U);
};

const PLA: OpcodeHandler = (cpu) => {
  cpu.a = cpu.pull();
  updateZN(cpu, cpu.a);
};

const PLP: OpcodeHandler = (cpu) => {
  cpu.status = (cpu.pull() & ~Flag.B) | Flag.U;
};

// Logical Operations
const AND: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.a &= cpu.read(address);
  updateZN(cpu, cpu.a);
};

const EOR: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.a ^= cpu.read(address);
  updateZN(cpu, cpu.a);
};

const ORA: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  cpu.a |= cpu.read(address);
  updateZN(cpu, cpu.a);
};

const BIT: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  const value = cpu.read(address);
  cpu.setFlag(Flag.Z, (cpu.a & value) === 0);
  cpu.setFlag(Flag.V, (value & 0x40) !== 0);
  cpu.setFlag(Flag.N, (value & 0x80) !== 0);
};

// Arithmetic Operations
const ADC: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  const value = cpu.read(address);
  const carry = cpu.getFlag(Flag.C) ? 1 : 0;
  const sum = cpu.a + value + carry;

  cpu.setFlag(Flag.C, sum > 0xff);
  cpu.setFlag(Flag.V, ((cpu.a ^ sum) & (value ^ sum) & 0x80) !== 0);
  cpu.a = sum & 0xff;
  updateZN(cpu, cpu.a);
};

const SBC: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  const value = cpu.read(address);
  const carry = cpu.getFlag(Flag.C) ? 1 : 0;
  const diff = cpu.a - value - (1 - carry);

  cpu.setFlag(Flag.C, diff >= 0);
  cpu.setFlag(Flag.V, ((cpu.a ^ diff) & (~value ^ diff) & 0x80) !== 0);
  cpu.a = diff & 0xff;
  updateZN(cpu, cpu.a);
};

const CMP: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  const value = cpu.read(address);
  const result = cpu.a - value;
  cpu.setFlag(Flag.C, cpu.a >= value);
  updateZN(cpu, result & 0xff);
};

const CPX: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  const value = cpu.read(address);
  const result = cpu.x - value;
  cpu.setFlag(Flag.C, cpu.x >= value);
  updateZN(cpu, result & 0xff);
};

const CPY: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  const value = cpu.read(address);
  const result = cpu.y - value;
  cpu.setFlag(Flag.C, cpu.y >= value);
  updateZN(cpu, result & 0xff);
};

// Increments & Decrements
const INC: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  const value = (cpu.read(address) + 1) & 0xff;
  cpu.write(address, value);
  updateZN(cpu, value);
};

const INX: OpcodeHandler = (cpu) => {
  cpu.x = (cpu.x + 1) & 0xff;
  updateZN(cpu, cpu.x);
};

const INY: OpcodeHandler = (cpu) => {
  cpu.y = (cpu.y + 1) & 0xff;
  updateZN(cpu, cpu.y);
};

const DEC: OpcodeHandler = (cpu, mode) => {
  const address = getAddress(cpu, mode);
  const value = (cpu.read(address) - 1) & 0xff;
  cpu.write(address, value);
  updateZN(cpu, value);
};

const DEX: OpcodeHandler = (cpu) => {
  cpu.x = (cpu.x - 1) & 0xff;
  updateZN(cpu, cpu.x);
};

const DEY: OpcodeHandler = (cpu) => {
  cpu.y = (cpu.y - 1) & 0xff;
  updateZN(cpu, cpu.y);
};

// Shifts
const ASL: OpcodeHandler = (cpu, mode) => {
  if (mode === AddressingMode.Accumulator) {
    cpu.setFlag(Flag.C, (cpu.a & 0x80) !== 0);
    cpu.a = (cpu.a << 1) & 0xff;
    updateZN(cpu, cpu.a);
  } else {
    const address = getAddress(cpu, mode);
    let value = cpu.read(address);
    cpu.setFlag(Flag.C, (value & 0x80) !== 0);
    value = (value << 1) & 0xff;
    cpu.write(address, value);
    updateZN(cpu, value);
  }
};

const LSR: OpcodeHandler = (cpu, mode) => {
  if (mode === AddressingMode.Accumulator) {
    cpu.setFlag(Flag.C, (cpu.a & 0x01) !== 0);
    cpu.a = cpu.a >> 1;
    updateZN(cpu, cpu.a);
  } else {
    const address = getAddress(cpu, mode);
    let value = cpu.read(address);
    cpu.setFlag(Flag.C, (value & 0x01) !== 0);
    value = value >> 1;
    cpu.write(address, value);
    updateZN(cpu, value);
  }
};

const ROL: OpcodeHandler = (cpu, mode) => {
  const carry = cpu.getFlag(Flag.C) ? 1 : 0;
  if (mode === AddressingMode.Accumulator) {
    cpu.setFlag(Flag.C, (cpu.a & 0x80) !== 0);
    cpu.a = ((cpu.a << 1) | carry) & 0xff;
    updateZN(cpu, cpu.a);
  } else {
    const address = getAddress(cpu, mode);
    let value = cpu.read(address);
    cpu.setFlag(Flag.C, (value & 0x80) !== 0);
    value = ((value << 1) | carry) & 0xff;
    cpu.write(address, value);
    updateZN(cpu, value);
  }
};

const ROR: OpcodeHandler = (cpu, mode) => {
  const carry = cpu.getFlag(Flag.C) ? 0x80 : 0;
  if (mode === AddressingMode.Accumulator) {
    cpu.setFlag(Flag.C, (cpu.a & 0x01) !== 0);
    cpu.a = (cpu.a >> 1) | carry;
    updateZN(cpu, cpu.a);
  } else {
    const address = getAddress(cpu, mode);
    let value = cpu.read(address);
    cpu.setFlag(Flag.C, (value & 0x01) !== 0);
    value = (value >> 1) | carry;
    cpu.write(address, value);
    updateZN(cpu, value);
  }
};

// Jumps & Calls
const JMP: OpcodeHandler = (cpu, mode) => {
  cpu.pc = getAddress(cpu, mode);
};

const JSR: OpcodeHandler = (cpu) => {
  const address = getAddress(cpu, AddressingMode.Absolute);
  cpu.push16(cpu.pc - 1);
  cpu.pc = address;
};

const RTS: OpcodeHandler = (cpu) => {
  cpu.pc = (cpu.pull16() + 1) & 0xffff;
};

// Branches
const branch = (cpu: CPU, condition: boolean): void => {
  const offset = cpu.read(cpu.pc);
  cpu.pc = (cpu.pc + 1) & 0xffff;
  if (condition) {
    const oldPc = cpu.pc;
    cpu.pc = (cpu.pc + (offset < 0x80 ? offset : offset - 256)) & 0xffff;
    cpu.cycles += 1;
    if (pageCrossed(oldPc, cpu.pc)) {
      cpu.cycles += 1;
    }
  }
};

const BCC: OpcodeHandler = (cpu) => branch(cpu, !cpu.getFlag(Flag.C));
const BCS: OpcodeHandler = (cpu) => branch(cpu, cpu.getFlag(Flag.C));
const BEQ: OpcodeHandler = (cpu) => branch(cpu, cpu.getFlag(Flag.Z));
const BMI: OpcodeHandler = (cpu) => branch(cpu, cpu.getFlag(Flag.N));
const BNE: OpcodeHandler = (cpu) => branch(cpu, !cpu.getFlag(Flag.Z));
const BPL: OpcodeHandler = (cpu) => branch(cpu, !cpu.getFlag(Flag.N));
const BVC: OpcodeHandler = (cpu) => branch(cpu, !cpu.getFlag(Flag.V));
const BVS: OpcodeHandler = (cpu) => branch(cpu, cpu.getFlag(Flag.V));

// Status Flag Changes
const CLC: OpcodeHandler = (cpu) => cpu.setFlag(Flag.C, false);
const CLD: OpcodeHandler = (cpu) => cpu.setFlag(Flag.D, false);
const CLI: OpcodeHandler = (cpu) => cpu.setFlag(Flag.I, false);
const CLV: OpcodeHandler = (cpu) => cpu.setFlag(Flag.V, false);
const SEC: OpcodeHandler = (cpu) => cpu.setFlag(Flag.C, true);
const SED: OpcodeHandler = (cpu) => cpu.setFlag(Flag.D, true);
const SEI: OpcodeHandler = (cpu) => cpu.setFlag(Flag.I, true);

// System Functions
const BRK: OpcodeHandler = (cpu) => {
  cpu.pc = (cpu.pc + 1) & 0xffff;
  cpu.push16(cpu.pc);
  cpu.push(cpu.status | Flag.B | Flag.U);
  cpu.setFlag(Flag.I, true);
  const lo = cpu.read(0xfffe);
  const hi = cpu.read(0xffff);
  cpu.pc = (hi << 8) | lo;
};

const NOP: OpcodeHandler = () => {};

const RTI: OpcodeHandler = (cpu) => {
  cpu.status = (cpu.pull() & ~Flag.B) | Flag.U;
  cpu.pc = cpu.pull16();
};

// Opcode table (256 entries)
export const opcodes: (Instruction | null)[] = new Array(256).fill(null);

// Helper to define opcodes
const op = (
  code: number,
  name: string,
  mode: AddressingMode,
  cycles: number,
  handler: OpcodeHandler
): void => {
  opcodes[code] = { name, mode, cycles, handler };
};

// Define all official opcodes
// LDA
op(0xa9, 'LDA', AddressingMode.Immediate, 2, LDA);
op(0xa5, 'LDA', AddressingMode.ZeroPage, 3, LDA);
op(0xb5, 'LDA', AddressingMode.ZeroPageX, 4, LDA);
op(0xad, 'LDA', AddressingMode.Absolute, 4, LDA);
op(0xbd, 'LDA', AddressingMode.AbsoluteX, 4, LDA);
op(0xb9, 'LDA', AddressingMode.AbsoluteY, 4, LDA);
op(0xa1, 'LDA', AddressingMode.IndirectX, 6, LDA);
op(0xb1, 'LDA', AddressingMode.IndirectY, 5, LDA);

// LDX
op(0xa2, 'LDX', AddressingMode.Immediate, 2, LDX);
op(0xa6, 'LDX', AddressingMode.ZeroPage, 3, LDX);
op(0xb6, 'LDX', AddressingMode.ZeroPageY, 4, LDX);
op(0xae, 'LDX', AddressingMode.Absolute, 4, LDX);
op(0xbe, 'LDX', AddressingMode.AbsoluteY, 4, LDX);

// LDY
op(0xa0, 'LDY', AddressingMode.Immediate, 2, LDY);
op(0xa4, 'LDY', AddressingMode.ZeroPage, 3, LDY);
op(0xb4, 'LDY', AddressingMode.ZeroPageX, 4, LDY);
op(0xac, 'LDY', AddressingMode.Absolute, 4, LDY);
op(0xbc, 'LDY', AddressingMode.AbsoluteX, 4, LDY);

// STA
op(0x85, 'STA', AddressingMode.ZeroPage, 3, STA);
op(0x95, 'STA', AddressingMode.ZeroPageX, 4, STA);
op(0x8d, 'STA', AddressingMode.Absolute, 4, STA);
op(0x9d, 'STA', AddressingMode.AbsoluteX, 5, STA);
op(0x99, 'STA', AddressingMode.AbsoluteY, 5, STA);
op(0x81, 'STA', AddressingMode.IndirectX, 6, STA);
op(0x91, 'STA', AddressingMode.IndirectY, 6, STA);

// STX
op(0x86, 'STX', AddressingMode.ZeroPage, 3, STX);
op(0x96, 'STX', AddressingMode.ZeroPageY, 4, STX);
op(0x8e, 'STX', AddressingMode.Absolute, 4, STX);

// STY
op(0x84, 'STY', AddressingMode.ZeroPage, 3, STY);
op(0x94, 'STY', AddressingMode.ZeroPageX, 4, STY);
op(0x8c, 'STY', AddressingMode.Absolute, 4, STY);

// Transfer
op(0xaa, 'TAX', AddressingMode.Implied, 2, TAX);
op(0xa8, 'TAY', AddressingMode.Implied, 2, TAY);
op(0x8a, 'TXA', AddressingMode.Implied, 2, TXA);
op(0x98, 'TYA', AddressingMode.Implied, 2, TYA);

// Stack
op(0xba, 'TSX', AddressingMode.Implied, 2, TSX);
op(0x9a, 'TXS', AddressingMode.Implied, 2, TXS);
op(0x48, 'PHA', AddressingMode.Implied, 3, PHA);
op(0x08, 'PHP', AddressingMode.Implied, 3, PHP);
op(0x68, 'PLA', AddressingMode.Implied, 4, PLA);
op(0x28, 'PLP', AddressingMode.Implied, 4, PLP);

// Logical
op(0x29, 'AND', AddressingMode.Immediate, 2, AND);
op(0x25, 'AND', AddressingMode.ZeroPage, 3, AND);
op(0x35, 'AND', AddressingMode.ZeroPageX, 4, AND);
op(0x2d, 'AND', AddressingMode.Absolute, 4, AND);
op(0x3d, 'AND', AddressingMode.AbsoluteX, 4, AND);
op(0x39, 'AND', AddressingMode.AbsoluteY, 4, AND);
op(0x21, 'AND', AddressingMode.IndirectX, 6, AND);
op(0x31, 'AND', AddressingMode.IndirectY, 5, AND);

op(0x49, 'EOR', AddressingMode.Immediate, 2, EOR);
op(0x45, 'EOR', AddressingMode.ZeroPage, 3, EOR);
op(0x55, 'EOR', AddressingMode.ZeroPageX, 4, EOR);
op(0x4d, 'EOR', AddressingMode.Absolute, 4, EOR);
op(0x5d, 'EOR', AddressingMode.AbsoluteX, 4, EOR);
op(0x59, 'EOR', AddressingMode.AbsoluteY, 4, EOR);
op(0x41, 'EOR', AddressingMode.IndirectX, 6, EOR);
op(0x51, 'EOR', AddressingMode.IndirectY, 5, EOR);

op(0x09, 'ORA', AddressingMode.Immediate, 2, ORA);
op(0x05, 'ORA', AddressingMode.ZeroPage, 3, ORA);
op(0x15, 'ORA', AddressingMode.ZeroPageX, 4, ORA);
op(0x0d, 'ORA', AddressingMode.Absolute, 4, ORA);
op(0x1d, 'ORA', AddressingMode.AbsoluteX, 4, ORA);
op(0x19, 'ORA', AddressingMode.AbsoluteY, 4, ORA);
op(0x01, 'ORA', AddressingMode.IndirectX, 6, ORA);
op(0x11, 'ORA', AddressingMode.IndirectY, 5, ORA);

op(0x24, 'BIT', AddressingMode.ZeroPage, 3, BIT);
op(0x2c, 'BIT', AddressingMode.Absolute, 4, BIT);

// Arithmetic
op(0x69, 'ADC', AddressingMode.Immediate, 2, ADC);
op(0x65, 'ADC', AddressingMode.ZeroPage, 3, ADC);
op(0x75, 'ADC', AddressingMode.ZeroPageX, 4, ADC);
op(0x6d, 'ADC', AddressingMode.Absolute, 4, ADC);
op(0x7d, 'ADC', AddressingMode.AbsoluteX, 4, ADC);
op(0x79, 'ADC', AddressingMode.AbsoluteY, 4, ADC);
op(0x61, 'ADC', AddressingMode.IndirectX, 6, ADC);
op(0x71, 'ADC', AddressingMode.IndirectY, 5, ADC);

op(0xe9, 'SBC', AddressingMode.Immediate, 2, SBC);
op(0xe5, 'SBC', AddressingMode.ZeroPage, 3, SBC);
op(0xf5, 'SBC', AddressingMode.ZeroPageX, 4, SBC);
op(0xed, 'SBC', AddressingMode.Absolute, 4, SBC);
op(0xfd, 'SBC', AddressingMode.AbsoluteX, 4, SBC);
op(0xf9, 'SBC', AddressingMode.AbsoluteY, 4, SBC);
op(0xe1, 'SBC', AddressingMode.IndirectX, 6, SBC);
op(0xf1, 'SBC', AddressingMode.IndirectY, 5, SBC);

op(0xc9, 'CMP', AddressingMode.Immediate, 2, CMP);
op(0xc5, 'CMP', AddressingMode.ZeroPage, 3, CMP);
op(0xd5, 'CMP', AddressingMode.ZeroPageX, 4, CMP);
op(0xcd, 'CMP', AddressingMode.Absolute, 4, CMP);
op(0xdd, 'CMP', AddressingMode.AbsoluteX, 4, CMP);
op(0xd9, 'CMP', AddressingMode.AbsoluteY, 4, CMP);
op(0xc1, 'CMP', AddressingMode.IndirectX, 6, CMP);
op(0xd1, 'CMP', AddressingMode.IndirectY, 5, CMP);

op(0xe0, 'CPX', AddressingMode.Immediate, 2, CPX);
op(0xe4, 'CPX', AddressingMode.ZeroPage, 3, CPX);
op(0xec, 'CPX', AddressingMode.Absolute, 4, CPX);

op(0xc0, 'CPY', AddressingMode.Immediate, 2, CPY);
op(0xc4, 'CPY', AddressingMode.ZeroPage, 3, CPY);
op(0xcc, 'CPY', AddressingMode.Absolute, 4, CPY);

// Increments/Decrements
op(0xe6, 'INC', AddressingMode.ZeroPage, 5, INC);
op(0xf6, 'INC', AddressingMode.ZeroPageX, 6, INC);
op(0xee, 'INC', AddressingMode.Absolute, 6, INC);
op(0xfe, 'INC', AddressingMode.AbsoluteX, 7, INC);

op(0xe8, 'INX', AddressingMode.Implied, 2, INX);
op(0xc8, 'INY', AddressingMode.Implied, 2, INY);

op(0xc6, 'DEC', AddressingMode.ZeroPage, 5, DEC);
op(0xd6, 'DEC', AddressingMode.ZeroPageX, 6, DEC);
op(0xce, 'DEC', AddressingMode.Absolute, 6, DEC);
op(0xde, 'DEC', AddressingMode.AbsoluteX, 7, DEC);

op(0xca, 'DEX', AddressingMode.Implied, 2, DEX);
op(0x88, 'DEY', AddressingMode.Implied, 2, DEY);

// Shifts
op(0x0a, 'ASL', AddressingMode.Accumulator, 2, ASL);
op(0x06, 'ASL', AddressingMode.ZeroPage, 5, ASL);
op(0x16, 'ASL', AddressingMode.ZeroPageX, 6, ASL);
op(0x0e, 'ASL', AddressingMode.Absolute, 6, ASL);
op(0x1e, 'ASL', AddressingMode.AbsoluteX, 7, ASL);

op(0x4a, 'LSR', AddressingMode.Accumulator, 2, LSR);
op(0x46, 'LSR', AddressingMode.ZeroPage, 5, LSR);
op(0x56, 'LSR', AddressingMode.ZeroPageX, 6, LSR);
op(0x4e, 'LSR', AddressingMode.Absolute, 6, LSR);
op(0x5e, 'LSR', AddressingMode.AbsoluteX, 7, LSR);

op(0x2a, 'ROL', AddressingMode.Accumulator, 2, ROL);
op(0x26, 'ROL', AddressingMode.ZeroPage, 5, ROL);
op(0x36, 'ROL', AddressingMode.ZeroPageX, 6, ROL);
op(0x2e, 'ROL', AddressingMode.Absolute, 6, ROL);
op(0x3e, 'ROL', AddressingMode.AbsoluteX, 7, ROL);

op(0x6a, 'ROR', AddressingMode.Accumulator, 2, ROR);
op(0x66, 'ROR', AddressingMode.ZeroPage, 5, ROR);
op(0x76, 'ROR', AddressingMode.ZeroPageX, 6, ROR);
op(0x6e, 'ROR', AddressingMode.Absolute, 6, ROR);
op(0x7e, 'ROR', AddressingMode.AbsoluteX, 7, ROR);

// Jumps/Calls
op(0x4c, 'JMP', AddressingMode.Absolute, 3, JMP);
op(0x6c, 'JMP', AddressingMode.Indirect, 5, JMP);
op(0x20, 'JSR', AddressingMode.Absolute, 6, JSR);
op(0x60, 'RTS', AddressingMode.Implied, 6, RTS);

// Branches
op(0x90, 'BCC', AddressingMode.Relative, 2, BCC);
op(0xb0, 'BCS', AddressingMode.Relative, 2, BCS);
op(0xf0, 'BEQ', AddressingMode.Relative, 2, BEQ);
op(0x30, 'BMI', AddressingMode.Relative, 2, BMI);
op(0xd0, 'BNE', AddressingMode.Relative, 2, BNE);
op(0x10, 'BPL', AddressingMode.Relative, 2, BPL);
op(0x50, 'BVC', AddressingMode.Relative, 2, BVC);
op(0x70, 'BVS', AddressingMode.Relative, 2, BVS);

// Status Flag Changes
op(0x18, 'CLC', AddressingMode.Implied, 2, CLC);
op(0xd8, 'CLD', AddressingMode.Implied, 2, CLD);
op(0x58, 'CLI', AddressingMode.Implied, 2, CLI);
op(0xb8, 'CLV', AddressingMode.Implied, 2, CLV);
op(0x38, 'SEC', AddressingMode.Implied, 2, SEC);
op(0xf8, 'SED', AddressingMode.Implied, 2, SED);
op(0x78, 'SEI', AddressingMode.Implied, 2, SEI);

// System
op(0x00, 'BRK', AddressingMode.Implied, 7, BRK);
op(0xea, 'NOP', AddressingMode.Implied, 2, NOP);
op(0x40, 'RTI', AddressingMode.Implied, 6, RTI);
