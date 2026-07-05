import { describe, it, expect } from 'vitest';
import { nextLoopDelayMs, PACER_SPIN_THRESHOLD_MS } from '.';

const TARGET_60FPS = 1000 / 60; // ~16.67ms

describe('nextLoopDelayMs', () => {
  it('runs immediately in uncapped mode (targetFrameTime = 0)', () => {
    expect(nextLoopDelayMs(100, 50, 0)).toBeNull();
  });

  it('runs immediately when the next frame is overdue', () => {
    expect(nextLoopDelayMs(120, 100, TARGET_60FPS)).toBeNull();
  });

  it('runs immediately when the frame is due within the spin threshold', () => {
    // 1.67ms until due — inside the spin window
    expect(nextLoopDelayMs(115, 100, TARGET_60FPS)).toBeNull();
  });

  it('sleeps off most of the inter-frame gap right after a frame runs', () => {
    // Full 16.67ms until due: sleep all but the spin threshold
    const delay = nextLoopDelayMs(100, 100, TARGET_60FPS);
    expect(delay).toBe(Math.floor(TARGET_60FPS - PACER_SPIN_THRESHOLD_MS));
  });

  it('never sleeps past the start of the spin window', () => {
    const lastFrameTime = 100;
    const due = lastFrameTime + TARGET_60FPS;
    for (const now of [100, 103.2, 108, 112.9, 114.5]) {
      const delay = nextLoopDelayMs(now, lastFrameTime, TARGET_60FPS);
      if (delay !== null) {
        expect(now + delay).toBeLessThanOrEqual(due - PACER_SPIN_THRESHOLD_MS);
      }
    }
  });

  it('sleeps a minimum of 1ms when a sleep is scheduled', () => {
    // 3.2ms until due: 1.2ms of sleepable time floors to 1ms
    expect(nextLoopDelayMs(113.47, 100, TARGET_60FPS)).toBe(1);
  });

  it('spins instead of oversleeping when under 1ms is sleepable', () => {
    // 2.5ms until due: only 0.5ms sleepable — not worth a timer
    expect(nextLoopDelayMs(114.17, 100, TARGET_60FPS)).toBeNull();
  });
});
