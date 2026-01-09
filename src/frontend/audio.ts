/**
 * Audio Manager
 *
 * Handles audio output for emulator cores using RtAudio.
 * This is a shared component that works with any core that produces audio samples.
 */

import pkg from 'audify';
const { RtAudio, RtAudioFormat } = pkg;

import type { AudioConfig } from '../core/core.js';

/**
 * Audio manager for emulator audio output
 */
export class AudioManager {
  private rtAudio: InstanceType<typeof RtAudio> | null = null;
  private config: AudioConfig;
  private enabled: boolean = true;
  private running: boolean = false;

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
  private maxQueuedFrames: number = 4;

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

    // Frame size for audio buffer (~10ms at sample rate for low latency)
    this.frameSize = Math.floor(config.sampleRate * 0.01);

    // Buffer size in bytes (16-bit stereo = 4 bytes per sample frame)
    const frameBytes = this.frameSize * 2 * 2; // frameSize * 2 channels * 2 bytes
    this.outputBuffer = Buffer.alloc(frameBytes);

    // Fixed-size ring buffer for sample accumulation (prevents unbounded growth)
    // Size: enough for ~100ms of audio (10 frames worth at 10ms each)
    this.ringBufferSize = this.frameSize * 10;
    this.ringBuffer = new Float32Array(this.ringBufferSize);
  }

  /**
   * Start audio output
   */
  start(): void {
    if (!this.enabled || this.running) return;

    this.createAudio();
    this.running = true;
  }

  /**
   * Stop audio output
   */
  stop(): void {
    if (!this.running) return;
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
    if (!this.rtAudio || !this.enabled || !this.running) return;

    // Add incoming samples to ring buffer
    for (let i = 0; i < samples.length; i++) {
      // If buffer is full, overwrite oldest samples (drop audio rather than grow)
      if (this.ringCount >= this.ringBufferSize) {
        // Advance read pointer to drop oldest sample
        this.ringReadPos = (this.ringReadPos + 1) % this.ringBufferSize;
        this.ringCount--;
      }
      this.ringBuffer[this.ringWritePos] = samples[i];
      this.ringWritePos = (this.ringWritePos + 1) % this.ringBufferSize;
      this.ringCount++;
    }

    // Write complete frames to RtAudio's queue
    this.tryWriteFrames();
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
        this.rtAudio.closeStream();
      } catch {
        // Ignore cleanup errors
      }
    }

    this.rtAudio = new RtAudio();

    // Frame output callback - called when a frame finishes playing
    const onFramePlayed = () => {
      this.framesPlayed++;
      // Opportunistically write more frames when playback creates room
      this.tryWriteFrames();
    };

    // Error callback for graceful error recovery
    const onAudioError = (type: number, msg: string) => {
      // Don't process errors if we're shutting down
      if (!this.running) return;

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
      console.error(`Audio error [${typeName}]: ${msg}`);

      // Attempt recovery for recoverable errors
      if (!this.isRecovering && this.running && type >= 3) {
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
        }, 100);
      }
    };

    // Open output-only stream (stereo for proper speaker output)
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
      'TUI-NES',
      null, // No input callback
      onFramePlayed, // Frame output callback for flow control
      0 as unknown as undefined, // Default flags - runtime expects number, types expect undefined
      onAudioError // Error callback for graceful recovery
    );

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
    if (!this.rtAudio || this.ringCount < this.frameSize) return false;

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
        const sample = Math.max(-1, Math.min(1, this.ringBuffer[this.ringReadPos]));
        const int16 = (sample * 32767) | 0;
        const offset = i * 4; // 4 bytes per stereo sample
        this.outputBuffer.writeInt16LE(int16, offset); // Left
        this.outputBuffer.writeInt16LE(int16, offset + 2); // Right
        this.ringReadPos = (this.ringReadPos + 1) % this.ringBufferSize;
      }
      this.ringCount -= this.frameSize;
    } else {
      // Stereo: samples are interleaved L,R,L,R,...
      const stereoFrameSize = this.frameSize * 2;
      for (let i = 0; i < this.frameSize; i++) {
        const leftSample = Math.max(
          -1,
          Math.min(1, this.ringBuffer[this.ringReadPos])
        );
        this.ringReadPos = (this.ringReadPos + 1) % this.ringBufferSize;
        const rightSample = Math.max(
          -1,
          Math.min(1, this.ringBuffer[this.ringReadPos])
        );
        this.ringReadPos = (this.ringReadPos + 1) % this.ringBufferSize;

        const offset = i * 4;
        this.outputBuffer.writeInt16LE((leftSample * 32767) | 0, offset);
        this.outputBuffer.writeInt16LE((rightSample * 32767) | 0, offset + 2);
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
