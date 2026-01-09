import { describe, it, expect, beforeEach } from 'vitest';
import { CPU, Flag } from '../src/cores/nes/cpu.js';
import { Bus } from '../src/cores/nes/bus.js';

describe('CPU', () => {
  let bus: Bus;
  let cpu: CPU;

  beforeEach(() => {
    bus = new Bus();
    cpu = new CPU(bus);
  });

  describe('Initialization', () => {
    it('should initialize with correct default values', () => {
      expect(cpu.a).toBe(0x00);
      expect(cpu.x).toBe(0x00);
      expect(cpu.y).toBe(0x00);
      expect(cpu.sp).toBe(0xfd);
      expect(cpu.status).toBe(0x24); // I and U flags set
    });
  });

  describe('Flags', () => {
    it('should set and get carry flag', () => {
      cpu.setFlag(Flag.C, true);
      expect(cpu.getFlag(Flag.C)).toBe(true);
      cpu.setFlag(Flag.C, false);
      expect(cpu.getFlag(Flag.C)).toBe(false);
    });

    it('should set and get zero flag', () => {
      cpu.setFlag(Flag.Z, true);
      expect(cpu.getFlag(Flag.Z)).toBe(true);
      cpu.setFlag(Flag.Z, false);
      expect(cpu.getFlag(Flag.Z)).toBe(false);
    });

    it('should set and get negative flag', () => {
      cpu.setFlag(Flag.N, true);
      expect(cpu.getFlag(Flag.N)).toBe(true);
      cpu.setFlag(Flag.N, false);
      expect(cpu.getFlag(Flag.N)).toBe(false);
    });
  });

  describe('Stack Operations', () => {
    it('should push and pull bytes correctly', () => {
      const initialSp = cpu.sp;
      cpu.push(0x42);
      expect(cpu.sp).toBe(initialSp - 1);

      const value = cpu.pull();
      expect(value).toBe(0x42);
      expect(cpu.sp).toBe(initialSp);
    });

    it('should push and pull 16-bit values correctly', () => {
      cpu.push16(0x1234);
      const value = cpu.pull16();
      expect(value).toBe(0x1234);
    });
  });

  describe('State', () => {
    it('should return correct state', () => {
      cpu.a = 0x12;
      cpu.x = 0x34;
      cpu.y = 0x56;
      cpu.sp = 0x78;
      cpu.pc = 0x9abc;
      cpu.status = 0xde;

      const state = cpu.getState();
      expect(state.a).toBe(0x12);
      expect(state.x).toBe(0x34);
      expect(state.y).toBe(0x56);
      expect(state.sp).toBe(0x78);
      expect(state.pc).toBe(0x9abc);
      expect(state.status).toBe(0xde);
    });
  });
});
