# TUI NES Emulator

A terminal-based NES emulator written in TypeScript that renders graphics using the Kitty graphics protocol, Unicode half-blocks, or ASCII characters.

## Quick Reference

```bash
npm run build         # Build the project
npm start -- <rom>    # Run a ROM
npm run typecheck     # Type check without building
npm test              # Run tests
```

## Project Structure

```
src/
├── index.ts              # CLI entry point, argument parsing
├── emulator.ts           # Main emulation loop, component orchestration
├── cpu/
│   ├── cpu.ts            # 6502 CPU with registers, interrupts (NMI/IRQ)
│   ├── opcodes.ts        # All 151 official opcodes with handlers
│   └── addressing.ts     # 13 addressing modes
├── ppu/
│   ├── ppu.ts            # PPU with background/sprite rendering, scrolling
│   ├── renderer.ts       # Terminal renderer (Unicode half-blocks + ASCII)
│   ├── kitty-renderer.ts # Kitty graphics protocol renderer
│   └── palette.ts        # NES 64-color palette → RGB mapping
├── memory/
│   └── bus.ts            # Memory bus, address decoding, DMA
├── cartridge/
│   ├── cartridge.ts      # iNES ROM parsing, mapper instantiation
│   └── mappers/
│       └── mapper.ts     # All mappers: 0 (NROM), 1 (MMC1), 2 (UxROM), 4 (MMC3)
├── input/
│   ├── controller.ts     # NES controller shift register emulation
│   ├── input-manager.ts  # Keyboard input with Kitty protocol detection
│   ├── gamepad-manager.ts # HID gamepad support via node-hid
│   └── gamepad-profiles.ts # Controller profiles (Xbox, PlayStation, etc.)
├── apu/
│   └── apu.ts            # APU with all 5 channels, frame counter, mixer
└── types/
    └── speaker.d.ts      # Type declarations for speaker package
```

## Architecture

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

### CPU (`cpu/cpu.ts`)

- Registers: A, X, Y, SP (8-bit), PC (16-bit), Status flags (N,V,B,D,I,Z,C)
- Interrupts: `reset()`, `nmi()`, `irq()` - each reads vector from $FFFA-$FFFF
- Instruction execution: `step()` returns cycle count for PPU synchronization

### PPU (`ppu/ppu.ts`)

- 256x240 framebuffer (palette indices 0-63)
- Registers: $2000-$2007 (PPUCTRL, PPUMASK, PPUSTATUS, etc.)
- Internal registers: v, t (VRAM address), x (fine scroll), w (write toggle)
- Background: nametables, pattern tables, attribute tables
- Sprites: 64 in OAM, 8 per scanline limit, sprite 0 hit detection
- Timing: 341 cycles/scanline, 262 scanlines/frame (NTSC)

### APU (`apu/apu.ts`)

- **Pulse 1 & 2**: Square waves with duty cycle (12.5%, 25%, 50%, 75%), sweep, envelope
- **Triangle**: Triangle wave with linear counter, no volume control
- **Noise**: LFSR-based noise with short/long mode
- **DMC**: Delta modulation channel for sample playback
- Frame counter: 4-step (with IRQ) or 5-step mode, clocks envelope/length/sweep
- Mixer: Uses NESDev wiki lookup formula for proper channel mixing
- Audio output: 44100 Hz sample rate via `speaker` package

### Mappers (`cartridge/mappers/mapper.ts`)

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

### Input System

**Keyboard** (`input/input-manager.ts`):
- Auto-detects Kitty keyboard protocol for true keyup/keydown events
- Falls back to legacy mode with 80ms auto-release timing
- WASD/Arrows for D-pad, K/Z=A, J/X=B, Enter=Start, Space=Select

**Gamepad** (`input/gamepad-manager.ts`):
- Uses node-hid for raw HID access (no SDL dependency)
- Profiles for Xbox, PlayStation, Nintendo, 8BitDo controllers
- Auto-detection with 3-second polling for hotplug

### Renderers

**Kitty** (`ppu/kitty-renderer.ts`):
- Best quality, sends raw RGB via Kitty graphics protocol
- Auto-scales to fit terminal, diff-based updates

**Terminal** (`ppu/renderer.ts`):
- Unicode half-blocks (▀) - each character = 1x2 NES pixels
- Uses 24-bit ANSI color codes

**ASCII** (`ppu/renderer.ts` with `asciiMode`):
- Brightness-mapped characters: ` .:-=+*#%@`
- Optional color support

## Memory Map

```
$0000-$07FF  2KB RAM (mirrored to $1FFF)
$2000-$2007  PPU registers (mirrored to $3FFF)
$4000-$4017  APU/IO registers
$4014        OAM DMA
$4016-$4017  Controller ports
$6000-$7FFF  PRG RAM (battery-backed)
$8000-$FFFF  PRG ROM (mapper-controlled)
```

## CLI Options

```
tui-nes <rom.nes> [options]

Rendering:
  --kitty           Kitty graphics (default)
  --terminal        Unicode half-blocks
  --ascii           ASCII characters
  --scale <n>       Fixed scale for Kitty
  --width/height    Display size for terminal/ascii

Input:
  --list-gamepads   Show detected controllers
  --debug-gamepad   Raw HID data for debugging
  --no-gamepad      Disable gamepad support

Audio:
  --no-audio        Disable audio output
```

## Key Implementation Details

### PPU Timing
- Visible scanlines: 0-239
- Vblank starts: scanline 241, cycle 1 (sets NMI flag)
- Pre-render scanline: 261 (clears flags, copies vertical scroll)
- Sprite evaluation happens at cycle 257 (prepares for next scanline)

### Scroll Handling
PPU uses loopy registers (v, t, x, w) for scrolling:
- `t` holds pending scroll values written via $2005/$2006
- `v` is the active VRAM address used during rendering
- Horizontal scroll copied at cycle 257, vertical at cycles 280-304 of pre-render

### MMC3 Scanline Counter
PPU notifies mapper at cycle 260 of each visible/pre-render scanline via `notifyScanline()`. Mapper decrements counter and triggers IRQ when counter reaches zero (used by SMB3 for status bar).

### Controller Polling
NES controller uses shift register. Write $01 then $00 to $4016 to latch, then read 8 times to get each button. Button state is captured at latch time, not read time.

## Testing

```bash
npm test                 # Watch mode
npm run test:run         # Single run
```

Use nestest.nes ROM for CPU verification. Check logs against known-good nestest output.

## Dependencies

- **chalk**: Terminal colors
- **node-hid**: HID device access for gamepads (prebuilt binaries)
- **speaker**: Audio output (uses native audio backend)
- **ink/react**: Available but unused (raw ANSI used instead)

## Common Tasks

### Adding a New Mapper
1. Add case to `createMapper()` switch in `mapper.ts`
2. Implement `Mapper` interface with bank switching logic
3. If IRQ needed, implement `irqPending()` and `acknowledgeIrq()`

### Debugging Graphics Issues
- Check nametable mirroring (mapper's `mirrorMode`)
- Verify scroll register handling (v/t manipulation)
- Check pattern table address calculation
- Sprite 0 hit requires both BG and sprite pixels opaque

### Debugging Input Issues
- Use `--debug-gamepad` to see raw HID bytes
- Check gamepad profile byte offsets in `gamepad-profiles.ts`
- For keyboard, check if Kitty mode is detected (affects key release behavior)
