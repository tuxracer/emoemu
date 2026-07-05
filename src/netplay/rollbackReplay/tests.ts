import { describe, it, expect, beforeEach } from 'vitest';
import { wireRollbackReplay } from '.';
import type { ReplayCoreHooks } from '.';
import { createSyncManager, type SyncManager } from '../SyncManager';
import { crc32 } from '../crc32';

interface RecordedCall {
  type: 'begin' | 'restore' | 'apply' | 'run' | 'end';
  frame?: number;
  bytes?: number[];
  input?: number[];
}

// Fake core: records the call sequence and produces a deterministic,
// distinct state per replayed frame
class FakeCore {
  calls: RecordedCall[] = [];
  captured: Buffer[] = [];
  scratchArgs: Array<Buffer | null> = [];
  captureReturnsNull = false;
  private runs = 0;

  hooks: ReplayCoreHooks = {
    beginReplay: () => this.calls.push({ type: 'begin' }),
    endReplay: () => this.calls.push({ type: 'end' }),
    restoreState: (state) => this.calls.push({ type: 'restore', bytes: [...state] }),
    applyInput: (input) => this.calls.push({ type: 'apply', input: [...input] }),
    runFrame: () => {
      this.runs++;
      this.calls.push({ type: 'run' });
    },
    captureState: (scratch) => {
      this.scratchArgs.push(scratch);
      if (this.captureReturnsNull) {
        return null;
      }
      const state = Buffer.from([200 + this.runs]);
      this.captured.push(state);
      return state;
    },
  };
}

describe('wireRollbackReplay', () => {
  let syncManager: SyncManager;
  let core: FakeCore;

  // Frames 1-5 run with simulated remote input (states [10]..[14]), then
  // real input arrives late for frame 2 -> rollback to 1, replay 2-5
  const runRollbackScenario = (): boolean => {
    for (let i = 0; i < 5; i++) {
      syncManager.preFrame([i, 0, 0]);
      syncManager.simulateRemoteInput(1);
      syncManager.postFrame(Buffer.from([10 + i]));
    }
    syncManager.receiveRemoteInput(1, 2, [0xff, 0, 0]);
    return syncManager.performRollbackIfNeeded();
  };

  beforeEach(() => {
    syncManager = createSyncManager({ localClientId: 0 });
    syncManager.initialize(0, Buffer.from([0xa0]));
    syncManager.addRemoteClient(1);
    core = new FakeCore();
    wireRollbackReplay(syncManager, core.hooks);
  });

  it('restores the core to the frame before the rollback target', () => {
    expect(runRollbackScenario()).toBe(true);

    const restores = core.calls.filter((c) => c.type === 'restore');
    expect(restores).toHaveLength(1);
    expect(restores[0].bytes).toEqual([10]); // frame 1's stored state
  });

  it('replays every frame from the target through the current frame', () => {
    runRollbackScenario();

    const types = core.calls.map((c) => c.type);
    // restore happens before any replayed frame, then apply+run per frame
    expect(types.filter((t) => t === 'run')).toHaveLength(4); // frames 2..5
    expect(types.indexOf('restore')).toBeLessThan(types.indexOf('run'));

    // Input is applied before each frame runs
    for (let i = 0; i < types.length - 1; i++) {
      if (types[i] === 'apply') {
        expect(types[i + 1]).toBe('run');
      }
    }
  });

  it('applies the corrected remote input during replay', () => {
    runRollbackScenario();

    const applies = core.calls.filter((c) => c.type === 'apply');
    // Remote client 1 is device 1 -> merged input base index 3
    expect(applies[0].input![3]).toBe(0xff);
  });

  it('stores re-captured states so later rollbacks use corrected history', () => {
    runRollbackScenario();

    // Each replayed frame's ring state must now be the fake core's
    // re-captured state, not the original pre-correction state
    expect(syncManager.getCrcForFrame(2)).toBe(crc32(core.captured[0]));
    expect(syncManager.getCrcForFrame(5)).toBe(crc32(core.captured[3]));
  });

  it('brackets the replay with begin and end hooks', () => {
    runRollbackScenario();

    const types = core.calls.map((c) => c.type);
    expect(types[0]).toBe('begin');
    expect(types[types.length - 1]).toBe('end');
  });

  it('passes the previously captured buffer back as the capture scratch', () => {
    runRollbackScenario();

    expect(core.scratchArgs[0]).toBeNull();
    expect(core.scratchArgs[1]).toBe(core.captured[0]);
    expect(core.scratchArgs[2]).toBe(core.captured[1]);
  });

  it('stores the crc basis for re-captured replay states', () => {
    const basisByRun: Buffer[] = [];
    core.hooks.captureCrcBasis = (): Buffer => {
      const basis = Buffer.from([100 + basisByRun.length]);
      basisByRun.push(basis);
      return basis;
    };

    runRollbackScenario();

    // Replayed frame CRCs must hash the same region other peers hash
    expect(syncManager.getCrcForFrame(2)).toBe(crc32(basisByRun[0]));
    expect(syncManager.getCrcForFrame(5)).toBe(crc32(basisByRun[3]));
  });

  it('keeps replaying when state capture fails', () => {
    core.captureReturnsNull = true;

    expect(runRollbackScenario()).toBe(true);
    expect(core.calls.filter((c) => c.type === 'run')).toHaveLength(4);
    // Original (pre-correction) states remain in the ring
    expect(syncManager.getCrcForFrame(2)).toBe(crc32(Buffer.from([11])));
  });
});
