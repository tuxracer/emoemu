/**
 * Re-export for backward compatibility.
 * The actual implementation has moved to src/cores/nes/apu.ts
 */
export { APU } from '../cores/nes/apu.js';
export type {
  APUState,
  PulseChannelState,
  TriangleChannelState,
  NoiseChannelState,
  DMCChannelState,
} from '../cores/nes/apu.js';
