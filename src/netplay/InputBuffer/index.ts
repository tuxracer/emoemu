/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

/**
 * Input Buffer for Netplay
 *
 * Manages input state per client, including:
 * - Input delay queue for local input
 * - Input prediction for remote clients
 * - Frame-accurate input tracking
 */

import { times } from 'remeda';
import { MAX_INPUT_DEVICES, MAX_INPUT_DELAY_FRAMES } from '..';

export * from './consts';
import { INPUTS_PER_DEVICE, INPUT_JOYPAD, INPUT_ANALOG_LEFT, INPUT_ANALOG_RIGHT } from './consts';

/**
 * Create a zero-filled number array of the given size.
 */
const createZeroArray = (size: number): number[] => times(size, () => 0);

/**
 * Per-client input state tracking.
 */
interface ClientInputState {
  /** Client ID */
  clientId: number;

  /** Last known input values per device */
  lastInput: number[];

  /** Last frame we received real input for */
  lastRealInputFrame: number;

  /** Is this client local? */
  isLocal: boolean;
}

/**
 * Delayed input entry for local input delay queue.
 */
interface DelayedInput {
  /** Frame number this input is for */
  frameNumber: number;

  /** Input values */
  input: number[];
}

/**
 * InputBuffer manages input state for all clients in a netplay session.
 */
export class InputBuffer {
  private readonly clients: Map<number, ClientInputState> = new Map();
  private readonly delayQueue: DelayedInput[] = [];
  private _inputDelayFrames: number = 0;
  private _localClientId: number = 0;

  /** Current input delay in frames */
  get inputDelayFrames(): number {
    return this._inputDelayFrames;
  }

  /** Local client ID */
  get localClientId(): number {
    return this._localClientId;
  }

  /**
   * Initialize the input buffer with local client ID and delay.
   */
  initialize(localClientId: number, inputDelayFrames: number = 0): void {
    this._localClientId = localClientId;
    this._inputDelayFrames = Math.min(inputDelayFrames, MAX_INPUT_DELAY_FRAMES);
    this.clients.clear();
    this.delayQueue.length = 0;

    // Register local client
    this.registerClient(localClientId, true);
  }

  /**
   * Update the local client ID.
   * Called when MODE command assigns our client number.
   */
  updateLocalClientId(newClientId: number): void {
    const oldId = this._localClientId;
    if (oldId === newClientId) {
      return;
    }

    // Move client state from old ID to new ID
    const oldState = this.clients.get(oldId);
    if (oldState) {
      this.clients.delete(oldId);
      oldState.clientId = newClientId;
      this.clients.set(newClientId, oldState);
    }

    this._localClientId = newClientId;
  }

  /**
   * Register a client for input tracking.
   */
  registerClient(clientId: number, isLocal: boolean = false): void {
    if (this.clients.has(clientId)) {
      return;
    }

    this.clients.set(clientId, {
      clientId,
      lastInput: createZeroArray(MAX_INPUT_DEVICES * INPUTS_PER_DEVICE),
      lastRealInputFrame: -1,
      isLocal,
    });
  }

  /**
   * Unregister a client.
   */
  unregisterClient(clientId: number): void {
    this.clients.delete(clientId);
  }

  /**
   * Get all registered client IDs.
   */
  getClientIds(): number[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get remote client IDs (excluding local).
   */
  getRemoteClientIds(): number[] {
    return Array.from(this.clients.entries())
      .filter(([_, state]) => !state.isLocal)
      .map(([id]) => id);
  }

  /**
   * Queue local input with delay.
   * Returns the frame number this input will be applied to.
   */
  queueLocalInput(currentFrame: number, input: number[]): number {
    const targetFrame = currentFrame + this._inputDelayFrames;

    this.delayQueue.push({
      frameNumber: targetFrame,
      input: [...input],
    });

    // Update last known input for local client
    const localState = this.clients.get(this._localClientId);
    if (localState) {
      const len = Math.min(input.length, localState.lastInput.length);
      for (let i = 0; i < len; i++) {
        localState.lastInput[i] = input[i];
      }
    }

    return targetFrame;
  }

  /**
   * Get local input for a specific frame from the delay queue.
   * Returns null if not yet available.
   */
  getDelayedLocalInput(frameNumber: number): number[] | null {
    const entry = this.delayQueue.find((e) => e.frameNumber === frameNumber);
    return entry?.input ?? null;
  }

  /**
   * Remove processed entries from the delay queue.
   */
  pruneDelayQueue(upToFrame: number): void {
    while (this.delayQueue.length > 0 && this.delayQueue[0].frameNumber <= upToFrame) {
      this.delayQueue.shift();
    }
  }

  /**
   * Record received input from a remote client.
   */
  recordRemoteInput(clientId: number, frameNumber: number, input: number[]): void {
    let state = this.clients.get(clientId);
    if (!state) {
      // Auto-register unknown client
      this.registerClient(clientId, false);
      state = this.clients.get(clientId)!;
    }

    // Update last known input
    const len = Math.min(input.length, state.lastInput.length);
    for (let i = 0; i < len; i++) {
      state.lastInput[i] = input[i];
    }

    // Update last real input frame
    if (frameNumber > state.lastRealInputFrame) {
      state.lastRealInputFrame = frameNumber;
    }
  }

  /**
   * Get input for a client at a specific frame.
   * If real input isn't available, returns predicted input.
   */
  getInputForClient(
    clientId: number,
    _frameNumber: number,
    realInputAvailable: boolean
  ): { input: number[]; isReal: boolean } {
    const state = this.clients.get(clientId);
    if (!state) {
      // Unknown client - return zeros
      return {
        input: createZeroArray(MAX_INPUT_DEVICES * INPUTS_PER_DEVICE),
        isReal: false,
      };
    }

    if (realInputAvailable) {
      return {
        input: [...state.lastInput],
        isReal: true,
      };
    }

    // Predict: repeat last known input
    return {
      input: this.predictInput(state),
      isReal: false,
    };
  }

  /**
   * Predict input for a client based on last known state.
   * Simple strategy: repeat last known input.
   */
  private predictInput(state: ClientInputState): number[] {
    // Simple prediction: repeat last known input
    return [...state.lastInput];
  }

  /**
   * Get the last frame we received real input for a client.
   */
  getLastRealInputFrame(clientId: number): number {
    return this.clients.get(clientId)?.lastRealInputFrame ?? -1;
  }

  /**
   * Set input for a specific device.
   * Convenience method for setting joypad + analog values.
   */
  setDeviceInput(
    clientId: number,
    deviceIndex: number,
    joypad: number,
    analogLeft: number = 0,
    analogRight: number = 0
  ): void {
    const state = this.clients.get(clientId);
    if (!state || deviceIndex >= MAX_INPUT_DEVICES) {
      return;
    }

    const base = deviceIndex * INPUTS_PER_DEVICE;
    state.lastInput[base + INPUT_JOYPAD] = joypad;
    state.lastInput[base + INPUT_ANALOG_LEFT] = analogLeft;
    state.lastInput[base + INPUT_ANALOG_RIGHT] = analogRight;
  }

  /**
   * Get input for a specific device.
   */
  getDeviceInput(
    clientId: number,
    deviceIndex: number
  ): { joypad: number; analogLeft: number; analogRight: number } | null {
    const state = this.clients.get(clientId);
    if (!state || deviceIndex >= MAX_INPUT_DEVICES) {
      return null;
    }

    const base = deviceIndex * INPUTS_PER_DEVICE;
    return {
      joypad: state.lastInput[base + INPUT_JOYPAD],
      analogLeft: state.lastInput[base + INPUT_ANALOG_LEFT],
      analogRight: state.lastInput[base + INPUT_ANALOG_RIGHT],
    };
  }

  /**
   * Merge input from multiple clients into a single input array.
   * Each client controls specific device slots.
   */
  mergeInputs(
    clientDeviceMap: Map<number, number[]>,
    frameNumber: number,
    realInputMap: Map<number, boolean>
  ): { merged: number[]; allReal: boolean } {
    const merged = createZeroArray(MAX_INPUT_DEVICES * INPUTS_PER_DEVICE);
    let allReal = true;

    for (const [clientId, deviceIndices] of clientDeviceMap) {
      const isReal = realInputMap.get(clientId) ?? false;
      const { input } = this.getInputForClient(clientId, frameNumber, isReal);

      if (!isReal) {
        allReal = false;
      }

      for (const deviceIndex of deviceIndices) {
        if (deviceIndex >= MAX_INPUT_DEVICES) {
          continue;
        }

        const srcBase = 0; // Assuming client's first device maps to their assigned slot
        const dstBase = deviceIndex * INPUTS_PER_DEVICE;

        merged[dstBase + INPUT_JOYPAD] = input[srcBase + INPUT_JOYPAD];
        merged[dstBase + INPUT_ANALOG_LEFT] = input[srcBase + INPUT_ANALOG_LEFT];
        merged[dstBase + INPUT_ANALOG_RIGHT] = input[srcBase + INPUT_ANALOG_RIGHT];
      }
    }

    return { merged, allReal };
  }

  /**
   * Clear all client state and queues.
   */
  clear(): void {
    this.clients.clear();
    this.delayQueue.length = 0;
  }
}

/**
 * Create a new input buffer.
 */
export const createInputBuffer = (): InputBuffer => {
  return new InputBuffer();
};
