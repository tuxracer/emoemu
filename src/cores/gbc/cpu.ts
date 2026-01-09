// Sharp LR35902 CPU implementation for Game Boy / Game Boy Color
// Z80-like but with differences (no IX/IY, no alternate registers, different flag behavior)

export interface CpuState {
  a: number;
  f: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  sp: number;
  pc: number;
  ime: boolean;
  halted: boolean;
  stopped: boolean;
  imeScheduled: boolean;
}

// Flag bit positions in F register
const FLAG_Z = 0x80; // Zero flag
const FLAG_N = 0x40; // Subtract flag
const FLAG_H = 0x20; // Half-carry flag
const FLAG_C = 0x10; // Carry flag

export class CPU {
  // 8-bit registers
  a = 0x11; // Accumulator (GBC mode initial)
  f = 0xb0; // Flags
  b = 0x00;
  c = 0x00;
  d = 0xff;
  e = 0x56;
  h = 0x00;
  l = 0x0d;

  // 16-bit registers
  sp = 0xfffe; // Stack pointer
  pc = 0x0100; // Program counter (after boot ROM)

  // Interrupt state
  ime = false; // Interrupt Master Enable
  imeScheduled = false; // EI enables IME after next instruction
  halted = false;
  stopped = false;

  // Memory access callbacks
  private read: (addr: number) => number;
  private write: (addr: number, value: number) => void;

  constructor(
    read: (addr: number) => number,
    write: (addr: number, value: number) => void
  ) {
    this.read = read;
    this.write = write;
  }

  reset(): void {
    // GBC mode initial values (after boot ROM)
    // These values are what the hardware has after the boot ROM completes
    this.a = 0x11;  // 0x11 indicates GBC mode
    this.f = 0x80;  // Z=1, N=0, H=0, C=0
    this.b = 0x00;
    this.c = 0x13;
    this.d = 0x00;
    this.e = 0xd8;
    this.h = 0x01;
    this.l = 0x4d;
    this.sp = 0xfffe;
    this.pc = 0x0100;
    this.ime = false;
    this.imeScheduled = false;
    this.halted = false;
    this.stopped = false;
  }

  // Check if CPU is in stopped state (for speed switch handling)
  isStopped(): boolean {
    return this.stopped;
  }

  // Clear stopped state (after speed switch)
  clearStopped(): void {
    this.stopped = false;
  }

  getState(): CpuState {
    return {
      a: this.a,
      f: this.f,
      b: this.b,
      c: this.c,
      d: this.d,
      e: this.e,
      h: this.h,
      l: this.l,
      sp: this.sp,
      pc: this.pc,
      ime: this.ime,
      halted: this.halted,
      stopped: this.stopped,
      imeScheduled: this.imeScheduled,
    };
  }

  setState(state: CpuState): void {
    this.a = state.a;
    this.f = state.f;
    this.b = state.b;
    this.c = state.c;
    this.d = state.d;
    this.e = state.e;
    this.h = state.h;
    this.l = state.l;
    this.sp = state.sp;
    this.pc = state.pc;
    this.ime = state.ime;
    this.halted = state.halted;
    this.stopped = state.stopped;
    this.imeScheduled = state.imeScheduled;
  }

  // 16-bit register pairs
  get af(): number {
    return (this.a << 8) | this.f;
  }
  set af(v: number) {
    this.a = (v >> 8) & 0xff;
    this.f = v & 0xf0; // Lower 4 bits always 0
  }

  get bc(): number {
    return (this.b << 8) | this.c;
  }
  set bc(v: number) {
    this.b = (v >> 8) & 0xff;
    this.c = v & 0xff;
  }

  get de(): number {
    return (this.d << 8) | this.e;
  }
  set de(v: number) {
    this.d = (v >> 8) & 0xff;
    this.e = v & 0xff;
  }

  get hl(): number {
    return (this.h << 8) | this.l;
  }
  set hl(v: number) {
    this.h = (v >> 8) & 0xff;
    this.l = v & 0xff;
  }

  // Flag helpers
  private getFlag(flag: number): boolean {
    return (this.f & flag) !== 0;
  }

  private setFlag(flag: number, value: boolean): void {
    if (value) {
      this.f |= flag;
    } else {
      this.f &= ~flag;
    }
  }

  get flagZ(): boolean {
    return this.getFlag(FLAG_Z);
  }
  set flagZ(v: boolean) {
    this.setFlag(FLAG_Z, v);
  }

  get flagN(): boolean {
    return this.getFlag(FLAG_N);
  }
  set flagN(v: boolean) {
    this.setFlag(FLAG_N, v);
  }

  get flagH(): boolean {
    return this.getFlag(FLAG_H);
  }
  set flagH(v: boolean) {
    this.setFlag(FLAG_H, v);
  }

  get flagC(): boolean {
    return this.getFlag(FLAG_C);
  }
  set flagC(v: boolean) {
    this.setFlag(FLAG_C, v);
  }

  // Memory access helpers
  private read8(addr: number): number {
    return this.read(addr & 0xffff);
  }

  private write8(addr: number, value: number): void {
    this.write(addr & 0xffff, value & 0xff);
  }

  private read16(addr: number): number {
    const lo = this.read8(addr);
    const hi = this.read8(addr + 1);
    return (hi << 8) | lo;
  }

  private write16(addr: number, value: number): void {
    this.write8(addr, value & 0xff);
    this.write8(addr + 1, (value >> 8) & 0xff);
  }

  // Fetch next byte/word from PC
  private fetch8(): number {
    const value = this.read8(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return value;
  }

  private fetch16(): number {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return (hi << 8) | lo;
  }

  // Stack operations
  private push16(value: number): void {
    this.sp = (this.sp - 2) & 0xffff;
    this.write16(this.sp, value);
  }

  private pop16(): number {
    const value = this.read16(this.sp);
    this.sp = (this.sp + 2) & 0xffff;
    return value;
  }

  // Handle interrupt if pending
  handleInterrupt(interruptFlags: number, interruptEnable: number): number {
    const pending = interruptFlags & interruptEnable & 0x1f;

    if (pending !== 0) {
      this.halted = false;
    }

    if (!this.ime || pending === 0) {
      return 0;
    }

    // Find highest priority interrupt
    let vector = 0;
    let bit = 0;
    if (pending & 0x01) {
      vector = 0x40;
      bit = 0x01;
    } // VBlank
    else if (pending & 0x02) {
      vector = 0x48;
      bit = 0x02;
    } // LCD STAT
    else if (pending & 0x04) {
      vector = 0x50;
      bit = 0x04;
    } // Timer
    else if (pending & 0x08) {
      vector = 0x58;
      bit = 0x08;
    } // Serial
    else if (pending & 0x10) {
      vector = 0x60;
      bit = 0x10;
    } // Joypad

    this.ime = false;
    this.push16(this.pc);
    this.pc = vector;

    return bit; // Return which interrupt was handled for IF clearing
  }

  // Execute one instruction, returns cycles consumed
  step(): number {
    // Handle EI delay
    if (this.imeScheduled) {
      this.ime = true;
      this.imeScheduled = false;
    }

    if (this.halted) {
      return 4; // Halted, just tick
    }

    const opcode = this.fetch8();
    return this.execute(opcode);
  }

  private execute(opcode: number): number {
    switch (opcode) {
      // NOP
      case 0x00:
        return 4;

      // LD BC,nn
      case 0x01:
        this.bc = this.fetch16();
        return 12;

      // LD (BC),A
      case 0x02:
        this.write8(this.bc, this.a);
        return 8;

      // INC BC
      case 0x03:
        this.bc = (this.bc + 1) & 0xffff;
        return 8;

      // INC B
      case 0x04:
        this.b = this.inc8(this.b);
        return 4;

      // DEC B
      case 0x05:
        this.b = this.dec8(this.b);
        return 4;

      // LD B,n
      case 0x06:
        this.b = this.fetch8();
        return 8;

      // RLCA
      case 0x07: {
        const carry = (this.a >> 7) & 1;
        this.a = ((this.a << 1) | carry) & 0xff;
        this.f = carry ? FLAG_C : 0;
        return 4;
      }

      // LD (nn),SP
      case 0x08: {
        const addr = this.fetch16();
        this.write16(addr, this.sp);
        return 20;
      }

      // ADD HL,BC
      case 0x09:
        this.addHL(this.bc);
        return 8;

      // LD A,(BC)
      case 0x0a:
        this.a = this.read8(this.bc);
        return 8;

      // DEC BC
      case 0x0b:
        this.bc = (this.bc - 1) & 0xffff;
        return 8;

      // INC C
      case 0x0c:
        this.c = this.inc8(this.c);
        return 4;

      // DEC C
      case 0x0d:
        this.c = this.dec8(this.c);
        return 4;

      // LD C,n
      case 0x0e:
        this.c = this.fetch8();
        return 8;

      // RRCA
      case 0x0f: {
        const carry = this.a & 1;
        this.a = ((this.a >> 1) | (carry << 7)) & 0xff;
        this.f = carry ? FLAG_C : 0;
        return 4;
      }

      // STOP
      case 0x10:
        this.fetch8(); // Consume extra byte
        this.stopped = true;
        return 4;

      // LD DE,nn
      case 0x11:
        this.de = this.fetch16();
        return 12;

      // LD (DE),A
      case 0x12:
        this.write8(this.de, this.a);
        return 8;

      // INC DE
      case 0x13:
        this.de = (this.de + 1) & 0xffff;
        return 8;

      // INC D
      case 0x14:
        this.d = this.inc8(this.d);
        return 4;

      // DEC D
      case 0x15:
        this.d = this.dec8(this.d);
        return 4;

      // LD D,n
      case 0x16:
        this.d = this.fetch8();
        return 8;

      // RLA
      case 0x17: {
        const oldCarry = this.flagC ? 1 : 0;
        const newCarry = (this.a >> 7) & 1;
        this.a = ((this.a << 1) | oldCarry) & 0xff;
        this.f = newCarry ? FLAG_C : 0;
        return 4;
      }

      // JR e
      case 0x18: {
        const offset = this.signedByte(this.fetch8());
        this.pc = (this.pc + offset) & 0xffff;
        return 12;
      }

      // ADD HL,DE
      case 0x19:
        this.addHL(this.de);
        return 8;

      // LD A,(DE)
      case 0x1a:
        this.a = this.read8(this.de);
        return 8;

      // DEC DE
      case 0x1b:
        this.de = (this.de - 1) & 0xffff;
        return 8;

      // INC E
      case 0x1c:
        this.e = this.inc8(this.e);
        return 4;

      // DEC E
      case 0x1d:
        this.e = this.dec8(this.e);
        return 4;

      // LD E,n
      case 0x1e:
        this.e = this.fetch8();
        return 8;

      // RRA
      case 0x1f: {
        const oldCarry = this.flagC ? 0x80 : 0;
        const newCarry = this.a & 1;
        this.a = ((this.a >> 1) | oldCarry) & 0xff;
        this.f = newCarry ? FLAG_C : 0;
        return 4;
      }

      // JR NZ,e
      case 0x20: {
        const offset = this.signedByte(this.fetch8());
        if (!this.flagZ) {
          this.pc = (this.pc + offset) & 0xffff;
          return 12;
        }
        return 8;
      }

      // LD HL,nn
      case 0x21:
        this.hl = this.fetch16();
        return 12;

      // LD (HL+),A
      case 0x22:
        this.write8(this.hl, this.a);
        this.hl = (this.hl + 1) & 0xffff;
        return 8;

      // INC HL
      case 0x23:
        this.hl = (this.hl + 1) & 0xffff;
        return 8;

      // INC H
      case 0x24:
        this.h = this.inc8(this.h);
        return 4;

      // DEC H
      case 0x25:
        this.h = this.dec8(this.h);
        return 4;

      // LD H,n
      case 0x26:
        this.h = this.fetch8();
        return 8;

      // DAA
      case 0x27:
        this.daa();
        return 4;

      // JR Z,e
      case 0x28: {
        const offset = this.signedByte(this.fetch8());
        if (this.flagZ) {
          this.pc = (this.pc + offset) & 0xffff;
          return 12;
        }
        return 8;
      }

      // ADD HL,HL
      case 0x29:
        this.addHL(this.hl);
        return 8;

      // LD A,(HL+)
      case 0x2a:
        this.a = this.read8(this.hl);
        this.hl = (this.hl + 1) & 0xffff;
        return 8;

      // DEC HL
      case 0x2b:
        this.hl = (this.hl - 1) & 0xffff;
        return 8;

      // INC L
      case 0x2c:
        this.l = this.inc8(this.l);
        return 4;

      // DEC L
      case 0x2d:
        this.l = this.dec8(this.l);
        return 4;

      // LD L,n
      case 0x2e:
        this.l = this.fetch8();
        return 8;

      // CPL
      case 0x2f:
        this.a = ~this.a & 0xff;
        this.flagN = true;
        this.flagH = true;
        return 4;

      // JR NC,e
      case 0x30: {
        const offset = this.signedByte(this.fetch8());
        if (!this.flagC) {
          this.pc = (this.pc + offset) & 0xffff;
          return 12;
        }
        return 8;
      }

      // LD SP,nn
      case 0x31:
        this.sp = this.fetch16();
        return 12;

      // LD (HL-),A
      case 0x32:
        this.write8(this.hl, this.a);
        this.hl = (this.hl - 1) & 0xffff;
        return 8;

      // INC SP
      case 0x33:
        this.sp = (this.sp + 1) & 0xffff;
        return 8;

      // INC (HL)
      case 0x34: {
        const value = this.inc8(this.read8(this.hl));
        this.write8(this.hl, value);
        return 12;
      }

      // DEC (HL)
      case 0x35: {
        const value = this.dec8(this.read8(this.hl));
        this.write8(this.hl, value);
        return 12;
      }

      // LD (HL),n
      case 0x36:
        this.write8(this.hl, this.fetch8());
        return 12;

      // SCF
      case 0x37:
        this.flagN = false;
        this.flagH = false;
        this.flagC = true;
        return 4;

      // JR C,e
      case 0x38: {
        const offset = this.signedByte(this.fetch8());
        if (this.flagC) {
          this.pc = (this.pc + offset) & 0xffff;
          return 12;
        }
        return 8;
      }

      // ADD HL,SP
      case 0x39:
        this.addHL(this.sp);
        return 8;

      // LD A,(HL-)
      case 0x3a:
        this.a = this.read8(this.hl);
        this.hl = (this.hl - 1) & 0xffff;
        return 8;

      // DEC SP
      case 0x3b:
        this.sp = (this.sp - 1) & 0xffff;
        return 8;

      // INC A
      case 0x3c:
        this.a = this.inc8(this.a);
        return 4;

      // DEC A
      case 0x3d:
        this.a = this.dec8(this.a);
        return 4;

      // LD A,n
      case 0x3e:
        this.a = this.fetch8();
        return 8;

      // CCF
      case 0x3f:
        this.flagN = false;
        this.flagH = false;
        this.flagC = !this.flagC;
        return 4;

      // LD B,B through LD B,A (0x40-0x47)
      case 0x40:
        return 4; // LD B,B
      case 0x41:
        this.b = this.c;
        return 4;
      case 0x42:
        this.b = this.d;
        return 4;
      case 0x43:
        this.b = this.e;
        return 4;
      case 0x44:
        this.b = this.h;
        return 4;
      case 0x45:
        this.b = this.l;
        return 4;
      case 0x46:
        this.b = this.read8(this.hl);
        return 8;
      case 0x47:
        this.b = this.a;
        return 4;

      // LD C,B through LD C,A (0x48-0x4F)
      case 0x48:
        this.c = this.b;
        return 4;
      case 0x49:
        return 4; // LD C,C
      case 0x4a:
        this.c = this.d;
        return 4;
      case 0x4b:
        this.c = this.e;
        return 4;
      case 0x4c:
        this.c = this.h;
        return 4;
      case 0x4d:
        this.c = this.l;
        return 4;
      case 0x4e:
        this.c = this.read8(this.hl);
        return 8;
      case 0x4f:
        this.c = this.a;
        return 4;

      // LD D,B through LD D,A (0x50-0x57)
      case 0x50:
        this.d = this.b;
        return 4;
      case 0x51:
        this.d = this.c;
        return 4;
      case 0x52:
        return 4; // LD D,D
      case 0x53:
        this.d = this.e;
        return 4;
      case 0x54:
        this.d = this.h;
        return 4;
      case 0x55:
        this.d = this.l;
        return 4;
      case 0x56:
        this.d = this.read8(this.hl);
        return 8;
      case 0x57:
        this.d = this.a;
        return 4;

      // LD E,B through LD E,A (0x58-0x5F)
      case 0x58:
        this.e = this.b;
        return 4;
      case 0x59:
        this.e = this.c;
        return 4;
      case 0x5a:
        this.e = this.d;
        return 4;
      case 0x5b:
        return 4; // LD E,E
      case 0x5c:
        this.e = this.h;
        return 4;
      case 0x5d:
        this.e = this.l;
        return 4;
      case 0x5e:
        this.e = this.read8(this.hl);
        return 8;
      case 0x5f:
        this.e = this.a;
        return 4;

      // LD H,B through LD H,A (0x60-0x67)
      case 0x60:
        this.h = this.b;
        return 4;
      case 0x61:
        this.h = this.c;
        return 4;
      case 0x62:
        this.h = this.d;
        return 4;
      case 0x63:
        this.h = this.e;
        return 4;
      case 0x64:
        return 4; // LD H,H
      case 0x65:
        this.h = this.l;
        return 4;
      case 0x66:
        this.h = this.read8(this.hl);
        return 8;
      case 0x67:
        this.h = this.a;
        return 4;

      // LD L,B through LD L,A (0x68-0x6F)
      case 0x68:
        this.l = this.b;
        return 4;
      case 0x69:
        this.l = this.c;
        return 4;
      case 0x6a:
        this.l = this.d;
        return 4;
      case 0x6b:
        this.l = this.e;
        return 4;
      case 0x6c:
        this.l = this.h;
        return 4;
      case 0x6d:
        return 4; // LD L,L
      case 0x6e:
        this.l = this.read8(this.hl);
        return 8;
      case 0x6f:
        this.l = this.a;
        return 4;

      // LD (HL),B through LD (HL),A (0x70-0x77, except 0x76=HALT)
      case 0x70:
        this.write8(this.hl, this.b);
        return 8;
      case 0x71:
        this.write8(this.hl, this.c);
        return 8;
      case 0x72:
        this.write8(this.hl, this.d);
        return 8;
      case 0x73:
        this.write8(this.hl, this.e);
        return 8;
      case 0x74:
        this.write8(this.hl, this.h);
        return 8;
      case 0x75:
        this.write8(this.hl, this.l);
        return 8;

      // HALT
      case 0x76:
        this.halted = true;
        return 4;

      case 0x77:
        this.write8(this.hl, this.a);
        return 8;

      // LD A,B through LD A,A (0x78-0x7F)
      case 0x78:
        this.a = this.b;
        return 4;
      case 0x79:
        this.a = this.c;
        return 4;
      case 0x7a:
        this.a = this.d;
        return 4;
      case 0x7b:
        this.a = this.e;
        return 4;
      case 0x7c:
        this.a = this.h;
        return 4;
      case 0x7d:
        this.a = this.l;
        return 4;
      case 0x7e:
        this.a = this.read8(this.hl);
        return 8;
      case 0x7f:
        return 4; // LD A,A

      // ADD A,r (0x80-0x87)
      case 0x80:
        this.add8(this.b);
        return 4;
      case 0x81:
        this.add8(this.c);
        return 4;
      case 0x82:
        this.add8(this.d);
        return 4;
      case 0x83:
        this.add8(this.e);
        return 4;
      case 0x84:
        this.add8(this.h);
        return 4;
      case 0x85:
        this.add8(this.l);
        return 4;
      case 0x86:
        this.add8(this.read8(this.hl));
        return 8;
      case 0x87:
        this.add8(this.a);
        return 4;

      // ADC A,r (0x88-0x8F)
      case 0x88:
        this.adc8(this.b);
        return 4;
      case 0x89:
        this.adc8(this.c);
        return 4;
      case 0x8a:
        this.adc8(this.d);
        return 4;
      case 0x8b:
        this.adc8(this.e);
        return 4;
      case 0x8c:
        this.adc8(this.h);
        return 4;
      case 0x8d:
        this.adc8(this.l);
        return 4;
      case 0x8e:
        this.adc8(this.read8(this.hl));
        return 8;
      case 0x8f:
        this.adc8(this.a);
        return 4;

      // SUB A,r (0x90-0x97)
      case 0x90:
        this.sub8(this.b);
        return 4;
      case 0x91:
        this.sub8(this.c);
        return 4;
      case 0x92:
        this.sub8(this.d);
        return 4;
      case 0x93:
        this.sub8(this.e);
        return 4;
      case 0x94:
        this.sub8(this.h);
        return 4;
      case 0x95:
        this.sub8(this.l);
        return 4;
      case 0x96:
        this.sub8(this.read8(this.hl));
        return 8;
      case 0x97:
        this.sub8(this.a);
        return 4;

      // SBC A,r (0x98-0x9F)
      case 0x98:
        this.sbc8(this.b);
        return 4;
      case 0x99:
        this.sbc8(this.c);
        return 4;
      case 0x9a:
        this.sbc8(this.d);
        return 4;
      case 0x9b:
        this.sbc8(this.e);
        return 4;
      case 0x9c:
        this.sbc8(this.h);
        return 4;
      case 0x9d:
        this.sbc8(this.l);
        return 4;
      case 0x9e:
        this.sbc8(this.read8(this.hl));
        return 8;
      case 0x9f:
        this.sbc8(this.a);
        return 4;

      // AND A,r (0xA0-0xA7)
      case 0xa0:
        this.and8(this.b);
        return 4;
      case 0xa1:
        this.and8(this.c);
        return 4;
      case 0xa2:
        this.and8(this.d);
        return 4;
      case 0xa3:
        this.and8(this.e);
        return 4;
      case 0xa4:
        this.and8(this.h);
        return 4;
      case 0xa5:
        this.and8(this.l);
        return 4;
      case 0xa6:
        this.and8(this.read8(this.hl));
        return 8;
      case 0xa7:
        this.and8(this.a);
        return 4;

      // XOR A,r (0xA8-0xAF)
      case 0xa8:
        this.xor8(this.b);
        return 4;
      case 0xa9:
        this.xor8(this.c);
        return 4;
      case 0xaa:
        this.xor8(this.d);
        return 4;
      case 0xab:
        this.xor8(this.e);
        return 4;
      case 0xac:
        this.xor8(this.h);
        return 4;
      case 0xad:
        this.xor8(this.l);
        return 4;
      case 0xae:
        this.xor8(this.read8(this.hl));
        return 8;
      case 0xaf:
        this.xor8(this.a);
        return 4;

      // OR A,r (0xB0-0xB7)
      case 0xb0:
        this.or8(this.b);
        return 4;
      case 0xb1:
        this.or8(this.c);
        return 4;
      case 0xb2:
        this.or8(this.d);
        return 4;
      case 0xb3:
        this.or8(this.e);
        return 4;
      case 0xb4:
        this.or8(this.h);
        return 4;
      case 0xb5:
        this.or8(this.l);
        return 4;
      case 0xb6:
        this.or8(this.read8(this.hl));
        return 8;
      case 0xb7:
        this.or8(this.a);
        return 4;

      // CP A,r (0xB8-0xBF)
      case 0xb8:
        this.cp8(this.b);
        return 4;
      case 0xb9:
        this.cp8(this.c);
        return 4;
      case 0xba:
        this.cp8(this.d);
        return 4;
      case 0xbb:
        this.cp8(this.e);
        return 4;
      case 0xbc:
        this.cp8(this.h);
        return 4;
      case 0xbd:
        this.cp8(this.l);
        return 4;
      case 0xbe:
        this.cp8(this.read8(this.hl));
        return 8;
      case 0xbf:
        this.cp8(this.a);
        return 4;

      // RET NZ
      case 0xc0:
        if (!this.flagZ) {
          this.pc = this.pop16();
          return 20;
        }
        return 8;

      // POP BC
      case 0xc1:
        this.bc = this.pop16();
        return 12;

      // JP NZ,nn
      case 0xc2: {
        const addr = this.fetch16();
        if (!this.flagZ) {
          this.pc = addr;
          return 16;
        }
        return 12;
      }

      // JP nn
      case 0xc3:
        this.pc = this.fetch16();
        return 16;

      // CALL NZ,nn
      case 0xc4: {
        const addr = this.fetch16();
        if (!this.flagZ) {
          this.push16(this.pc);
          this.pc = addr;
          return 24;
        }
        return 12;
      }

      // PUSH BC
      case 0xc5:
        this.push16(this.bc);
        return 16;

      // ADD A,n
      case 0xc6:
        this.add8(this.fetch8());
        return 8;

      // RST 00
      case 0xc7:
        this.push16(this.pc);
        this.pc = 0x00;
        return 16;

      // RET Z
      case 0xc8:
        if (this.flagZ) {
          this.pc = this.pop16();
          return 20;
        }
        return 8;

      // RET
      case 0xc9:
        this.pc = this.pop16();
        return 16;

      // JP Z,nn
      case 0xca: {
        const addr = this.fetch16();
        if (this.flagZ) {
          this.pc = addr;
          return 16;
        }
        return 12;
      }

      // CB prefix
      case 0xcb:
        return this.executeCB();

      // CALL Z,nn
      case 0xcc: {
        const addr = this.fetch16();
        if (this.flagZ) {
          this.push16(this.pc);
          this.pc = addr;
          return 24;
        }
        return 12;
      }

      // CALL nn
      case 0xcd: {
        const addr = this.fetch16();
        this.push16(this.pc);
        this.pc = addr;
        return 24;
      }

      // ADC A,n
      case 0xce:
        this.adc8(this.fetch8());
        return 8;

      // RST 08
      case 0xcf:
        this.push16(this.pc);
        this.pc = 0x08;
        return 16;

      // RET NC
      case 0xd0:
        if (!this.flagC) {
          this.pc = this.pop16();
          return 20;
        }
        return 8;

      // POP DE
      case 0xd1:
        this.de = this.pop16();
        return 12;

      // JP NC,nn
      case 0xd2: {
        const addr = this.fetch16();
        if (!this.flagC) {
          this.pc = addr;
          return 16;
        }
        return 12;
      }

      // (Undefined opcode 0xD3)
      case 0xd3:
        return 4;

      // CALL NC,nn
      case 0xd4: {
        const addr = this.fetch16();
        if (!this.flagC) {
          this.push16(this.pc);
          this.pc = addr;
          return 24;
        }
        return 12;
      }

      // PUSH DE
      case 0xd5:
        this.push16(this.de);
        return 16;

      // SUB A,n
      case 0xd6:
        this.sub8(this.fetch8());
        return 8;

      // RST 10
      case 0xd7:
        this.push16(this.pc);
        this.pc = 0x10;
        return 16;

      // RET C
      case 0xd8:
        if (this.flagC) {
          this.pc = this.pop16();
          return 20;
        }
        return 8;

      // RETI
      case 0xd9:
        this.pc = this.pop16();
        this.ime = true;
        return 16;

      // JP C,nn
      case 0xda: {
        const addr = this.fetch16();
        if (this.flagC) {
          this.pc = addr;
          return 16;
        }
        return 12;
      }

      // (Undefined opcode 0xDB)
      case 0xdb:
        return 4;

      // CALL C,nn
      case 0xdc: {
        const addr = this.fetch16();
        if (this.flagC) {
          this.push16(this.pc);
          this.pc = addr;
          return 24;
        }
        return 12;
      }

      // (Undefined opcode 0xDD)
      case 0xdd:
        return 4;

      // SBC A,n
      case 0xde:
        this.sbc8(this.fetch8());
        return 8;

      // RST 18
      case 0xdf:
        this.push16(this.pc);
        this.pc = 0x18;
        return 16;

      // LD (FF00+n),A
      case 0xe0: {
        const offset = this.fetch8();
        this.write8(0xff00 + offset, this.a);
        return 12;
      }

      // POP HL
      case 0xe1:
        this.hl = this.pop16();
        return 12;

      // LD (FF00+C),A
      case 0xe2:
        this.write8(0xff00 + this.c, this.a);
        return 8;

      // (Undefined opcodes 0xE3, 0xE4)
      case 0xe3:
      case 0xe4:
        return 4;

      // PUSH HL
      case 0xe5:
        this.push16(this.hl);
        return 16;

      // AND A,n
      case 0xe6:
        this.and8(this.fetch8());
        return 8;

      // RST 20
      case 0xe7:
        this.push16(this.pc);
        this.pc = 0x20;
        return 16;

      // ADD SP,e
      case 0xe8: {
        const offset = this.signedByte(this.fetch8());
        const result = (this.sp + offset) & 0xffff;
        this.flagZ = false;
        this.flagN = false;
        this.flagH = ((this.sp & 0x0f) + (offset & 0x0f)) > 0x0f;
        this.flagC = ((this.sp & 0xff) + (offset & 0xff)) > 0xff;
        this.sp = result;
        return 16;
      }

      // JP HL
      case 0xe9:
        this.pc = this.hl;
        return 4;

      // LD (nn),A
      case 0xea: {
        const addr = this.fetch16();
        this.write8(addr, this.a);
        return 16;
      }

      // (Undefined opcodes 0xEB, 0xEC, 0xED)
      case 0xeb:
      case 0xec:
      case 0xed:
        return 4;

      // XOR A,n
      case 0xee:
        this.xor8(this.fetch8());
        return 8;

      // RST 28
      case 0xef:
        this.push16(this.pc);
        this.pc = 0x28;
        return 16;

      // LD A,(FF00+n)
      case 0xf0: {
        const offset = this.fetch8();
        this.a = this.read8(0xff00 + offset);
        return 12;
      }

      // POP AF
      case 0xf1:
        this.af = this.pop16();
        return 12;

      // LD A,(FF00+C)
      case 0xf2:
        this.a = this.read8(0xff00 + this.c);
        return 8;

      // DI
      case 0xf3:
        this.ime = false;
        return 4;

      // (Undefined opcode 0xF4)
      case 0xf4:
        return 4;

      // PUSH AF
      case 0xf5:
        this.push16(this.af);
        return 16;

      // OR A,n
      case 0xf6:
        this.or8(this.fetch8());
        return 8;

      // RST 30
      case 0xf7:
        this.push16(this.pc);
        this.pc = 0x30;
        return 16;

      // LD HL,SP+e
      case 0xf8: {
        const offset = this.signedByte(this.fetch8());
        const result = (this.sp + offset) & 0xffff;
        this.flagZ = false;
        this.flagN = false;
        this.flagH = ((this.sp & 0x0f) + (offset & 0x0f)) > 0x0f;
        this.flagC = ((this.sp & 0xff) + (offset & 0xff)) > 0xff;
        this.hl = result;
        return 12;
      }

      // LD SP,HL
      case 0xf9:
        this.sp = this.hl;
        return 8;

      // LD A,(nn)
      case 0xfa: {
        const addr = this.fetch16();
        this.a = this.read8(addr);
        return 16;
      }

      // EI
      case 0xfb:
        this.imeScheduled = true;
        return 4;

      // (Undefined opcodes 0xFC, 0xFD)
      case 0xfc:
      case 0xfd:
        return 4;

      // CP A,n
      case 0xfe:
        this.cp8(this.fetch8());
        return 8;

      // RST 38
      case 0xff:
        this.push16(this.pc);
        this.pc = 0x38;
        return 16;

      default:
        return 4;
    }
  }

  // CB-prefixed opcodes
  private executeCB(): number {
    const opcode = this.fetch8();
    const reg = opcode & 0x07;
    const op = (opcode >> 3) & 0x1f;

    // Get register value
    let value: number;
    const isHL = reg === 6;
    if (isHL) {
      value = this.read8(this.hl);
    } else {
      value = this.getReg8(reg);
    }

    let result: number;
    const cycles = isHL ? 16 : 8;

    if (op < 8) {
      // Rotate/shift operations
      switch (op) {
        case 0: // RLC
          result = this.rlc(value);
          break;
        case 1: // RRC
          result = this.rrc(value);
          break;
        case 2: // RL
          result = this.rl(value);
          break;
        case 3: // RR
          result = this.rr(value);
          break;
        case 4: // SLA
          result = this.sla(value);
          break;
        case 5: // SRA
          result = this.sra(value);
          break;
        case 6: // SWAP
          result = this.swap(value);
          break;
        case 7: // SRL
          result = this.srl(value);
          break;
        default:
          result = value;
      }

      if (isHL) {
        this.write8(this.hl, result);
      } else {
        this.setReg8(reg, result);
      }
    } else if (op < 16) {
      // BIT operations (0x40-0x7F)
      const bit = op - 8;
      this.bit(value, bit);
      return isHL ? 12 : 8; // BIT (HL) is 12 cycles, not 16
    } else if (op < 24) {
      // RES operations (0x80-0xBF)
      const bit = op - 16;
      result = value & ~(1 << bit);
      if (isHL) {
        this.write8(this.hl, result);
      } else {
        this.setReg8(reg, result);
      }
    } else {
      // SET operations (0xC0-0xFF)
      const bit = op - 24;
      result = value | (1 << bit);
      if (isHL) {
        this.write8(this.hl, result);
      } else {
        this.setReg8(reg, result);
      }
    }

    return cycles;
  }

  // Get/set 8-bit register by index (0=B, 1=C, 2=D, 3=E, 4=H, 5=L, 6=(HL), 7=A)
  private getReg8(index: number): number {
    switch (index) {
      case 0:
        return this.b;
      case 1:
        return this.c;
      case 2:
        return this.d;
      case 3:
        return this.e;
      case 4:
        return this.h;
      case 5:
        return this.l;
      case 6:
        return this.read8(this.hl);
      case 7:
        return this.a;
      default:
        return 0;
    }
  }

  private setReg8(index: number, value: number): void {
    value &= 0xff;
    switch (index) {
      case 0:
        this.b = value;
        break;
      case 1:
        this.c = value;
        break;
      case 2:
        this.d = value;
        break;
      case 3:
        this.e = value;
        break;
      case 4:
        this.h = value;
        break;
      case 5:
        this.l = value;
        break;
      case 6:
        this.write8(this.hl, value);
        break;
      case 7:
        this.a = value;
        break;
    }
  }

  // ALU operations
  private inc8(value: number): number {
    const result = (value + 1) & 0xff;
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = (value & 0x0f) === 0x0f;
    return result;
  }

  private dec8(value: number): number {
    const result = (value - 1) & 0xff;
    this.flagZ = result === 0;
    this.flagN = true;
    this.flagH = (value & 0x0f) === 0;
    return result;
  }

  private add8(value: number): void {
    const result = this.a + value;
    this.flagZ = (result & 0xff) === 0;
    this.flagN = false;
    this.flagH = ((this.a & 0x0f) + (value & 0x0f)) > 0x0f;
    this.flagC = result > 0xff;
    this.a = result & 0xff;
  }

  private adc8(value: number): void {
    const carry = this.flagC ? 1 : 0;
    const result = this.a + value + carry;
    this.flagZ = (result & 0xff) === 0;
    this.flagN = false;
    this.flagH = ((this.a & 0x0f) + (value & 0x0f) + carry) > 0x0f;
    this.flagC = result > 0xff;
    this.a = result & 0xff;
  }

  private sub8(value: number): void {
    const result = this.a - value;
    this.flagZ = (result & 0xff) === 0;
    this.flagN = true;
    this.flagH = (this.a & 0x0f) < (value & 0x0f);
    this.flagC = this.a < value;
    this.a = result & 0xff;
  }

  private sbc8(value: number): void {
    const carry = this.flagC ? 1 : 0;
    const result = this.a - value - carry;
    this.flagZ = (result & 0xff) === 0;
    this.flagN = true;
    this.flagH = (this.a & 0x0f) < (value & 0x0f) + carry;
    this.flagC = this.a < value + carry;
    this.a = result & 0xff;
  }

  private and8(value: number): void {
    this.a &= value;
    this.flagZ = this.a === 0;
    this.flagN = false;
    this.flagH = true;
    this.flagC = false;
  }

  private xor8(value: number): void {
    this.a ^= value;
    this.flagZ = this.a === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = false;
  }

  private or8(value: number): void {
    this.a |= value;
    this.flagZ = this.a === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = false;
  }

  private cp8(value: number): void {
    const result = this.a - value;
    this.flagZ = (result & 0xff) === 0;
    this.flagN = true;
    this.flagH = (this.a & 0x0f) < (value & 0x0f);
    this.flagC = this.a < value;
  }

  private addHL(value: number): void {
    const result = this.hl + value;
    this.flagN = false;
    this.flagH = ((this.hl & 0x0fff) + (value & 0x0fff)) > 0x0fff;
    this.flagC = result > 0xffff;
    this.hl = result & 0xffff;
  }

  // Rotate/shift operations
  private rlc(value: number): number {
    const carry = (value >> 7) & 1;
    const result = ((value << 1) | carry) & 0xff;
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry === 1;
    return result;
  }

  private rrc(value: number): number {
    const carry = value & 1;
    const result = ((value >> 1) | (carry << 7)) & 0xff;
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry === 1;
    return result;
  }

  private rl(value: number): number {
    const oldCarry = this.flagC ? 1 : 0;
    const newCarry = (value >> 7) & 1;
    const result = ((value << 1) | oldCarry) & 0xff;
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = newCarry === 1;
    return result;
  }

  private rr(value: number): number {
    const oldCarry = this.flagC ? 0x80 : 0;
    const newCarry = value & 1;
    const result = ((value >> 1) | oldCarry) & 0xff;
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = newCarry === 1;
    return result;
  }

  private sla(value: number): number {
    const carry = (value >> 7) & 1;
    const result = (value << 1) & 0xff;
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry === 1;
    return result;
  }

  private sra(value: number): number {
    const carry = value & 1;
    const result = ((value >> 1) | (value & 0x80)) & 0xff;
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry === 1;
    return result;
  }

  private srl(value: number): number {
    const carry = value & 1;
    const result = (value >> 1) & 0xff;
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry === 1;
    return result;
  }

  private swap(value: number): number {
    const result = ((value & 0x0f) << 4) | ((value >> 4) & 0x0f);
    this.flagZ = result === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = false;
    return result;
  }

  private bit(value: number, bit: number): void {
    this.flagZ = (value & (1 << bit)) === 0;
    this.flagN = false;
    this.flagH = true;
  }

  // DAA - Decimal Adjust Accumulator
  private daa(): void {
    let adjust = 0;
    let carry = false;

    if (this.flagN) {
      // After subtraction
      if (this.flagC) {
        adjust = 0x60;
        carry = true;
      }
      if (this.flagH) {
        adjust |= 0x06;
      }
      this.a = (this.a - adjust) & 0xff;
    } else {
      // After addition
      if (this.flagC || this.a > 0x99) {
        adjust = 0x60;
        carry = true;
      }
      if (this.flagH || (this.a & 0x0f) > 0x09) {
        adjust |= 0x06;
      }
      this.a = (this.a + adjust) & 0xff;
    }

    this.flagZ = this.a === 0;
    this.flagH = false;
    this.flagC = carry;
  }

  // Helper to convert unsigned byte to signed
  private signedByte(value: number): number {
    return value > 127 ? value - 256 : value;
  }
}
