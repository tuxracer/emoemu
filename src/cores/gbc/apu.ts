// Game Boy Color APU (Audio Processing Unit)
// 4 channels: 2 pulse (1 with sweep), 1 wave, 1 noise
// Stereo output with per-channel panning

// Channel state interfaces for save states
export interface PulseChannelState {
  enabled: boolean;
  dacEnabled: boolean;
  lengthCounter: number;
  lengthEnabled: boolean;
  frequency: number;
  duty: number;
  dutyPos: number;
  timer: number;
  volume: number;
  volumeInitial: number;
  volumeEnvDir: number;
  volumeEnvPeriod: number;
  volumeEnvTimer: number;
  // Channel 1 only (sweep)
  sweepEnabled: boolean;
  sweepPeriod: number;
  sweepTimer: number;
  sweepShift: number;
  sweepNegate: boolean;
  sweepShadowFreq: number;
  sweepCalcWithNegate: boolean;
}

export interface WaveChannelState {
  enabled: boolean;
  dacEnabled: boolean;
  lengthCounter: number;
  lengthEnabled: boolean;
  frequency: number;
  timer: number;
  volume: number;
  position: number;
  sampleBuffer: number;
  waveRam: number[];
}

export interface NoiseChannelState {
  enabled: boolean;
  dacEnabled: boolean;
  lengthCounter: number;
  lengthEnabled: boolean;
  volume: number;
  volumeInitial: number;
  volumeEnvDir: number;
  volumeEnvPeriod: number;
  volumeEnvTimer: number;
  divisor: number;
  shift: number;
  width: boolean;
  lfsr: number;
  timer: number;
}

export interface APUState {
  enabled: boolean;
  frameSequencer: number;
  frameSequencerTimer: number;
  masterVolumeLeft: number;
  masterVolumeRight: number;
  panLeft: number;
  panRight: number;
  pulse1: PulseChannelState;
  pulse2: PulseChannelState;
  wave: WaveChannelState;
  noise: NoiseChannelState;
}

// Duty cycle waveforms
const DUTY_WAVEFORMS = [
  [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
  [1, 0, 0, 0, 0, 0, 0, 1], // 25%
  [1, 0, 0, 0, 0, 1, 1, 1], // 50%
  [0, 1, 1, 1, 1, 1, 1, 0], // 75%
];

// Noise divisor table
const NOISE_DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112];

// Pulse channel implementation
class PulseChannel {
  enabled = false;
  dacEnabled = false;
  lengthCounter = 0;
  lengthEnabled = false;
  frequency = 0;
  duty = 0;
  dutyPos = 0;
  timer = 0;
  volume = 0;
  volumeInitial = 0;
  volumeEnvDir = 0;
  volumeEnvPeriod = 0;
  volumeEnvTimer = 0;

  // Sweep (channel 1 only)
  hasSweep: boolean;
  sweepEnabled = false;
  sweepPeriod = 0;
  sweepTimer = 0;
  sweepShift = 0;
  sweepNegate = false;
  sweepShadowFreq = 0;
  sweepCalcWithNegate = false;

  constructor(hasSweep: boolean) {
    this.hasSweep = hasSweep;
  }

  reset(): void {
    this.enabled = false;
    this.dacEnabled = false;
    this.lengthCounter = 0;
    this.lengthEnabled = false;
    this.frequency = 0;
    this.duty = 0;
    this.dutyPos = 0;
    this.timer = 0;
    this.volume = 0;
    this.volumeInitial = 0;
    this.volumeEnvDir = 0;
    this.volumeEnvPeriod = 0;
    this.volumeEnvTimer = 0;
    this.sweepEnabled = false;
    this.sweepPeriod = 0;
    this.sweepTimer = 0;
    this.sweepShift = 0;
    this.sweepNegate = false;
    this.sweepShadowFreq = 0;
    this.sweepCalcWithNegate = false;
  }

  // NRx0 - Sweep (Channel 1 only)
  writeSweep(value: number): void {
    this.sweepPeriod = (value >> 4) & 0x07;
    this.sweepNegate = (value & 0x08) !== 0;
    this.sweepShift = value & 0x07;

    // Disabling negate after a negate calc was done disables channel
    if (!this.sweepNegate && this.sweepCalcWithNegate) {
      this.enabled = false;
    }
  }

  readSweep(): number {
    return (
      0x80 |
      (this.sweepPeriod << 4) |
      (this.sweepNegate ? 0x08 : 0) |
      this.sweepShift
    );
  }

  // NRx1 - Length/duty
  writeLengthDuty(value: number): void {
    this.duty = (value >> 6) & 0x03;
    this.lengthCounter = 64 - (value & 0x3f);
  }

  readLengthDuty(): number {
    return (this.duty << 6) | 0x3f;
  }

  // NRx2 - Volume envelope
  writeEnvelope(value: number): void {
    this.volumeInitial = (value >> 4) & 0x0f;
    this.volumeEnvDir = (value & 0x08) !== 0 ? 1 : -1;
    this.volumeEnvPeriod = value & 0x07;
    this.dacEnabled = (value & 0xf8) !== 0;

    if (!this.dacEnabled) {
      this.enabled = false;
    }
  }

  readEnvelope(): number {
    return (
      (this.volumeInitial << 4) |
      (this.volumeEnvDir > 0 ? 0x08 : 0) |
      this.volumeEnvPeriod
    );
  }

  // NRx3 - Frequency low
  writeFreqLow(value: number): void {
    this.frequency = (this.frequency & 0x700) | value;
  }

  // NRx4 - Frequency high / trigger / length enable
  writeFreqHigh(value: number, frameSequencer: number): void {
    this.frequency = (this.frequency & 0x0ff) | ((value & 0x07) << 8);

    const wasLengthEnabled = this.lengthEnabled;
    this.lengthEnabled = (value & 0x40) !== 0;

    // Extra length clock if enabling length on first half of frame sequencer
    if (!wasLengthEnabled && this.lengthEnabled) {
      if ((frameSequencer & 1) === 0 && this.lengthCounter > 0) {
        this.lengthCounter--;
        if (this.lengthCounter === 0) {
          this.enabled = false;
        }
      }
    }

    if (value & 0x80) {
      this.trigger(frameSequencer);
    }
  }

  readFreqHigh(): number {
    return (this.lengthEnabled ? 0x40 : 0) | 0xbf;
  }

  private trigger(frameSequencer: number): void {
    this.enabled = this.dacEnabled;

    if (this.lengthCounter === 0) {
      this.lengthCounter = 64;
      // If triggering on first half and length enabled, immediately clock length
      if (this.lengthEnabled && (frameSequencer & 1) === 0) {
        this.lengthCounter--;
      }
    }

    this.timer = (2048 - this.frequency) * 4;
    this.volume = this.volumeInitial;
    this.volumeEnvTimer = this.volumeEnvPeriod === 0 ? 8 : this.volumeEnvPeriod;

    if (this.hasSweep) {
      this.sweepShadowFreq = this.frequency;
      this.sweepTimer =
        this.sweepPeriod === 0 ? 8 : this.sweepPeriod;
      this.sweepEnabled = this.sweepPeriod !== 0 || this.sweepShift !== 0;
      this.sweepCalcWithNegate = false;

      if (this.sweepShift !== 0) {
        this.calculateSweepFreq();
      }
    }
  }

  private calculateSweepFreq(): number {
    let newFreq = this.sweepShadowFreq >> this.sweepShift;

    if (this.sweepNegate) {
      newFreq = this.sweepShadowFreq - newFreq;
      this.sweepCalcWithNegate = true;
    } else {
      newFreq = this.sweepShadowFreq + newFreq;
    }

    if (newFreq > 2047) {
      this.enabled = false;
    }

    return newFreq;
  }

  clockSweep(): void {
    if (!this.hasSweep) return;

    this.sweepTimer--;
    if (this.sweepTimer <= 0) {
      this.sweepTimer = this.sweepPeriod === 0 ? 8 : this.sweepPeriod;

      if (this.sweepEnabled && this.sweepPeriod !== 0) {
        const newFreq = this.calculateSweepFreq();

        if (newFreq <= 2047 && this.sweepShift !== 0) {
          this.frequency = newFreq;
          this.sweepShadowFreq = newFreq;
          this.calculateSweepFreq();
        }
      }
    }
  }

  clockLength(): void {
    if (this.lengthEnabled && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.enabled = false;
      }
    }
  }

  clockEnvelope(): void {
    if (this.volumeEnvPeriod === 0) return;

    this.volumeEnvTimer--;
    if (this.volumeEnvTimer <= 0) {
      this.volumeEnvTimer = this.volumeEnvPeriod === 0 ? 8 : this.volumeEnvPeriod;

      const newVolume = this.volume + this.volumeEnvDir;
      if (newVolume >= 0 && newVolume <= 15) {
        this.volume = newVolume;
      }
    }
  }

  tick(cycles: number): void {
    this.timer -= cycles;
    while (this.timer <= 0) {
      this.timer += (2048 - this.frequency) * 4;
      this.dutyPos = (this.dutyPos + 1) & 0x07;
    }
  }

  output(): number {
    if (!this.enabled || !this.dacEnabled) {
      return 0;
    }
    return DUTY_WAVEFORMS[this.duty][this.dutyPos] * this.volume;
  }

  getState(): PulseChannelState {
    return {
      enabled: this.enabled,
      dacEnabled: this.dacEnabled,
      lengthCounter: this.lengthCounter,
      lengthEnabled: this.lengthEnabled,
      frequency: this.frequency,
      duty: this.duty,
      dutyPos: this.dutyPos,
      timer: this.timer,
      volume: this.volume,
      volumeInitial: this.volumeInitial,
      volumeEnvDir: this.volumeEnvDir,
      volumeEnvPeriod: this.volumeEnvPeriod,
      volumeEnvTimer: this.volumeEnvTimer,
      sweepEnabled: this.sweepEnabled,
      sweepPeriod: this.sweepPeriod,
      sweepTimer: this.sweepTimer,
      sweepShift: this.sweepShift,
      sweepNegate: this.sweepNegate,
      sweepShadowFreq: this.sweepShadowFreq,
      sweepCalcWithNegate: this.sweepCalcWithNegate,
    };
  }

  setState(state: PulseChannelState): void {
    this.enabled = state.enabled;
    this.dacEnabled = state.dacEnabled;
    this.lengthCounter = state.lengthCounter;
    this.lengthEnabled = state.lengthEnabled;
    this.frequency = state.frequency;
    this.duty = state.duty;
    this.dutyPos = state.dutyPos;
    this.timer = state.timer;
    this.volume = state.volume;
    this.volumeInitial = state.volumeInitial;
    this.volumeEnvDir = state.volumeEnvDir;
    this.volumeEnvPeriod = state.volumeEnvPeriod;
    this.volumeEnvTimer = state.volumeEnvTimer;
    this.sweepEnabled = state.sweepEnabled;
    this.sweepPeriod = state.sweepPeriod;
    this.sweepTimer = state.sweepTimer;
    this.sweepShift = state.sweepShift;
    this.sweepNegate = state.sweepNegate;
    this.sweepShadowFreq = state.sweepShadowFreq;
    this.sweepCalcWithNegate = state.sweepCalcWithNegate;
  }
}

// Wave channel implementation
class WaveChannel {
  enabled = false;
  dacEnabled = false;
  lengthCounter = 0;
  lengthEnabled = false;
  frequency = 0;
  timer = 0;
  volume = 0;
  position = 0;
  sampleBuffer = 0;
  waveRam = new Uint8Array(16);

  reset(): void {
    this.enabled = false;
    this.dacEnabled = false;
    this.lengthCounter = 0;
    this.lengthEnabled = false;
    this.frequency = 0;
    this.timer = 0;
    this.volume = 0;
    this.position = 0;
    this.sampleBuffer = 0;
    this.waveRam.fill(0);
  }

  // NR30 - DAC enable
  writeDacEnable(value: number): void {
    this.dacEnabled = (value & 0x80) !== 0;
    if (!this.dacEnabled) {
      this.enabled = false;
    }
  }

  readDacEnable(): number {
    return (this.dacEnabled ? 0x80 : 0) | 0x7f;
  }

  // NR31 - Length
  writeLength(value: number): void {
    this.lengthCounter = 256 - value;
  }

  // NR32 - Volume
  writeVolume(value: number): void {
    this.volume = (value >> 5) & 0x03;
  }

  readVolume(): number {
    return (this.volume << 5) | 0x9f;
  }

  // NR33 - Frequency low
  writeFreqLow(value: number): void {
    this.frequency = (this.frequency & 0x700) | value;
  }

  // NR34 - Frequency high / trigger / length enable
  writeFreqHigh(value: number, frameSequencer: number): void {
    this.frequency = (this.frequency & 0x0ff) | ((value & 0x07) << 8);

    const wasLengthEnabled = this.lengthEnabled;
    this.lengthEnabled = (value & 0x40) !== 0;

    if (!wasLengthEnabled && this.lengthEnabled) {
      if ((frameSequencer & 1) === 0 && this.lengthCounter > 0) {
        this.lengthCounter--;
        if (this.lengthCounter === 0) {
          this.enabled = false;
        }
      }
    }

    if (value & 0x80) {
      this.trigger(frameSequencer);
    }
  }

  readFreqHigh(): number {
    return (this.lengthEnabled ? 0x40 : 0) | 0xbf;
  }

  private trigger(frameSequencer: number): void {
    this.enabled = this.dacEnabled;

    if (this.lengthCounter === 0) {
      this.lengthCounter = 256;
      if (this.lengthEnabled && (frameSequencer & 1) === 0) {
        this.lengthCounter--;
      }
    }

    this.timer = (2048 - this.frequency) * 2;
    this.position = 0;
  }

  clockLength(): void {
    if (this.lengthEnabled && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.enabled = false;
      }
    }
  }

  tick(cycles: number): void {
    this.timer -= cycles;
    while (this.timer <= 0) {
      this.timer += (2048 - this.frequency) * 2;
      this.position = (this.position + 1) & 0x1f;

      // Read sample from wave RAM
      const byteIndex = this.position >> 1;
      if (this.position & 1) {
        this.sampleBuffer = this.waveRam[byteIndex] & 0x0f;
      } else {
        this.sampleBuffer = this.waveRam[byteIndex] >> 4;
      }
    }
  }

  output(): number {
    if (!this.enabled || !this.dacEnabled) {
      return 0;
    }

    // Volume shifts: 0=mute, 1=100%, 2=50%, 3=25%
    const shifts = [4, 0, 1, 2];
    return this.sampleBuffer >> shifts[this.volume];
  }

  writeWaveRam(address: number, value: number): void {
    this.waveRam[address & 0x0f] = value;
  }

  readWaveRam(address: number): number {
    return this.waveRam[address & 0x0f];
  }

  getState(): WaveChannelState {
    return {
      enabled: this.enabled,
      dacEnabled: this.dacEnabled,
      lengthCounter: this.lengthCounter,
      lengthEnabled: this.lengthEnabled,
      frequency: this.frequency,
      timer: this.timer,
      volume: this.volume,
      position: this.position,
      sampleBuffer: this.sampleBuffer,
      waveRam: Array.from(this.waveRam),
    };
  }

  setState(state: WaveChannelState): void {
    this.enabled = state.enabled;
    this.dacEnabled = state.dacEnabled;
    this.lengthCounter = state.lengthCounter;
    this.lengthEnabled = state.lengthEnabled;
    this.frequency = state.frequency;
    this.timer = state.timer;
    this.volume = state.volume;
    this.position = state.position;
    this.sampleBuffer = state.sampleBuffer;
    this.waveRam = new Uint8Array(state.waveRam);
  }
}

// Noise channel implementation
class NoiseChannel {
  enabled = false;
  dacEnabled = false;
  lengthCounter = 0;
  lengthEnabled = false;
  volume = 0;
  volumeInitial = 0;
  volumeEnvDir = 0;
  volumeEnvPeriod = 0;
  volumeEnvTimer = 0;
  divisor = 0;
  shift = 0;
  width = false;
  lfsr = 0x7fff;
  timer = 0;

  reset(): void {
    this.enabled = false;
    this.dacEnabled = false;
    this.lengthCounter = 0;
    this.lengthEnabled = false;
    this.volume = 0;
    this.volumeInitial = 0;
    this.volumeEnvDir = 0;
    this.volumeEnvPeriod = 0;
    this.volumeEnvTimer = 0;
    this.divisor = 0;
    this.shift = 0;
    this.width = false;
    this.lfsr = 0x7fff;
    this.timer = 0;
  }

  // NR41 - Length
  writeLength(value: number): void {
    this.lengthCounter = 64 - (value & 0x3f);
  }

  // NR42 - Volume envelope
  writeEnvelope(value: number): void {
    this.volumeInitial = (value >> 4) & 0x0f;
    this.volumeEnvDir = (value & 0x08) !== 0 ? 1 : -1;
    this.volumeEnvPeriod = value & 0x07;
    this.dacEnabled = (value & 0xf8) !== 0;

    if (!this.dacEnabled) {
      this.enabled = false;
    }
  }

  readEnvelope(): number {
    return (
      (this.volumeInitial << 4) |
      (this.volumeEnvDir > 0 ? 0x08 : 0) |
      this.volumeEnvPeriod
    );
  }

  // NR43 - Clock/divisor/width
  writeClock(value: number): void {
    this.shift = (value >> 4) & 0x0f;
    this.width = (value & 0x08) !== 0;
    this.divisor = value & 0x07;
  }

  readClock(): number {
    return (this.shift << 4) | (this.width ? 0x08 : 0) | this.divisor;
  }

  // NR44 - Trigger / length enable
  writeTrigger(value: number, frameSequencer: number): void {
    const wasLengthEnabled = this.lengthEnabled;
    this.lengthEnabled = (value & 0x40) !== 0;

    if (!wasLengthEnabled && this.lengthEnabled) {
      if ((frameSequencer & 1) === 0 && this.lengthCounter > 0) {
        this.lengthCounter--;
        if (this.lengthCounter === 0) {
          this.enabled = false;
        }
      }
    }

    if (value & 0x80) {
      this.trigger(frameSequencer);
    }
  }

  readTrigger(): number {
    return (this.lengthEnabled ? 0x40 : 0) | 0xbf;
  }

  private trigger(frameSequencer: number): void {
    this.enabled = this.dacEnabled;

    if (this.lengthCounter === 0) {
      this.lengthCounter = 64;
      if (this.lengthEnabled && (frameSequencer & 1) === 0) {
        this.lengthCounter--;
      }
    }

    this.timer = NOISE_DIVISORS[this.divisor] << this.shift;
    this.lfsr = 0x7fff;
    this.volume = this.volumeInitial;
    this.volumeEnvTimer = this.volumeEnvPeriod === 0 ? 8 : this.volumeEnvPeriod;
  }

  clockLength(): void {
    if (this.lengthEnabled && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.enabled = false;
      }
    }
  }

  clockEnvelope(): void {
    if (this.volumeEnvPeriod === 0) return;

    this.volumeEnvTimer--;
    if (this.volumeEnvTimer <= 0) {
      this.volumeEnvTimer = this.volumeEnvPeriod === 0 ? 8 : this.volumeEnvPeriod;

      const newVolume = this.volume + this.volumeEnvDir;
      if (newVolume >= 0 && newVolume <= 15) {
        this.volume = newVolume;
      }
    }
  }

  tick(cycles: number): void {
    this.timer -= cycles;
    while (this.timer <= 0) {
      this.timer += NOISE_DIVISORS[this.divisor] << this.shift;

      // LFSR step
      const xor = (this.lfsr & 1) ^ ((this.lfsr >> 1) & 1);
      this.lfsr = (this.lfsr >> 1) | (xor << 14);

      if (this.width) {
        // 7-bit mode
        this.lfsr &= ~0x40;
        this.lfsr |= xor << 6;
      }
    }
  }

  output(): number {
    if (!this.enabled || !this.dacEnabled) {
      return 0;
    }
    // LFSR bit 0 inverted
    return (~this.lfsr & 1) * this.volume;
  }

  getState(): NoiseChannelState {
    return {
      enabled: this.enabled,
      dacEnabled: this.dacEnabled,
      lengthCounter: this.lengthCounter,
      lengthEnabled: this.lengthEnabled,
      volume: this.volume,
      volumeInitial: this.volumeInitial,
      volumeEnvDir: this.volumeEnvDir,
      volumeEnvPeriod: this.volumeEnvPeriod,
      volumeEnvTimer: this.volumeEnvTimer,
      divisor: this.divisor,
      shift: this.shift,
      width: this.width,
      lfsr: this.lfsr,
      timer: this.timer,
    };
  }

  setState(state: NoiseChannelState): void {
    this.enabled = state.enabled;
    this.dacEnabled = state.dacEnabled;
    this.lengthCounter = state.lengthCounter;
    this.lengthEnabled = state.lengthEnabled;
    this.volume = state.volume;
    this.volumeInitial = state.volumeInitial;
    this.volumeEnvDir = state.volumeEnvDir;
    this.volumeEnvPeriod = state.volumeEnvPeriod;
    this.volumeEnvTimer = state.volumeEnvTimer;
    this.divisor = state.divisor;
    this.shift = state.shift;
    this.width = state.width;
    this.lfsr = state.lfsr;
    this.timer = state.timer;
  }
}

// Main APU class
export class APU {
  private pulse1 = new PulseChannel(true); // Has sweep
  private pulse2 = new PulseChannel(false); // No sweep
  private wave = new WaveChannel();
  private noise = new NoiseChannel();

  // Master control
  private enabled = true;
  private frameSequencer = 0;
  private frameSequencerTimer = 8192;

  // Volume and panning
  private masterVolumeLeft = 7;
  private masterVolumeRight = 7;
  private panLeft = 0xff; // All channels to left
  private panRight = 0xff; // All channels to right

  // Audio output
  private sampleRate = 44100;
  private cpuFrequency = 4194304;
  private sampleBuffer: Float32Array;
  private sampleIndex = 0;
  private sampleAccumulator = 0;

  // High-pass filter to remove DC offset
  private highPassLeftPrev = 0;
  private highPassLeftOut = 0;
  private highPassRightPrev = 0;
  private highPassRightOut = 0;
  private readonly highPassAlpha = 0.999;

  // Audio callback
  onSamplesReady: ((samples: Float32Array) => void) | null = null;

  constructor() {
    // Stereo buffer (interleaved L/R)
    this.sampleBuffer = new Float32Array(512);
    this.reset();
  }

  reset(): void {
    this.enabled = true;
    this.frameSequencer = 0;
    this.frameSequencerTimer = 8192;
    this.masterVolumeLeft = 7;
    this.masterVolumeRight = 7;
    this.panLeft = 0xff;
    this.panRight = 0xff;
    this.sampleIndex = 0;
    this.sampleAccumulator = 0;

    this.pulse1.reset();
    this.pulse2.reset();
    this.wave.reset();
    this.noise.reset();

    this.highPassLeftPrev = 0;
    this.highPassLeftOut = 0;
    this.highPassRightPrev = 0;
    this.highPassRightOut = 0;
  }

  read(address: number): number {
    if (!this.enabled && address < 0xff26) {
      return 0xff;
    }

    switch (address) {
      // Pulse 1
      case 0xff10:
        return this.pulse1.readSweep();
      case 0xff11:
        return this.pulse1.readLengthDuty();
      case 0xff12:
        return this.pulse1.readEnvelope();
      case 0xff13:
        return 0xff;
      case 0xff14:
        return this.pulse1.readFreqHigh();

      // Pulse 2
      case 0xff15:
        return 0xff;
      case 0xff16:
        return this.pulse2.readLengthDuty();
      case 0xff17:
        return this.pulse2.readEnvelope();
      case 0xff18:
        return 0xff;
      case 0xff19:
        return this.pulse2.readFreqHigh();

      // Wave
      case 0xff1a:
        return this.wave.readDacEnable();
      case 0xff1b:
        return 0xff;
      case 0xff1c:
        return this.wave.readVolume();
      case 0xff1d:
        return 0xff;
      case 0xff1e:
        return this.wave.readFreqHigh();

      // Noise
      case 0xff1f:
        return 0xff;
      case 0xff20:
        return 0xff;
      case 0xff21:
        return this.noise.readEnvelope();
      case 0xff22:
        return this.noise.readClock();
      case 0xff23:
        return this.noise.readTrigger();

      // Control
      case 0xff24:
        return (
          (this.masterVolumeLeft << 4) | this.masterVolumeRight | 0x88
        );
      case 0xff25:
        return (this.panLeft << 4) | this.panRight;
      case 0xff26: {
        let status = this.enabled ? 0x80 : 0;
        if (this.pulse1.enabled) status |= 0x01;
        if (this.pulse2.enabled) status |= 0x02;
        if (this.wave.enabled) status |= 0x04;
        if (this.noise.enabled) status |= 0x08;
        return status | 0x70;
      }

      // Wave RAM
      default:
        if (address >= 0xff30 && address <= 0xff3f) {
          return this.wave.readWaveRam(address - 0xff30);
        }
        return 0xff;
    }
  }

  write(address: number, value: number): void {
    // Wave RAM is always accessible
    if (address >= 0xff30 && address <= 0xff3f) {
      this.wave.writeWaveRam(address - 0xff30, value);
      return;
    }

    // NR52 (master control) is always accessible
    if (address === 0xff26) {
      const wasEnabled = this.enabled;
      this.enabled = (value & 0x80) !== 0;

      if (wasEnabled && !this.enabled) {
        // Turning off resets all registers
        this.pulse1.reset();
        this.pulse2.reset();
        this.wave.reset();
        this.noise.reset();
        this.masterVolumeLeft = 0;
        this.masterVolumeRight = 0;
        this.panLeft = 0;
        this.panRight = 0;
      }
      return;
    }

    // Other registers ignored when APU is off
    if (!this.enabled) {
      return;
    }

    switch (address) {
      // Pulse 1
      case 0xff10:
        this.pulse1.writeSweep(value);
        break;
      case 0xff11:
        this.pulse1.writeLengthDuty(value);
        break;
      case 0xff12:
        this.pulse1.writeEnvelope(value);
        break;
      case 0xff13:
        this.pulse1.writeFreqLow(value);
        break;
      case 0xff14:
        this.pulse1.writeFreqHigh(value, this.frameSequencer);
        break;

      // Pulse 2
      case 0xff16:
        this.pulse2.writeLengthDuty(value);
        break;
      case 0xff17:
        this.pulse2.writeEnvelope(value);
        break;
      case 0xff18:
        this.pulse2.writeFreqLow(value);
        break;
      case 0xff19:
        this.pulse2.writeFreqHigh(value, this.frameSequencer);
        break;

      // Wave
      case 0xff1a:
        this.wave.writeDacEnable(value);
        break;
      case 0xff1b:
        this.wave.writeLength(value);
        break;
      case 0xff1c:
        this.wave.writeVolume(value);
        break;
      case 0xff1d:
        this.wave.writeFreqLow(value);
        break;
      case 0xff1e:
        this.wave.writeFreqHigh(value, this.frameSequencer);
        break;

      // Noise
      case 0xff20:
        this.noise.writeLength(value);
        break;
      case 0xff21:
        this.noise.writeEnvelope(value);
        break;
      case 0xff22:
        this.noise.writeClock(value);
        break;
      case 0xff23:
        this.noise.writeTrigger(value, this.frameSequencer);
        break;

      // Control
      case 0xff24:
        this.masterVolumeLeft = (value >> 4) & 0x07;
        this.masterVolumeRight = value & 0x07;
        break;
      case 0xff25:
        this.panRight = value & 0x0f;
        this.panLeft = (value >> 4) & 0x0f;
        break;
    }
  }

  tick(cycles: number): void {
    if (!this.enabled) {
      // Still generate silent samples for timing
      this.sampleAccumulator += this.sampleRate * cycles;
      while (this.sampleAccumulator >= this.cpuFrequency) {
        this.sampleAccumulator -= this.cpuFrequency;
        this.sampleBuffer[this.sampleIndex++] = 0; // Left
        this.sampleBuffer[this.sampleIndex++] = 0; // Right

        if (this.sampleIndex >= this.sampleBuffer.length) {
          if (this.onSamplesReady) {
            this.onSamplesReady(this.sampleBuffer);
          }
          this.sampleIndex = 0;
        }
      }
      return;
    }

    // Frame sequencer (runs at 512 Hz = every 8192 CPU cycles)
    this.frameSequencerTimer -= cycles;
    while (this.frameSequencerTimer <= 0) {
      this.frameSequencerTimer += 8192;

      // Frame sequencer clocks at 512 Hz
      // Step 0: Length
      // Step 1: -
      // Step 2: Length, Sweep
      // Step 3: -
      // Step 4: Length
      // Step 5: -
      // Step 6: Length, Sweep
      // Step 7: Envelope

      switch (this.frameSequencer) {
        case 0:
        case 4:
          this.pulse1.clockLength();
          this.pulse2.clockLength();
          this.wave.clockLength();
          this.noise.clockLength();
          break;
        case 2:
        case 6:
          this.pulse1.clockLength();
          this.pulse2.clockLength();
          this.wave.clockLength();
          this.noise.clockLength();
          this.pulse1.clockSweep();
          break;
        case 7:
          this.pulse1.clockEnvelope();
          this.pulse2.clockEnvelope();
          this.noise.clockEnvelope();
          break;
      }

      this.frameSequencer = (this.frameSequencer + 1) & 0x07;
    }

    // Tick channels
    this.pulse1.tick(cycles);
    this.pulse2.tick(cycles);
    this.wave.tick(cycles);
    this.noise.tick(cycles);

    // Generate samples
    this.sampleAccumulator += this.sampleRate * cycles;
    while (this.sampleAccumulator >= this.cpuFrequency) {
      this.sampleAccumulator -= this.cpuFrequency;

      // Get channel outputs (0-15 range)
      const ch1 = this.pulse1.output();
      const ch2 = this.pulse2.output();
      const ch3 = this.wave.output();
      const ch4 = this.noise.output();

      // Mix with panning
      let left = 0;
      let right = 0;

      if (this.panLeft & 0x01) left += ch1;
      if (this.panLeft & 0x02) left += ch2;
      if (this.panLeft & 0x04) left += ch3;
      if (this.panLeft & 0x08) left += ch4;

      if (this.panRight & 0x01) right += ch1;
      if (this.panRight & 0x02) right += ch2;
      if (this.panRight & 0x04) right += ch3;
      if (this.panRight & 0x08) right += ch4;

      // Apply master volume (0-7)
      left *= (this.masterVolumeLeft + 1) / 8;
      right *= (this.masterVolumeRight + 1) / 8;

      // Normalize to -1..1 range (max output is 60: 4 channels * 15 max)
      left = left / 60;
      right = right / 60;

      // High-pass filter to remove DC offset
      this.highPassLeftOut =
        this.highPassAlpha * (this.highPassLeftOut + left - this.highPassLeftPrev);
      this.highPassLeftPrev = left;

      this.highPassRightOut =
        this.highPassAlpha * (this.highPassRightOut + right - this.highPassRightPrev);
      this.highPassRightPrev = right;

      this.sampleBuffer[this.sampleIndex++] = this.highPassLeftOut;
      this.sampleBuffer[this.sampleIndex++] = this.highPassRightOut;

      if (this.sampleIndex >= this.sampleBuffer.length) {
        if (this.onSamplesReady) {
          this.onSamplesReady(this.sampleBuffer);
        }
        this.sampleIndex = 0;
      }
    }
  }

  getState(): APUState {
    return {
      enabled: this.enabled,
      frameSequencer: this.frameSequencer,
      frameSequencerTimer: this.frameSequencerTimer,
      masterVolumeLeft: this.masterVolumeLeft,
      masterVolumeRight: this.masterVolumeRight,
      panLeft: this.panLeft,
      panRight: this.panRight,
      pulse1: this.pulse1.getState(),
      pulse2: this.pulse2.getState(),
      wave: this.wave.getState(),
      noise: this.noise.getState(),
    };
  }

  setState(state: APUState): void {
    this.enabled = state.enabled;
    this.frameSequencer = state.frameSequencer;
    this.frameSequencerTimer = state.frameSequencerTimer;
    this.masterVolumeLeft = state.masterVolumeLeft;
    this.masterVolumeRight = state.masterVolumeRight;
    this.panLeft = state.panLeft;
    this.panRight = state.panRight;

    this.pulse1.setState(state.pulse1);
    this.pulse2.setState(state.pulse2);
    this.wave.setState(state.wave);
    this.noise.setState(state.noise);

    // Reset filter state
    this.highPassLeftPrev = 0;
    this.highPassLeftOut = 0;
    this.highPassRightPrev = 0;
    this.highPassRightOut = 0;
    this.sampleAccumulator = 0;
    this.sampleIndex = 0;
  }
}
