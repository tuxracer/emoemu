# Multi-Core Architecture - Technical Requirements Document

This document describes the architecture for restructuring TUI-NES into a multi-core emulator that can support multiple gaming systems (NES, GBA, and future systems) with shared infrastructure.

## Overview

### Goals

1. **Modularity**: Separate system-specific emulation (cores) from shared infrastructure (frontend)
2. **Extensibility**: Enable adding new systems (GBA, SNES, GB) without modifying shared code
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
  /** Unique identifier (e.g., "nes", "gba") */
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
  colorSpace: 'palette' | 'rgb15' | 'rgb24';

  /** For palette mode: RGB triplets (e.g., 64×3 = 192 bytes for NES) */
  palette?: Uint8Array;
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

### CoreState

Serialized state for save/load operations.

```typescript
interface CoreState {
  /** State format version (for migration) */
  version: number;

  /** Core identifier (validates correct core) */
  coreId: string;

  /** Game identifier (ROM path or checksum) */
  gameId: string;

  /** Serialized state data (opaque to frontend) */
  data: Record<string, unknown>;
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

  /** Serialize current state */
  getState(): CoreState;

  /** Restore from saved state */
  setState(state: CoreState): void;

  /** Get state format version */
  getStateVersion(): number;

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

| System | CPU Clock | PPU Ratio | Frame Rate |
|--------|-----------|-----------|------------|
| NES    | 1.79 MHz  | 3:1       | 60.0988 fps |
| GBA    | 16.78 MHz | PPU-driven | 59.7275 fps |
| SNES   | 3.58 MHz  | Variable  | 60.0988 fps |

**Decision**: `runFrame()` abstracts internal timing. Each core manages its own CPU/PPU synchronization. The frontend uses `SystemInfo.fps` for frame pacing.

### Input Mapping

Different systems have different button counts:
- **NES**: 8 buttons (A, B, Select, Start, D-pad)
- **GBA**: 10 buttons (A, B, L, R, Select, Start, D-pad)
- **SNES**: 12 buttons (A, B, X, Y, L, R, Select, Start, D-pad)

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

| System | Color Format | Palette Size |
|--------|--------------|--------------|
| NES    | 6-bit palette indices | 64 colors |
| GBA    | 15-bit RGB (xBBBBBGGGGGRRRRR) | Direct |
| SNES   | 15-bit RGB or palette | Variable |

**Decision**: `SystemInfo.colorSpace` specifies format. Renderers convert to RGB24 for display.

```typescript
function framebufferToRgb24(fb: Uint8Array | Uint16Array, info: SystemInfo): Uint8Array {
  switch (info.colorSpace) {
    case 'palette':
      // Map indices through info.palette
    case 'rgb15':
      // Expand 5-5-5 to 8-8-8
    case 'rgb24':
      // Pass through
  }
}
```

### Audio Output

| System | Sample Rate | Channels |
|--------|-------------|----------|
| NES    | 44100 Hz    | Mono     |
| GBA    | 32768 Hz    | Stereo   |

**Decision**: Callback-based audio with configurable sample rate. Frontend's RtAudio wrapper handles the output device.

### State Management

**Decision**: `CoreState` includes metadata for validation:
- `version`: Detect incompatible state formats
- `coreId`: Prevent loading NES state into GBA core
- `gameId`: Warn if state doesn't match current ROM

---

## Directory Structure

### Proposed Layout

```
src/
├── index.ts                    # CLI entry point
│
├── core/
│   ├── core.ts                 # Core interface definitions
│   └── button.ts               # StandardButton enum
│
├── frontend/
│   ├── emulator.ts             # Main loop, orchestrates core + frontend
│   ├── audio.ts                # RtAudio wrapper, sample buffering
│   ├── state-manager.ts        # Save/load, gzip, validation
│   └── core-registry.ts        # Core discovery and instantiation
│
├── input/
│   ├── input-manager.ts        # Keyboard (Kitty protocol) [existing]
│   ├── gamepad-manager.ts      # HID gamepad support [existing]
│   ├── gamepad-profiles.ts     # Controller profiles [existing]
│   ├── input-mapper.ts         # Physical → core button mapping [new]
│   └── controller.ts           # Generic controller state [modified]
│
├── rendering/
│   ├── renderer.ts             # Renderer interface + TerminalRenderer
│   ├── kitty-renderer.ts       # Kitty graphics protocol
│   └── palette.ts              # Color utilities
│
├── cores/
│   ├── nes/
│   │   ├── index.ts            # NESCore class (implements Core)
│   │   ├── cpu.ts              # 6502 CPU [from src/cpu/]
│   │   ├── opcodes.ts          # Opcode handlers [from src/cpu/]
│   │   ├── addressing.ts       # Addressing modes [from src/cpu/]
│   │   ├── ppu.ts              # PPU [from src/ppu/ppu.ts]
│   │   ├── apu.ts              # APU [from src/apu/]
│   │   ├── bus.ts              # Memory bus [from src/memory/]
│   │   ├── cartridge.ts        # ROM loading [from src/cartridge/]
│   │   └── mappers/
│   │       └── mapper.ts       # All mappers [from src/cartridge/mappers/]
│   │
│   └── gba/                    # Future: Game Boy Advance
│       ├── index.ts            # GBACore class
│       ├── arm7tdmi.ts         # ARM7TDMI CPU
│       ├── thumb.ts            # Thumb instruction set
│       ├── ppu.ts              # GBA PPU (240×160)
│       ├── apu.ts              # GBA sound
│       ├── bus.ts              # GBA memory map
│       └── cartridge.ts        # GBA ROM handling
│
└── types/
    └── *.d.ts                  # Type declarations
```

### File Mapping (Current → New)

| Current Path | New Path |
|--------------|----------|
| `src/emulator.ts` | Split: `src/frontend/emulator.ts` + `src/cores/nes/index.ts` |
| `src/cpu/*` | `src/cores/nes/cpu.ts`, `opcodes.ts`, `addressing.ts` |
| `src/ppu/ppu.ts` | `src/cores/nes/ppu.ts` |
| `src/ppu/renderer.ts` | `src/rendering/renderer.ts` |
| `src/ppu/kitty-renderer.ts` | `src/rendering/kitty-renderer.ts` |
| `src/ppu/palette.ts` | `src/rendering/palette.ts` |
| `src/apu/*` | `src/cores/nes/apu.ts` |
| `src/memory/bus.ts` | `src/cores/nes/bus.ts` |
| `src/cartridge/*` | `src/cores/nes/cartridge.ts`, `mappers/` |
| `src/input/*` | `src/input/*` (mostly unchanged) |

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
  ['nes', {
    create: () => new NESCore(),
    extensions: ['.nes', '.unf'],
  }],
  // Future:
  // ['gba', {
  //   create: () => new GBACore(),
  //   extensions: ['.gba', '.agb'],
  // }],
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

## NESCore Implementation

### System Info

```typescript
const NES_SYSTEM_INFO: SystemInfo = {
  id: 'nes',
  name: 'Nintendo Entertainment System',
  extensions: ['.nes', '.unf'],
  width: 256,
  height: 240,
  fps: 60.0988,
  sampleRate: 44100,
  pixelAspectRatio: 8 / 7,
  maxPlayers: 2,
  buttons: [
    { id: 0, name: 'A', defaultKey: 'k', defaultGamepad: 'A' },
    { id: 1, name: 'B', defaultKey: 'j', defaultGamepad: 'B' },
    { id: 2, name: 'Select', defaultKey: ' ', defaultGamepad: 'Back' },
    { id: 3, name: 'Start', defaultKey: 'Enter', defaultGamepad: 'Start' },
    { id: 4, name: 'Up', defaultKey: 'w', defaultGamepad: 'DPadUp' },
    { id: 5, name: 'Down', defaultKey: 's', defaultGamepad: 'DPadDown' },
    { id: 6, name: 'Left', defaultKey: 'a', defaultGamepad: 'DPadLeft' },
    { id: 7, name: 'Right', defaultKey: 'd', defaultGamepad: 'DPadRight' },
  ],
  colorSpace: 'palette',
  palette: NES_PALETTE,  // 64×3 = 192 bytes
};
```

### Core Class Structure

```typescript
class NESCore implements Core {
  private cpu: CPU;
  private ppu: PPU;
  private apu: APU;
  private bus: Bus;
  private cartridge: Cartridge;
  private buttonState: Map<number, Map<number, boolean>>;
  private audioCallback: ((samples: Float32Array) => void) | null;

  getSystemInfo(): SystemInfo { return NES_SYSTEM_INFO; }

  loadRom(romPath: string): void {
    this.cartridge = new Cartridge(romPath);
    this.bus = new Bus();
    this.ppu = new PPU();
    this.cpu = new CPU(this.bus);
    this.apu = new APU();

    // Connect components
    this.bus.connectPPU(this.ppu);
    this.bus.connectCartridge(this.cartridge);
    this.bus.connectAPU(this.apu);
    this.ppu.connectCartridge(this.cartridge);

    // Wire button state (replaces Controller objects)
    this.bus.setButtonCallback((port, button) =>
      this.buttonState.get(port)?.get(button) ?? false
    );

    // Wire audio
    this.apu.onSamplesReady = (samples) => this.audioCallback?.(samples);
  }

  runFrame(): void {
    this.ppu.frameComplete = false;

    while (!this.ppu.frameComplete) {
      const cpuCycles = this.cpu.step();

      // PPU clocks at 3× CPU rate
      for (let i = 0; i < cpuCycles * 3; i++) {
        this.ppu.clock();
        if (this.ppu.shouldGenerateNMI()) {
          this.ppu.clearNMI();
          this.cpu.nmi();
        }
        if (this.cartridge.irqPending()) {
          this.cpu.irq();
        }
      }

      // APU clocks at CPU rate
      for (let i = 0; i < cpuCycles; i++) {
        this.apu.clock();
      }

      if (this.apu.irqPending()) {
        this.cpu.irq();
      }

      // Handle OAM DMA
      const dma = this.bus.doDma();
      if (dma.active && dma.data) {
        this.ppu.oamDma(dma.data);
      }
    }
  }

  getFramebuffer(): Uint8Array { return this.ppu.frameBuffer; }

  setButtonState(port: number, button: number, pressed: boolean): void {
    this.buttonState.get(port)?.set(button, pressed);
  }

  getState(): CoreState {
    return {
      version: 2,
      coreId: 'nes',
      gameId: this.romPath,
      data: {
        cpu: this.cpu.getState(),
        ppu: this.ppu.getState(),
        apu: this.apu.getState(),
        bus: this.bus.getState(),
        cartridge: this.cartridge.getState(),
      },
    };
  }

  // ... remaining methods
}
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

## Migration Plan

### Phase 1: Create Core Infrastructure (Non-Breaking)

1. Create `src/core/core.ts` with interface definitions
2. Create `src/core/button.ts` with StandardButton enum
3. Create `src/frontend/core-registry.ts`
4. Create `src/input/input-mapper.ts`

**Verification**: TypeScript compiles, no runtime changes.

### Phase 2: Refactor NES into NESCore

1. Create `src/cores/nes/` directory
2. Copy existing components (cpu, ppu, apu, bus, cartridge)
3. Create `NESCore` class implementing Core interface
4. Modify Bus to use button callback instead of Controller objects
5. Add re-exports for backward compatibility

**Verification**: Existing imports still work, NESCore passes unit tests.

### Phase 3: Create Shared Frontend

1. Extract audio setup from emulator.ts → `src/frontend/audio.ts`
2. Extract state management → `src/frontend/state-manager.ts`
3. Move renderers to `src/rendering/`
4. Create new `src/frontend/emulator.ts` using Core interface

**Verification**: Emulator runs via new frontend with NESCore.

### Phase 4: Update CLI and Entry Point

1. Update `src/index.ts` to use core registry
2. Add `--core <id>` CLI option for explicit core selection
3. Add `--list-cores` to show available cores
4. Update help text

**Verification**: `tui-nes game.nes` auto-detects NES core and runs.

### Phase 5: Cleanup and Documentation

1. Remove old file locations after all imports updated
2. Update CLAUDE.md with new structure
3. Update README with multi-core information
4. Add integration tests for core interface

**Verification**: Full test suite passes, documentation accurate.

---

## Future: GBA Core

With this architecture, adding GBA requires:

```typescript
const GBA_SYSTEM_INFO: SystemInfo = {
  id: 'gba',
  name: 'Game Boy Advance',
  extensions: ['.gba', '.agb'],
  width: 240,
  height: 160,
  fps: 59.7275,
  sampleRate: 32768,
  pixelAspectRatio: 1,
  maxPlayers: 1,
  buttons: [
    { id: 0, name: 'A', ... },
    { id: 1, name: 'B', ... },
    { id: 2, name: 'L', ... },
    { id: 3, name: 'R', ... },
    { id: 4, name: 'Select', ... },
    { id: 5, name: 'Start', ... },
    { id: 6, name: 'Up', ... },
    { id: 7, name: 'Down', ... },
    { id: 8, name: 'Left', ... },
    { id: 9, name: 'Right', ... },
  ],
  colorSpace: 'rgb15',
};
```

GBA core implementation requires:
- ARM7TDMI CPU (32-bit ARM + 16-bit Thumb)
- GBA PPU (4 BG modes, rotation/scaling, alpha blending)
- GBA APU (4 GB channels + 2 DirectSound DMA channels)
- GBA memory map (96KB VRAM, 256KB WRAM, 32KB IWRAM)
- GBA cartridge handling (up to 32MB ROM)

---

## Appendix: System Comparison

| Aspect | NES | GBA |
|--------|-----|-----|
| CPU | 6502 @ 1.79 MHz | ARM7TDMI @ 16.78 MHz |
| Resolution | 256×240 | 240×160 |
| Colors | 64 palette | 32,768 (15-bit RGB) |
| Audio | 5 channels, mono | 6 channels, stereo |
| Max ROM | 512 KB | 32 MB |
| Controllers | 8 buttons × 2 | 10 buttons × 1 |
| Timing | CPU-driven | PPU-driven |
