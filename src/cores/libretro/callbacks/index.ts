/**
 * Callback manager for libretro cores
 * Handles video, audio, and input callbacks from native code
 */

import { clamp } from 'remeda';
import koffi from "koffi";
import type { LibretroAPI, KoffiCallback } from "../api";
import {
  retro_environment_t,
  retro_video_refresh_t,
  retro_audio_sample_t,
  retro_audio_sample_batch_t,
  retro_input_poll_t,
  retro_input_state_t,
} from "../api";
import type { EnvironmentHandler } from "../environment";
import { RETRO_DEVICE, RETRO_DEVICE_INDEX_ANALOG, RETRO_DEVICE_ID_ANALOG, FRAMEBUFFER_HEADROOM } from "..";
import { logger } from "@/utils/logger";

// Callback-specific constants
import {
  INITIAL_AUDIO_BUFFER_SIZE,
  JOYPAD_BITMASK_ID,
  INT16_MAX,
  INT16_MIN,
  INT16_MAX_POSITIVE,
  AUDIO_BUFFER_GROWTH_FACTOR,
  DEBUG_VIDEO_CALLBACK_COUNT,
  DEBUG_INITIAL_FRAMES_TO_LOG,
  DEBUG_VIDEO_FRAME_LOG_INTERVAL,
  DEBUG_ANALOG_CHANGE_THRESHOLD,
} from "./consts";

export * from './consts';

/**
 * CallbackManager handles all callbacks between the libretro core and the frontend
 */
export class CallbackManager {
  // Registered koffi callbacks - must keep references to prevent GC
  private environmentCallback: KoffiCallback | null = null;
  private videoCallback: KoffiCallback | null = null;
  private audioSampleCallback: KoffiCallback | null = null;
  private audioBatchCallback: KoffiCallback | null = null;
  private inputPollCallback: KoffiCallback | null = null;
  private inputStateCallback: KoffiCallback | null = null;

  // Frame data
  framebuffer: Uint8Array | null = null;
  frameWidth = 0;
  frameHeight = 0;
  framePitch = 0;
  private framebufferCapacity = 0;

  // Audio buffer (grows as needed)
  private audioBufferCapacity = INITIAL_AUDIO_BUFFER_SIZE;
  audioBuffer: Int16Array = new Int16Array(this.audioBufferCapacity);
  audioSamples = 0;

  // Reusable Float32Array for drainAudio() output to avoid per-frame allocations
  private audioOutputBuffer: Float32Array | null = null;
  private audioOutputCapacity = 0;

  // Input state per port - use arrays for O(1) access
  // buttonState[port][buttonId] = pressed (boolean), sparse arrays allow undefined
  private buttonState: Array<Array<boolean | undefined> | undefined> = [];
  // Cached bitmask per port - updated on setButtonState() for O(1) bitmask queries
  private buttonBitmask: number[] = [];
  // Analog state per port - analogState[port][index][axis] = value (-32768 to 32767)
  // index: 0=left stick, 1=right stick; axis: 0=X, 1=Y
  private analogState: Array<Array<Array<number> | undefined> | undefined> = [];

  constructor(private envHandler: EnvironmentHandler) {}

  /**
   * Create and register all callbacks with the libretro API
   */
  createCallbacks(api: LibretroAPI): void {
    // Environment callback - MUST be set before retro_init() for some cores
    this.environmentCallback = koffi.register(
      (cmd: number, data: Buffer | null): boolean => {
        return this.envHandler.handle(cmd, data);
      },
      koffi.pointer(retro_environment_t)
    );
    api.retro_set_environment(this.environmentCallback);

    // Video refresh callback
    this.videoCallback = koffi.register(
      (
        data: Buffer | null,
        width: number,
        height: number,
        pitch: number
      ): void => {
        // Debug: Log callback invocation (first N calls with detailed info)
        if (this.debugFrameCount < DEBUG_VIDEO_CALLBACK_COUNT) {
          const dataInfo = data ? `present (type=${typeof data}, length=${data.length || 'N/A'})` : 'null';
          logger.debug(`Video callback #${this.debugFrameCount + 1}: data=${dataInfo}, ${width}x${height}, pitch=${pitch}`, 'Video');
        }
        this.handleVideoRefresh(data, width, height, pitch);
      },
      koffi.pointer(retro_video_refresh_t)
    );
    api.retro_set_video_refresh(this.videoCallback);
    logger.debug('Video callback registered', 'Video');

    // Audio sample callback (single sample, stereo)
    this.audioSampleCallback = koffi.register(
      (left: number, right: number): void => {
        this.handleAudioSample(left, right);
      },
      koffi.pointer(retro_audio_sample_t)
    );
    api.retro_set_audio_sample(this.audioSampleCallback);

    // Audio sample batch callback (multiple frames at once)
    this.audioBatchCallback = koffi.register(
      (data: Buffer | null, frames: number): number => {
        return this.handleAudioBatch(data, frames);
      },
      koffi.pointer(retro_audio_sample_batch_t)
    );
    api.retro_set_audio_sample_batch(this.audioBatchCallback);

    // Input poll callback
    this.inputPollCallback = koffi.register((): void => {
      // No-op - we update input state externally
    }, koffi.pointer(retro_input_poll_t));
    api.retro_set_input_poll(this.inputPollCallback);

    // Input state callback
    this.inputStateCallback = koffi.register(
      (port: number, device: number, index: number, id: number): number => {
        return this.handleInputState(port, device, index, id);
      },
      koffi.pointer(retro_input_state_t)
    );
    api.retro_set_input_state(this.inputStateCallback);
  }

  // Debug: track frame count for video callback diagnostics
  private debugFrameCount = 0;

  /**
   * Handle video refresh callback from core
   */
  private handleVideoRefresh(

    data: any,
    width: number,
    height: number,
    pitch: number
  ): void {
    // data can be null for duplicate frames when GET_CAN_DUPE is true
    if (!data) {return;}

    this.frameWidth = width;
    this.frameHeight = height;
    this.framePitch = pitch;

    // Calculate required buffer size (pitch * height)
    const requiredSize = pitch * height;

    // Allocate or grow framebuffer if needed
    if (!this.framebuffer || this.framebufferCapacity < requiredSize) {
      // Allocate with some headroom
      this.framebufferCapacity = requiredSize + FRAMEBUFFER_HEADROOM;
      this.framebuffer = new Uint8Array(this.framebufferCapacity);
    }

    // Use koffi.view() to get direct access to the framebuffer memory without copying
    // This creates an ArrayBuffer view into the native memory
    const arrayBuffer = koffi.view(data, requiredSize);
    const srcData = new Uint8Array(arrayBuffer);

    // Copy to our internal buffer (we must copy because the source memory
    // is only valid during this callback)
    this.framebuffer.set(srcData);

    // Debug: log frame info periodically (first few frames and then at regular intervals)
    this.debugFrameCount++;
    if (this.debugFrameCount <= DEBUG_INITIAL_FRAMES_TO_LOG || this.debugFrameCount % DEBUG_VIDEO_FRAME_LOG_INTERVAL === 0) {
      const pixelFormat = this.envHandler.getPixelFormat();
      logger.debug(`Video frame ${this.debugFrameCount}: ${width}x${height}, pitch=${pitch}, format=${pixelFormat}`, 'Video');
    }
  }

  /**
   * Handle single audio sample callback (less common, used by some cores)
   */
  private handleAudioSample(left: number, right: number): void {
    this.ensureAudioCapacity(2);
    this.audioBuffer[this.audioSamples++] = left;
    this.audioBuffer[this.audioSamples++] = right;
  }

  /**
   * Handle audio batch callback (most common, more efficient)
   */

  private handleAudioBatch(data: any, frames: number): number {
    if (!data || frames === 0) {return frames;}

    // Each frame is 2 samples (left, right) as int16 (2 bytes each)
    const samples = frames * 2;
    const byteSize = samples * 2; // 2 bytes per int16 sample
    this.ensureAudioCapacity(samples);

    // Use koffi.view() to get direct access to the audio memory
    const arrayBuffer = koffi.view(data, byteSize);
    const srcData = new Int16Array(arrayBuffer);

    // Copy to our internal buffer
    for (let i = 0; i < samples; i++) {
      this.audioBuffer[this.audioSamples++] = srcData[i];
    }

    return frames;
  }

  /**
   * Ensure audio buffer has enough capacity.
   * Uses 1.5x growth factor for more memory-efficient expansion.
   */
  private ensureAudioCapacity(additionalSamples: number): void {
    const required = this.audioSamples + additionalSamples;
    if (required > this.audioBufferCapacity) {
      // Grow by 1.5x until sufficient (more memory-efficient than 2x)
      while (this.audioBufferCapacity < required) {
        this.audioBufferCapacity = Math.ceil(this.audioBufferCapacity * AUDIO_BUFFER_GROWTH_FACTOR);
      }
      const newBuffer = new Int16Array(this.audioBufferCapacity);
      newBuffer.set(this.audioBuffer.subarray(0, this.audioSamples));
      this.audioBuffer = newBuffer;
    }
  }

  /**
   * Handle input state query from core
   * Supports both joypad (digital buttons) and analog stick queries.
   * Uses cached bitmask for O(1) bitmask queries and array lookup for individual buttons.
   */
  private handleInputState(
    port: number,
    device: number,
    index: number,
    id: number
  ): number {
    // Handle analog stick queries
    if (device === RETRO_DEVICE.ANALOG) {
      return this.getAnalogState(port, index, id);
    }

    // Handle joypad (digital button) queries
    if (device !== RETRO_DEVICE.JOYPAD) {return 0;}

    // id=JOYPAD_BITMASK_ID (256) is RETRO_DEVICE_ID_JOYPAD_MASK - return cached bitmask
    if (id === JOYPAD_BITMASK_ID) {
      return this.buttonBitmask[port] ?? 0;
    }

    // Individual button query - O(1) array lookup
    const portState = this.buttonState[port];
    if (!portState) {return 0;}
    return portState[id] ? 1 : 0;
  }

  // Track which analog indices have been queried
  private loggedAnalogIndices = new Set<number>();

  /**
   * Get analog axis value for a port/stick/axis
   * @param port - Controller port (0-based)
   * @param index - Analog stick (0=left, 1=right, 2=analog buttons)
   * @param axis - Axis (0=X, 1=Y)
   * @returns Analog value from -32768 to 32767
   */
  // Track last returned values to avoid spamming logs
  private lastLoggedAnalogValue: Map<string, number> = new Map();

  private getAnalogState(port: number, index: number, axis: number): number {
    const portState = this.analogState[port];
    if (!portState) {return 0;}
    const stickState = portState[index];
    if (!stickState) {return 0;}
    const value = stickState[axis] ?? 0;

    // Guard: this runs on every analog FFI query from the core, so skip
    // all the debug bookkeeping (key string, map lookups) unless debug
    // logging is actually on
    if (logger.isLevelEnabled('debug')) {
      // Log first time core queries each analog index
      if (!this.loggedAnalogIndices.has(index)) {
        logger.debug(`Core queries analog index=${index} (LEFT=0, RIGHT=1)`, 'Input');
        this.loggedAnalogIndices.add(index);
      }

      // Log significant return values (changed by more than threshold from last logged)
      const key = `${port}.${index}.${axis}`;
      const lastLogged = this.lastLoggedAnalogValue.get(key) ?? 0;
      if (Math.abs(value - lastLogged) > DEBUG_ANALOG_CHANGE_THRESHOLD) {
        logger.debug(`getAnalogState RETURN: port=${port} index=${index} axis=${axis} → ${value}`, 'Input');
        this.lastLoggedAnalogValue.set(key, value);
      }
    }

    return value;
  }

  /**
   * Set button state for input handling.
   * Updates both the button array and cached bitmask for O(1) queries.
   */
  setButtonState(port: number, button: number, pressed: boolean): void {
    // Initialize port state array if needed
    if (!this.buttonState[port]) {
      this.buttonState[port] = [];
      this.buttonBitmask[port] = 0;
    }

    // Update button state
    this.buttonState[port][button] = pressed;

    // Update cached bitmask
    if (pressed) {
      this.buttonBitmask[port] |= (1 << button);
    } else {
      this.buttonBitmask[port] &= ~(1 << button);
    }
  }

  /**
   * Get all button states for a port.
   * Converts internal array to Map for API compatibility.
   */
  getButtonState(port: number): Map<number, boolean> {
    const portState = this.buttonState[port];
    if (!portState) {return new Map<number, boolean>();}

    const result = new Map<number, boolean>();
    for (let i = 0; i < portState.length; i++) {
      const pressed = portState[i];
      if (pressed !== undefined) {
        result.set(i, pressed);
      }
    }
    return result;
  }

  /**
   * Set analog axis state for a port/stick/axis.
   * @param port - Controller port (0-based)
   * @param index - Analog stick (0=left, 1=right from RETRO_DEVICE_INDEX_ANALOG)
   * @param axis - Axis (0=X, 1=Y from RETRO_DEVICE_ID_ANALOG)
   * @param value - Analog value from -32768 to 32767
   */
  setAnalogState(port: number, index: number, axis: number, value: number): void {
    // Clamp value to valid range
    const clampedValue = clamp(Math.round(value), { min: INT16_MIN, max: INT16_MAX_POSITIVE });

    // Debug: Log significant analog values being stored (guarded — per input event)
    if (logger.isLevelEnabled('debug') && Math.abs(clampedValue) > DEBUG_ANALOG_CHANGE_THRESHOLD) {
      logger.debug(`setAnalogState: port=${port} index=${index} axis=${axis} value=${clampedValue}`, 'Input');
    }

    // Initialize port state if needed
    if (!this.analogState[port]) {
      this.analogState[port] = [];
    }
    // Initialize stick state if needed
    if (!this.analogState[port]![index]) {
      this.analogState[port]![index] = [0, 0];
    }
    // Set axis value
    this.analogState[port]![index]![axis] = clampedValue;
  }

  /**
   * Get all analog states for a port.
   * Returns a map of "index.axis" -> value
   */
  getAnalogStates(port: number): Map<string, number> {
    const result = new Map<string, number>();
    const portState = this.analogState[port];
    if (!portState) {return result;}

    // Iterate over both analog sticks (left=0, right=1)
    const analogIndices = [RETRO_DEVICE_INDEX_ANALOG.LEFT, RETRO_DEVICE_INDEX_ANALOG.RIGHT];
    const axisIds = [RETRO_DEVICE_ID_ANALOG.X, RETRO_DEVICE_ID_ANALOG.Y];

    for (const index of analogIndices) {
      const stickState = portState[index];
      if (!stickState) {continue;}
      for (const axis of axisIds) {
        const value = stickState[axis];
        // Only include non-zero values to reduce map size
        if (value !== 0) {
          result.set(`${index}.${axis}`, value);
        }
      }
    }
    return result;
  }

  /**
   * Drain the audio buffer and return samples as Float32Array
   * Converts from Int16 [-32768, 32767] to Float32 [-1.0, 1.0]
   * Reuses internal buffer to avoid per-frame allocations.
   */
  drainAudio(): Float32Array {
    const count = this.audioSamples;

    // Grow output buffer if needed
    if (!this.audioOutputBuffer || this.audioOutputCapacity < count) {
      this.audioOutputCapacity = Math.max(count, this.audioBufferCapacity);
      this.audioOutputBuffer = new Float32Array(this.audioOutputCapacity);
    }

    const output = this.audioOutputBuffer;
    const input = this.audioBuffer;

    for (let i = 0; i < count; i++) {
      output[i] = input[i] / INT16_MAX;
    }

    this.audioSamples = 0;
    return output.subarray(0, count);
  }

  /**
   * Check if there are audio samples available
   */
  hasAudio(): boolean {
    return this.audioSamples > 0;
  }

  /**
   * Clean up callbacks
   */
  destroy(): void {
    // Note: koffi registered callbacks are cleaned up when the library is unloaded
    // We just need to clear our references
    this.environmentCallback = null;
    this.videoCallback = null;
    this.audioSampleCallback = null;
    this.audioBatchCallback = null;
    this.inputPollCallback = null;
    this.inputStateCallback = null;
    this.framebuffer = null;
    this.audioBuffer = new Int16Array(0);
    this.audioOutputBuffer = null;
    this.audioOutputCapacity = 0;
    this.audioSamples = 0;
    this.buttonState = [];
    this.buttonBitmask = [];
    this.analogState = [];
    this.lastLoggedAnalogValue.clear();
  }
}
