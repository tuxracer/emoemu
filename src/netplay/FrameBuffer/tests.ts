import { describe, it, expect, beforeEach } from 'vitest';
import { FrameBuffer, createFrameBuffer } from '.';
import { crc32 } from '../crc32';
import { DEFAULT_FRAME_BUFFER_SIZE, MAX_INPUT_DEVICES } from '..';

describe('FrameBuffer', () => {
  let buffer: FrameBuffer;

  beforeEach(() => {
    buffer = createFrameBuffer(10); // Small buffer for testing
  });

  describe('initialization', () => {
    it('should create buffer with specified capacity', () => {
      expect(buffer.capacity).toBe(10);
    });

    it('should start empty', () => {
      expect(buffer.size).toBe(0);
      expect(buffer.newestFrame).toBe(-1);
    });

    it('should use default capacity if not specified', () => {
      const defaultBuffer = createFrameBuffer();
      expect(defaultBuffer.capacity).toBe(DEFAULT_FRAME_BUFFER_SIZE);
    });
  });

  describe('advance', () => {
    it('should advance to first frame', () => {
      const frame = buffer.advance();
      expect(frame.frameNumber).toBe(0);
      expect(buffer.newestFrame).toBe(0);
      expect(buffer.size).toBe(1);
    });

    it('should advance multiple frames', () => {
      for (let i = 0; i < 5; i++) {
        buffer.advance();
      }
      expect(buffer.newestFrame).toBe(4);
      expect(buffer.oldestFrame).toBe(0);
      expect(buffer.size).toBe(5);
    });

    it('should wrap around when exceeding capacity', () => {
      for (let i = 0; i < 15; i++) {
        buffer.advance();
      }
      expect(buffer.newestFrame).toBe(14);
      expect(buffer.oldestFrame).toBe(5);
      expect(buffer.size).toBe(10);
    });

    it('should reset frame state on reuse', () => {
      const frame1 = buffer.advance();
      frame1.serializedState = Buffer.from([1, 2, 3]);
      frame1.crc = 12345;

      // Advance past capacity to reuse slot
      for (let i = 0; i < 10; i++) {
        buffer.advance();
      }

      // Frame 10 should be in slot 0, which was frame 0
      const frame10 = buffer.get(10);
      expect(frame10).not.toBeNull();
      expect(frame10!.serializedState).toBeNull();
      expect(frame10!.crc).toBeNull();
    });
  });

  describe('get', () => {
    it('should return null for frame not in buffer', () => {
      expect(buffer.get(0)).toBeNull();
      expect(buffer.get(100)).toBeNull();
    });

    it('should return frame by number', () => {
      buffer.advance();
      buffer.advance();
      const frame = buffer.get(1);
      expect(frame).not.toBeNull();
      expect(frame!.frameNumber).toBe(1);
    });

    it('should return null for expired frame', () => {
      for (let i = 0; i < 15; i++) {
        buffer.advance();
      }
      expect(buffer.get(0)).toBeNull();
      expect(buffer.get(4)).toBeNull();
      expect(buffer.get(5)).not.toBeNull();
    });
  });

  describe('getCurrent', () => {
    it('should return null when empty', () => {
      expect(buffer.getCurrent()).toBeNull();
    });

    it('should return newest frame', () => {
      buffer.advance();
      buffer.advance();
      buffer.advance();
      const current = buffer.getCurrent();
      expect(current).not.toBeNull();
      expect(current!.frameNumber).toBe(2);
    });
  });

  describe('hasFrame', () => {
    it('should return false for empty buffer', () => {
      expect(buffer.hasFrame(0)).toBe(false);
    });

    it('should return true for frames in range', () => {
      for (let i = 0; i < 5; i++) {
        buffer.advance();
      }
      expect(buffer.hasFrame(0)).toBe(true);
      expect(buffer.hasFrame(4)).toBe(true);
    });

    it('should return false for frames outside range', () => {
      for (let i = 0; i < 5; i++) {
        buffer.advance();
      }
      expect(buffer.hasFrame(5)).toBe(false);
      expect(buffer.hasFrame(-1)).toBe(false);
    });
  });

  describe('state management', () => {
    it('should set and get state', () => {
      buffer.advance();
      const state = Buffer.from([1, 2, 3, 4, 5]);
      expect(buffer.setState(0, state)).toBe(true);
      expect(buffer.getState(0)).toEqual(state);
    });

    it('should compute CRC when setting state', () => {
      buffer.advance();
      const state = Buffer.from('test state');
      buffer.setState(0, state);
      const crc = buffer.getCrc(0);
      expect(crc).not.toBeNull();
      expect(crc).toBe(crc32(state));
    });

    it('should return false when setting state for invalid frame', () => {
      expect(buffer.setState(0, Buffer.alloc(0))).toBe(false);
    });

    it('should store a copy so the caller can reuse its buffer', () => {
      buffer.advance();
      const scratch = Buffer.from([1, 2, 3, 4, 5]);
      buffer.setState(0, scratch);

      scratch.fill(0xff); // caller reuses the buffer for the next frame

      expect([...buffer.getState(0)!]).toEqual([1, 2, 3, 4, 5]);
    });

    it('should defer CRC computation until getCrc is called', () => {
      buffer.advance();
      const state = Buffer.from('expensive state');
      buffer.setState(0, state);

      // Not computed as part of setState (it's only consumed every
      // crcCheckInterval frames)
      expect(buffer.get(0)!.crc).toBeNull();

      expect(buffer.getCrc(0)).toBe(crc32(state));
      // Cached after first computation
      expect(buffer.get(0)!.crc).toBe(crc32(state));
    });

    it('should not serve a stale CRC after the state is replaced', () => {
      buffer.advance();
      buffer.setState(0, Buffer.from('first'));
      expect(buffer.getCrc(0)).toBe(crc32(Buffer.from('first')));

      buffer.setState(0, Buffer.from('second'));
      expect(buffer.getCrc(0)).toBe(crc32(Buffer.from('second')));
    });

    it('should handle state size changes on the same slot', () => {
      buffer.advance();
      buffer.setState(0, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
      buffer.setState(0, Buffer.from([9, 9, 9]));

      const state = buffer.getState(0)!;
      expect(state.length).toBe(3);
      expect([...state]).toEqual([9, 9, 9]);
    });

    it('should compute the CRC from the crc basis when provided', () => {
      // Some cores (mGBA) normalize a few volatile bytes on savestate load,
      // so desync CRCs hash a stable region (work RAM) instead of the
      // full state when the caller provides one
      buffer.advance();
      const state = Buffer.from('full state with volatile latch bytes');
      const basis = Buffer.from('stable work ram');
      buffer.setState(0, state, basis);
      expect(buffer.getCrc(0)).toBe(crc32(basis));
      expect(buffer.getCrc(0)).not.toBe(crc32(state));
      // The full state is still stored for rollback restores
      expect([...buffer.getState(0)!]).toEqual([...state]);
    });

    it('should store a copy of the crc basis so the caller can reuse its buffer', () => {
      buffer.advance();
      const basis = Buffer.from([1, 2, 3]);
      buffer.setState(0, Buffer.from('state'), basis);
      basis.fill(0xff);
      expect(buffer.getCrc(0)).toBe(crc32(Buffer.from([1, 2, 3])));
    });

    it('should fall back to hashing the state when a new write has no basis', () => {
      buffer.advance();
      buffer.setState(0, Buffer.from('one'), Buffer.from('basis'));
      buffer.setState(0, Buffer.from('two'));
      expect(buffer.getCrc(0)).toBe(crc32(Buffer.from('two')));
    });

    it('should isolate state between slots as the ring wraps', () => {
      // capacity is 10 (beforeEach); frame 0 and frame 10 share a slot
      buffer.advance();
      buffer.setState(0, Buffer.from('frame zero'));

      for (let f = 1; f <= 10; f++) {
        buffer.advance();
      }
      buffer.setState(10, Buffer.from('frame ten!'));

      expect(buffer.getState(0)).toBeNull(); // expired
      expect([...buffer.getState(10)!]).toEqual([...Buffer.from('frame ten!')]);
      expect(buffer.getCrc(10)).toBe(crc32(Buffer.from('frame ten!')));
    });
  });

  describe('local input', () => {
    it('should set local input for current frame', () => {
      buffer.advance();
      const input = [0xff, 0x1234, 0x5678];
      expect(buffer.setLocalInput(input)).toBe(true);

      const frame = buffer.getCurrent();
      expect(frame!.localInput[0]).toBe(0xff);
      expect(frame!.localInput[1]).toBe(0x1234);
      expect(frame!.localInput[2]).toBe(0x5678);
    });

    it('should set input for specific device', () => {
      buffer.advance();
      expect(buffer.setLocalInputForDevice(1, 0xabcd, 0x1111, 0x2222)).toBe(true);

      const frame = buffer.getCurrent();
      // Device 1 starts at index 3 (device 0 uses indices 0-2)
      expect(frame!.localInput[3]).toBe(0xabcd);
      expect(frame!.localInput[4]).toBe(0x1111);
      expect(frame!.localInput[5]).toBe(0x2222);
    });

    it('should reject device index out of range', () => {
      buffer.advance();
      expect(buffer.setLocalInputForDevice(MAX_INPUT_DEVICES, 0xff)).toBe(false);
    });
  });

  describe('remote input', () => {
    it('should set and get remote input', () => {
      buffer.advance();
      const input = [0xaa, 0xbb, 0xcc];
      buffer.setRemoteInput(0, 1, input, true);

      expect(buffer.getRemoteInput(0, 1)).toEqual(input);
      expect(buffer.isRemoteInputReal(0, 1)).toBe(true);
    });

    it('should track simulated vs real input', () => {
      buffer.advance();
      buffer.setRemoteInput(0, 1, [1, 2, 3], false);
      expect(buffer.isRemoteInputReal(0, 1)).toBe(false);

      buffer.setRemoteInput(0, 1, [4, 5, 6], true);
      expect(buffer.isRemoteInputReal(0, 1)).toBe(true);
    });

    it('should return null for unknown client', () => {
      buffer.advance();
      expect(buffer.getRemoteInput(0, 99)).toBeNull();
    });
  });

  describe('sync frame finding', () => {
    it('should find sync frame with all real input', () => {
      for (let i = 0; i < 5; i++) {
        buffer.advance();
        buffer.setRemoteInput(i, 1, [i], true);
        buffer.setRemoteInput(i, 2, [i], true);
      }

      const syncFrame = buffer.findSyncFrame([1, 2]);
      expect(syncFrame).toBe(4);
    });

    it('should find last frame before simulated input', () => {
      for (let i = 0; i < 5; i++) {
        buffer.advance();
        buffer.setRemoteInput(i, 1, [i], true);
        buffer.setRemoteInput(i, 2, [i], i < 3); // Only real for frames 0-2
      }

      const syncFrame = buffer.findSyncFrame([1, 2]);
      expect(syncFrame).toBe(2);
    });

    it('should return null if no synced frames', () => {
      for (let i = 0; i < 3; i++) {
        buffer.advance();
        buffer.setRemoteInput(i, 1, [i], false);
      }

      const syncFrame = buffer.findSyncFrame([1]);
      expect(syncFrame).toBeNull();
    });
  });

  describe('unread frame finding', () => {
    it('should find first frame with simulated input', () => {
      for (let i = 0; i < 5; i++) {
        buffer.advance();
        buffer.setRemoteInput(i, 1, [i], i < 3);
      }

      const unreadFrame = buffer.findUnreadFrame([1]);
      expect(unreadFrame).toBe(3);
    });

    it('should return null if all frames have real input', () => {
      for (let i = 0; i < 5; i++) {
        buffer.advance();
        buffer.setRemoteInput(i, 1, [i], true);
      }

      const unreadFrame = buffer.findUnreadFrame([1]);
      expect(unreadFrame).toBeNull();
    });
  });

  describe('initializeAt', () => {
    it('should initialize buffer at specific frame', () => {
      const frame = buffer.initializeAt(1000);
      expect(frame.frameNumber).toBe(1000);
      expect(buffer.newestFrame).toBe(1000);
      expect(buffer.oldestFrame).toBe(1000);
    });
  });

  describe('clear', () => {
    it('should reset buffer to empty state', () => {
      for (let i = 0; i < 5; i++) {
        buffer.advance();
      }

      buffer.clear();
      expect(buffer.size).toBe(0);
      expect(buffer.newestFrame).toBe(-1);
    });
  });
});
