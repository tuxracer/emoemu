// Game Boy / Game Boy Color Timer implementation
// DIV - Divider register, increments at 16384 Hz (every 256 cycles)
// TIMA - Timer counter, increments at rate specified by TAC
// TMA - Timer modulo, value loaded into TIMA on overflow
// TAC - Timer control (bit 2 = enable, bits 0-1 = frequency)

export interface TimerState {
  div: number;
  tima: number;
  tma: number;
  tac: number;
  divCounter: number;
  timaCounter: number;
}

// TAC frequency dividers (CPU cycles per TIMA increment)
// 00 = 4096 Hz = 1024 cycles
// 01 = 262144 Hz = 16 cycles
// 10 = 65536 Hz = 64 cycles
// 11 = 16384 Hz = 256 cycles
const TAC_FREQUENCIES = [1024, 16, 64, 256];

export class Timer {
  // Registers
  private div = 0; // $FF04 - Divider (upper 8 bits of 16-bit counter)
  private tima = 0; // $FF05 - Timer counter
  private tma = 0; // $FF06 - Timer modulo
  private tac = 0; // $FF07 - Timer control

  // Internal counters
  private divCounter = 0; // Full 16-bit divider counter
  private timaCounter = 0; // Cycles since last TIMA increment

  // Interrupt request callback
  private requestInterrupt: () => void;

  constructor(requestInterrupt: () => void) {
    this.requestInterrupt = requestInterrupt;
  }

  reset(): void {
    this.div = 0;
    this.tima = 0;
    this.tma = 0;
    this.tac = 0;
    this.divCounter = 0;
    this.timaCounter = 0;
  }

  getState(): TimerState {
    return {
      div: this.div,
      tima: this.tima,
      tma: this.tma,
      tac: this.tac,
      divCounter: this.divCounter,
      timaCounter: this.timaCounter,
    };
  }

  setState(state: TimerState): void {
    this.div = state.div;
    this.tima = state.tima;
    this.tma = state.tma;
    this.tac = state.tac;
    this.divCounter = state.divCounter;
    this.timaCounter = state.timaCounter;
  }

  // Tick the timer for the given number of CPU cycles
  tick(cycles: number): void {
    // Update DIV register (always runs)
    this.divCounter += cycles;
    while (this.divCounter >= 256) {
      this.divCounter -= 256;
      this.div = (this.div + 1) & 0xff;
    }

    // Update TIMA if timer is enabled
    if (this.tac & 0x04) {
      const frequency = TAC_FREQUENCIES[this.tac & 0x03];
      this.timaCounter += cycles;

      while (this.timaCounter >= frequency) {
        this.timaCounter -= frequency;
        this.tima++;

        // Check for overflow
        if (this.tima > 0xff) {
          this.tima = this.tma; // Reload from TMA
          this.requestInterrupt(); // Request timer interrupt
        }
      }
    }
  }

  // Read timer registers
  read(address: number): number {
    switch (address) {
      case 0xff04:
        return this.div;
      case 0xff05:
        return this.tima;
      case 0xff06:
        return this.tma;
      case 0xff07:
        return this.tac | 0xf8; // Bits 3-7 read as 1
      default:
        return 0xff;
    }
  }

  // Write timer registers
  write(address: number, value: number): void {
    switch (address) {
      case 0xff04:
        // Writing any value to DIV resets it to 0
        this.div = 0;
        this.divCounter = 0;
        break;
      case 0xff05:
        this.tima = value;
        break;
      case 0xff06:
        this.tma = value;
        break;
      case 0xff07:
        // Changing TAC can affect timer behavior
        const oldEnabled = (this.tac & 0x04) !== 0;
        const newEnabled = (value & 0x04) !== 0;

        // If timer was enabled and is now disabled, or if frequency changed
        // while enabled, there may be edge cases - for now, simple implementation
        if (oldEnabled && !newEnabled) {
          this.timaCounter = 0;
        }

        this.tac = value & 0x07;
        break;
    }
  }
}
