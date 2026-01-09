# TUI-NES - Terminal Retro Emulator

A terminal-based multi-core emulator written in TypeScript that renders graphics using the Kitty graphics protocol, Unicode half-blocks, or ASCII characters. Currently supports NES and Game Boy Color with architecture designed for additional cores (GBA, SNES, etc.).

## Quick Reference

```bash
pnpm run build         # Build the project
pnpm run start <rom>   # Run a ROM (auto-detects core)
pnpm run typecheck     # Type check without building
pnpm test              # Run tests
```

## Project Structure

```
src/
├── index.ts              # CLI entry point, argument parsing
├── emulator.ts           # Main emulation loop, renderer orchestration
│
├── core/                 # Multi-core interface definitions
│   ├── core.ts           # Core interface, SystemInfo, AudioConfig, CoreState
│   ├── button.ts         # StandardButton enum for input abstraction
│   └── index.ts          # Module exports
│
├── frontend/             # Shared frontend infrastructure
│   ├── core-registry.ts  # Core discovery and instantiation
│   ├── audio.ts          # AudioManager (RtAudio wrapper)
│   ├── state-manager.ts  # Save/load state handling with gzip compression
│   └── index.ts          # Module exports
│
├── cores/                # System-specific emulation cores
│   ├── nes/
│   │   ├── index.ts      # NESCore class (implements Core interface)
│   │   ├── cpu.ts        # 6502 CPU with registers, interrupts
│   │   ├── opcodes.ts    # All 151 official opcodes
│   │   ├── addressing.ts # 13 addressing modes
│   │   ├── ppu.ts        # PPU with background/sprite rendering
│   │   ├── apu.ts        # APU with all 5 channels
│   │   ├── bus.ts        # Memory bus, address decoding, DMA
│   │   ├── cartridge.ts  # iNES ROM parsing, mapper instantiation
│   │   └── mappers/
│   │       └── mapper.ts # All mappers: 0, 1, 2, 3, 4, 7, 9
│   │
│   └── gbc/              # Game Boy Color core
│       ├── index.ts      # GBCCore class (implements Core interface)
│       ├── cpu.ts        # Sharp LR35902 CPU (Z80-like)
│       ├── ppu.ts        # PPU with tile/sprite rendering, CGB palettes
│       ├── apu.ts        # APU with 4 channels, stereo output
│       ├── bus.ts        # Memory bus, I/O registers, speed switching
│       ├── timer.ts      # Timer/divider registers (DIV, TIMA, TMA, TAC)
│       └── cartridge.ts  # ROM parsing, MBC1/2/3/5 mappers
│
├── input/                # Input handling (shared)
│   ├── controller.ts     # NES controller shift register emulation
│   ├── input-manager.ts  # Keyboard input with Kitty protocol
│   ├── input-mapper.ts   # Physical → core button mapping
│   ├── gamepad-manager.ts # HID gamepad support
│   └── gamepad-profiles.ts # Controller profiles
│
├── rendering/            # Rendering infrastructure (shared)
│   ├── renderer.ts       # TerminalRenderer (Unicode half-blocks + ASCII)
│   ├── kitty-renderer.ts # Kitty graphics protocol renderer
│   ├── palette.ts        # NES palette, color utilities
│   └── index.ts          # Module exports
│
└── types/
    └── *.d.ts            # Type declarations
```

## Multi-Core Architecture

The emulator follows a **libretro-inspired** architecture separating system-specific emulation (cores) from shared infrastructure (frontend).

### Core Interface (`core/core.ts`)

All system emulators implement the `Core` interface:

```typescript
interface Core {
  // Lifecycle
  getSystemInfo(): SystemInfo;    // Capabilities (resolution, fps, buttons, colorSpace)
  loadRom(romPath: string): void;
  reset(): void;
  destroy(): void;

  // Emulation
  runFrame(): void;               // Run one frame of emulation
  isFrameComplete(): boolean;     // Check if frame finished (variable timing)

  // Video Output
  getFramebuffer(): Uint8Array | Uint16Array;  // Format per colorSpace

  // Audio Output
  getAudioConfig(): AudioConfig;  // { sampleRate, channels: 1|2 }
  setAudioCallback(cb): void;     // Wire audio output

  // Input
  setButtonState(port, btn, pressed): void;
  getButtonState(port): Map<number, boolean>;

  // State Management
  getState(): CoreState;          // Save state
  setState(state: CoreState): void;
  getStateVersion(): number;

  // Battery/SRAM (optional)
  hasBatterySave(): boolean;
  getBatteryRam(): Uint8Array | null;
  setBatteryRam(data: Uint8Array): void;
}

interface SystemInfo {
  id: string;                     // "nes", "gbc"
  name: string;                   // Human-readable name
  extensions: string[];           // [".nes"], [".gbc", ".gb"]
  width: number;                  // Native framebuffer width
  height: number;                 // Native framebuffer height
  fps: number;                    // Target FPS
  sampleRate: number;             // Audio sample rate
  pixelAspectRatio: number;       // For correct display aspect
  maxPlayers: number;             // Controller ports
  buttons: ButtonDefinition[];    // Input definitions
  colorSpace: 'palette' | 'rgb15' | 'rgb24';  // Framebuffer format
  palette?: Uint8Array;           // For palette mode
}
```

### Core Registry (`frontend/core-registry.ts`)

Cores self-register when imported. ROM files are auto-detected by extension:

```typescript
// Auto-detect core from file extension
const core = detectCore('game.nes');  // Returns NESCore

// Or explicitly select
const factory = getCoreFactory('nes');
const core = factory.create();
```

### Adding a New Core

1. Create `src/cores/<system>/` directory
2. Implement `Core` interface in `index.ts`
3. Call `registerCore('id', factory)` to register
4. Import the core module in `src/index.ts`

## NES Core Details

### Emulation Loop (`emulator.ts:runFrame`)

```
Per frame (until PPU sets frameComplete):
  1. CPU executes one instruction → returns cycle count
  2. PPU clocks 3x per CPU cycle
  3. APU clocks 1x per CPU cycle
  4. Check PPU NMI (vblank interrupt)
  5. Check mapper IRQ (MMC3 scanline counter)
  6. Check APU frame counter IRQ
  7. Handle OAM DMA if triggered
```

### CPU (`cores/nes/cpu.ts`)

- Registers: A, X, Y, SP (8-bit), PC (16-bit), Status flags (N,V,B,D,I,Z,C)
- Interrupts: `reset()`, `nmi()`, `irq()` - each reads vector from $FFFA-$FFFF
- Instruction execution: `step()` returns cycle count for PPU synchronization

### PPU (`cores/nes/ppu.ts`)

- 256x240 framebuffer (palette indices 0-63)
- Registers: $2000-$2007 (PPUCTRL, PPUMASK, PPUSTATUS, etc.)
- Internal registers: v, t (VRAM address), x (fine scroll), w (write toggle)
- Background: nametables, pattern tables, attribute tables
- Sprites: 64 in OAM, 8 per scanline limit, sprite 0 hit detection
- Timing: 341 cycles/scanline, 262 scanlines/frame (NTSC)

### APU (`cores/nes/apu.ts`)

- **Pulse 1 & 2**: Square waves with duty cycle, sweep, envelope
- **Triangle**: Triangle wave with linear counter
- **Noise**: LFSR-based noise with short/long mode
- **DMC**: Delta modulation channel for sample playback
- Frame counter: 4-step (with IRQ) or 5-step mode
- Mixer: Uses NESDev wiki lookup formula
- Audio output: 44100 Hz sample rate

### Mappers (`cores/nes/mappers/mapper.ts`)

All mappers in single file. Interface:
```typescript
interface Mapper {
  cpuRead(address: number): number;
  cpuWrite(address: number, data: number): void;
  ppuRead(address: number): number;
  ppuWrite(address: number, data: number): void;
  mirrorMode?: number;      // 0=horizontal, 1=vertical, 2/3=single-screen
  irqPending?(): boolean;   // For MMC3
  acknowledgeIrq?(): void;
}
```

**Implemented:**
- Mapper 0 (NROM): Direct ROM access, handles 16KB/32KB PRG
- Mapper 1 (MMC1): Shift register banking, 16KB/32KB PRG modes, 4KB/8KB CHR
- Mapper 2 (UxROM): Simple 16KB PRG bank switching
- Mapper 3 (CNROM): Simple 8KB CHR bank switching
- Mapper 4 (MMC3): 8KB PRG banks, 1KB CHR banks, scanline IRQ
- Mapper 7 (AxROM): 32KB PRG bank switching, single-screen mirroring
- Mapper 9 (MMC2): Tile-based CHR bank switching for Punch-Out!!

### NES Memory Map

```
$0000-$07FF  2KB RAM (mirrored to $1FFF)
$2000-$2007  PPU registers (mirrored to $3FFF)
$4000-$4017  APU/IO registers
$4014        OAM DMA
$4016-$4017  Controller ports
$6000-$7FFF  PRG RAM (battery-backed)
$8000-$FFFF  PRG ROM (mapper-controlled)
```

## GBC Core Details

### System Specs

- **Resolution**: 160x144 pixels
- **Frame rate**: 59.7275 fps (4194304 Hz / 70224 cycles per frame)
- **Color space**: RGB15 (15-bit color, xBBBBBGGGGGRRRRR)
- **Audio**: Stereo, 44100 Hz sample rate

### CPU (`cores/gbc/cpu.ts`)

- Sharp LR35902 (Z80-like with differences)
- Registers: A, F (flags), B, C, D, E, H, L (8-bit), SP, PC (16-bit)
- Flags: Z (zero), N (subtract), H (half-carry), C (carry)
- Interrupts: VBlank, LCD STAT, Timer, Serial, Joypad
- CGB double-speed mode support

### PPU (`cores/gbc/ppu.ts`)

- 160x144 framebuffer (RGB15 format)
- Tile-based rendering with 8x8 tiles
- Background: 32x32 tile maps, scrolling support
- Window: overlay layer with separate position
- Sprites: 40 in OAM, 10 per scanline limit
- CGB features: 8 background palettes, 8 sprite palettes, VRAM banks

### APU (`cores/gbc/apu.ts`)

- **Channel 1**: Square wave with sweep, envelope
- **Channel 2**: Square wave with envelope
- **Channel 3**: Programmable wave (32 samples)
- **Channel 4**: Noise with LFSR
- Stereo panning per channel
- Audio output: 44100 Hz, 2 channels

### Timer (`cores/gbc/timer.ts`)

- DIV: Divider register (increments at 16384 Hz)
- TIMA: Timer counter
- TMA: Timer modulo (reload value)
- TAC: Timer control (enable, frequency select)

### Cartridge/MBC (`cores/gbc/cartridge.ts`)

Memory Bank Controllers implemented:
- **No MBC**: Direct ROM access (32KB max)
- **MBC1**: Up to 2MB ROM, 32KB RAM, banking modes
- **MBC2**: Up to 256KB ROM, 512×4 bits internal RAM
- **MBC3**: Up to 2MB ROM, 32KB RAM, RTC support
- **MBC5**: Up to 8MB ROM, 128KB RAM

### GBC Memory Map

```
$0000-$3FFF  ROM Bank 0 (fixed)
$4000-$7FFF  ROM Bank 1-N (switchable)
$8000-$9FFF  VRAM (CGB: 2 banks)
$A000-$BFFF  External RAM (cartridge)
$C000-$CFFF  WRAM Bank 0
$D000-$DFFF  WRAM Bank 1-7 (CGB switchable)
$E000-$FDFF  Echo RAM (mirrors $C000-$DDFF)
$FE00-$FE9F  OAM (sprite attribute table)
$FF00-$FF7F  I/O Registers
$FF80-$FFFE  High RAM (HRAM)
$FFFF       Interrupt Enable
```

## Input System

**Keyboard** (`input/input-manager.ts`):
- Auto-detects Kitty keyboard protocol for true keyup/keydown events
- Falls back to legacy mode with 80ms auto-release timing
- WASD/Arrows for D-pad, K/Z=A, J/X=B, Enter=Start, Space=Select

**Gamepad** (`input/gamepad-manager.ts`):
- Uses node-hid for raw HID access (no SDL dependency)
- Profiles for Xbox, PlayStation, Nintendo, 8BitDo controllers
- Auto-detection with 3-second polling for hotplug

**Input Mapper** (`input/input-mapper.ts`):
- Translates `StandardButton` enum to core-specific button IDs
- Enables same physical inputs to work across different cores

## Renderers

**Kitty** (`rendering/kitty-renderer.ts`):
- Best quality, sends raw RGB via Kitty graphics protocol
- Auto-scales to fit terminal, diff-based updates

**Terminal** (`rendering/renderer.ts`):
- Unicode half-blocks (▀) - each character = 1x2 pixels
- Uses 24-bit ANSI color codes

**ASCII** (`rendering/renderer.ts` with `asciiMode`):
- Brightness-mapped characters: ` .:-=+*#%@`
- Optional color support

## CLI Options

```
tui-nes <rom> [options]

Supported ROM formats: .nes, .gbc, .gb

Core Selection:
  --core <id>       Use specific core (see --list-cores)
  --list-cores      Show available emulator cores

Rendering:
  --kitty           Kitty graphics (default)
  --terminal        Unicode half-blocks
  --ascii           ASCII characters
  --emoji           Emoji characters
  --scale <n>       Fixed scale for Kitty
  --width/height    Display size for terminal/ascii

Input:
  --list-gamepads   Show detected controllers
  --debug-gamepad   Raw HID data for debugging
  --no-gamepad      Disable gamepad support

Audio:
  --no-audio        Disable audio output

Save Data:
  --no-save-state   Disable save state loading/saving
  --no-battery-save Disable battery save (.srm) loading/saving

Display:
  --no-status       Hide the status bar
```

## Key Implementation Details

### PPU Timing
- Visible scanlines: 0-239
- Vblank starts: scanline 241, cycle 1 (sets NMI flag)
- Pre-render scanline: 261 (clears flags, copies vertical scroll)
- Sprite evaluation happens at cycle 257

### Scroll Handling
PPU uses loopy registers (v, t, x, w) for scrolling:
- `t` holds pending scroll values written via $2005/$2006
- `v` is the active VRAM address used during rendering
- Horizontal scroll copied at cycle 257, vertical at cycles 280-304 of pre-render

### MMC3 Scanline Counter
PPU notifies mapper at cycle 260 of each visible/pre-render scanline via `notifyScanline()`. Mapper decrements counter and triggers IRQ when counter reaches zero.

### Controller Polling
NES controller uses shift register. Write $01 then $00 to $4016 to latch, then read 8 times to get each button.

## Testing

```bash
pnpm test                 # Watch mode
pnpm run test:run         # Single run
```

Use nestest.nes ROM for CPU verification.

## Dependencies

- **audify**: Audio output (RtAudio bindings)
- **chalk**: Terminal colors
- **node-hid**: HID device access for gamepads

**Node.js Requirement**: >= 24.0.0

## Common Tasks

### Adding a New NES Mapper
1. Add case to `createMapper()` switch in `cores/nes/mappers/mapper.ts`
2. Implement `Mapper` interface with bank switching logic
3. If IRQ needed, implement `irqPending()` and `acknowledgeIrq()`

### Adding a New GBC MBC
1. Add new MBCType enum value in `cores/gbc/cartridge.ts`
2. Add cartridge type mapping in `parseHeader()`
3. Implement read/write logic in `read()` and `write()` methods
4. Handle RAM enable/bank switching as needed

### Adding a New Core
1. Create directory `src/cores/<system>/`
2. Implement `Core` interface (see `src/core/core.ts`)
3. Register with `registerCore()` in your core's `index.ts`
4. Import core module in `src/index.ts` to auto-register

### Debugging NES Graphics Issues
- Check nametable mirroring (mapper's `mirrorMode`)
- Verify scroll register handling (v/t manipulation)
- Check pattern table address calculation
- Sprite 0 hit requires both BG and sprite pixels opaque

### Debugging GBC Issues
- Verify MBC type detection from cartridge header ($0147)
- Check ROM/RAM bank switching logic
- For CGB games, ensure double-speed mode handling
- Timer issues: verify DIV increments and TIMA overflow behavior
- PPU: check VRAM bank selection for CGB mode

### Debugging Input Issues
- Use `--debug-gamepad` to see raw HID bytes
- Check gamepad profile byte offsets in `gamepad-profiles.ts`
- For keyboard, check if Kitty mode is detected
