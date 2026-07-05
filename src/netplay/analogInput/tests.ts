import { describe, it, expect } from 'vitest';
import { packAnalogStick, unpackAnalogX, unpackAnalogY } from '.';

describe('analog input packing', () => {
  // RetroArch packs one stick per 32-bit word: (u16)x | ((u16)y << 16)
  it('packs X into the low half and Y into the high half', () => {
    expect(packAnalogStick(0x1234, 0x5678)).toBe(0x56781234);
  });

  it('packs negative axes as unsigned 16-bit two\'s complement', () => {
    expect(packAnalogStick(-32768, 32767)).toBe(0x7fff8000);
    expect(packAnalogStick(-1, -1)).toBe(0xffffffff);
  });

  it('round-trips signed extremes', () => {
    const word = packAnalogStick(-32768, 32767);
    expect(unpackAnalogX(word)).toBe(-32768);
    expect(unpackAnalogY(word)).toBe(32767);
  });

  it('round-trips arbitrary values', () => {
    const word = packAnalogStick(-12345, 6789);
    expect(unpackAnalogX(word)).toBe(-12345);
    expect(unpackAnalogY(word)).toBe(6789);
  });

  it('clamps out-of-range axes to int16', () => {
    const word = packAnalogStick(40000, -40000);
    expect(unpackAnalogX(word)).toBe(32767);
    expect(unpackAnalogY(word)).toBe(-32768);
  });

  it('treats centered sticks as zero', () => {
    expect(packAnalogStick(0, 0)).toBe(0);
    expect(unpackAnalogX(0)).toBe(0);
    expect(unpackAnalogY(0)).toBe(0);
  });
});
