/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

/**
 * Sync Manager for Netplay Rollback
 *
 * Coordinates frame synchronization between local and remote players:
 * - Tracks three key frame pointers: self, other, unread
 * - Detects when rollback is needed
 * - Performs state restoration and replay
 * - Handles desync detection via CRC comparison
 */

import { EventEmitter } from 'events';
import { times, find, flatMap, pipe, map, filter, isDefined } from 'remeda';
import { FrameBuffer } from '../FrameBuffer';
import { InputBuffer } from '../InputBuffer';
import { netplayLogger } from '../netplayLogger';
import {
  TIMING,
  HEX_RADIX,
  MAX_INPUT_DEVICES,
  DEFAULT_FRAME_BUFFER_SIZE,
  MAX_FRAMES_BEHIND,
  MAX_REQUESTED_STALL_FRAMES,
  CATCH_UP_THRESHOLD,
} from '..';

/** Number of input values per device */
const INPUTS_PER_DEVICE = 3;

/** Events emitted by sync manager */
interface SyncManagerEvents {
  /** Rollback is about to start */
  'rollback-start': (fromFrame: number, toFrame: number) => void;
  /** Rollback completed */
  'rollback-end': (framesReplayed: number) => void;
  /** Desync detected */
  desync: (frameNumber: number, localCrc: number, remoteCrc: number) => void;
  /** State capture requested */
  'capture-state': (frameNumber: number) => void;
  /** State restore requested */
  'restore-state': (frameNumber: number, state: Buffer) => void;
  /** Run frame requested (for replay) */
  'run-frame': (frameNumber: number, input: number[]) => void;
}

/** Configuration for sync manager */
export interface SyncManagerConfig {
  /** Frame buffer capacity */
  frameBufferSize?: number;
  /** How often to send CRC checks (frames) */
  crcCheckInterval?: number;
  /** Maximum frames to allow falling behind before stalling */
  maxFramesBehind?: number;
  /** Local client ID */
  localClientId: number;
  /** Input delay frames */
  inputDelayFrames?: number;
  /** Is this the server/host? Servers don't stall waiting for client input */
  isServer?: boolean;
}

/** Desync info for debugging */
export interface DesyncInfo {
  frameNumber: number;
  localCrc: number;
  remoteCrc: number;
  timestamp: number;
}

/**
 * Compare two input arrays, treating missing trailing entries as 0
 * (RetroArch may omit trailing zero words).
 */
const inputsMatch = (a: number[], b: number[]): boolean => {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return false;
    }
  }
  return true;
};

/**
 * SyncManager coordinates rollback netplay synchronization.
 *
 * Frame pointers:
 * - self: Current local frame (may be ahead of confirmed state)
 * - other: Last frame where all input is confirmed real
 * - unread: First frame with missing/simulated remote input
 */
export class SyncManager extends EventEmitter {
  private readonly frameBuffer: FrameBuffer;
  private readonly inputBuffer: InputBuffer;
  private readonly config: Required<SyncManagerConfig>;

  /** Current local frame number (input read position - frame we're preparing input for) */
  private _selfFrame: number = -1;

  /** Last completed frame (execution position - frame that has finished running) */
  private _runFrame: number = -1;

  /** Last fully synchronized frame */
  private _otherFrame: number = -1;

  /** First frame with incomplete input */
  private _unreadFrame: number | null = null;

  /** Remote client IDs we're tracking */
  private remoteClients: Set<number> = new Set();

  /** Map of client ID to their assigned device indices */
  private clientDeviceMap: Map<number, number[]> = new Map();

  /** Pending CRC checks from remote (frame -> crc) */
  private remoteCrcChecks: Map<number, number> = new Map();

  /**
   * CRC checking is trusted until proven useless. Peers with a different
   * CRC basis (e.g. a frontend hashing the full state while we hash system
   * RAM, or a core that serializes volatile bytes) mismatch on every
   * check — like RetroArch, a mismatch on the very first comparison marks
   * CRCs as invalid and disables checking instead of desync-recovering
   * forever. A first comparison that matches proves the basis agrees.
   */
  private crcsValid = true;
  private crcValidityChecked = false;

  /** Recent desync history for debugging */
  private desyncHistory: DesyncInfo[] = [];

  /** Are we currently in a rollback? */
  private _inRollback: boolean = false;

  /** Frame number we need to rollback to (-1 if none) */
  private rollbackTarget: number = -1;

  /** Server-requested stall frames remaining */
  private requestedStallFrames: number = 0;

  /** Latest frame number received from any remote client (for catch-up detection) */
  private _latestRemoteFrame: number = -1;

  /** Initial sync frame (frames at or before this don't need remote input) */
  private _initialFrame: number = -1;

  /**
   * Track the "sync gap end" per client - the frame number of the first INPUT received.
   * Frames from (_initialFrame + 1) to (syncGapEnd - 1) are in the "sync gap" and
   * should be considered as having real (empty) input from this client.
   * This handles the case where INPUT arrives before those frames exist in the buffer.
   */
  private syncGapEnd: Map<number, number> = new Map();

  /**
   * Per-client read frame tracking (similar to RetroArch's read_frame_count[]).
   * Tracks the next frame we need real input for from each client.
   * This enables O(C) sync pointer updates instead of O(B×C) buffer scans.
   */
  private readFramePerClient: Map<number, number> = new Map();

  /**
   * Pending remote input for frames that don't exist yet.
   * Map<frameNumber, Map<clientId, { input: number[], isReal: boolean }>>
   * When frames are created, pending input is applied automatically.
   */
  private pendingRemoteInput: Map<number, Map<number, { input: number[]; isReal: boolean }>> = new Map();

  /**
   * Pre-allocated buffer for merged input (avoids per-frame allocation).
   * Reused each frame - callers must copy if they need to retain the data.
   */
  private readonly mergedInputBuffer: number[];

  /** Statistics */
  private stats = {
    rollbackCount: 0,
    totalFramesReplayed: 0,
    desyncCount: 0,
  };

  constructor(config: SyncManagerConfig) {
    super();

    this.config = {
      frameBufferSize: config.frameBufferSize ?? DEFAULT_FRAME_BUFFER_SIZE,
      crcCheckInterval: config.crcCheckInterval ?? TIMING.CRC_CHECK_INTERVAL_FRAMES,
      maxFramesBehind: config.maxFramesBehind ?? MAX_FRAMES_BEHIND,
      localClientId: config.localClientId,
      inputDelayFrames: config.inputDelayFrames ?? 0,
      isServer: config.isServer ?? false,
    };

    this.frameBuffer = new FrameBuffer(this.config.frameBufferSize);
    this.inputBuffer = new InputBuffer();
    this.inputBuffer.initialize(this.config.localClientId, this.config.inputDelayFrames);

    // Pre-allocate merged input buffer (reused each frame)
    this.mergedInputBuffer = new Array<number>(MAX_INPUT_DEVICES * INPUTS_PER_DEVICE).fill(0);

    // Local client controls device 0 by default
    this.clientDeviceMap.set(this.config.localClientId, [0]);
  }

  /** Current local frame number */
  get selfFrame(): number {
    return this._selfFrame;
  }

  /** Last completed frame (execution position) */
  get runFrame(): number {
    return this._runFrame;
  }

  /** Last fully synchronized frame (all input confirmed) */
  get otherFrame(): number {
    return this._otherFrame;
  }

  /** First frame with missing remote input */
  get unreadFrame(): number | null {
    return this._unreadFrame;
  }

  /** Are we currently performing a rollback? */
  get inRollback(): boolean {
    return this._inRollback;
  }

  /** Input delay in frames */
  get inputDelayFrames(): number {
    return this.config.inputDelayFrames;
  }

  /** Get rollback statistics */
  get statistics(): Readonly<typeof this.stats> {
    return this.stats;
  }

  /** Get the frame buffer (for external state access) */
  getFrameBuffer(): FrameBuffer {
    return this.frameBuffer;
  }

  /** Get the input buffer */
  getInputBuffer(): InputBuffer {
    return this.inputBuffer;
  }

  /**
   * Request a stall for a specific number of frames.
   * Called when server sends STALL command to throttle a fast client.
   */
  requestStall(frames: number): void {
    // Add to existing stall frames (don't overwrite if already stalling),
    // clamped to the RetroArch maximum so a bogus request can't freeze us
    this.requestedStallFrames = Math.min(
      this.requestedStallFrames + frames,
      MAX_REQUESTED_STALL_FRAMES
    );
  }

  /**
   * Initialize sync manager at a specific starting frame.
   * Called when syncing with server or starting fresh.
   */
  initialize(startFrame: number, initialState?: Buffer): void {
    this._selfFrame = startFrame;
    this._runFrame = startFrame;  // Both counters start at same frame
    this._otherFrame = startFrame;
    this._unreadFrame = null;
    this.rollbackTarget = -1;
    this._inRollback = false;
    this._initialFrame = startFrame;
    this.requestedStallFrames = 0;
    this.syncGapEnd.clear();
    this.pendingRemoteInput.clear();
    this.readFramePerClient.clear();

    this.frameBuffer.initializeAt(startFrame);

    if (initialState) {
      this.frameBuffer.setState(startFrame, initialState);
    }

    // Mark initial frame as synced for all existing remote clients
    // and initialize per-client read frame tracking
    for (const clientId of this.remoteClients) {
      this.frameBuffer.setRemoteInput(startFrame, clientId, [], true);
      // Next frame we need real input for is startFrame + 1
      this.readFramePerClient.set(clientId, startFrame + 1);
    }

    this.remoteCrcChecks.clear();
    this.desyncHistory = [];
  }

  /**
   * Register a remote client for input tracking.
   */
  addRemoteClient(clientId: number, deviceIndices: number[] = []): void {
    this.remoteClients.add(clientId);
    this.inputBuffer.registerClient(clientId, false);

    // Assign device indices (default to next available)
    if (deviceIndices.length === 0) {
      const usedDevices = new Set(
        flatMap([...this.clientDeviceMap.values()], (devices) => devices)
      );
      const firstUnused = find(times(MAX_INPUT_DEVICES, (i) => i), (i) => !usedDevices.has(i));
      if (firstUnused !== undefined) {
        deviceIndices = [firstUnused];
      }
    }

    this.clientDeviceMap.set(clientId, deviceIndices);

    // Mark initial frame as synced for this client (initial state doesn't need input)
    if (this._initialFrame >= 0) {
      this.frameBuffer.setRemoteInput(this._initialFrame, clientId, [], true);
      // Initialize per-client read frame to initial frame + 1 (next frame we need input for)
      this.readFramePerClient.set(clientId, this._initialFrame + 1);
    } else {
      // No initial frame yet, will be set when initialize() is called
      this.readFramePerClient.set(clientId, 0);
    }
  }

  /**
   * Remove a remote client.
   */
  removeRemoteClient(clientId: number): void {
    this.remoteClients.delete(clientId);
    this.inputBuffer.unregisterClient(clientId);
    this.clientDeviceMap.delete(clientId);
    this.readFramePerClient.delete(clientId);
    this.syncGapEnd.delete(clientId);
  }

  /**
   * Update the local client ID.
   * Called when MODE command assigns our client number.
   * This must be called BEFORE updateLocalDevices to avoid conflicts
   * with remote clients that may share the old ID.
   *
   * @param clientId The client ID assigned by the server
   */
  updateLocalClientId(clientId: number): void {
    const oldId = this.config.localClientId;

    // Copy device mapping from old ID to new ID
    const oldDevices = this.clientDeviceMap.get(oldId);
    if (oldDevices) {
      // Only delete the old mapping if it's not used by a remote client
      // (e.g., server is client 0, and we were also using 0 temporarily)
      if (!this.remoteClients.has(oldId)) {
        this.clientDeviceMap.delete(oldId);
      }
      this.clientDeviceMap.set(clientId, [...oldDevices]);
    }

    // Update the config (cast to mutable to update)
    (this.config as { localClientId: number }).localClientId = clientId;

    // Update input buffer's local client ID
    this.inputBuffer.updateLocalClientId(clientId);
  }

  /**
   * Update the local client's device mapping.
   * Called when MODE command assigns a device to us.
   *
   * @param deviceBitmap Bitmask of device indices this client controls
   */
  updateLocalDevices(deviceBitmap: number): void {
    // Extract device indices from bitmap
    const devices: number[] = [];
    for (let i = 0; i < MAX_INPUT_DEVICES; i++) {
      if ((deviceBitmap & (1 << i)) !== 0) {
        devices.push(i);
      }
    }

    // If no devices set in bitmap, default to device 0
    if (devices.length === 0) {
      devices.push(0);
    }

    this.clientDeviceMap.set(this.config.localClientId, devices);
  }

  /**
   * Get all remote client IDs.
   */
  getRemoteClientIds(): number[] {
    return Array.from(this.remoteClients);
  }

  /**
   * Called before running a frame.
   * Sets up input and checks if we need to rollback.
   *
   * Returns the merged input to use for this frame, or null if we should stall.
   * shouldCatchUp indicates the client is behind and should disable frame limiter.
   */
  preFrame(localInput: number[]): { input: number[]; shouldStall: boolean; shouldCatchUp: boolean } | null {
    // Queue local input with delay
    this.inputBuffer.queueLocalInput(this._selfFrame + 1, localInput);

    // Check for server-requested stall (STALL command)
    if (this.requestedStallFrames > 0) {
      this.requestedStallFrames--;
      return { input: [], shouldStall: true, shouldCatchUp: false };
    }

    // Check if we're too far ahead of unread (clients only - servers don't stall)
    // Servers are authoritative and continue running regardless of client input
    if (!this.config.isServer && this._unreadFrame !== null) {
      const framesBehind = this._selfFrame + 1 - this._unreadFrame;
      if (framesBehind > this.config.maxFramesBehind) {
        return { input: [], shouldStall: true, shouldCatchUp: false };
      }
    }

    // Advance to next frame
    this._selfFrame++;
    const frame = this.frameBuffer.advance();

    // Apply any pending remote input for this frame
    this.applyPendingInput(this._selfFrame);

    // Record predictions for clients whose real input hasn't arrived, so
    // when it does arrive late we can compare it against what we actually
    // executed with and skip the rollback if the prediction was right
    for (const clientId of this.remoteClients) {
      if (this.frameBuffer.getRemoteInput(this._selfFrame, clientId) === null) {
        this.simulateRemoteInput(clientId);
      }
    }

    // Get delayed local input for this frame (if available)
    const delayedLocal = this.inputBuffer.getDelayedLocalInput(this._selfFrame);
    if (delayedLocal) {
      frame.localInput = [...delayedLocal];
    }

    // Build merged input from all clients
    // buildMergedInput returns a reference to internal buffer, so we copy
    const merged = this.buildMergedInput(this._selfFrame);
    const inputCopy = [...merged];
    frame.localInput = inputCopy;

    // Check if we're behind remote and should catch up (disable frame limiter)
    // This allows smooth fast-forward instead of stuttery pause/resume cycles
    const shouldCatchUp = this._latestRemoteFrame - this._selfFrame > CATCH_UP_THRESHOLD;

    return { input: inputCopy, shouldStall: false, shouldCatchUp };
  }

  /**
   * Called after running a frame.
   * Captures state and sends CRC if needed.
   */
  postFrame(serializedState: Buffer, crcBasis?: Uint8Array): void {
    // Mark this frame as completed (execution position catches up to read position)
    this._runFrame = this._selfFrame;

    // Store state in frame buffer
    this.frameBuffer.setState(this._selfFrame, serializedState, crcBasis);

    // Prune old local input from delay queue
    this.inputBuffer.pruneDelayQueue(this._selfFrame - this.config.inputDelayFrames);

    // Update sync pointers
    this.updateSyncPointers();

    // Check for CRC verification
    this.checkPendingCrcs();
  }

  /**
   * Receive remote input from a client.
   * Returns true if this triggered a need for rollback.
   */
  receiveRemoteInput(
    clientId: number,
    frameNumber: number,
    input: number[]
  ): boolean {
    // Record the input
    this.inputBuffer.recordRemoteInput(clientId, frameNumber, input);

    // Track latest remote frame for catch-up detection
    if (frameNumber > this._latestRemoteFrame) {
      this._latestRemoteFrame = frameNumber;
    }

    // Track the "sync gap end" when we receive the first INPUT from a client.
    // After LOAD_SAVESTATE, there's typically a 1-3 frame gap where the server
    // doesn't send INPUT. We record where real INPUT starts so we can treat
    // the gap frames as having real (empty) input in isFrameInSyncGap().
    if (!this.syncGapEnd.has(clientId) && this._initialFrame >= 0) {
      this.syncGapEnd.set(clientId, frameNumber);
      // Also try to fill any gap frames that already exist in the buffer
      // For frames that don't exist yet, store as pending
      for (let f = this._initialFrame + 1; f < frameNumber; f++) {
        const stored = this.frameBuffer.setRemoteInput(f, clientId, [], true);
        if (!stored) {
          // Frame doesn't exist yet, store as pending
          this.storePendingInput(f, clientId, [], true);
        }
      }
      // Update per-client read frame to account for sync gap
      // Frames in the gap are considered "read" (real empty input)
      this.readFramePerClient.set(clientId, frameNumber);
    }

    // Capture what we executed with (the prediction) before overwriting it
    const predictedInput = this.frameBuffer.getRemoteInput(frameNumber, clientId);

    // Try to store in frame buffer
    // wasNew is true if this is real input replacing simulated input
    const wasNew = this.frameBuffer.setRemoteInput(frameNumber, clientId, input, true);

    // If frame doesn't exist yet, store as pending for when it's created
    if (!this.frameBuffer.hasFrame(frameNumber)) {
      this.storePendingInput(frameNumber, clientId, input, true);
    }

    // Update per-client read frame tracking (O(1) operation)
    // This tracks the next frame we need real input for from this client
    this.advanceClientReadFrame(clientId, frameNumber);

    // Recalculate global sync pointers from per-client tracking (O(C) operation)
    this.updateSyncPointers();

    if (wasNew && frameNumber <= this._runFrame) {
      // We received real input for a frame we already COMPLETED with simulated input.
      // Use _runFrame (not _selfFrame) to avoid triggering rollback for frames still executing.
      // Only rewind when the prediction was actually WRONG — if the real
      // input matches what we executed with, the frames we ran are already
      // correct and replaying them would be pure waste (RetroArch does the
      // same misprediction check).
      if (predictedInput !== null && inputsMatch(predictedInput, input)) {
        return false;
      }
      if (this.rollbackTarget < 0 || frameNumber < this.rollbackTarget) {
        this.rollbackTarget = frameNumber;
      }
      return true;
    }

    return false;
  }

  /**
   * Advance frame without input data (for NOINPUT command).
   *
   * Used when the server sends NOINPUT to indicate frame advancement
   * without any input data (e.g., when spectating). This marks the frame
   * as synced with empty input to prevent unnecessary stalling.
   *
   * @param clientId The client ID (typically 0 for server)
   * @param frameNumber The frame that has no input
   */
  advanceFrameWithoutInput(clientId: number, frameNumber: number): void {
    // Track latest remote frame for catch-up detection
    if (frameNumber > this._latestRemoteFrame) {
      this._latestRemoteFrame = frameNumber;
    }

    // Mark this frame as having real (empty) input
    const emptyInput: number[] = [];
    this.frameBuffer.setRemoteInput(frameNumber, clientId, emptyInput, true);

    // If frame doesn't exist yet, store as pending
    if (!this.frameBuffer.hasFrame(frameNumber)) {
      this.storePendingInput(frameNumber, clientId, emptyInput, true);
    }

    // Update per-client read frame tracking
    this.advanceClientReadFrame(clientId, frameNumber);

    // Recalculate global sync pointers
    this.updateSyncPointers();
  }

  /**
   * Advance a client's read frame pointer when we receive real input.
   * This enables O(C) sync pointer updates instead of O(B×C) buffer scans.
   *
   * Like RetroArch's read_frame_count[], this tracks the next frame we need
   * real input for from each client.
   */
  private advanceClientReadFrame(clientId: number, frameNumber: number): void {
    const currentReadFrame = this.readFramePerClient.get(clientId) ?? 0;

    // If this input is for the frame we were waiting for, advance to next
    if (frameNumber === currentReadFrame) {
      // Check if we have real input for subsequent frames too (they may have
      // arrived out of order or been stored as pending)
      let nextFrame = frameNumber + 1;
      const newest = this.frameBuffer.newestFrame;

      while (nextFrame <= newest) {
        // Check if we have real input for this frame
        const hasRealInput =
          this.frameBuffer.isRemoteInputReal(nextFrame, clientId) ||
          this.isFrameInSyncGap(nextFrame, clientId) ||
          this.hasPendingRealInput(nextFrame, clientId);

        if (!hasRealInput) {
          break;
        }
        nextFrame++;
      }

      this.readFramePerClient.set(clientId, nextFrame);
    } else if (frameNumber > currentReadFrame) {
      // Input arrived for a future frame (out of order)
      // Don't advance read pointer yet - we're still waiting for currentReadFrame
      // The input will be applied when we catch up
    }
    // If frameNumber < currentReadFrame, this is old input we already processed
  }

  /**
   * Check if we have pending real input for a frame from a client.
   */
  private hasPendingRealInput(frameNumber: number, clientId: number): boolean {
    const framePending = this.pendingRemoteInput.get(frameNumber);
    if (!framePending) {
      return false;
    }
    const clientPending = framePending.get(clientId);
    return clientPending?.isReal ?? false;
  }

  /**
   * Store remote input as pending for a frame that doesn't exist yet.
   */
  private storePendingInput(
    frameNumber: number,
    clientId: number,
    input: number[],
    isReal: boolean
  ): void {
    let framePending = this.pendingRemoteInput.get(frameNumber);
    if (!framePending) {
      framePending = new Map();
      this.pendingRemoteInput.set(frameNumber, framePending);
    }
    framePending.set(clientId, { input: [...input], isReal });
  }

  /**
   * Apply any pending remote input for a frame that now exists.
   */
  private applyPendingInput(frameNumber: number): void {
    const pending = this.pendingRemoteInput.get(frameNumber);
    if (!pending) {
      return;
    }

    for (const [clientId, { input, isReal }] of pending) {
      this.frameBuffer.setRemoteInput(frameNumber, clientId, input, isReal);

      // Advance client read frame if this was real input
      if (isReal) {
        this.advanceClientReadFrame(clientId, frameNumber);
      }
    }

    // Remove applied pending input
    this.pendingRemoteInput.delete(frameNumber);

    // Recalculate sync pointers since we just applied input
    this.updateSyncPointers();
  }

  /**
   * Check if a frame is in the "sync gap" for a client.
   * The sync gap is the range of frames between the initial sync frame and
   * the first INPUT received from a client. These frames should be treated
   * as having real (empty) input from that client.
   */
  isFrameInSyncGap(frameNumber: number, clientId: number): boolean {
    if (this._initialFrame < 0) {
      return false;
    }
    const gapEnd = this.syncGapEnd.get(clientId);
    if (gapEnd === undefined) {
      return false;
    }
    // Frame is in sync gap if it's after initialFrame and before the first INPUT
    return frameNumber > this._initialFrame && frameNumber < gapEnd;
  }

  /**
   * Receive a CRC check from remote for verification.
   */
  receiveCrcCheck(frameNumber: number, remoteCrc: number): void {
    // Try to verify immediately if we have the frame and it's synced
    const localCrc = this.frameBuffer.getCrc(frameNumber);
    if (localCrc !== null && frameNumber <= this._otherFrame) {
      // Can verify now
      this.verifyCrc(frameNumber, remoteCrc);
    } else {
      // Store for later verification
      this.remoteCrcChecks.set(frameNumber, remoteCrc);
    }
  }

  /**
   * Check if rollback is needed and perform it.
   * Returns true if rollback was performed.
   */
  performRollbackIfNeeded(): boolean {
    if (this.rollbackTarget < 0 || this._inRollback) {
      return false;
    }

    const targetFrame = this.rollbackTarget;
    this.rollbackTarget = -1;

    // Find the state to restore (we need the state BEFORE the target frame)
    const restoreFrame = targetFrame - 1;
    const state = this.frameBuffer.getState(restoreFrame);

    if (!state) {
      // Can't rollback - state not available
      // This is a desync situation
      this.emit('desync', targetFrame, 0, 0);
      return false;
    }

    this._inRollback = true;
    const startFrame = this._selfFrame;
    this.emit('rollback-start', restoreFrame, startFrame);

    // Restore state
    this.emit('restore-state', restoreFrame, state);
    this._selfFrame = restoreFrame;

    // Replay frames from restoreFrame+1 to startFrame
    const framesToReplay = startFrame - restoreFrame;
    for (let f = restoreFrame + 1; f <= startFrame; f++) {
      this._selfFrame = f;

      // Get merged input for this frame (now with real remote input)
      // buildMergedInput returns a reference to internal buffer, so we copy
      // to frame.localInput (which we need to store) and for the event
      const input = this.buildMergedInput(f);
      const inputCopy = [...input];

      // Update frame buffer with correct input
      const frame = this.frameBuffer.get(f);
      if (frame) {
        frame.localInput = inputCopy;
      }

      // Run the frame (emit with copy since internal buffer is reused next iteration)
      this.emit('run-frame', f, inputCopy);
    }

    this.stats.rollbackCount++;
    this.stats.totalFramesReplayed += framesToReplay;

    this._inRollback = false;
    this.emit('rollback-end', framesToReplay);

    return true;
  }

  /**
   * Store a re-captured state for a frame that was just replayed.
   * Called by the rollback replay wiring after re-running each frame so
   * the ring holds the corrected history for later rollbacks and CRC checks.
   */
  storeReplayState(frameNumber: number, state: Buffer, crcBasis?: Uint8Array): void {
    this.frameBuffer.setState(frameNumber, state, crcBasis);
  }

  /**
   * Get the CRC for the current frame (for sending to remote).
   */
  getCurrentCrc(): number | null {
    return this.frameBuffer.getCrc(this._selfFrame);
  }

  /**
   * Get the CRC for a specific frame (for verifying against remote CRC).
   */
  getCrcForFrame(frameNumber: number): number | null {
    return this.frameBuffer.getCrc(frameNumber);
  }

  /**
   * Check if we should send a CRC check this frame.
   */
  shouldSendCrc(): boolean {
    if (this._selfFrame < 0) {
      return false;
    }
    return this._selfFrame % this.config.crcCheckInterval === 0;
  }

  /**
   * Get input that should be sent to remote for a frame.
   */
  getLocalInputForFrame(frameNumber: number): number[] | null {
    const frame = this.frameBuffer.get(frameNumber);
    return frame?.localInput ?? null;
  }

  /**
   * Simulate remote input for a client at the current frame.
   * Used when real input hasn't arrived yet.
   */
  simulateRemoteInput(clientId: number): void {
    const { input } = this.inputBuffer.getInputForClient(
      clientId,
      this._selfFrame,
      false
    );
    this.frameBuffer.setRemoteInput(this._selfFrame, clientId, input, false);
  }

  /**
   * Build merged input from all clients for a frame.
   * Returns a reference to the internal buffer - callers must copy if they need to retain.
   */
  private buildMergedInput(frameNumber: number): number[] {
    // Clear the pre-allocated buffer (faster than creating new array)
    const merged = this.mergedInputBuffer;
    for (let i = 0; i < merged.length; i++) {
      merged[i] = 0;
    }

    // Add local input
    const localDevices = this.clientDeviceMap.get(this.config.localClientId) ?? [0];
    const delayedLocal = this.inputBuffer.getDelayedLocalInput(frameNumber);

    for (const deviceIndex of localDevices) {
      if (deviceIndex >= MAX_INPUT_DEVICES) {
        continue;
      }
      const base = deviceIndex * INPUTS_PER_DEVICE;
      if (delayedLocal) {
        merged[base] = delayedLocal[0] ?? 0;
        merged[base + 1] = delayedLocal[1] ?? 0;
        merged[base + 2] = delayedLocal[2] ?? 0;
      }
    }

    // Add remote input
    for (const clientId of this.remoteClients) {
      const devices = this.clientDeviceMap.get(clientId) ?? [];
      const remoteInput = this.frameBuffer.getRemoteInput(frameNumber, clientId);
      const isReal = this.frameBuffer.isRemoteInputReal(frameNumber, clientId);

      // If no real input, use prediction
      const input = remoteInput ?? this.inputBuffer.getInputForClient(clientId, frameNumber, isReal).input;

      for (const deviceIndex of devices) {
        if (deviceIndex >= MAX_INPUT_DEVICES) {
          continue;
        }
        const base = deviceIndex * INPUTS_PER_DEVICE;
        merged[base] = input[0] ?? 0;
        merged[base + 1] = input[1] ?? 0;
        merged[base + 2] = input[2] ?? 0;
      }
    }

    return merged;
  }

  /**
   * Update sync pointers based on per-client read frame tracking.
   * This is O(C) where C is the number of clients, not O(B×C) like before.
   *
   * Similar to RetroArch's netplay_update_unread_ptr(), we compute the global
   * unread frame as the minimum of all per-client read frames.
   */
  private updateSyncPointers(): void {
    const remoteIds = this.getRemoteClientIds();

    if (remoteIds.length === 0 || this._selfFrame < 0) {
      // No remote clients - we're fully synced with ourselves
      this._otherFrame = this._selfFrame;
      this._unreadFrame = null;
      return;
    }

    // Find minimum read frame across all clients (O(C) operation)
    // This is the first frame where we're missing real input from at least one client
    const readFrames = pipe(
      remoteIds,
      map((id) => this.readFramePerClient.get(id)),
      filter(isDefined),
    );
    const minReadFrame = readFrames.length > 0 ? Math.min(...readFrames) : Number.MAX_SAFE_INTEGER;

    if (minReadFrame === Number.MAX_SAFE_INTEGER) {
      // No valid read frames - all clients fully synced
      this._otherFrame = this._selfFrame;
      this._unreadFrame = null;
      return;
    }

    // "other" frame is the last frame where ALL clients have real input
    // This is minReadFrame - 1 (since readFrame is the NEXT frame we need)
    const syncFrame = minReadFrame - 1;
    if (syncFrame >= this._initialFrame) {
      this._otherFrame = syncFrame;
    }

    // "unread" frame is the first frame with missing input
    // This is minReadFrame (the first frame where at least one client is missing)
    // But only if it's within our buffer range and <= selfFrame
    if (minReadFrame <= this._selfFrame && this.frameBuffer.hasFrame(minReadFrame)) {
      this._unreadFrame = minReadFrame;
    } else if (minReadFrame > this._selfFrame) {
      // All remote input is caught up or ahead - no unread frames
      this._unreadFrame = null;
    } else {
      // minReadFrame is before our buffer - this shouldn't happen normally
      // Fall back to null (no stalling)
      this._unreadFrame = null;
    }
  }

  /**
   * Check pending CRC verifications.
   */
  private checkPendingCrcs(): void {
    for (const [frameNumber, remoteCrc] of this.remoteCrcChecks) {
      if (frameNumber <= this._otherFrame) {
        this.verifyCrc(frameNumber, remoteCrc);
        this.remoteCrcChecks.delete(frameNumber);
      }
    }
  }

  /**
   * Verify CRC for a frame.
   */
  private verifyCrc(frameNumber: number, remoteCrc: number): void {
    if (!this.crcsValid) {
      return; // CRCs proven not to work with this peer
    }

    // The initial frame's state was received from the remote, not executed
    // locally — its CRC basis is unknown, so comparing it can only produce
    // a false desync right after joining
    if (frameNumber <= this._initialFrame) {
      return;
    }

    const localCrc = this.frameBuffer.getCrc(frameNumber);
    if (localCrc === null) {
      return; // Don't have state for this frame yet
    }

    if (localCrc === remoteCrc) {
      this.crcValidityChecked = true;
      return;
    }

    // A mismatch before any comparison has ever matched means the peer's
    // CRC basis simply disagrees with ours — disable checking
    if (!this.crcValidityChecked) {
      this.crcsValid = false;
      netplayLogger.warn('SYNC', 'First CRC check mismatched — disabling CRC checks for this session', {
        frame: frameNumber,
        localCrc: localCrc.toString(HEX_RADIX),
        remoteCrc: remoteCrc.toString(HEX_RADIX),
      });
      return;
    }

    this.stats.desyncCount++;
    this.desyncHistory.push({
      frameNumber,
      localCrc,
      remoteCrc,
      timestamp: Date.now(),
    });

    // Keep only last 10 desyncs
    const maxDesyncHistory = 10;
    if (this.desyncHistory.length > maxDesyncHistory) {
      this.desyncHistory.shift();
    }

    this.emit('desync', frameNumber, localCrc, remoteCrc);
  }

  /**
   * Get recent desync history for debugging.
   */
  getDesyncHistory(): readonly DesyncInfo[] {
    return this.desyncHistory;
  }

  /**
   * Reset sync manager state.
   */
  reset(): void {
    this._selfFrame = -1;
    this._runFrame = -1;
    this._otherFrame = -1;
    this._unreadFrame = null;
    this.rollbackTarget = -1;
    this._inRollback = false;
    this._initialFrame = -1;
    this.requestedStallFrames = 0;
    this._latestRemoteFrame = -1;

    this.frameBuffer.clear();
    this.inputBuffer.clear();
    this.inputBuffer.initialize(this.config.localClientId, this.config.inputDelayFrames);

    this.remoteClients.clear();
    this.clientDeviceMap.clear();
    this.clientDeviceMap.set(this.config.localClientId, [0]);

    this.remoteCrcChecks.clear();
    this.syncGapEnd.clear();
    this.pendingRemoteInput.clear();
    this.readFramePerClient.clear();
    this.desyncHistory = [];

    this.stats = {
      rollbackCount: 0,
      totalFramesReplayed: 0,
      desyncCount: 0,
    };
  }

  // Type-safe event emitter methods
  override on<K extends keyof SyncManagerEvents>(
    event: K,
    listener: SyncManagerEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override off<K extends keyof SyncManagerEvents>(
    event: K,
    listener: SyncManagerEvents[K]
  ): this {
    return super.off(event, listener);
  }

  override emit<K extends keyof SyncManagerEvents>(
    event: K,
    ...args: Parameters<SyncManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create a new sync manager.
 */
export const createSyncManager = (config: SyncManagerConfig): SyncManager => {
  return new SyncManager(config);
};
