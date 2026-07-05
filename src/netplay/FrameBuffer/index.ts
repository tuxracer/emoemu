/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

/**
 * Frame Buffer Ring for Netplay Rollback
 *
 * Maintains a fixed-size ring buffer of frame states for rollback/replay.
 * Each frame stores:
 * - Serialized core state (savestate)
 * - Local input
 * - Remote input (per client)
 * - CRC32 hash for desync detection
 */

import { DEFAULT_FRAME_BUFFER_SIZE, MAX_INPUT_DEVICES, type FrameState } from '..';
import { crc32 } from '../crc32';

export * from './consts';
import { INPUTS_PER_DEVICE } from './consts';

/**
 * Create a zero-filled number array of the given size.
 */
const createZeroArray = (size: number): number[] => {
  const arr: number[] = [];
  for (let i = 0; i < size; i++) {
    arr.push(0);
  }
  return arr;
};

/**
 * Create an empty frame state for a given frame number.
 */
const createEmptyFrame = (frameNumber: number): FrameState => ({
  frameNumber,
  serializedState: null,
  localInput: createZeroArray(MAX_INPUT_DEVICES * INPUTS_PER_DEVICE),
  remoteInput: new Map(),
  remoteInputReal: new Map(),
  crc: null,
  crcBasis: null,
});

/**
 * FrameBuffer implements a ring buffer for frame history.
 *
 * Frame numbers can grow indefinitely, but the buffer only stores
 * the most recent `capacity` frames. Old frames are overwritten.
 */
export class FrameBuffer {
  private readonly buffer: FrameState[];
  private readonly _capacity: number;

  /**
   * Pooled per-slot state storage. States arrive every frame at a fixed
   * size, so each ring slot owns a reusable backing buffer instead of
   * retaining a caller allocation per frame.
   */
  private readonly stateStorage: Buffer[];

  /** Pooled per-slot storage for the CRC basis (see FrameState.crcBasis) */
  private readonly crcBasisStorage: Buffer[];

  /** Earliest frame number still in the buffer */
  private _oldestFrame: number = 0;

  /** Most recent frame number in the buffer */
  private _newestFrame: number = -1;

  constructor(capacity: number = DEFAULT_FRAME_BUFFER_SIZE) {
    this._capacity = capacity;
    this.buffer = [];
    this.stateStorage = [];
    this.crcBasisStorage = [];

    // Initialize all slots
    for (let i = 0; i < capacity; i++) {
      this.buffer.push(createEmptyFrame(i));
      this.stateStorage.push(Buffer.alloc(0));
      this.crcBasisStorage.push(Buffer.alloc(0));
    }
  }

  /** Buffer capacity (max frames stored) */
  get capacity(): number {
    return this._capacity;
  }

  /** Oldest frame number still available */
  get oldestFrame(): number {
    return this._oldestFrame;
  }

  /** Newest (current) frame number */
  get newestFrame(): number {
    return this._newestFrame;
  }

  /** Number of frames currently stored */
  get size(): number {
    if (this._newestFrame < 0) {
      return 0;
    }
    return Math.min(this._newestFrame - this._oldestFrame + 1, this._capacity);
  }

  /**
   * Get the buffer index for a frame number.
   */
  private indexFor(frameNumber: number): number {
    // Handle negative frame numbers (shouldn't happen but be safe)
    const n = frameNumber < 0 ? 0 : frameNumber;
    return n % this._capacity;
  }

  /**
   * Check if a frame number is within the buffer range.
   */
  hasFrame(frameNumber: number): boolean {
    if (this._newestFrame < 0) {
      return false;
    }
    return frameNumber >= this._oldestFrame && frameNumber <= this._newestFrame;
  }

  /**
   * Get a frame by number. Returns null if not in buffer.
   */
  get(frameNumber: number): FrameState | null {
    if (!this.hasFrame(frameNumber)) {
      return null;
    }
    return this.buffer[this.indexFor(frameNumber)];
  }

  /**
   * Get the current (newest) frame.
   */
  getCurrent(): FrameState | null {
    if (this._newestFrame < 0) {
      return null;
    }
    return this.buffer[this.indexFor(this._newestFrame)];
  }

  /**
   * Advance to the next frame, returning the new frame state.
   * This overwrites the oldest frame if the buffer is full.
   */
  advance(): FrameState {
    this._newestFrame++;

    // Update oldest frame if buffer is full (only when we actually need to overwrite)
    const currentSize = this._newestFrame - this._oldestFrame + 1;
    if (currentSize > this._capacity) {
      this._oldestFrame = this._newestFrame - this._capacity + 1;
    }

    const index = this.indexFor(this._newestFrame);
    const frame = this.buffer[index];

    // Reset the frame for reuse
    frame.frameNumber = this._newestFrame;
    frame.serializedState = null;
    frame.localInput.fill(0);
    frame.remoteInput.clear();
    frame.remoteInputReal.clear();
    frame.crc = null;
    frame.crcBasis = null;

    return frame;
  }

  /**
   * Initialize the buffer at a specific starting frame.
   * Used when syncing with server.
   */
  initializeAt(frameNumber: number): FrameState {
    this._oldestFrame = frameNumber;
    this._newestFrame = frameNumber;

    const index = this.indexFor(frameNumber);
    const frame = this.buffer[index];

    frame.frameNumber = frameNumber;
    frame.serializedState = null;
    frame.localInput.fill(0);
    frame.remoteInput.clear();
    frame.remoteInputReal.clear();
    frame.crc = null;
    frame.crcBasis = null;

    return frame;
  }

  /**
   * Set the serialized state for a frame.
   *
   * Copies into the slot's pooled buffer, so the caller may reuse `state`
   * (e.g. a per-frame serialize scratch buffer) immediately after this
   * returns. The CRC is computed lazily by getCrc().
   *
   * When `crcBasis` is provided (e.g. the core's system RAM), the desync
   * CRC hashes it instead of the full state — some cores normalize a few
   * volatile bytes on savestate load, so full-state CRCs falsely desync
   * any peer that ever loaded a state.
   */
  setState(frameNumber: number, state: Buffer, crcBasis?: Uint8Array): boolean {
    const frame = this.get(frameNumber);
    if (!frame) {
      return false;
    }

    const slot = this.indexFor(frameNumber);
    if (this.stateStorage[slot].length < state.length) {
      this.stateStorage[slot] = Buffer.allocUnsafe(state.length);
    }
    const storage = this.stateStorage[slot];
    state.copy(storage);

    frame.serializedState = storage.subarray(0, state.length);
    frame.crc = null;

    if (crcBasis !== undefined) {
      if (this.crcBasisStorage[slot].length < crcBasis.length) {
        this.crcBasisStorage[slot] = Buffer.allocUnsafe(crcBasis.length);
      }
      this.crcBasisStorage[slot].set(crcBasis);
      frame.crcBasis = this.crcBasisStorage[slot].subarray(0, crcBasis.length);
    } else {
      frame.crcBasis = null;
    }

    return true;
  }

  /**
   * Get the serialized state for a frame.
   */
  getState(frameNumber: number): Buffer | null {
    const frame = this.get(frameNumber);
    return frame?.serializedState ?? null;
  }

  /**
   * Set local input for the current frame.
   * Input is an array of values: [joypad, analogLeft, analogRight] per device.
   */
  setLocalInput(input: number[]): boolean {
    const frame = this.getCurrent();
    if (!frame) {
      return false;
    }
    const len = Math.min(input.length, frame.localInput.length);
    for (let i = 0; i < len; i++) {
      frame.localInput[i] = input[i];
    }
    return true;
  }

  /**
   * Set local input for a specific device on the current frame.
   */
  setLocalInputForDevice(
    deviceIndex: number,
    joypad: number,
    analogLeft: number = 0,
    analogRight: number = 0
  ): boolean {
    const frame = this.getCurrent();
    if (!frame || deviceIndex >= MAX_INPUT_DEVICES) {
      return false;
    }
    const base = deviceIndex * INPUTS_PER_DEVICE;
    frame.localInput[base] = joypad;
    frame.localInput[base + 1] = analogLeft;
    frame.localInput[base + 2] = analogRight;
    return true;
  }

  /**
   * Set remote input for a specific client and frame.
   * Returns true if this was new real input (not just an update).
   */
  setRemoteInput(
    frameNumber: number,
    clientId: number,
    input: number[],
    isReal: boolean = true
  ): boolean {
    const frame = this.get(frameNumber);
    if (!frame) {
      return false;
    }

    const wasReal = frame.remoteInputReal.get(clientId) ?? false;
    frame.remoteInput.set(clientId, [...input]);
    frame.remoteInputReal.set(clientId, isReal);

    // Return true if this is new real input
    return isReal && !wasReal;
  }

  /**
   * Get remote input for a client at a specific frame.
   * Returns null if not available.
   */
  getRemoteInput(frameNumber: number, clientId: number): number[] | null {
    const frame = this.get(frameNumber);
    return frame?.remoteInput.get(clientId) ?? null;
  }

  /**
   * Check if remote input for a client at a frame is real (not simulated).
   */
  isRemoteInputReal(frameNumber: number, clientId: number): boolean {
    const frame = this.get(frameNumber);
    return frame?.remoteInputReal.get(clientId) ?? false;
  }

  /**
   * Get the CRC32 for a frame's state.
   *
   * Computed on demand and cached: CRCs are only consumed every
   * crcCheckInterval frames, so hashing every stored state eagerly
   * would waste a full-buffer pass per frame.
   */
  getCrc(frameNumber: number): number | null {
    const frame = this.get(frameNumber);
    if (!frame) {
      return null;
    }
    if (frame.crc === null && frame.serializedState !== null) {
      frame.crc = crc32(frame.crcBasis ?? frame.serializedState);
    }
    return frame.crc;
  }

  /**
   * Find the earliest frame that has real remote input from all specified clients.
   * Used to determine the "other" sync point.
   */
  findSyncFrame(clientIds: number[]): number | null {
    if (clientIds.length === 0 || this._newestFrame < 0) {
      return this._newestFrame >= 0 ? this._newestFrame : null;
    }

    // Search backwards from newest to find last fully synced frame
    for (let f = this._newestFrame; f >= this._oldestFrame; f--) {
      const frame = this.get(f);
      if (!frame) {
        continue;
      }

      let allReal = true;
      for (const clientId of clientIds) {
        if (!frame.remoteInputReal.get(clientId)) {
          allReal = false;
          break;
        }
      }

      if (allReal) {
        return f;
      }
    }

    return null;
  }

  /**
   * Find the first frame where we have simulated (not real) input for any client.
   * This is the "unread" frame - first frame with incomplete data.
   */
  findUnreadFrame(clientIds: number[]): number | null {
    if (clientIds.length === 0 || this._newestFrame < 0) {
      return null;
    }

    // Search forward from oldest to find first frame with simulated input
    for (let f = this._oldestFrame; f <= this._newestFrame; f++) {
      const frame = this.get(f);
      if (!frame) {
        continue;
      }

      for (const clientId of clientIds) {
        if (!frame.remoteInputReal.get(clientId)) {
          return f;
        }
      }
    }

    // All frames have real input
    return null;
  }

  /**
   * Clear all frames and reset the buffer.
   */
  clear(): void {
    this._oldestFrame = 0;
    this._newestFrame = -1;
    for (let i = 0; i < this._capacity; i++) {
      const frame = this.buffer[i];
      frame.frameNumber = i;
      frame.serializedState = null;
      frame.localInput.fill(0);
      frame.remoteInput.clear();
      frame.remoteInputReal.clear();
      frame.crc = null;
      frame.crcBasis = null;
    }
  }
}

/**
 * Create a new frame buffer with the specified capacity.
 */
export const createFrameBuffer = (capacity: number = DEFAULT_FRAME_BUFFER_SIZE): FrameBuffer => {
  return new FrameBuffer(capacity);
};
