import { describe, it, expect, beforeEach } from 'vitest';
import { InputBuffer, createInputBuffer } from '.';
import { MAX_INPUT_DEVICES } from '..';

describe('InputBuffer', () => {
  let inputBuffer: InputBuffer;

  beforeEach(() => {
    inputBuffer = createInputBuffer();
    inputBuffer.initialize(0, 2); // Client 0, 2 frame delay
  });

  describe('initialization', () => {
    it('should set local client ID and delay', () => {
      expect(inputBuffer.localClientId).toBe(0);
      expect(inputBuffer.inputDelayFrames).toBe(2);
    });

    it('should auto-register local client', () => {
      expect(inputBuffer.getClientIds()).toContain(0);
    });

    it('should clamp delay to max', () => {
      inputBuffer.initialize(0, 100);
      expect(inputBuffer.inputDelayFrames).toBeLessThanOrEqual(16);
    });
  });

  describe('client registration', () => {
    it('should register new clients', () => {
      inputBuffer.registerClient(1);
      inputBuffer.registerClient(2);
      expect(inputBuffer.getClientIds()).toContain(1);
      expect(inputBuffer.getClientIds()).toContain(2);
    });

    it('should not duplicate clients', () => {
      inputBuffer.registerClient(1);
      inputBuffer.registerClient(1);
      const ids = inputBuffer.getClientIds().filter((id) => id === 1);
      expect(ids.length).toBe(1);
    });

    it('should unregister clients', () => {
      inputBuffer.registerClient(1);
      inputBuffer.unregisterClient(1);
      expect(inputBuffer.getClientIds()).not.toContain(1);
    });

    it('should return only remote client IDs', () => {
      inputBuffer.registerClient(1);
      inputBuffer.registerClient(2);
      const remoteIds = inputBuffer.getRemoteClientIds();
      expect(remoteIds).toContain(1);
      expect(remoteIds).toContain(2);
      expect(remoteIds).not.toContain(0); // Local client
    });
  });

  describe('local input delay queue', () => {
    it('should queue input with delay', () => {
      const targetFrame = inputBuffer.queueLocalInput(10, [0xff]);
      expect(targetFrame).toBe(12); // 10 + 2 frame delay
    });

    it('should retrieve delayed input', () => {
      inputBuffer.queueLocalInput(10, [0xaa, 0xbb]);
      const input = inputBuffer.getDelayedLocalInput(12);
      expect(input).toEqual([0xaa, 0xbb]);
    });

    it('should return null for unavailable input', () => {
      expect(inputBuffer.getDelayedLocalInput(100)).toBeNull();
    });

    it('should prune old entries', () => {
      inputBuffer.queueLocalInput(10, [1]);
      inputBuffer.queueLocalInput(11, [2]);
      inputBuffer.queueLocalInput(12, [3]);

      inputBuffer.pruneDelayQueue(13);

      expect(inputBuffer.getDelayedLocalInput(12)).toBeNull();
      expect(inputBuffer.getDelayedLocalInput(14)).toEqual([3]);
    });
  });

  describe('remote input', () => {
    it('should record remote input', () => {
      inputBuffer.registerClient(1);
      inputBuffer.recordRemoteInput(1, 10, [0xab, 0xcd]);

      expect(inputBuffer.getLastRealInputFrame(1)).toBe(10);
    });

    it('should auto-register unknown clients', () => {
      inputBuffer.recordRemoteInput(99, 5, [1, 2, 3]);
      expect(inputBuffer.getClientIds()).toContain(99);
    });

    it('should update last input on record', () => {
      inputBuffer.registerClient(1);
      inputBuffer.recordRemoteInput(1, 10, [0x11]);
      inputBuffer.recordRemoteInput(1, 11, [0x22]);

      const { input } = inputBuffer.getInputForClient(1, 11, true);
      expect(input[0]).toBe(0x22);
    });
  });

  describe('input prediction', () => {
    it('should return real input when available', () => {
      inputBuffer.registerClient(1);
      inputBuffer.recordRemoteInput(1, 10, [0xaa]);

      const result = inputBuffer.getInputForClient(1, 10, true);
      expect(result.isReal).toBe(true);
      expect(result.input[0]).toBe(0xaa);
    });

    it('should predict when real input not available', () => {
      inputBuffer.registerClient(1);
      inputBuffer.recordRemoteInput(1, 10, [0xbb]);

      const result = inputBuffer.getInputForClient(1, 15, false);
      expect(result.isReal).toBe(false);
      // Should repeat last known input
      expect(result.input[0]).toBe(0xbb);
    });

    it('should return zeros for unknown client', () => {
      const result = inputBuffer.getInputForClient(999, 10, false);
      expect(result.isReal).toBe(false);
      expect(result.input[0]).toBe(0);
    });
  });

  describe('device input', () => {
    it('should set and get device input', () => {
      inputBuffer.setDeviceInput(0, 1, 0xff, 0x1234, 0x5678);

      const device = inputBuffer.getDeviceInput(0, 1);
      expect(device).not.toBeNull();
      expect(device!.joypad).toBe(0xff);
      expect(device!.analogLeft).toBe(0x1234);
      expect(device!.analogRight).toBe(0x5678);
    });

    it('should return null for out of range device', () => {
      expect(inputBuffer.getDeviceInput(0, MAX_INPUT_DEVICES)).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      inputBuffer.registerClient(1);
      inputBuffer.registerClient(2);
      inputBuffer.queueLocalInput(10, [1]);

      inputBuffer.clear();

      expect(inputBuffer.getClientIds()).toHaveLength(0);
      expect(inputBuffer.getDelayedLocalInput(12)).toBeNull();
    });
  });
});
