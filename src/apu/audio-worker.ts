// Audio Worker - runs on separate thread to handle audio output
// This prevents speaker.write() from blocking the main emulation loop

import { parentPort } from 'worker_threads';
import Speaker from 'speaker';

let speaker: Speaker | null = null;
let isRunning = false;

// Initialize speaker with given sample rate
function initSpeaker(sampleRate: number): boolean {
  try {
    speaker = new Speaker({
      channels: 1,
      bitDepth: 16,
      sampleRate: sampleRate,
    });

    speaker.on('error', (err) => {
      // Notify main thread of audio error
      parentPort?.postMessage({ type: 'error', error: err.message });
      speaker = null;
    });

    speaker.on('close', () => {
      isRunning = false;
    });

    isRunning = true;
    return true;
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) });
    return false;
  }
}

// Convert Float32Array samples to Int16 PCM and write to speaker
function writeSamples(samples: Float32Array): void {
  if (!speaker || !isRunning) return;

  const buffer = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    // Clamp and convert to 16-bit signed integer
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const int16 = (sample * 32767) | 0; // Bitwise OR for fast floor
    buffer.writeInt16LE(int16, i * 2);
  }

  try {
    speaker.write(buffer);
  } catch {
    // Speaker may have been closed
  }
}

// Handle messages from main thread
parentPort?.on('message', (message: { type: string; sampleRate?: number; samples?: Float32Array }) => {
  switch (message.type) {
    case 'init':
      if (message.sampleRate) {
        const success = initSpeaker(message.sampleRate);
        parentPort?.postMessage({ type: 'init', success });
      }
      break;

    case 'samples':
      if (message.samples) {
        writeSamples(message.samples);
      }
      break;

    case 'stop':
      isRunning = false;
      if (speaker) {
        speaker.end();
        speaker = null;
      }
      parentPort?.postMessage({ type: 'stopped' });
      break;
  }
});

// Notify main thread that worker is ready
parentPort?.postMessage({ type: 'ready' });
