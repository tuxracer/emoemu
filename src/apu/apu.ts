// APU (Audio Processing Unit) - Full Implementation
// NES APU has 5 channels: 2 pulse, 1 triangle, 1 noise, 1 DMC

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
    if (!this.enabled || this.lengthCounter === 0 || this.linearCounter === 0) {
      return 0;
    }
    // Silence ultrasonic frequencies
    if (this.timerPeriod < 2) {
      return 0;
    }
    return TRIANGLE_TABLE[this.sequencePos];
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
}

// DMC (Delta Modulation Channel)
class DMCChannel {
  private irqEnabled: boolean = false;
  private loop: boolean = false;
  private ratePeriod: number = 0;
  private directLoad: number = 0;
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
}

// Precomputed pulse mixer lookup table (avoids division in hot path)
const PULSE_TABLE = new Float32Array(31);
for (let i = 0; i < 31; i++) {
  PULSE_TABLE[i] = i === 0 ? 0 : 95.88 / (8128 / i + 100);
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

  // Use fixed-point arithmetic for sample timing
  private sampleCounter: number = 0;
  private cyclesPerSample: number;

  // Memory read callback for DMC
  private readMemory: ((address: number) => number) | null = null;

  // Audio callback
  onSamplesReady: ((samples: Float32Array) => void) | null = null;

  constructor() {
    this.cyclesPerSample = Math.floor(this.cpuFrequency / this.sampleRate);
    // Small buffer for low latency (~5.8ms at 44100Hz)
    this.sampleBuffer = new Float32Array(256);
    this.reset();
  }

  setMemoryReader(reader: (address: number) => number): void {
    this.readMemory = reader;
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
    this.sampleCounter = 0;
    this.sampleIndex = 0;
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

    // Sample generation - use counter instead of modulo
    this.sampleCounter++;
    if (this.sampleCounter >= this.cyclesPerSample) {
      this.sampleCounter = 0;

      // Inline mixer for performance
      const p1 = this.pulse1.output();
      const p2 = this.pulse2.output();
      const pulseOut = PULSE_TABLE[p1 + p2];

      const t = this.triangle.output();
      const n = this.noise.output();
      const d = this.dmc.output();

      // TND mixer - fast path for silence
      let tndOut = 0;
      if (t | n | d) {
        const tndSum = t / 8227 + n / 12241 + d / 22638;
        tndOut = 159.79 / (1 / tndSum + 100);
      }

      this.sampleBuffer[this.sampleIndex++] = pulseOut + tndOut;

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
}
