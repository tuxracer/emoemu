// APU (Audio Processing Unit) - Full Implementation
// NES APU has 5 channels: 2 pulse, 1 triangle, 1 noise, 1 DMC

// Channel state interfaces for full state preservation
export interface PulseChannelState {
  dutyCycle: number;
  lengthHalt: boolean;
  constantVolume: boolean;
  volume: number;
  sweepEnabled: boolean;
  sweepPeriod: number;
  sweepNegate: boolean;
  sweepShift: number;
  timerPeriod: number;
  lengthCounter: number;
  timerValue: number;
  sequencePos: number;
  envelopeStart: boolean;
  envelopeVolume: number;
  envelopeValue: number;
  sweepReload: boolean;
  sweepValue: number;
  enabled: boolean;
}

export interface TriangleChannelState {
  linearCounterLoad: number;
  lengthHalt: boolean;
  timerPeriod: number;
  lengthCounter: number;
  timerValue: number;
  sequencePos: number;
  linearCounter: number;
  linearReload: boolean;
  enabled: boolean;
}

export interface NoiseChannelState {
  lengthHalt: boolean;
  constantVolume: boolean;
  volume: number;
  mode: boolean;
  timerPeriod: number;
  lengthCounter: number;
  timerValue: number;
  shiftRegister: number;
  envelopeStart: boolean;
  envelopeVolume: number;
  envelopeValue: number;
  enabled: boolean;
}

export interface DMCChannelState {
  irqEnabled: boolean;
  loop: boolean;
  ratePeriod: number;
  sampleAddress: number;
  sampleLength: number;
  timerValue: number;
  outputLevel: number;
  currentAddress: number;
  bytesRemaining: number;
  sampleBuffer: number;
  sampleBufferEmpty: boolean;
  shiftRegister: number;
  bitsRemaining: number;
  silence: boolean;
  enabled: boolean;
  irqPending: boolean;
}

export interface APUState {
  frameCounterMode: number;
  frameIRQInhibit: boolean;
  frameIRQPending: boolean;
  cycleCount: number;
  frameCycleCount: number;
  frameStep: number;
  // Full channel states
  pulse1: PulseChannelState;
  pulse2: PulseChannelState;
  triangle: TriangleChannelState;
  noise: NoiseChannelState;
  dmc: DMCChannelState;
}

// Length counter lookup table
const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
];

// Duty cycle waveforms for pulse channels
const DUTY_TABLE = [
  [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
  [0, 0, 0, 0, 0, 0, 1, 1], // 25%
  [0, 0, 0, 0, 1, 1, 1, 1], // 50%
  [1, 1, 1, 1, 1, 1, 0, 0], // 25% negated
];

// Triangle channel waveform (32 steps)
const TRIANGLE_TABLE = [
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

// Noise channel period lookup (NTSC)
const NOISE_TABLE = [
  4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068,
];

// DMC rate table (NTSC)
const DMC_TABLE = [
  428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54,
];

// Pulse channel
class PulseChannel {
  // Registers
  private dutyCycle: number = 0;
  private lengthHalt: boolean = false;
  private constantVolume: boolean = false;
  private volume: number = 0;
  private sweepEnabled: boolean = false;
  private sweepPeriod: number = 0;
  private sweepNegate: boolean = false;
  private sweepShift: number = 0;
  private timerPeriod: number = 0;
  private lengthCounter: number = 0;

  // Internal state
  private timerValue: number = 0;
  private sequencePos: number = 0;
  private envelopeStart: boolean = false;
  private envelopeVolume: number = 0;
  private envelopeValue: number = 0;
  private sweepReload: boolean = false;
  private sweepValue: number = 0;
  enabled: boolean = false;

  // For sweep negate difference between pulse 1 and 2
  constructor(private channel: 1 | 2) {}

  writeControl(data: number): void {
    this.dutyCycle = (data >> 6) & 0x03;
    this.lengthHalt = (data & 0x20) !== 0;
    this.constantVolume = (data & 0x10) !== 0;
    this.volume = data & 0x0f;
  }

  writeSweep(data: number): void {
    this.sweepEnabled = (data & 0x80) !== 0;
    this.sweepPeriod = (data >> 4) & 0x07;
    this.sweepNegate = (data & 0x08) !== 0;
    this.sweepShift = data & 0x07;
    this.sweepReload = true;
  }

  writeTimerLow(data: number): void {
    this.timerPeriod = (this.timerPeriod & 0x700) | data;
  }

  writeTimerHigh(data: number): void {
    this.timerPeriod = (this.timerPeriod & 0x0ff) | ((data & 0x07) << 8);
    if (this.enabled) {
      this.lengthCounter = LENGTH_TABLE[(data >> 3) & 0x1f];
    }
    this.sequencePos = 0;
    this.envelopeStart = true;
  }

  clockTimer(): void {
    if (this.timerValue === 0) {
      this.timerValue = this.timerPeriod;
      this.sequencePos = (this.sequencePos + 1) & 0x07;
    } else {
      this.timerValue--;
    }
  }

  clockEnvelope(): void {
    if (this.envelopeStart) {
      this.envelopeStart = false;
      this.envelopeVolume = 15;
      this.envelopeValue = this.volume;
    } else if (this.envelopeValue > 0) {
      this.envelopeValue--;
    } else {
      if (this.envelopeVolume > 0) {
        this.envelopeVolume--;
      } else if (this.lengthHalt) {
        this.envelopeVolume = 15;
      }
      this.envelopeValue = this.volume;
    }
  }

  clockLength(): void {
    if (!this.lengthHalt && this.lengthCounter > 0) {
      this.lengthCounter--;
    }
  }

  clockSweep(): void {
    if (this.sweepValue === 0 && this.sweepEnabled && this.sweepShift > 0 && !this.isMuted()) {
      const delta = this.timerPeriod >> this.sweepShift;
      if (this.sweepNegate) {
        this.timerPeriod -= delta;
        if (this.channel === 1) {
          this.timerPeriod--;
        }
      } else {
        this.timerPeriod += delta;
      }
    }
    if (this.sweepValue === 0 || this.sweepReload) {
      this.sweepValue = this.sweepPeriod;
      this.sweepReload = false;
    } else {
      this.sweepValue--;
    }
  }

  private isMuted(): boolean {
    return this.timerPeriod < 8 || this.timerPeriod > 0x7ff;
  }

  output(): number {
    if (!this.enabled || this.lengthCounter === 0 || this.isMuted()) {
      return 0;
    }
    if (DUTY_TABLE[this.dutyCycle][this.sequencePos] === 0) {
      return 0;
    }
    return this.constantVolume ? this.volume : this.envelopeVolume;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.lengthCounter = 0;
    }
  }

  getLengthCounter(): number {
    return this.lengthCounter;
  }

  getState(): PulseChannelState {
    return {
      dutyCycle: this.dutyCycle,
      lengthHalt: this.lengthHalt,
      constantVolume: this.constantVolume,
      volume: this.volume,
      sweepEnabled: this.sweepEnabled,
      sweepPeriod: this.sweepPeriod,
      sweepNegate: this.sweepNegate,
      sweepShift: this.sweepShift,
      timerPeriod: this.timerPeriod,
      lengthCounter: this.lengthCounter,
      timerValue: this.timerValue,
      sequencePos: this.sequencePos,
      envelopeStart: this.envelopeStart,
      envelopeVolume: this.envelopeVolume,
      envelopeValue: this.envelopeValue,
      sweepReload: this.sweepReload,
      sweepValue: this.sweepValue,
      enabled: this.enabled,
    };
  }

  setState(state: PulseChannelState): void {
    this.dutyCycle = state.dutyCycle;
    this.lengthHalt = state.lengthHalt;
    this.constantVolume = state.constantVolume;
    this.volume = state.volume;
    this.sweepEnabled = state.sweepEnabled;
    this.sweepPeriod = state.sweepPeriod;
    this.sweepNegate = state.sweepNegate;
    this.sweepShift = state.sweepShift;
    this.timerPeriod = state.timerPeriod;
    this.lengthCounter = state.lengthCounter;
    this.timerValue = state.timerValue;
    this.sequencePos = state.sequencePos;
    this.envelopeStart = state.envelopeStart;
    this.envelopeVolume = state.envelopeVolume;
    this.envelopeValue = state.envelopeValue;
    this.sweepReload = state.sweepReload;
    this.sweepValue = state.sweepValue;
    this.enabled = state.enabled;
  }
}

// Triangle channel
class TriangleChannel {
  private linearCounterLoad: number = 0;
  private lengthHalt: boolean = false;
  private timerPeriod: number = 0;
  private lengthCounter: number = 0;

  private timerValue: number = 0;
  private sequencePos: number = 0;
  private linearCounter: number = 0;
  private linearReload: boolean = false;
  enabled: boolean = false;

  // Pop suppression: smooth output when channel is silenced mid-waveform
  private smoothedOutput: number = 0;

  writeControl(data: number): void {
    this.lengthHalt = (data & 0x80) !== 0;
    this.linearCounterLoad = data & 0x7f;
  }

  writeTimerLow(data: number): void {
    this.timerPeriod = (this.timerPeriod & 0x700) | data;
  }

  writeTimerHigh(data: number): void {
    this.timerPeriod = (this.timerPeriod & 0x0ff) | ((data & 0x07) << 8);
    if (this.enabled) {
      this.lengthCounter = LENGTH_TABLE[(data >> 3) & 0x1f];
    }
    this.linearReload = true;
  }

  clockTimer(): void {
    if (this.timerValue === 0) {
      this.timerValue = this.timerPeriod;
      if (this.lengthCounter > 0 && this.linearCounter > 0) {
        this.sequencePos = (this.sequencePos + 1) & 0x1f;
      }
    } else {
      this.timerValue--;
    }
  }

  clockLinear(): void {
    if (this.linearReload) {
      this.linearCounter = this.linearCounterLoad;
    } else if (this.linearCounter > 0) {
      this.linearCounter--;
    }
    if (!this.lengthHalt) {
      this.linearReload = false;
    }
  }

  clockLength(): void {
    if (!this.lengthHalt && this.lengthCounter > 0) {
      this.lengthCounter--;
    }
  }

  output(): number {
    let targetOutput: number;

    if (!this.enabled || this.lengthCounter === 0 || this.linearCounter === 0) {
      targetOutput = 0;
    } else if (this.timerPeriod < 2) {
      // Silence ultrasonic frequencies
      targetOutput = 0;
    } else {
      targetOutput = TRIANGLE_TABLE[this.sequencePos];
    }

    // Pop suppression: when silencing, ramp down smoothly instead of instant cutoff
    if (targetOutput === 0 && this.smoothedOutput > 0) {
      // Decay towards zero over ~1ms worth of samples
      this.smoothedOutput = Math.max(0, this.smoothedOutput - 0.5);
      return this.smoothedOutput;
    }

    this.smoothedOutput = targetOutput;
    return targetOutput;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.lengthCounter = 0;
    }
  }

  getLengthCounter(): number {
    return this.lengthCounter;
  }

  getState(): TriangleChannelState {
    return {
      linearCounterLoad: this.linearCounterLoad,
      lengthHalt: this.lengthHalt,
      timerPeriod: this.timerPeriod,
      lengthCounter: this.lengthCounter,
      timerValue: this.timerValue,
      sequencePos: this.sequencePos,
      linearCounter: this.linearCounter,
      linearReload: this.linearReload,
      enabled: this.enabled,
    };
  }

  setState(state: TriangleChannelState): void {
    this.linearCounterLoad = state.linearCounterLoad;
    this.lengthHalt = state.lengthHalt;
    this.timerPeriod = state.timerPeriod;
    this.lengthCounter = state.lengthCounter;
    this.timerValue = state.timerValue;
    this.sequencePos = state.sequencePos;
    this.linearCounter = state.linearCounter;
    this.linearReload = state.linearReload;
    this.enabled = state.enabled;
    // Reset pop suppression state
    this.smoothedOutput = 0;
  }
}

// Noise channel
class NoiseChannel {
  private lengthHalt: boolean = false;
  private constantVolume: boolean = false;
  private volume: number = 0;
  private mode: boolean = false;
  private timerPeriod: number = 0;
  private lengthCounter: number = 0;

  private timerValue: number = 0;
  private shiftRegister: number = 1;
  private envelopeStart: boolean = false;
  private envelopeVolume: number = 0;
  private envelopeValue: number = 0;
  enabled: boolean = false;

  writeControl(data: number): void {
    this.lengthHalt = (data & 0x20) !== 0;
    this.constantVolume = (data & 0x10) !== 0;
    this.volume = data & 0x0f;
  }

  writeMode(data: number): void {
    this.mode = (data & 0x80) !== 0;
    this.timerPeriod = NOISE_TABLE[data & 0x0f];
  }

  writeLength(data: number): void {
    if (this.enabled) {
      this.lengthCounter = LENGTH_TABLE[(data >> 3) & 0x1f];
    }
    this.envelopeStart = true;
  }

  clockTimer(): void {
    if (this.timerValue === 0) {
      this.timerValue = this.timerPeriod;
      const bit = this.mode ? 6 : 1;
      const feedback = (this.shiftRegister & 1) ^ ((this.shiftRegister >> bit) & 1);
      this.shiftRegister = (this.shiftRegister >> 1) | (feedback << 14);
    } else {
      this.timerValue--;
    }
  }

  clockEnvelope(): void {
    if (this.envelopeStart) {
      this.envelopeStart = false;
      this.envelopeVolume = 15;
      this.envelopeValue = this.volume;
    } else if (this.envelopeValue > 0) {
      this.envelopeValue--;
    } else {
      if (this.envelopeVolume > 0) {
        this.envelopeVolume--;
      } else if (this.lengthHalt) {
        this.envelopeVolume = 15;
      }
      this.envelopeValue = this.volume;
    }
  }

  clockLength(): void {
    if (!this.lengthHalt && this.lengthCounter > 0) {
      this.lengthCounter--;
    }
  }

  output(): number {
    if (!this.enabled || this.lengthCounter === 0 || (this.shiftRegister & 1) !== 0) {
      return 0;
    }
    return this.constantVolume ? this.volume : this.envelopeVolume;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.lengthCounter = 0;
    }
  }

  getLengthCounter(): number {
    return this.lengthCounter;
  }

  getState(): NoiseChannelState {
    return {
      lengthHalt: this.lengthHalt,
      constantVolume: this.constantVolume,
      volume: this.volume,
      mode: this.mode,
      timerPeriod: this.timerPeriod,
      lengthCounter: this.lengthCounter,
      timerValue: this.timerValue,
      shiftRegister: this.shiftRegister,
      envelopeStart: this.envelopeStart,
      envelopeVolume: this.envelopeVolume,
      envelopeValue: this.envelopeValue,
      enabled: this.enabled,
    };
  }

  setState(state: NoiseChannelState): void {
    this.lengthHalt = state.lengthHalt;
    this.constantVolume = state.constantVolume;
    this.volume = state.volume;
    this.mode = state.mode;
    this.timerPeriod = state.timerPeriod;
    this.lengthCounter = state.lengthCounter;
    this.timerValue = state.timerValue;
    this.shiftRegister = state.shiftRegister;
    this.envelopeStart = state.envelopeStart;
    this.envelopeVolume = state.envelopeVolume;
    this.envelopeValue = state.envelopeValue;
    this.enabled = state.enabled;
  }
}

// DMC (Delta Modulation Channel)
class DMCChannel {
  private irqEnabled: boolean = false;
  private loop: boolean = false;
  private ratePeriod: number = 0;
  private sampleAddress: number = 0;
  private sampleLength: number = 0;

  private timerValue: number = 0;
  private outputLevel: number = 0;
  private currentAddress: number = 0;
  private bytesRemaining: number = 0;
  private sampleBuffer: number = 0;
  private sampleBufferEmpty: boolean = true;
  private shiftRegister: number = 0;
  private bitsRemaining: number = 0;
  private silence: boolean = true;
  enabled: boolean = false;
  irqPending: boolean = false;

  // Memory read callback (set by APU)
  readMemory: ((address: number) => number) | null = null;

  writeControl(data: number): void {
    this.irqEnabled = (data & 0x80) !== 0;
    this.loop = (data & 0x40) !== 0;
    this.ratePeriod = DMC_TABLE[data & 0x0f];
    if (!this.irqEnabled) {
      this.irqPending = false;
    }
  }

  writeDirectLoad(data: number): void {
    this.outputLevel = data & 0x7f;
  }

  writeAddress(data: number): void {
    this.sampleAddress = 0xc000 | (data << 6);
  }

  writeLength(data: number): void {
    this.sampleLength = (data << 4) | 1;
  }

  clockTimer(): void {
    if (this.timerValue === 0) {
      this.timerValue = this.ratePeriod;
      this.clockOutput();
    } else {
      this.timerValue--;
    }
  }

  private clockOutput(): void {
    if (!this.silence) {
      if ((this.shiftRegister & 1) !== 0) {
        if (this.outputLevel <= 125) {
          this.outputLevel += 2;
        }
      } else {
        if (this.outputLevel >= 2) {
          this.outputLevel -= 2;
        }
      }
      this.shiftRegister >>= 1;
    }

    this.bitsRemaining--;
    if (this.bitsRemaining === 0) {
      this.bitsRemaining = 8;
      if (this.sampleBufferEmpty) {
        this.silence = true;
      } else {
        this.silence = false;
        this.shiftRegister = this.sampleBuffer;
        this.sampleBufferEmpty = true;
        this.fillSampleBuffer();
      }
    }
  }

  private fillSampleBuffer(): void {
    if (this.bytesRemaining > 0 && this.readMemory) {
      this.sampleBuffer = this.readMemory(this.currentAddress);
      this.sampleBufferEmpty = false;
      this.currentAddress = 0x8000 | ((this.currentAddress + 1) & 0x7fff);
      this.bytesRemaining--;

      if (this.bytesRemaining === 0) {
        if (this.loop) {
          this.restart();
        } else if (this.irqEnabled) {
          this.irqPending = true;
        }
      }
    }
  }

  restart(): void {
    this.currentAddress = this.sampleAddress;
    this.bytesRemaining = this.sampleLength;
  }

  output(): number {
    return this.outputLevel;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.bytesRemaining = 0;
    } else if (this.bytesRemaining === 0) {
      this.restart();
      if (this.sampleBufferEmpty) {
        this.fillSampleBuffer();
      }
    }
  }

  getBytesRemaining(): number {
    return this.bytesRemaining;
  }

  getState(): DMCChannelState {
    return {
      irqEnabled: this.irqEnabled,
      loop: this.loop,
      ratePeriod: this.ratePeriod,
      sampleAddress: this.sampleAddress,
      sampleLength: this.sampleLength,
      timerValue: this.timerValue,
      outputLevel: this.outputLevel,
      currentAddress: this.currentAddress,
      bytesRemaining: this.bytesRemaining,
      sampleBuffer: this.sampleBuffer,
      sampleBufferEmpty: this.sampleBufferEmpty,
      shiftRegister: this.shiftRegister,
      bitsRemaining: this.bitsRemaining,
      silence: this.silence,
      enabled: this.enabled,
      irqPending: this.irqPending,
    };
  }

  setState(state: DMCChannelState): void {
    this.irqEnabled = state.irqEnabled;
    this.loop = state.loop;
    this.ratePeriod = state.ratePeriod;
    this.sampleAddress = state.sampleAddress;
    this.sampleLength = state.sampleLength;
    this.timerValue = state.timerValue;
    this.outputLevel = state.outputLevel;
    this.currentAddress = state.currentAddress;
    this.bytesRemaining = state.bytesRemaining;
    this.sampleBuffer = state.sampleBuffer;
    this.sampleBufferEmpty = state.sampleBufferEmpty;
    this.shiftRegister = state.shiftRegister;
    this.bitsRemaining = state.bitsRemaining;
    this.silence = state.silence;
    this.enabled = state.enabled;
    this.irqPending = state.irqPending;
  }
}

// Precomputed pulse mixer lookup table (avoids division in hot path)
const PULSE_TABLE = new Float32Array(31);
for (let i = 0; i < 31; i++) {
  PULSE_TABLE[i] = i === 0 ? 0 : 95.88 / (8128 / i + 100);
}

// Precomputed TND mixer lookup table
// Indexed by: (triangle << 11) | (noise << 7) | dmc
// triangle: 0-15, noise: 0-15, dmc: 0-127
// Total: 16 * 16 * 128 = 32768 entries (~128KB)
const TND_TABLE = new Float32Array(32768);
for (let t = 0; t < 16; t++) {
  for (let n = 0; n < 16; n++) {
    for (let d = 0; d < 128; d++) {
      const index = (t << 11) | (n << 7) | d;
      if (t === 0 && n === 0 && d === 0) {
        TND_TABLE[index] = 0;
      } else {
        const tndSum = t / 8227 + n / 12241 + d / 22638;
        TND_TABLE[index] = 159.79 / (1 / tndSum + 100);
      }
    }
  }
}

// Main APU class
export class APU {
  private pulse1: PulseChannel = new PulseChannel(1);
  private pulse2: PulseChannel = new PulseChannel(2);
  private triangle: TriangleChannel = new TriangleChannel();
  private noise: NoiseChannel = new NoiseChannel();
  private dmc: DMCChannel = new DMCChannel();

  // Frame counter
  private frameCounterMode: number = 0; // 0 = 4-step, 1 = 5-step
  private frameIRQInhibit: boolean = false;
  private frameIRQPending: boolean = false;

  // Timing - use counters instead of modulo
  private cycleCount: number = 0;
  private frameCycleCount: number = 0;
  private frameStep: number = 0;

  // Audio output
  private sampleRate: number = 44100;
  private cpuFrequency: number = 1789773; // NTSC
  private sampleBuffer: Float32Array;
  private sampleIndex: number = 0;

  // Fractional sample timing using Bresenham-style accumulation
  // This ensures perfect sample rate without drift (1789773 CPU cycles / 44100 samples = 40.584...)
  // Instead of integer division, we accumulate and check: counter += sampleRate; if >= cpuFreq, emit sample
  private sampleAccumulator: number = 0;

  // Audio callback
  onSamplesReady: ((samples: Float32Array) => void) | null = null;

  // Audio filtering - simulates NES analog output characteristics
  // First-order high-pass filter at ~37 Hz (removes DC offset)
  private highPass1Prev: number = 0;
  private highPass1Out: number = 0;
  // First-order high-pass filter at ~300 Hz (from mixer capacitor, gentler for bass)
  private highPass2Prev: number = 0;
  private highPass2Out: number = 0;
  // First-order low-pass filter at ~14 kHz (smooths harsh edges)
  private lowPassPrev: number = 0;

  // Filter coefficients (precomputed for 44100 Hz sample rate)
  // High-pass: y[n] = α * (y[n-1] + x[n] - x[n-1]), where α = RC / (RC + dt)
  // Low-pass: y[n] = α * x[n] + (1 - α) * y[n-1], where α = dt / (RC + dt)
  private readonly highPass1Alpha = 0.996039; // ~37 Hz cutoff
  private readonly highPass2Alpha = 0.958725; // ~300 Hz cutoff (gentler than 440 Hz)
  private readonly lowPassAlpha = 0.815686;   // ~14 kHz cutoff

  // Dithering - reduces quantization noise on quiet sounds
  // Uses xorshift32 for fast pseudo-random number generation
  private ditherState: number = 1;

  constructor() {
    // Small buffer for low latency - ring buffer in emulator handles buffering
    this.sampleBuffer = new Float32Array(256);
    this.reset();
  }

  setMemoryReader(reader: (address: number) => number): void {
    this.dmc.readMemory = reader;
  }

  reset(): void {
    this.pulse1.setEnabled(false);
    this.pulse2.setEnabled(false);
    this.triangle.setEnabled(false);
    this.noise.setEnabled(false);
    this.dmc.setEnabled(false);
    this.frameCounterMode = 0;
    this.frameIRQInhibit = false;
    this.frameIRQPending = false;
    this.cycleCount = 0;
    this.frameCycleCount = 0;
    this.frameStep = 0;
    this.sampleAccumulator = 0;
    this.sampleIndex = 0;
    // Reset filter state
    this.highPass1Prev = 0;
    this.highPass1Out = 0;
    this.highPass2Prev = 0;
    this.highPass2Out = 0;
    this.lowPassPrev = 0;
    this.ditherState = 1;
  }

  // Fast xorshift32 PRNG for dithering (returns value in [-1, 1])
  private dither(): number {
    let x = this.ditherState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.ditherState = x >>> 0; // Ensure unsigned
    // Convert to float in range [-1, 1]
    return (x / 0x7fffffff) - 1;
  }

  // Apply audio filters to simulate NES analog output
  private applyFilters(sample: number): number {
    // First high-pass filter (~37 Hz) - removes DC offset
    this.highPass1Out = this.highPass1Alpha * (this.highPass1Out + sample - this.highPass1Prev);
    this.highPass1Prev = sample;

    // Second high-pass filter (~440 Hz) - simulates mixer capacitor coupling
    this.highPass2Out = this.highPass2Alpha * (this.highPass2Out + this.highPass1Out - this.highPass2Prev);
    this.highPass2Prev = this.highPass1Out;

    // Low-pass filter (~14 kHz) - smooths harsh high frequencies
    this.lowPassPrev = this.lowPassAlpha * this.highPass2Out + (1 - this.lowPassAlpha) * this.lowPassPrev;

    // Add dithering to reduce quantization noise (very subtle, ~0.5 LSB equivalent)
    const dithered = this.lowPassPrev + this.dither() * 0.00003;

    return dithered;
  }

  cpuRead(address: number): number {
    if (address === 0x4015) {
      // Status register
      let status = 0;
      if (this.pulse1.getLengthCounter() > 0) status |= 0x01;
      if (this.pulse2.getLengthCounter() > 0) status |= 0x02;
      if (this.triangle.getLengthCounter() > 0) status |= 0x04;
      if (this.noise.getLengthCounter() > 0) status |= 0x08;
      if (this.dmc.getBytesRemaining() > 0) status |= 0x10;
      if (this.frameIRQPending) status |= 0x40;
      if (this.dmc.irqPending) status |= 0x80;
      this.frameIRQPending = false;
      return status;
    }
    return 0;
  }

  cpuWrite(address: number, data: number): void {
    switch (address) {
      // Pulse 1
      case 0x4000:
        this.pulse1.writeControl(data);
        break;
      case 0x4001:
        this.pulse1.writeSweep(data);
        break;
      case 0x4002:
        this.pulse1.writeTimerLow(data);
        break;
      case 0x4003:
        this.pulse1.writeTimerHigh(data);
        break;

      // Pulse 2
      case 0x4004:
        this.pulse2.writeControl(data);
        break;
      case 0x4005:
        this.pulse2.writeSweep(data);
        break;
      case 0x4006:
        this.pulse2.writeTimerLow(data);
        break;
      case 0x4007:
        this.pulse2.writeTimerHigh(data);
        break;

      // Triangle
      case 0x4008:
        this.triangle.writeControl(data);
        break;
      case 0x400a:
        this.triangle.writeTimerLow(data);
        break;
      case 0x400b:
        this.triangle.writeTimerHigh(data);
        break;

      // Noise
      case 0x400c:
        this.noise.writeControl(data);
        break;
      case 0x400e:
        this.noise.writeMode(data);
        break;
      case 0x400f:
        this.noise.writeLength(data);
        break;

      // DMC
      case 0x4010:
        this.dmc.writeControl(data);
        break;
      case 0x4011:
        this.dmc.writeDirectLoad(data);
        break;
      case 0x4012:
        this.dmc.writeAddress(data);
        break;
      case 0x4013:
        this.dmc.writeLength(data);
        break;

      // Status
      case 0x4015:
        this.pulse1.setEnabled((data & 0x01) !== 0);
        this.pulse2.setEnabled((data & 0x02) !== 0);
        this.triangle.setEnabled((data & 0x04) !== 0);
        this.noise.setEnabled((data & 0x08) !== 0);
        this.dmc.setEnabled((data & 0x10) !== 0);
        this.dmc.irqPending = false;
        break;

      // Frame counter
      case 0x4017:
        this.frameCounterMode = (data >> 7) & 1;
        this.frameIRQInhibit = (data & 0x40) !== 0;
        if (this.frameIRQInhibit) {
          this.frameIRQPending = false;
        }
        if (this.frameCounterMode === 1) {
          this.clockQuarterFrame();
          this.clockHalfFrame();
        }
        break;
    }
  }

  // Clock APU (called every CPU cycle)
  clock(): void {
    const isEvenCycle = (this.cycleCount & 1) === 0;

    // Clock timers (triangle clocks every cycle, others every other cycle)
    this.triangle.clockTimer();

    if (isEvenCycle) {
      this.pulse1.clockTimer();
      this.pulse2.clockTimer();
      this.noise.clockTimer();
      this.dmc.clockTimer();
    }

    // Frame counter - use counter instead of modulo
    this.frameCycleCount++;
    if (this.frameCycleCount >= 7457) {
      this.frameCycleCount = 0;
      this.stepFrameCounter();
    }

    // Sample generation using Bresenham-style fractional accumulation
    // This eliminates drift from integer division (40 vs 40.584 cycles per sample)
    this.sampleAccumulator += this.sampleRate;
    while (this.sampleAccumulator >= this.cpuFrequency) {
      this.sampleAccumulator -= this.cpuFrequency;

      // Inline mixer for performance using lookup tables
      const p1 = this.pulse1.output();
      const p2 = this.pulse2.output();
      const pulseOut = PULSE_TABLE[p1 + p2];

      const t = this.triangle.output();
      const n = this.noise.output();
      const d = this.dmc.output();

      // TND mixer using precomputed lookup table
      const tndOut = TND_TABLE[(t << 11) | (n << 7) | d];

      // Apply audio filters (high-pass, low-pass) and dithering for authentic NES sound
      const rawSample = pulseOut + tndOut;
      this.sampleBuffer[this.sampleIndex++] = this.applyFilters(rawSample);

      if (this.sampleIndex >= this.sampleBuffer.length) {
        if (this.onSamplesReady) {
          this.onSamplesReady(this.sampleBuffer);
        }
        this.sampleIndex = 0;
      }
    }

    this.cycleCount++;
  }

  private stepFrameCounter(): void {
    if (this.frameCounterMode === 0) {
      // 4-step mode
      switch (this.frameStep) {
        case 0:
        case 2:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 3:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          if (!this.frameIRQInhibit) {
            this.frameIRQPending = true;
          }
          this.frameStep = -1; // Will wrap to 0
          break;
      }
    } else {
      // 5-step mode
      switch (this.frameStep) {
        case 0:
        case 2:
          this.clockQuarterFrame();
          break;
        case 1:
        case 3:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 4:
          this.frameStep = -1; // Will wrap to 0
          break;
      }
    }
    this.frameStep++;
  }

  private clockQuarterFrame(): void {
    this.pulse1.clockEnvelope();
    this.pulse2.clockEnvelope();
    this.triangle.clockLinear();
    this.noise.clockEnvelope();
  }

  private clockHalfFrame(): void {
    this.pulse1.clockLength();
    this.pulse1.clockSweep();
    this.pulse2.clockLength();
    this.pulse2.clockSweep();
    this.triangle.clockLength();
    this.noise.clockLength();
  }

  irqPending(): boolean {
    return this.frameIRQPending || this.dmc.irqPending;
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  getState(): APUState {
    return {
      frameCounterMode: this.frameCounterMode,
      frameIRQInhibit: this.frameIRQInhibit,
      frameIRQPending: this.frameIRQPending,
      cycleCount: this.cycleCount,
      frameCycleCount: this.frameCycleCount,
      frameStep: this.frameStep,
      pulse1: this.pulse1.getState(),
      pulse2: this.pulse2.getState(),
      triangle: this.triangle.getState(),
      noise: this.noise.getState(),
      dmc: this.dmc.getState(),
    };
  }

  setState(state: APUState): void {
    this.frameCounterMode = state.frameCounterMode;
    this.frameIRQInhibit = state.frameIRQInhibit;
    this.frameIRQPending = state.frameIRQPending;
    this.cycleCount = state.cycleCount;
    this.frameCycleCount = state.frameCycleCount;
    this.frameStep = state.frameStep;

    this.pulse1.setState(state.pulse1);
    this.pulse2.setState(state.pulse2);
    this.triangle.setState(state.triangle);
    this.noise.setState(state.noise);
    this.dmc.setState(state.dmc);

    // Reset sample accumulator and filter state
    this.sampleAccumulator = 0;
    this.sampleIndex = 0;
    this.highPass1Prev = 0;
    this.highPass1Out = 0;
    this.highPass2Prev = 0;
    this.highPass2Out = 0;
    this.lowPassPrev = 0;
  }
}
