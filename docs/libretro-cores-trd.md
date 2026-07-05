# Libretro Core Support - Technical Requirements Document

This document describes the design for loading and running native libretro cores (RetroArch cores) within emoemu, enabling support for additional systems like Sega Genesis, PlayStation, and others without writing new emulation code.

## Overview

### Goals

1. **Leverage Existing Cores**: Use battle-tested libretro cores (PicoDrive, Beetle PSX, etc.) instead of writing new emulators
2. **Seamless Integration**: Wrap libretro cores to implement our existing `Core` interface
3. **Cross-Platform**: Support macOS (.dylib), Linux (.so), and Windows (.dll)
4. **Minimal Overhead**: Efficient data passing between JavaScript and native code

### Non-Goals

1. Full RetroArch compatibility (shaders, netplay, achievements, etc.)
2. Dynamic core downloading (cores must be provided by user)
3. Support for cores requiring OpenGL/Vulkan contexts

### Background: Libretro API

Libretro is a C API that defines a standard interface between emulator cores and frontends. Key characteristics:

- **Dynamic Libraries**: Cores are `.so`/`.dll`/`.dylib` files
- **Callback-Based**: Frontend provides function pointers for video/audio/input
- **Environment Queries**: Cores request capabilities via environment callback
- **Standardized I/O**: Common formats for framebuffer, audio samples, input polling

Popular libretro cores:
- **PicoDrive**: Sega Genesis/Mega Drive, Master System, Game Gear, 32X, Sega CD
- **Beetle PSX**: PlayStation 1
- **mGBA**: Game Boy Advance
- **Snes9x**: Super Nintendo (alternative to our native core)
- **Mupen64Plus-Next**: Nintendo 64

---

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────┐
│                    emoemu Frontend                     │
│  (Emulator, Renderers, Audio, Input, State Manager)     │
└─────────────────────────┬───────────────────────────────┘
                          │ Core Interface
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    LibretroCore                         │
│         (Implements Core, wraps libretro API)           │
└─────────────────────────┬───────────────────────────────┘
                          │ FFI (koffi)
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Native Libretro Core (.so/.dylib)          │
│              (picodrive_libretro.dylib, etc.)           │
└─────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/cores/libretro/
├── index.ts              # LibretroCore class (implements Core)
├── api.ts                # FFI bindings for libretro functions
├── types.ts              # Libretro type definitions
├── environment.ts        # Environment callback handler
├── callbacks.ts          # Video/audio/input callback implementations
└── core-info.ts          # Core metadata and system info mapping
```

---

## Libretro API Bindings

### Core Functions

The libretro API consists of ~25 functions. Essential ones for basic operation:

```typescript
// src/cores/libretro/api.ts

import koffi from 'koffi';

// Type definitions
const retro_game_info = koffi.struct('retro_game_info', {
  path: 'const char*',
  data: 'const void*',
  size: 'size_t',
  meta: 'const char*',
});

const retro_system_info = koffi.struct('retro_system_info', {
  library_name: 'const char*',
  library_version: 'const char*',
  valid_extensions: 'const char*',
  need_fullpath: 'bool',
  block_extract: 'bool',
});

const retro_system_av_info = koffi.struct('retro_system_av_info', {
  geometry: koffi.struct({
    base_width: 'unsigned',
    base_height: 'unsigned',
    max_width: 'unsigned',
    max_height: 'unsigned',
    aspect_ratio: 'float',
  }),
  timing: koffi.struct({
    fps: 'double',
    sample_rate: 'double',
  }),
});

// Callback types
const retro_video_refresh_t = koffi.proto(
  'void retro_video_refresh_t(const void* data, unsigned width, unsigned height, size_t pitch)'
);
const retro_audio_sample_t = koffi.proto(
  'void retro_audio_sample_t(int16_t left, int16_t right)'
);
const retro_audio_sample_batch_t = koffi.proto(
  'size_t retro_audio_sample_batch_t(const int16_t* data, size_t frames)'
);
const retro_input_poll_t = koffi.proto('void retro_input_poll_t()');
const retro_input_state_t = koffi.proto(
  'int16_t retro_input_state_t(unsigned port, unsigned device, unsigned index, unsigned id)'
);
const retro_environment_t = koffi.proto(
  'bool retro_environment_t(unsigned cmd, void* data)'
);

export class LibretroAPI {
  private lib: koffi.IKoffiLib;

  // Core functions
  retro_init: () => void;
  retro_deinit: () => void;
  retro_api_version: () => number;
  retro_get_system_info: (info: any) => void;
  retro_get_system_av_info: (info: any) => void;
  retro_set_controller_port_device: (port: number, device: number) => void;
  retro_reset: () => void;
  retro_run: () => void;
  retro_load_game: (game: any) => boolean;
  retro_unload_game: () => void;

  // Serialization
  retro_serialize_size: () => number;
  retro_serialize: (data: Buffer, size: number) => boolean;
  retro_unserialize: (data: Buffer, size: number) => boolean;

  // Memory access
  retro_get_memory_data: (id: number) => Buffer | null;
  retro_get_memory_size: (id: number) => number;

  // Callback setters
  retro_set_video_refresh: (cb: any) => void;
  retro_set_audio_sample: (cb: any) => void;
  retro_set_audio_sample_batch: (cb: any) => void;
  retro_set_input_poll: (cb: any) => void;
  retro_set_input_state: (cb: any) => void;
  retro_set_environment: (cb: any) => void;

  constructor(corePath: string) {
    this.lib = koffi.load(corePath);
    this.bindFunctions();
  }

  private bindFunctions(): void {
    this.retro_init = this.lib.func('void retro_init()');
    this.retro_deinit = this.lib.func('void retro_deinit()');
    this.retro_api_version = this.lib.func('unsigned retro_api_version()');
    this.retro_run = this.lib.func('void retro_run()');
    this.retro_reset = this.lib.func('void retro_reset()');
    this.retro_load_game = this.lib.func('bool retro_load_game(retro_game_info*)');
    this.retro_unload_game = this.lib.func('void retro_unload_game()');
    // ... bind remaining functions
  }

  destroy(): void {
    this.lib.unload();
  }
}
```

### Memory Constants

```typescript
// Memory region IDs for retro_get_memory_data/size
export const RETRO_MEMORY = {
  SAVE_RAM: 0,      // Battery-backed save RAM
  RTC: 1,           // Real-time clock
  SYSTEM_RAM: 2,    // Main system RAM
  VIDEO_RAM: 3,     // Video RAM
} as const;

// Device types for retro_set_controller_port_device
export const RETRO_DEVICE = {
  NONE: 0,
  JOYPAD: 1,
  MOUSE: 2,
  KEYBOARD: 3,
  LIGHTGUN: 4,
  ANALOG: 5,
} as const;

// Joypad button IDs for retro_input_state
export const RETRO_DEVICE_ID_JOYPAD = {
  B: 0,
  Y: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
  X: 9,
  L: 10,
  R: 11,
  L2: 12,
  R2: 13,
  L3: 14,
  R3: 15,
} as const;
```

---

## Environment Callback

The environment callback is how cores query frontend capabilities and configure behavior. This is the most complex part of the integration.

### Environment Commands

```typescript
// src/cores/libretro/environment.ts

// Subset of environment commands (full list has 100+ commands)
export const RETRO_ENVIRONMENT = {
  // Video
  SET_PIXEL_FORMAT: 10,           // Request pixel format (0555, XRGB8888, RGB565)
  GET_SYSTEM_DIRECTORY: 9,        // Path to system files (BIOS)
  SET_GEOMETRY: 37,               // Change video geometry mid-game
  GET_VARIABLE: 15,               // Get core option value
  SET_VARIABLES: 16,              // Define core options

  // Input
  SET_INPUT_DESCRIPTORS: 31,      // Describe input layout
  GET_INPUT_BITMASKS: 52,         // Request bitmask input polling

  // Save
  GET_SAVE_DIRECTORY: 31,         // Path for save files

  // Info
  GET_LOG_INTERFACE: 27,          // Logging callback
  SET_SUPPORT_NO_GAME: 18,        // Core can run without ROM
  GET_CORE_OPTIONS_VERSION: 52,   // Options API version
} as const;

// Pixel formats
export const RETRO_PIXEL_FORMAT = {
  XRGB1555: 0,    // 15-bit, X ignored
  XRGB8888: 1,    // 32-bit XRGB
  RGB565: 2,      // 16-bit RGB
} as const;

export class EnvironmentHandler {
  private pixelFormat = RETRO_PIXEL_FORMAT.XRGB1555;
  private variables = new Map<string, string>();
  private systemDirectory = './system';
  private saveDirectory = './saves';

  /** Handle environment callback from core */
  handle(cmd: number, data: Buffer | null): boolean {
    switch (cmd) {
      case RETRO_ENVIRONMENT.SET_PIXEL_FORMAT:
        if (data) {
          this.pixelFormat = data.readUInt32LE(0);
          return this.pixelFormat <= RETRO_PIXEL_FORMAT.RGB565;
        }
        return false;

      case RETRO_ENVIRONMENT.GET_SYSTEM_DIRECTORY:
        if (data) {
          // Write string pointer to data
          // Complex: requires allocating native string
        }
        return true;

      case RETRO_ENVIRONMENT.GET_VARIABLE:
        // Core requesting option value
        return this.handleGetVariable(data);

      case RETRO_ENVIRONMENT.SET_VARIABLES:
        // Core defining available options
        return this.handleSetVariables(data);

      case RETRO_ENVIRONMENT.GET_LOG_INTERFACE:
        // Provide logging callback
        return this.handleLogInterface(data);

      case RETRO_ENVIRONMENT.SET_INPUT_DESCRIPTORS:
        // Core describing its input layout
        return true; // Accept but we use our own mapping

      default:
        // Unknown command - return false
        return false;
    }
  }

  getPixelFormat(): number {
    return this.pixelFormat;
  }

  private handleGetVariable(data: Buffer | null): boolean {
    // Parse retro_variable struct, look up value, write back
    return false; // Stub
  }

  private handleSetVariables(data: Buffer | null): boolean {
    // Parse variable definitions, store defaults
    return true; // Stub
  }

  private handleLogInterface(data: Buffer | null): boolean {
    // Provide logging callback
    return false; // Stub - logging not implemented
  }
}
```

### Callback Registration

```typescript
// src/cores/libretro/callbacks.ts

import koffi from 'koffi';

export class CallbackManager {
  private videoCallback: koffi.IKoffiRegisteredCallback | null = null;
  private audioCallback: koffi.IKoffiRegisteredCallback | null = null;
  private inputPollCallback: koffi.IKoffiRegisteredCallback | null = null;
  private inputStateCallback: koffi.IKoffiRegisteredCallback | null = null;
  private environmentCallback: koffi.IKoffiRegisteredCallback | null = null;

  // Current frame data
  framebuffer: Uint8Array | null = null;
  frameWidth = 0;
  frameHeight = 0;
  framePitch = 0;

  // Audio buffer
  audioBuffer: Int16Array = new Int16Array(4096);
  audioSamples = 0;

  // Input state
  private buttonState = new Map<number, Map<number, boolean>>();

  constructor(private envHandler: EnvironmentHandler) {}

  createCallbacks(api: LibretroAPI): void {
    // Video refresh callback
    this.videoCallback = koffi.register(
      (data: Buffer, width: number, height: number, pitch: number) => {
        this.frameWidth = width;
        this.frameHeight = height;
        this.framePitch = pitch;

        // Copy framebuffer (data may be invalidated after callback returns)
        const size = height * pitch;
        if (!this.framebuffer || this.framebuffer.length < size) {
          this.framebuffer = new Uint8Array(size);
        }
        data.copy(this.framebuffer, 0, 0, size);
      },
      koffi.proto('void (*)(const void*, unsigned, unsigned, size_t)')
    );

    // Audio sample batch callback
    this.audioCallback = koffi.register(
      (data: Buffer, frames: number): number => {
        // Copy interleaved stereo samples
        const samples = frames * 2;
        if (this.audioSamples + samples > this.audioBuffer.length) {
          // Grow buffer
          const newBuffer = new Int16Array(this.audioBuffer.length * 2);
          newBuffer.set(this.audioBuffer);
          this.audioBuffer = newBuffer;
        }
        for (let i = 0; i < samples; i++) {
          this.audioBuffer[this.audioSamples++] = data.readInt16LE(i * 2);
        }
        return frames;
      },
      koffi.proto('size_t (*)(const int16_t*, size_t)')
    );

    // Input poll callback (called before input_state queries)
    this.inputPollCallback = koffi.register(
      () => {
        // Nothing to do - we update state externally
      },
      koffi.proto('void (*)()')
    );

    // Input state callback
    this.inputStateCallback = koffi.register(
      (port: number, device: number, index: number, id: number): number => {
        if (device !== RETRO_DEVICE.JOYPAD) return 0;
        const portState = this.buttonState.get(port);
        return portState?.get(id) ? 1 : 0;
      },
      koffi.proto('int16_t (*)(unsigned, unsigned, unsigned, unsigned)')
    );

    // Environment callback
    this.environmentCallback = koffi.register(
      (cmd: number, data: Buffer | null): boolean => {
        return this.envHandler.handle(cmd, data);
      },
      koffi.proto('bool (*)(unsigned, void*)')
    );

    // Register callbacks with core
    api.retro_set_environment(this.environmentCallback);
    api.retro_set_video_refresh(this.videoCallback);
    api.retro_set_audio_sample_batch(this.audioCallback);
    api.retro_set_input_poll(this.inputPollCallback);
    api.retro_set_input_state(this.inputStateCallback);
  }

  setButtonState(port: number, button: number, pressed: boolean): void {
    let portState = this.buttonState.get(port);
    if (!portState) {
      portState = new Map();
      this.buttonState.set(port, portState);
    }
    portState.set(button, pressed);
  }

  getButtonState(port: number): Map<number, boolean> {
    return this.buttonState.get(port) ?? new Map();
  }

  /** Drain audio buffer and return samples */
  drainAudio(): Float32Array {
    const samples = new Float32Array(this.audioSamples);
    for (let i = 0; i < this.audioSamples; i++) {
      samples[i] = this.audioBuffer[i] / 32768;
    }
    this.audioSamples = 0;
    return samples;
  }

  destroy(): void {
    // Callbacks are cleaned up when koffi lib is unloaded
    this.videoCallback = null;
    this.audioCallback = null;
    this.inputPollCallback = null;
    this.inputStateCallback = null;
    this.environmentCallback = null;
  }
}
```

---

## LibretroCore Implementation

### Core Class

```typescript
// src/cores/libretro/index.ts

import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { Core, SystemInfo, AudioConfig, CoreState, ButtonDefinition } from '../../core/core.js';
import { LibretroAPI } from './api.js';
import { EnvironmentHandler, RETRO_PIXEL_FORMAT } from './environment.js';
import { CallbackManager, RETRO_DEVICE_ID_JOYPAD } from './callbacks.js';
import { registerCore } from '../../frontend/core-registry.js';

export class LibretroCore implements Core {
  private api: LibretroAPI;
  private envHandler: EnvironmentHandler;
  private callbacks: CallbackManager;
  private systemInfo: SystemInfo;
  private romPath = '';
  private romData: Buffer | null = null;

  constructor(corePath: string) {
    this.envHandler = new EnvironmentHandler();
    this.api = new LibretroAPI(corePath);
    this.callbacks = new CallbackManager(this.envHandler);

    // Set environment callback before init (required by some cores)
    this.callbacks.createCallbacks(this.api);

    // Initialize core
    this.api.retro_init();

    // Get system info
    this.systemInfo = this.buildSystemInfo();
  }

  private buildSystemInfo(): SystemInfo {
    const info = {} as any;
    this.api.retro_get_system_info(info);

    const avInfo = { geometry: {}, timing: {} } as any;
    // Note: av_info not available until game is loaded for some cores

    return {
      id: `libretro-${info.library_name.toLowerCase().replace(/\s+/g, '-')}`,
      name: `${info.library_name} (libretro)`,
      extensions: info.valid_extensions.split('|').map((e: string) => `.${e}`),
      width: 320,   // Updated after ROM load
      height: 240,  // Updated after ROM load
      fps: 60,      // Updated after ROM load
      sampleRate: 44100,
      pixelAspectRatio: 1,
      maxPlayers: 2,
      buttons: this.getDefaultButtons(),
      colorSpace: 'rgb24', // We convert internally
    };
  }

  private getDefaultButtons(): ButtonDefinition[] {
    // Standard libretro joypad layout
    return [
      { id: RETRO_DEVICE_ID_JOYPAD.A, name: 'A', defaultKey: 'k', defaultGamepad: 'A' },
      { id: RETRO_DEVICE_ID_JOYPAD.B, name: 'B', defaultKey: 'j', defaultGamepad: 'B' },
      { id: RETRO_DEVICE_ID_JOYPAD.X, name: 'X', defaultKey: 'i', defaultGamepad: 'X' },
      { id: RETRO_DEVICE_ID_JOYPAD.Y, name: 'Y', defaultKey: 'u', defaultGamepad: 'Y' },
      { id: RETRO_DEVICE_ID_JOYPAD.L, name: 'L', defaultKey: 'q', defaultGamepad: 'LB' },
      { id: RETRO_DEVICE_ID_JOYPAD.R, name: 'R', defaultKey: 'e', defaultGamepad: 'RB' },
      { id: RETRO_DEVICE_ID_JOYPAD.SELECT, name: 'Select', defaultKey: ' ', defaultGamepad: 'Back' },
      { id: RETRO_DEVICE_ID_JOYPAD.START, name: 'Start', defaultKey: 'Enter', defaultGamepad: 'Start' },
      { id: RETRO_DEVICE_ID_JOYPAD.UP, name: 'Up', defaultKey: 'w', defaultGamepad: 'DPadUp' },
      { id: RETRO_DEVICE_ID_JOYPAD.DOWN, name: 'Down', defaultKey: 's', defaultGamepad: 'DPadDown' },
      { id: RETRO_DEVICE_ID_JOYPAD.LEFT, name: 'Left', defaultKey: 'a', defaultGamepad: 'DPadLeft' },
      { id: RETRO_DEVICE_ID_JOYPAD.RIGHT, name: 'Right', defaultKey: 'd', defaultGamepad: 'DPadRight' },
    ];
  }

  getSystemInfo(): SystemInfo {
    return this.systemInfo;
  }

  loadRom(romPath: string): void {
    this.romPath = romPath;
    this.romData = readFileSync(romPath);

    const gameInfo = {
      path: romPath,
      data: this.romData,
      size: this.romData.length,
      meta: null,
    };

    const success = this.api.retro_load_game(gameInfo);
    if (!success) {
      throw new Error(`Failed to load ROM: ${romPath}`);
    }

    // Update system info with actual values
    const avInfo = { geometry: {}, timing: {} } as any;
    this.api.retro_get_system_av_info(avInfo);

    this.systemInfo.width = avInfo.geometry.base_width;
    this.systemInfo.height = avInfo.geometry.base_height;
    this.systemInfo.fps = avInfo.timing.fps;
    this.systemInfo.sampleRate = avInfo.timing.sample_rate;
    this.systemInfo.pixelAspectRatio = avInfo.geometry.aspect_ratio || 1;

    // Set up controller ports
    this.api.retro_set_controller_port_device(0, RETRO_DEVICE.JOYPAD);
    this.api.retro_set_controller_port_device(1, RETRO_DEVICE.JOYPAD);
  }

  reset(): void {
    this.api.retro_reset();
  }

  destroy(): void {
    this.api.retro_unload_game();
    this.api.retro_deinit();
    this.callbacks.destroy();
    this.api.destroy();
  }

  runFrame(): void {
    this.api.retro_run();

    // Push audio samples if callback is set
    if (this.audioCallback && this.callbacks.audioSamples > 0) {
      const samples = this.callbacks.drainAudio();
      this.audioCallback(samples);
    }
  }

  isFrameComplete(): boolean {
    return true; // libretro cores always complete one frame per run()
  }

  getFramebuffer(): Uint8Array {
    const fb = this.callbacks.framebuffer;
    if (!fb) return new Uint8Array(0);

    // Convert to RGB24 based on pixel format
    return this.convertFramebuffer(
      fb,
      this.callbacks.frameWidth,
      this.callbacks.frameHeight,
      this.callbacks.framePitch
    );
  }

  private convertFramebuffer(
    data: Uint8Array,
    width: number,
    height: number,
    pitch: number
  ): Uint8Array {
    const format = this.envHandler.getPixelFormat();
    const output = new Uint8Array(width * height * 3);
    let outIdx = 0;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * pitch;

      for (let x = 0; x < width; x++) {
        let r: number, g: number, b: number;

        switch (format) {
          case RETRO_PIXEL_FORMAT.XRGB8888: {
            const idx = rowOffset + x * 4;
            b = data[idx];
            g = data[idx + 1];
            r = data[idx + 2];
            break;
          }
          case RETRO_PIXEL_FORMAT.RGB565: {
            const idx = rowOffset + x * 2;
            const pixel = data[idx] | (data[idx + 1] << 8);
            r = ((pixel >> 11) & 0x1f) << 3;
            g = ((pixel >> 5) & 0x3f) << 2;
            b = (pixel & 0x1f) << 3;
            break;
          }
          case RETRO_PIXEL_FORMAT.XRGB1555:
          default: {
            const idx = rowOffset + x * 2;
            const pixel = data[idx] | (data[idx + 1] << 8);
            r = ((pixel >> 10) & 0x1f) << 3;
            g = ((pixel >> 5) & 0x1f) << 3;
            b = (pixel & 0x1f) << 3;
            break;
          }
        }

        output[outIdx++] = r;
        output[outIdx++] = g;
        output[outIdx++] = b;
      }
    }

    return output;
  }

  // Audio
  private audioCallback: ((samples: Float32Array) => void) | null = null;

  getAudioConfig(): AudioConfig {
    return {
      sampleRate: this.systemInfo.sampleRate,
      channels: 2, // libretro is always stereo
    };
  }

  setAudioCallback(callback: ((samples: Float32Array) => void) | null): void {
    this.audioCallback = callback;
  }

  // Input
  setButtonState(port: number, button: number, pressed: boolean): void {
    this.callbacks.setButtonState(port, button, pressed);
  }

  getButtonState(port: number): Map<number, boolean> {
    return this.callbacks.getButtonState(port);
  }

  // State management
  getState(): CoreState {
    const size = this.api.retro_serialize_size();
    const buffer = Buffer.alloc(size);
    const success = this.api.retro_serialize(buffer, size);

    return {
      version: 1,
      coreId: this.systemInfo.id,
      gameId: this.romPath,
      data: {
        state: success ? buffer.toString('base64') : null,
      },
    };
  }

  setState(state: CoreState): void {
    if (state.coreId !== this.systemInfo.id) {
      throw new Error(`State core mismatch: expected ${this.systemInfo.id}, got ${state.coreId}`);
    }

    const stateData = state.data.state as string | null;
    if (!stateData) return;

    const buffer = Buffer.from(stateData, 'base64');
    const success = this.api.retro_unserialize(buffer, buffer.length);

    if (!success) {
      throw new Error('Failed to load state');
    }
  }

  getStateVersion(): number {
    return 1;
  }

  // Battery save
  hasBatterySave(): boolean {
    return this.api.retro_get_memory_size(RETRO_MEMORY.SAVE_RAM) > 0;
  }

  getBatteryRam(): Uint8Array | null {
    const size = this.api.retro_get_memory_size(RETRO_MEMORY.SAVE_RAM);
    if (size === 0) return null;

    const data = this.api.retro_get_memory_data(RETRO_MEMORY.SAVE_RAM);
    if (!data) return null;

    return new Uint8Array(data);
  }

  setBatteryRam(data: Uint8Array): void {
    const ptr = this.api.retro_get_memory_data(RETRO_MEMORY.SAVE_RAM);
    if (!ptr) return;

    const size = this.api.retro_get_memory_size(RETRO_MEMORY.SAVE_RAM);
    const copySize = Math.min(data.length, size);
    data.copy(ptr, 0, 0, copySize);
  }
}

// Memory constants
const RETRO_MEMORY = {
  SAVE_RAM: 0,
  RTC: 1,
  SYSTEM_RAM: 2,
  VIDEO_RAM: 3,
};

const RETRO_DEVICE = {
  NONE: 0,
  JOYPAD: 1,
  MOUSE: 2,
  KEYBOARD: 3,
  LIGHTGUN: 4,
  ANALOG: 5,
};
```

---

## Core Discovery and Registration

### Dynamic Core Loading

```typescript
// src/cores/libretro/loader.ts

import { existsSync, readdirSync } from 'fs';
import { join, basename, extname } from 'path';
import { platform } from 'os';
import { LibretroCore } from './index.js';
import { registerCore } from '../../frontend/core-registry.js';

/** Platform-specific library extension */
function getLibraryExtension(): string {
  switch (platform()) {
    case 'darwin': return '.dylib';
    case 'win32': return '.dll';
    default: return '.so';
  }
}

/** Scan directory for libretro cores and register them */
export function loadLibretroCores(coreDirectory: string): void {
  if (!existsSync(coreDirectory)) return;

  const ext = getLibraryExtension();
  const files = readdirSync(coreDirectory).filter(f => f.endsWith(`_libretro${ext}`));

  for (const file of files) {
    const corePath = join(coreDirectory, file);
    const coreName = basename(file, `_libretro${ext}`);

    try {
      // Create a temporary instance to get system info
      const tempCore = new LibretroCore(corePath);
      const info = tempCore.getSystemInfo();
      tempCore.destroy();

      // Register core factory
      registerCore(info.id, {
        create: () => new LibretroCore(corePath),
        extensions: info.extensions,
        name: info.name,
      });

      console.log(`Loaded libretro core: ${info.name}`);
    } catch (error) {
      console.warn(`Failed to load libretro core ${file}:`, error);
    }
  }
}
```

### CLI Integration

```typescript
// In src/index.ts

import { loadLibretroCores } from './cores/libretro/loader.js';

// Load libretro cores from default locations
const coreSearchPaths = [
  './cores',                                    // Local cores directory
  join(homedir(), '.config/emoemu/cores'),     // User config
  '/usr/lib/libretro',                          // System (Linux)
  '/usr/local/lib/libretro',                    // Homebrew (macOS)
];

for (const path of coreSearchPaths) {
  loadLibretroCores(path);
}
```

---

## Considerations and Challenges

### Memory Management

1. **Framebuffer Copying**: Native framebuffer must be copied in the callback since it may be invalidated after the callback returns.

2. **String Handling**: Environment callbacks that return strings (paths) require careful native memory allocation.

3. **Buffer Lifetimes**: ROM data must remain valid for the lifetime of the core.

### Thread Safety

1. **Single-Threaded**: Libretro cores expect single-threaded operation. Do not call core functions from multiple threads.

2. **Callback Context**: Callbacks execute in the same thread as `retro_run()`.

### Core Compatibility

Not all libretro cores will work:

| Category | Compatibility |
|----------|--------------|
| Software-rendered cores | Full support |
| OpenGL cores | Not supported (no GL context) |
| Vulkan cores | Not supported |
| Hardware-accelerated cores | Not supported |
| Cores requiring BIOS files | Requires user to provide BIOS |

### Performance Considerations

1. **FFI Overhead**: Each callback incurs FFI crossing overhead. The video callback is called once per frame, audio potentially multiple times.

2. **Buffer Conversion**: Pixel format conversion adds CPU overhead. Consider caching converted buffers.

3. **Memory Copies**: Minimize copies between native and JS buffers where possible.

### Supported Cores (Initial Target)

| Core | System | Status |
|------|--------|--------|
| picodrive | Sega Genesis/MD, SMS, Game Gear, 32X, Sega CD | Target |
| gambatte | Game Boy / Game Boy Color | Target (alternative to native) |
| mgba | Game Boy Advance | Target |
| snes9x | SNES | Target (alternative to native) |
| nestopia | NES | Target (alternative to native) |
| fceumm | NES | Target (alternative to native) |

---

## Dependencies

### Required Packages

```json
{
  "dependencies": {
    "koffi": "^2.8.0"
  }
}
```

### Alternative FFI Libraries

| Library | Pros | Cons |
|---------|------|------|
| koffi | Fast, modern, good callback support | Newer, less battle-tested |
| node-ffi-napi | Well-established, widely used | Slower, complex callback setup |
| sbffi | Very fast | Limited features |

**Recommendation**: Use `koffi` for its superior callback support and performance.

---

## Testing Strategy

### Unit Tests

1. **API Binding Tests**: Verify function signatures match libretro header
2. **Environment Handler Tests**: Test command parsing and responses
3. **Pixel Format Conversion Tests**: Verify correct color conversion

### Integration Tests

1. **Core Loading**: Test loading various core types
2. **ROM Loading**: Test ROM load/unload cycle
3. **Frame Execution**: Verify frame output and timing
4. **State Save/Load**: Test serialization round-trip
5. **Input Mapping**: Verify button state propagation

### Manual Testing

1. Test with reference cores (picodrive, gambatte)
2. Verify audio/video sync
3. Test save states across core restarts
4. Verify battery save persistence

---

## Future Enhancements

1. **Core Options UI**: Expose core-specific options (e.g., region, video filters)
2. **Subsystem Support**: Support cores with multiple content types (e.g., BIOS + ROM)
3. **Cheats**: Implement cheat code interface
4. **Rewind**: Leverage libretro's serialization for rewind feature
5. **Run-Ahead**: Reduce input latency using state save/load
6. **Disk Control**: Support multi-disc games (PlayStation)

---

## Appendix: Libretro API Reference

### Essential Functions

| Function | Description |
|----------|-------------|
| `retro_init()` | Initialize core (call once) |
| `retro_deinit()` | Cleanup core (call once) |
| `retro_load_game()` | Load ROM/content |
| `retro_unload_game()` | Unload ROM/content |
| `retro_run()` | Execute one frame |
| `retro_reset()` | Reset to power-on state |
| `retro_serialize()` | Save state to buffer |
| `retro_unserialize()` | Load state from buffer |

### Callback Registration Order

```
1. retro_set_environment()    # Before retro_init() for some cores
2. retro_init()
3. retro_set_video_refresh()
4. retro_set_audio_sample_batch()
5. retro_set_input_poll()
6. retro_set_input_state()
7. retro_load_game()
8. retro_get_system_av_info()  # After load_game()
9. Main loop: retro_run()
```

### Resources

- [Libretro Documentation](https://docs.libretro.com/)
- [libretro.h Header](https://github.com/libretro/libretro-common/blob/master/include/libretro.h)
- [RetroArch Core Downloads](https://buildbot.libretro.com/nightly/)
