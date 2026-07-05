# Multi-Core Architecture - Technical Requirements Document

This document describes the multi-core architecture of emoemu, which supports any system via libretro cores.

## Overview

### Goals

1. **Modularity**: Separate system-specific emulation (cores) from shared infrastructure (frontend)
2. **Extensibility**: Enable adding new systems via libretro cores without modifying shared code
3. **Code Reuse**: Share input handling, rendering, audio output, and state management across cores
4. **Consistency**: Provide a unified user experience regardless of which system is being emulated

### Architecture Model

The architecture follows the **libretro model** with a clear separation between:
- **Cores**: System-specific emulation (CPU, PPU, APU, memory, cartridge/ROM)
- **Frontend**: Shared infrastructure (CLI, input, rendering, audio output, state management)

Unlike libretro's C ABI approach, this TypeScript implementation uses interfaces and dependency injection for type safety.

---

## Core Interface

### SystemInfo

Describes a core's capabilities and requirements. Called before loading a ROM.

```typescript
interface SystemInfo {
  /** Unique identifier (e.g., "nes", "gbc") */
  id: string;

  /** Human-readable name (e.g., "Nintendo Entertainment System") */
  name: string;

  /** File extensions this core handles (e.g., [".nes", ".unf"]) */
  extensions: string[];

  /** Native framebuffer dimensions */
  width: number;
  height: number;

  /** Target frames per second (e.g., 60.0988 for NES NTSC) */
  fps: number;

  /** Preferred audio sample rate in Hz */
  sampleRate: number;

  /** Pixel aspect ratio for correct display (e.g., 8/7 for NES) */
  pixelAspectRatio: number;

  /** Maximum controller ports */
  maxPlayers: number;

  /** Button definitions for this system */
  buttons: ButtonDefinition[];

  /** Framebuffer color format */
  colorSpace: 'rgb15' | 'rgb24';
}
```

### ButtonDefinition

Defines a button for input mapping.

```typescript
interface ButtonDefinition {
  /** Button ID (0-based index used in setButtonState) */
  id: number;

  /** Display name (e.g., "A", "Start", "L") */
  name: string;

  /** Suggested keyboard key */
  defaultKey: string;

  /** Suggested gamepad button */
  defaultGamepad: string;
}
```

### AudioConfig

Audio output configuration.

```typescript
interface AudioConfig {
  sampleRate: number;
  channels: 1 | 2;  // Mono or stereo
}
```

### Core Interface

Main interface that all system emulators implement.

```typescript
interface Core {
  //=== Lifecycle ===

  /** Get system capabilities (can be called before loadRom) */
  getSystemInfo(): SystemInfo;

  /** Load a ROM file */
  loadRom(romPath: string): void;

  /** Reset to power-on state */
  reset(): void;

  /** Clean up resources */
  destroy(): void;

  //=== Emulation ===

  /** Run one frame of emulation */
  runFrame(): void;

  /** Check if frame completed (for variable-rate systems) */
  isFrameComplete(): boolean;

  //=== Video Output ===

  /** Get current framebuffer (format per SystemInfo.colorSpace) */
  getFramebuffer(): Uint8Array | Uint16Array;

  //=== Audio Output ===

  /** Get audio configuration */
  getAudioConfig(): AudioConfig;

  /** Set callback for audio samples */
  setAudioCallback(callback: ((samples: Float32Array) => void) | null): void;

  //=== Input ===

  /** Set button state for a controller port */
  setButtonState(port: number, button: number, pressed: boolean): void;

  /** Get current button state (for status display) */
  getButtonState(port: number): Map<number, boolean>;

  //=== State Management ===

  /** Serialize current state (raw binary) */
  getState(): Buffer | null;

  /** Restore from saved state (raw binary) */
  setState(state: Buffer): void;

  //=== Battery/SRAM (Optional) ===

  /** Check for battery-backed saves */
  hasBatterySave(): boolean;

  /** Get battery RAM for saving */
  getBatteryRam(): Uint8Array | null;

  /** Load battery RAM from disk */
  setBatteryRam(data: Uint8Array): void;
}
```

---

## Design Decisions

### Timing Abstraction

**Decision**: `runFrame()` abstracts internal timing. Each core manages its own CPU/PPU synchronization. The frontend uses `SystemInfo.fps` for frame pacing. Libretro cores handle their own timing internally.

### Input Mapping

Different systems have different button counts:
- **NES**: 8 buttons (A, B, Select, Start, D-pad)
- **SNES-style (libretro)**: 12 buttons (A, B, X, Y, L, R, Select, Start, D-pad)

**Decision**: Frontend defines `StandardButton` enum for physical inputs. `InputMapper` translates to core-specific button IDs via name matching.

```typescript
enum StandardButton {
  A, B, X, Y,           // Face buttons
  L, R, L2, R2,         // Shoulder buttons
  Start, Select,        // Control buttons
  Up, Down, Left, Right // D-pad
}
```

### Color Space Handling

**Decision**: `SystemInfo.colorSpace` specifies format (`'rgb15'` or `'rgb24'`). Renderers convert to RGB24 for display. Libretro cores output various formats (XRGB8888, RGB565, XRGB1555) which are normalized to rgb15 or rgb24.

### Audio Output

**Decision**: Callback-based audio with configurable sample rate. Frontend's RtAudio wrapper handles the output device. Libretro cores output stereo audio at various sample rates.

### State Management

**Decision**: All cores use raw binary save states (compatible with RetroArch). The frontend handles save/load as opaque `Buffer` data.

---

## Directory Structure

### Proposed Layout

```
src/
├── index.ts                    # CLI entry point, main loop
├── cli/                        # CLI argument parsing and commands
│   ├── parseArgs/              # Argument parsing, config-to-options mapping
│   ├── commands/               # CLI commands (usage, install-core, playlist, etc.)
│   └── runEmulator/            # Emulator launch, state file validation
│
├── Emulator/                   # Main emulation loop, renderer orchestration
│   ├── saveState/              # Save state and battery save (.srm) management
│   ├── screenshot/             # Screenshot capture, thumbnails
│   └── terminalDimensions/     # Terminal display size calculation
│
├── core/                       # Core interface definitions (Core, SystemInfo, AudioConfig)
│
├── frontend/                   # Shared infrastructure (audio, notifications, state)
│
├── input/                      # Keyboard (Kitty protocol) and gamepad (node-hid) handling
│
├── rendering/                  # Kitty graphics, Unicode half-blocks, ASCII, emoji renderers
│
├── cores/
│   └── libretro/               # Libretro core wrapper
│       ├── index.ts            # LibretroCore class (implements Core interface)
│       ├── api/                # FFI bindings using koffi
│       ├── environment/        # Environment callback handler
│       └── ...                 # Callbacks, pixel format, loader, etc.
│
├── netplay/                    # RetroArch-compatible netplay (rollback, LAN discovery)
│
├── ui/                         # React/Ink TUI
│   └── RomBrowser/             # ROM browser, settings, netplay panels
│
└── types/
    └── *.d.ts                  # Type declarations
```

---

## Core Registry

Discovers and instantiates cores based on ROM file extension.

```typescript
// src/frontend/core-registry.ts

interface CoreFactory {
  create(): Core;
  extensions: string[];
}

const cores = new Map<string, CoreFactory>([
  // Libretro cores are registered dynamically via loader.ts
]);

/** Auto-detect core from file extension */
function detectCore(romPath: string): Core | null {
  const ext = romPath.toLowerCase().match(/\.[^.]+$/)?.[0];
  for (const [, factory] of cores) {
    if (factory.extensions.includes(ext)) {
      return factory.create();
    }
  }
  return null;
}

/** Get core by ID */
function getCore(id: string): Core | null {
  return cores.get(id)?.create() ?? null;
}

/** List available cores */
function listCores(): Array<{ id: string; name: string; extensions: string[] }>;
```

---

## Frontend Emulator

The shared frontend orchestrates the core and handles I/O.

```typescript
// src/frontend/emulator.ts

class Emulator {
  private core: Core;
  private systemInfo: SystemInfo;
  private renderer: Renderer;
  private audioManager: AudioManager;
  private stateManager: StateManager;
  private inputMapper: InputMapper;

  constructor(options: FrontendOptions) {
    // Auto-detect or use provided core
    this.core = options.core ?? detectCore(options.romPath);
    this.systemInfo = this.core.getSystemInfo();

    // Initialize shared infrastructure
    this.renderer = createRenderer(options.renderMode, this.systemInfo);
    this.audioManager = new AudioManager(this.core.getAudioConfig());
    this.stateManager = new StateManager(options.romPath, this.systemInfo.id);
    this.inputMapper = new InputMapper(this.systemInfo.buttons);

    // Load ROM and wire callbacks
    this.core.loadRom(options.romPath);
    this.core.setAudioCallback((s) => this.audioManager.pushSamples(s));
    this.inputMapper.onButtonChange = (port, btn, pressed) =>
      this.core.setButtonState(port, btn, pressed);
  }

  async run(): Promise<void> {
    const targetFrameTime = 1000 / this.systemInfo.fps;

    // Main loop
    while (this.running) {
      const start = performance.now();

      this.inputMapper.update();
      this.core.runFrame();
      this.renderFrame();
      this.updateStatusBar();

      // Frame pacing
      const elapsed = performance.now() - start;
      if (elapsed < targetFrameTime) {
        await sleep(targetFrameTime - elapsed);
      }
    }
  }

  private renderFrame(): void {
    const fb = this.core.getFramebuffer();
    const output = this.renderer.render(fb, this.systemInfo);
    process.stdout.write(output);
  }
}
```

---

## Input Mapper

Translates physical inputs to core-specific buttons.

```typescript
// src/input/input-mapper.ts

class InputMapper {
  private coreButtons: ButtonDefinition[];
  private standardToCore: Map<StandardButton, number>;
  private portState: Map<number, Map<number, boolean>>;

  onButtonChange?: (port: number, button: number, pressed: boolean) => void;

  constructor(coreButtons: ButtonDefinition[]) {
    this.coreButtons = coreButtons;
    this.standardToCore = this.buildMapping();
  }

  /** Build default mapping from StandardButton to core buttons by name */
  private buildMapping(): Map<StandardButton, number> {
    const map = new Map<StandardButton, number>();

    for (const btn of this.coreButtons) {
      const name = btn.name.toLowerCase();
      if (name === 'a') map.set(StandardButton.A, btn.id);
      else if (name === 'b') map.set(StandardButton.B, btn.id);
      else if (name === 'l') map.set(StandardButton.L, btn.id);
      else if (name === 'r') map.set(StandardButton.R, btn.id);
      else if (name === 'start') map.set(StandardButton.Start, btn.id);
      else if (name === 'select') map.set(StandardButton.Select, btn.id);
      else if (name === 'up') map.set(StandardButton.Up, btn.id);
      else if (name === 'down') map.set(StandardButton.Down, btn.id);
      else if (name === 'left') map.set(StandardButton.Left, btn.id);
      else if (name === 'right') map.set(StandardButton.Right, btn.id);
    }

    return map;
  }

  /** Handle keyboard input */
  handleKey(key: string, pressed: boolean, port = 0): void {
    const standard = this.keyToStandard(key);
    if (standard === undefined) return;

    const coreButton = this.standardToCore.get(standard);
    if (coreButton === undefined) return;

    this.setButton(port, coreButton, pressed);
  }

  private setButton(port: number, button: number, pressed: boolean): void {
    const state = this.portState.get(port);
    if (state?.get(button) !== pressed) {
      state?.set(button, pressed);
      this.onButtonChange?.(port, button, pressed);
    }
  }
}
```

---

## Appendix: Adding New Systems

New systems can be added via libretro cores without modifying emoemu code:

1. Download a libretro core from [RetroArch buildbot](https://buildbot.libretro.com/nightly/)
2. Place in `~/Library/Application Support/emoemu/cores/` (macOS), `~/.config/emoemu/cores/` (Linux), or `%APPDATA%\emoemu\cores\` (Windows)
3. The core will be auto-detected on next run

Popular libretro cores:
- **picodrive**: Sega Genesis/Mega Drive, Master System, Game Gear
- **mgba**: Game Boy Advance
- **gambatte**: Game Boy / Game Boy Color
- **bsnes** / **snes9x**: Super Nintendo
- **mednafen_pce**: PC Engine / TurboGrafx-16
