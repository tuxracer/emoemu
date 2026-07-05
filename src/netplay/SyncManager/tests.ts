import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncManager, createSyncManager } from '.';
import { DEFAULT_FRAME_BUFFER_SIZE } from '..';
import { crc32 } from '../crc32';

describe('SyncManager', () => {
  let syncManager: SyncManager;

  beforeEach(() => {
    syncManager = createSyncManager({
      localClientId: 0,
      inputDelayFrames: 0,
    });
  });

  describe('initialization', () => {
    it('should create with default config', () => {
      expect(syncManager.selfFrame).toBe(-1);
      expect(syncManager.otherFrame).toBe(-1);
      expect(syncManager.unreadFrame).toBeNull();
      expect(syncManager.inRollback).toBe(false);
    });

    it('should initialize at specific frame', () => {
      const initialState = Buffer.from([1, 2, 3, 4]);
      syncManager.initialize(100, initialState);

      expect(syncManager.selfFrame).toBe(100);
      expect(syncManager.otherFrame).toBe(100);

      const frameBuffer = syncManager.getFrameBuffer();
      expect(frameBuffer.getState(100)).toEqual(initialState);
    });

    it('should use configured frame buffer size', () => {
      const customManager = createSyncManager({
        localClientId: 0,
        frameBufferSize: 64,
      });

      const frameBuffer = customManager.getFrameBuffer();
      expect(frameBuffer.capacity).toBe(64);
    });

    it('should use default frame buffer size', () => {
      const frameBuffer = syncManager.getFrameBuffer();
      expect(frameBuffer.capacity).toBe(DEFAULT_FRAME_BUFFER_SIZE);
    });
  });

  describe('remote client management', () => {
    it('should add remote clients', () => {
      syncManager.addRemoteClient(1);
      syncManager.addRemoteClient(2);

      const remoteIds = syncManager.getRemoteClientIds();
      expect(remoteIds).toContain(1);
      expect(remoteIds).toContain(2);
      expect(remoteIds).not.toContain(0); // Local client
    });

    it('should assign device indices automatically', () => {
      // Local client has device 0
      syncManager.addRemoteClient(1); // Should get device 1
      syncManager.addRemoteClient(2); // Should get device 2

      expect(syncManager.getRemoteClientIds()).toHaveLength(2);
    });

    it('should assign specific device indices', () => {
      syncManager.addRemoteClient(1, [2, 3]);
      expect(syncManager.getRemoteClientIds()).toContain(1);
    });

    it('should remove remote clients', () => {
      syncManager.addRemoteClient(1);
      syncManager.removeRemoteClient(1);

      expect(syncManager.getRemoteClientIds()).not.toContain(1);
    });
  });

  describe('frame advancement', () => {
    beforeEach(() => {
      syncManager.initialize(0);
    });

    it('should advance frame on preFrame', () => {
      const result = syncManager.preFrame([0]);
      expect(result).not.toBeNull();
      expect(result!.shouldStall).toBe(false);
      expect(syncManager.selfFrame).toBe(1);
    });

    it('should return merged input', () => {
      const result = syncManager.preFrame([0xff]);
      expect(result).not.toBeNull();
      expect(result!.input).toBeDefined();
      expect(Array.isArray(result!.input)).toBe(true);
    });

    it('should store state on postFrame', () => {
      syncManager.preFrame([0]);
      const state = Buffer.from([1, 2, 3, 4, 5]);
      syncManager.postFrame(state);

      const frameBuffer = syncManager.getFrameBuffer();
      expect(frameBuffer.getState(1)).toEqual(state);
    });

    it('should compute CRC on postFrame', () => {
      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from([1, 2, 3]));

      expect(syncManager.getCurrentCrc()).not.toBeNull();
    });

    it('should base frame CRCs on the crc basis when provided', () => {
      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from('full state'), Buffer.from('work ram'));

      expect(syncManager.getCurrentCrc()).toBe(crc32(Buffer.from('work ram')));
    });
  });

  describe('remote input', () => {
    beforeEach(() => {
      syncManager.initialize(0);
      syncManager.addRemoteClient(1);
    });

    it('should receive remote input and trigger rollback for past frames', () => {
      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from([1]));

      // Receiving input for a frame we've already run triggers rollback
      const needsRollback = syncManager.receiveRemoteInput(1, 1, [0xaa, 0xbb, 0xcc]);
      expect(needsRollback).toBe(true);
    });

    it('should receive remote input without rollback for future frames', () => {
      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from([1]));

      // Receiving input for a future frame doesn't trigger rollback
      const needsRollback = syncManager.receiveRemoteInput(1, 5, [0xaa, 0xbb, 0xcc]);
      expect(needsRollback).toBe(false);
    });

    it('should record predictions during preFrame so matching late input skips rollback', () => {
      // Real flow: no explicit simulateRemoteInput — preFrame itself must
      // record what it executed with for absent remote input
      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from([1]));

      expect(syncManager.receiveRemoteInput(1, 1, [0, 0, 0])).toBe(false);
      expect(syncManager.performRollbackIfNeeded()).toBe(false);
    });

    it('should not trigger rollback when late input matches the prediction', () => {
      // Run frames with simulated (predicted) remote input — all zeros
      for (let i = 0; i < 3; i++) {
        syncManager.preFrame([i]);
        syncManager.simulateRemoteInput(1);
        syncManager.postFrame(Buffer.from([i]));
      }

      // Real input arrives late but matches what we predicted: the frames
      // we executed are already correct, so re-running them is pointless
      const needsRollback = syncManager.receiveRemoteInput(1, 1, [0, 0, 0]);
      expect(needsRollback).toBe(false);
      expect(syncManager.performRollbackIfNeeded()).toBe(false);
    });

    it('should treat a shorter zero-padded input as matching the prediction', () => {
      for (let i = 0; i < 3; i++) {
        syncManager.preFrame([i]);
        syncManager.simulateRemoteInput(1);
        syncManager.postFrame(Buffer.from([i]));
      }

      // RetroArch may omit trailing zero words
      expect(syncManager.receiveRemoteInput(1, 1, [0])).toBe(false);
    });

    it('should detect rollback needed for late input', () => {
      // Advance a few frames with simulated remote input
      for (let i = 0; i < 3; i++) {
        syncManager.preFrame([i]);
        syncManager.simulateRemoteInput(1);
        syncManager.postFrame(Buffer.from([i]));
      }

      // Now receive real input for frame 1 (late)
      const needsRollback = syncManager.receiveRemoteInput(1, 1, [0xff]);
      expect(needsRollback).toBe(true);
    });

  });

  describe('stall requests', () => {
    it('should clamp a requested stall to the RetroArch maximum', () => {
      syncManager.initialize(0);
      syncManager.requestStall(10_000);

      let stalls = 0;
      while (syncManager.preFrame([0])?.shouldStall === true) {
        stalls++;
        if (stalls > 100) {
          break;
        }
      }
      expect(stalls).toBe(60); // NETPLAY_MAX_REQ_STALL_TIME
    });
  });

  describe('crc verification', () => {
    it('should not verify CRCs for the received initial state frame', () => {
      // The initial frame's state was received from the server, not
      // executed locally, so its CRC basis is unknown — comparing it can
      // only produce a false desync at join
      const desyncFn = vi.fn();
      syncManager.on('desync', desyncFn);

      syncManager.initialize(5, Buffer.from('received state'));
      syncManager.receiveCrcCheck(5, 0xdeadbeef);

      expect(desyncFn).not.toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    beforeEach(() => {
      // Provide initial state so we can rollback to frame 0
      syncManager.initialize(0, Buffer.from([0, 0, 0, 0]));
      syncManager.addRemoteClient(1);
    });

    it('should emit rollback events', () => {
      const rollbackStartFn = vi.fn();
      const rollbackEndFn = vi.fn();
      const runFrameFn = vi.fn();
      const restoreStateFn = vi.fn();

      syncManager.on('rollback-start', rollbackStartFn);
      syncManager.on('rollback-end', rollbackEndFn);
      syncManager.on('run-frame', runFrameFn);
      syncManager.on('restore-state', restoreStateFn);

      // Advance frames with simulated input
      for (let i = 0; i < 5; i++) {
        syncManager.preFrame([i]);
        syncManager.simulateRemoteInput(1);
        syncManager.postFrame(Buffer.from([i, i, i, i]));
      }

      // Receive late input for frame 2
      syncManager.receiveRemoteInput(1, 2, [0xff]);

      // Perform rollback
      const didRollback = syncManager.performRollbackIfNeeded();

      expect(didRollback).toBe(true);
      expect(rollbackStartFn).toHaveBeenCalled();
      expect(rollbackEndFn).toHaveBeenCalled();
      expect(restoreStateFn).toHaveBeenCalled();
      expect(runFrameFn).toHaveBeenCalled();
    });

    it('should not rollback when not needed', () => {
      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from([0]));

      const didRollback = syncManager.performRollbackIfNeeded();
      expect(didRollback).toBe(false);
    });

    it('should update rollback statistics', () => {
      // Advance frames
      for (let i = 0; i < 5; i++) {
        syncManager.preFrame([i]);
        syncManager.simulateRemoteInput(1);
        syncManager.postFrame(Buffer.from([i, i, i, i]));
      }

      // Trigger rollback
      syncManager.receiveRemoteInput(1, 2, [0xff]);
      syncManager.performRollbackIfNeeded();

      const stats = syncManager.statistics;
      expect(stats.rollbackCount).toBe(1);
      expect(stats.totalFramesReplayed).toBeGreaterThan(0);
    });

    it('should set inRollback flag during rollback', () => {
      let wasInRollback = false;

      syncManager.on('run-frame', () => {
        wasInRollback = syncManager.inRollback;
      });

      // Advance frames
      for (let i = 0; i < 3; i++) {
        syncManager.preFrame([i]);
        syncManager.simulateRemoteInput(1);
        syncManager.postFrame(Buffer.from([i, i, i, i]));
      }

      // Trigger rollback
      syncManager.receiveRemoteInput(1, 1, [0xff]);
      syncManager.performRollbackIfNeeded();

      expect(wasInRollback).toBe(true);
      expect(syncManager.inRollback).toBe(false); // Should be false after rollback
    });
  });

  describe('stalling', () => {
    beforeEach(() => {
      syncManager = createSyncManager({
        localClientId: 0,
        maxFramesBehind: 5, // Use smaller value for testing
      });
      syncManager.initialize(0);
      syncManager.addRemoteClient(1);
    });

    it('should stall when too far ahead', () => {
      // Advance frames with simulated input (no real remote input)
      for (let i = 0; i < 6; i++) {
        const result = syncManager.preFrame([i]);
        if (result && !result.shouldStall) {
          syncManager.simulateRemoteInput(1);
          syncManager.postFrame(Buffer.from([i]));
        }
      }

      // Try to advance one more frame
      const result = syncManager.preFrame([99]);
      expect(result).not.toBeNull();
      expect(result!.shouldStall).toBe(true);
    });

    it('should not stall with real input', () => {
      // Provide real remote input for each frame
      for (let i = 0; i < 10; i++) {
        const result = syncManager.preFrame([i]);
        if (result && !result.shouldStall) {
          syncManager.receiveRemoteInput(1, i + 1, [i]);
          syncManager.postFrame(Buffer.from([i]));
        } else {
          break;
        }
      }

      // Should be able to advance
      const result = syncManager.preFrame([10]);
      expect(result).not.toBeNull();
      expect(result!.shouldStall).toBe(false);
    });
  });

  describe('CRC verification', () => {
    beforeEach(() => {
      syncManager = createSyncManager({
        localClientId: 0,
        crcCheckInterval: 5, // Check every 5 frames
      });
      syncManager.initialize(0);
    });

    it('should determine when to send CRC', () => {
      expect(syncManager.shouldSendCrc()).toBe(true); // Frame 0

      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from([1]));
      expect(syncManager.shouldSendCrc()).toBe(false); // Frame 1

      for (let i = 0; i < 4; i++) {
        syncManager.preFrame([i]);
        syncManager.postFrame(Buffer.from([i]));
      }
      expect(syncManager.shouldSendCrc()).toBe(true); // Frame 5
    });

    // Validate CRC checking with one matching comparison first: a mismatch
    // on the very first comparison disables checking (RetroArch semantics)
    const validateCrcs = (): void => {
      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from([1, 2, 3, 4]));
      syncManager.addRemoteClient(1);
      syncManager.receiveRemoteInput(1, 1, [0]);
      syncManager.receiveCrcCheck(1, syncManager.getCrcForFrame(1)!);
    };

    it('should emit desync on CRC mismatch after checks are validated', () => {
      const desyncFn = vi.fn();
      syncManager.on('desync', desyncFn);

      validateCrcs();
      expect(desyncFn).not.toHaveBeenCalled();

      // Receive a wrong CRC for the next frame
      syncManager.receiveCrcCheck(2, 0x12345678);
      syncManager.receiveRemoteInput(1, 2, [0]);
      syncManager.preFrame([1]);
      syncManager.postFrame(Buffer.from([5, 6, 7, 8]));

      expect(desyncFn).toHaveBeenCalled();
    });

    it('should disable CRC checking when the first comparison mismatches', () => {
      // Some cores serialize volatile bytes, so peers with a different CRC
      // basis (e.g. real RetroArch) mismatch on every check. Like
      // RetroArch, treat a first-comparison mismatch as "CRCs don't work"
      // instead of desync-recovering forever.
      const desyncFn = vi.fn();
      syncManager.on('desync', desyncFn);

      syncManager.preFrame([0]);
      syncManager.postFrame(Buffer.from([1, 2, 3, 4]));
      syncManager.addRemoteClient(1);
      syncManager.receiveRemoteInput(1, 1, [0]);

      syncManager.receiveCrcCheck(1, 0xbad0bad0);
      expect(desyncFn).not.toHaveBeenCalled();

      // Checking stays off for the rest of the session
      syncManager.receiveRemoteInput(1, 2, [0]);
      syncManager.preFrame([1]);
      syncManager.postFrame(Buffer.from([5, 6, 7, 8]));
      syncManager.receiveCrcCheck(2, 0xbad1bad1);

      expect(desyncFn).not.toHaveBeenCalled();
    });

    it('should track desync history', () => {
      validateCrcs();

      // Trigger desync on a later frame
      syncManager.receiveCrcCheck(2, 0x12345678);
      syncManager.receiveRemoteInput(1, 2, [0]);
      syncManager.preFrame([1]);
      syncManager.postFrame(Buffer.from([5, 6, 7, 8]));

      const history = syncManager.getDesyncHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].frameNumber).toBe(2);
      expect(history[0].remoteCrc).toBe(0x12345678);
    });

    it('should update desync statistics', () => {
      validateCrcs();

      syncManager.receiveCrcCheck(2, 0xdeadbeef);
      syncManager.receiveRemoteInput(1, 2, [0]);
      syncManager.preFrame([1]);
      syncManager.postFrame(Buffer.from([5, 6, 7, 8]));

      expect(syncManager.statistics.desyncCount).toBe(1);
    });
  });

  describe('input delay', () => {
    it('should apply input delay', () => {
      const delayedManager = createSyncManager({
        localClientId: 0,
        inputDelayFrames: 2,
      });
      delayedManager.initialize(0);

      expect(delayedManager.inputDelayFrames).toBe(2);
    });
  });

  describe('local input for frame', () => {
    beforeEach(() => {
      syncManager.initialize(0);
    });

    it('should return local input for frame', () => {
      syncManager.preFrame([0xaa, 0xbb, 0xcc]);
      syncManager.postFrame(Buffer.from([1]));

      const input = syncManager.getLocalInputForFrame(1);
      expect(input).not.toBeNull();
    });

    it('should return null for unknown frame', () => {
      const input = syncManager.getLocalInputForFrame(999);
      expect(input).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      syncManager.initialize(0);
      syncManager.addRemoteClient(1);

      for (let i = 0; i < 5; i++) {
        syncManager.preFrame([i]);
        syncManager.postFrame(Buffer.from([i]));
      }

      syncManager.reset();

      expect(syncManager.selfFrame).toBe(-1);
      expect(syncManager.otherFrame).toBe(-1);
      expect(syncManager.unreadFrame).toBeNull();
      expect(syncManager.getRemoteClientIds()).toHaveLength(0);
      expect(syncManager.statistics.rollbackCount).toBe(0);
    });
  });
});
