/**
 * Audio Manager
 *
 * Handles audio output for emulator cores using RtAudio.
 * This is a shared component that works with any core that produces audio samples.
 */

import { clamp } from 'remeda';
import pkg from 'audify';
const { RtAudio, RtAudioFormat } = pkg;

import type { AudioConfig } from '../../core/core';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/getErrorMessage';
import {
  MAX_AUDIO_QUEUED_FRAMES,
  AUDIO_FRAME_DURATION_SEC,
  AUDIO_STEREO_CHANNELS,
  BYTES_PER_INT16_SAMPLE,
  AUDIO_RING_BUFFER_FRAMES,
  INT16_MAX_VALUE,
  SAMPLE_RATE_44100,
  SAMPLE_RATE_48000,
  FLOAT_COMPARE_EPSILON,
  STEREO_NEXT_RIGHT_OFFSET,
  BYTES_PER_STEREO_SAMPLE,
  RTAUDIO_RECOVERABLE_ERROR_THRESHOLD,
  AUDIO_RECOVERY_DELAY_MS,
} from '..';

/**
 * Audio manager for emulator audio output
 */
export class AudioManager {
  private rtAudio: InstanceType<typeof RtAudio> | null = null;
  private config: AudioConfig;
  private enabled: boolean = true;
  private running: boolean = false;

  // Sample rate tracking for resampling
  private sourceSampleRate: number;
  private outputSampleRate: number;
  private resampleRatio: number = 1.0;

  // Ring buffer for sample accumulation
  private ringBuffer: Float32Array;
  private ringBufferSize: number;
  private ringWritePos: number = 0;
  private ringReadPos: number = 0;
  private ringCount: number = 0;

  // Output buffer for RtAudio
  private outputBuffer: Buffer;
  private frameSize: number;

  // Flow control
  private framesWritten: number = 0;
  private framesPlayed: number = 0;
  private maxQueuedFrames: number = MAX_AUDIO_QUEUED_FRAMES;

  // Error recovery
  private isRecovering: boolean = false;

  /**
   * Create an audio manager for a core's audio output.
   *
   * @param config Audio configuration from the core
   * @param enabled Whether audio is enabled (default: true)
   */
  constructor(config: AudioConfig, enabled: boolean = true) {
    this.config = config;
    this.enabled = enabled;

    // Track source sample rate for resampling
    this.sourceSampleRate = config.sampleRate;
    this.outputSampleRate = config.sampleRate;

    // Frame size for audio buffer (~10ms at sample rate for low latency)
    this.frameSize = Math.floor(config.sampleRate * AUDIO_FRAME_DURATION_SEC);

    // Buffer size in bytes (16-bit stereo = 4 bytes per sample frame)
    const frameBytes = this.frameSize * AUDIO_STEREO_CHANNELS * BYTES_PER_INT16_SAMPLE; // frameSize * 2 channels * 2 bytes
    this.outputBuffer = Buffer.alloc(frameBytes);

    // Fixed-size ring buffer for sample accumulation (prevents unbounded growth)
    // Size: enough for ~100ms of audio (10 frames worth at 10ms each)
    this.ringBufferSize = this.frameSize * AUDIO_RING_BUFFER_FRAMES;
    this.ringBuffer = new Float32Array(this.ringBufferSize);
  }

  /**
   * Start audio output
   */
  start(): void {
    if (!this.enabled || this.running) {return;}

    // Try the core's native sample rate first, then fall back to common rates
    const ratesToTry = [this.sourceSampleRate];
    if (this.sourceSampleRate !== SAMPLE_RATE_44100) {ratesToTry.push(SAMPLE_RATE_44100);}
    if (this.sourceSampleRate !== SAMPLE_RATE_48000) {ratesToTry.push(SAMPLE_RATE_48000);}

    for (const rate of ratesToTry) {
      try {
        this.outputSampleRate = rate;
        this.config.sampleRate = rate;
        this.frameSize = Math.floor(rate * AUDIO_FRAME_DURATION_SEC);
        this.ringBufferSize = this.frameSize * AUDIO_RING_BUFFER_FRAMES;
        this.ringBuffer = new Float32Array(this.ringBufferSize);
        const frameBytes = this.frameSize * AUDIO_STEREO_CHANNELS * BYTES_PER_INT16_SAMPLE;
        this.outputBuffer = Buffer.alloc(frameBytes);

        // Calculate resample ratio (source / output)
        this.resampleRatio = this.sourceSampleRate / this.outputSampleRate;

        this.createAudio();
        this.running = true;
        return;
      } catch {
        // Try next sample rate
      }
    }

    // All sample rates failed - disable audio gracefully
    logger.error('Audio initialization failed for all sample rates. Continuing without audio...', 'Audio');
    this.enabled = false;
    this.rtAudio = null;
  }

  /**
   * Stop audio output
   */
  stop(): void {
    if (!this.running) {return;}
    this.running = false;

    if (this.rtAudio) {
      try {
        if (this.rtAudio.isStreamRunning()) {
          this.rtAudio.stop();
        }
        if (this.rtAudio.isStreamOpen()) {
          this.rtAudio.closeStream();
        }
      } catch {
        // Ignore cleanup errors
      }
      this.rtAudio = null;
    }
  }

  /**
   * Push audio samples from the core.
   * Call this from the core's audio callback.
   *
   * @param samples Float32Array of audio samples (mono or stereo depending on config)
   */
  pushSamples(samples: Float32Array): void {
    if (!this.rtAudio || !this.enabled || !this.running) {return;}

    // If no resampling needed, add directly to ring buffer
    if (Math.abs(this.resampleRatio - 1.0) < FLOAT_COMPARE_EPSILON) {
      this.addSamplesToRingBuffer(samples);
    } else {
      // Resample using linear interpolation
      this.resampleAndAddToRingBuffer(samples);
    }

    // Write complete frames to RtAudio's queue
    this.tryWriteFrames();
  }

  /**
   * Add samples directly to ring buffer (no resampling)
   */
  private addSamplesToRingBuffer(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      if (this.ringCount >= this.ringBufferSize) {
        this.ringReadPos = (this.ringReadPos + 1) % this.ringBufferSize;
        this.ringCount--;
      }
      this.ringBuffer[this.ringWritePos] = samples[i];
      this.ringWritePos = (this.ringWritePos + 1) % this.ringBufferSize;
      this.ringCount++;
    }
  }

  /**
   * Resample stereo audio using linear interpolation and add to ring buffer
   */
  private resampleAndAddToRingBuffer(samples: Float32Array): void {
    // Process stereo pairs (samples are interleaved L,R,L,R,...)
    const numFrames = samples.length / 2;

    // Generate output samples based on resample ratio
    // ratio < 1 means we're upsampling (generating more samples)
    // ratio > 1 means we're downsampling (generating fewer samples)
    let srcPos = 0;

    while (srcPos < numFrames - 1) {
      const srcIdx = Math.floor(srcPos) * 2;
      const frac = srcPos - Math.floor(srcPos);

      // Get current and next stereo samples
      const l0 = samples[srcIdx];
      const r0 = samples[srcIdx + 1];
      const l1 = samples[srcIdx + AUDIO_STEREO_CHANNELS] ?? l0;
      const r1 = samples[srcIdx + STEREO_NEXT_RIGHT_OFFSET] ?? r0;

      // Linear interpolation
      const outL = l0 + (l1 - l0) * frac;
      const outR = r0 + (r1 - r0) * frac;

      // Add to ring buffer
      if (this.ringCount >= this.ringBufferSize - 1) {
        this.ringReadPos = (this.ringReadPos + 2) % this.ringBufferSize;
        this.ringCount -= 2;
      }
      this.ringBuffer[this.ringWritePos] = outL;
      this.ringWritePos = (this.ringWritePos + 1) % this.ringBufferSize;
      this.ringBuffer[this.ringWritePos] = outR;
      this.ringWritePos = (this.ringWritePos + 1) % this.ringBufferSize;
      this.ringCount += 2;

      // Advance source position by resample ratio
      srcPos += this.resampleRatio;
    }
  }

  /**
   * Check if audio is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set audio enabled state
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.running) {
      this.stop();
    }
  }

  /**
   * Get the sample rate
   */
  getSampleRate(): number {
    return this.config.sampleRate;
  }

  /**
   * Create or recreate the RtAudio instance
   */
  private createAudio(): void {
    if (this.rtAudio) {
      try {
        if (this.rtAudio.isStreamRunning()) {
          this.rtAudio.stop();
        }
        if (this.rtAudio.isStreamOpen()) {
          this.rtAudio.closeStream();
        }
      } catch {
        // Ignore cleanup errors
      }
      this.rtAudio = null;
    }

    try {
      this.rtAudio = new RtAudio();
    } catch (err) {
      throw new Error(`Failed to create RtAudio: ${getErrorMessage(err)}`);
    }

    // Frame output callback - called when a frame finishes playing
    const onFramePlayed = () => {
      this.framesPlayed++;
      // Opportunistically write more frames when playback creates room
      this.tryWriteFrames();
    };

    // Error callback for graceful error recovery
    const onAudioError = (type: number, msg: string) => {
      // Ignore DEBUG_WARNING level (type 1) - these are informational messages about
      // internal RtAudio state (e.g., "no open stream to close") that aren't actionable.
      // Check this FIRST before any other conditions to ensure we never log these.
      if (type === 1) {return;}

      // Don't process errors if we're shutting down
      if (!this.running) {return;}

      // Log error for debugging
      const errorTypes = [
        'WARNING',
        'DEBUG_WARNING',
        'UNSPECIFIED',
        'NO_DEVICES_FOUND',
        'INVALID_DEVICE',
        'MEMORY_ERROR',
        'INVALID_PARAMETER',
        'INVALID_USE',
        'DRIVER_ERROR',
        'SYSTEM_ERROR',
        'THREAD_ERROR',
      ];
      const typeName = errorTypes[type] || `UNKNOWN(${type})`;
      logger.error(`Audio error [${typeName}]: ${msg}`, 'Audio');

      // Attempt recovery for recoverable errors
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- running can change asynchronously
if (!this.isRecovering && this.running && type >= RTAUDIO_RECOVERABLE_ERROR_THRESHOLD) {
        this.isRecovering = true;
        setTimeout(() => {
          if (this.running) {
            try {
              this.createAudio();
            } catch {
              // If recreation fails, disable audio
              this.enabled = false;
            }
          }
          this.isRecovering = false;
        }, AUDIO_RECOVERY_DELAY_MS);
      }
    };

    // Open output-only stream (stereo for proper speaker output)
    try {
      this.rtAudio.openStream(
        {
          deviceId: this.rtAudio.getDefaultOutputDevice(),
          nChannels: 2, // Always output stereo
          firstChannel: 0,
        },
        null, // No input
        RtAudioFormat.RTAUDIO_SINT16,
        this.config.sampleRate,
        this.frameSize,
        'emoemu',
        null, // No input callback
        onFramePlayed, // Frame output callback for flow control
        0 as unknown as undefined, // Default flags - runtime expects number, types expect undefined
        onAudioError // Error callback for graceful recovery
      );
    } catch (err) {
      // openStream failed - null out rtAudio so next retry doesn't try to close non-existent stream
      this.rtAudio = null;
      throw err;
    }

    this.rtAudio.start();

    // Reset state on audio recreation
    this.ringWritePos = 0;
    this.ringReadPos = 0;
    this.ringCount = 0;
    this.framesWritten = 0;
    this.framesPlayed = 0;
  }

  /**
   * Write a single frame to RtAudio from ring buffer
   */
  private writeFrame(): boolean {
    if (!this.rtAudio || this.ringCount < this.frameSize) {return false;}

    // Flow control: don't queue too many frames ahead
    const queuedFrames = this.framesWritten - this.framesPlayed;
    if (queuedFrames >= this.maxQueuedFrames) {
      return false; // Wait for playback to catch up
    }

    // Convert float samples to int16 stereo in output buffer
    // For mono input, duplicate to both channels
    // For stereo input, samples are already interleaved
    if (this.config.channels === 1) {
      // Mono: duplicate to both channels
      for (let i = 0; i < this.frameSize; i++) {
        const sample = clamp(this.ringBuffer[this.ringReadPos], { min: -1, max: 1 });
        const int16 = (sample * INT16_MAX_VALUE) | 0;
        const offset = i * BYTES_PER_STEREO_SAMPLE; // 4 bytes per stereo sample
        this.outputBuffer.writeInt16LE(int16, offset); // Left
        this.outputBuffer.writeInt16LE(int16, offset + BYTES_PER_INT16_SAMPLE); // Right
        this.ringReadPos = (this.ringReadPos + 1) % this.ringBufferSize;
      }
      this.ringCount -= this.frameSize;
    } else {
      // Stereo: samples are interleaved L,R,L,R,...
      const stereoFrameSize = this.frameSize * AUDIO_STEREO_CHANNELS;
      for (let i = 0; i < this.frameSize; i++) {
        const leftSample = clamp(this.ringBuffer[this.ringReadPos], { min: -1, max: 1 });
        this.ringReadPos = (this.ringReadPos + 1) % this.ringBufferSize;
        const rightSample = clamp(this.ringBuffer[this.ringReadPos], { min: -1, max: 1 });
        this.ringReadPos = (this.ringReadPos + 1) % this.ringBufferSize;

        const offset = i * BYTES_PER_STEREO_SAMPLE;
        this.outputBuffer.writeInt16LE((leftSample * INT16_MAX_VALUE) | 0, offset);
        this.outputBuffer.writeInt16LE((rightSample * INT16_MAX_VALUE) | 0, offset + BYTES_PER_INT16_SAMPLE);
      }
      this.ringCount -= stereoFrameSize;
    }

    this.rtAudio.write(this.outputBuffer);
    this.framesWritten++;
    return true;
  }

  /**
   * Try to write all available frames to RtAudio's queue
   */
  private tryWriteFrames(): void {
    const samplesPerFrame =
      this.config.channels === 1 ? this.frameSize : this.frameSize * 2;
    while (this.ringCount >= samplesPerFrame && this.writeFrame()) {
      // Keep writing until buffer is drained or queue is full
    }
  }
}
