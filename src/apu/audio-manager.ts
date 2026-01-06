// Audio Manager - manages audio worker thread for non-blocking audio output

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export class AudioManager {
  private worker: Worker | null = null;
  private isReady: boolean = false;
  private isEnabled: boolean = true;

  constructor(private sampleRate: number = 44100) {}

  // Start the audio worker
  async start(): Promise<boolean> {
    if (this.worker) {
      return this.isReady;
    }

    return new Promise((resolve) => {
      try {
        // Get the directory of the main module to find the worker
        // Note: This module gets bundled into index.js, so import.meta.url
        // points to dist/index.js, and the worker is at dist/apu/audio-worker.js
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const workerPath = join(__dirname, 'apu', 'audio-worker.js');

        this.worker = new Worker(workerPath);

        // Handle messages from worker
        this.worker.on('message', (message: { type: string; success?: boolean; error?: string }) => {
          switch (message.type) {
            case 'ready':
              // Worker is loaded, now initialize speaker
              this.worker?.postMessage({ type: 'init', sampleRate: this.sampleRate });
              break;

            case 'init':
              this.isReady = message.success ?? false;
              if (!this.isReady) {
                this.isEnabled = false;
              }
              resolve(this.isReady);
              break;

            case 'error':
              this.isEnabled = false;
              break;

            case 'stopped':
              this.isReady = false;
              break;
          }
        });

        this.worker.on('error', (err) => {
          console.error('Audio worker error:', err.message);
          this.isEnabled = false;
          this.isReady = false;
          resolve(false);
        });

        this.worker.on('exit', (code) => {
          if (code !== 0) {
            this.isEnabled = false;
          }
          this.isReady = false;
          this.worker = null;
        });

        // Timeout if worker doesn't respond
        setTimeout(() => {
          if (!this.isReady) {
            resolve(false);
          }
        }, 2000);

      } catch (err) {
        console.error('Failed to start audio worker:', err);
        this.isEnabled = false;
        resolve(false);
      }
    });
  }

  // Send samples to the worker for playback
  writeSamples(samples: Float32Array): void {
    if (!this.worker || !this.isReady || !this.isEnabled) {
      return;
    }

    // Transfer the buffer to avoid copying (more efficient)
    // We need to create a copy since the APU reuses its buffer
    const copy = new Float32Array(samples);
    this.worker.postMessage(
      { type: 'samples', samples: copy },
      [copy.buffer] // Transfer ownership of the buffer
    );
  }

  // Stop the audio worker
  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      // Give it a moment to clean up, then terminate
      setTimeout(() => {
        this.worker?.terminate();
        this.worker = null;
      }, 100);
    }
    this.isReady = false;
  }

  // Check if audio is enabled and working
  isAudioEnabled(): boolean {
    return this.isEnabled && this.isReady;
  }
}
