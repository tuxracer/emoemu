# TUI NES Emulator - Technical Requirements Document

## Project Overview

A terminal-based Nintendo Entertainment System (NES) emulator written in TypeScript. The emulator renders graphics using Unicode/ASCII characters in the terminal and accepts keyboard input for controls.

**Platform Compatibility:** This application should be compatible when running in the terminal on macOS, Windows, and Linux.

## Technical Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Terminal UI:** Ink (React for CLIs) or blessed/blessed-contrib
- **Build Tool:** tsup or esbuild

## Core Architecture

### 1. CPU (Ricoh 2A03 - based on MOS 6502)

The NES CPU is a modified 6502 processor running at 1.79 MHz (NTSC).

**Requirements:**
- Implement all official 6502 opcodes (151 instructions)
- Support all addressing modes (13 modes)
- Accurate cycle counting for timing
- Interrupt handling (NMI, IRQ, Reset)
- Register emulation (A, X, Y, SP, PC, Status)

**Registers:**
- `A` - Accumulator (8-bit)
- `X` - Index Register X (8-bit)
- `Y` - Index Register Y (8-bit)
- `SP` - Stack Pointer (8-bit)
- `PC` - Program Counter (16-bit)
- `P` - Status Register (8-bit flags: N, V, -, B, D, I, Z, C)

### 2. PPU (Picture Processing Unit - Ricoh 2C02)

The NES PPU generates the video signal at 256x240 pixels.

**Requirements:**
- VRAM management (2KB internal + cartridge CHR-ROM/RAM)
- Nametable mirroring (horizontal, vertical, single-screen, four-screen)
- Pattern table rendering (8x8 pixel tiles)
- Sprite rendering (64 sprites, 8 per scanline limit)
- Background rendering with scrolling
- Palette management (64 colors, 8 palettes)
- OAM (Object Attribute Memory) for sprites
- PPU registers ($2000-$2007, $4014)
- Accurate scanline/cycle timing

**Terminal Rendering:**
- Convert 256x240 output to terminal characters
- Use Unicode block characters (▀▄█░▒▓) for pseudo-pixels
- Support half-block characters for 2:1 vertical resolution
- Target ~128x60 effective character resolution (adjustable)
- Color support via ANSI 256-color or true color (24-bit)

### 3. APU (Audio Processing Unit)

**Requirements (Optional/Phase 2):**
- 2 Pulse wave channels
- 1 Triangle wave channel
- 1 Noise channel
- 1 DMC (Delta Modulation Channel)
- Frame counter for timing

**Note:** Terminal audio is limited. Consider:
- Outputting to system audio via node libraries (speaker, node-speaker)
- Optional audio disable flag for pure TUI experience

### 4. Memory Map

```
$0000-$07FF  2KB Internal RAM
$0800-$1FFF  Mirrors of RAM
$2000-$2007  PPU Registers
$2008-$3FFF  Mirrors of PPU Registers
$4000-$4017  APU and I/O Registers
$4018-$401F  APU and I/O (normally disabled)
$4020-$FFFF  Cartridge space (PRG-ROM, PRG-RAM, mappers)
```

### 5. Cartridge/Mapper Support

**Phase 1 Mappers:**
- Mapper 0 (NROM) - No mapper, direct ROM access
- Mapper 1 (MMC1) - Common mapper with bank switching
- Mapper 2 (UxROM) - Simple PRG bank switching

**Phase 2 Mappers:**
- Mapper 3 (CNROM) - CHR bank switching
- Mapper 4 (MMC3) - Scanline counter, common mapper
- Mapper 7 (AxROM) - Single-screen mirroring

**iNES File Format:**
- Parse 16-byte header
- Extract PRG-ROM and CHR-ROM banks
- Detect mapper number and mirroring mode

### 6. Input System

**Controller Mapping (Keyboard):**
```
NES Button    Default Key
─────────────────────────
D-Pad Up      W / Arrow Up
D-Pad Down    S / Arrow Down
D-Pad Left    A / Arrow Left
D-Pad Right   D / Arrow Right
A Button      K / Z
B Button      J / X
Start         Enter
Select        Shift
```

**Requirements:**
- Read keyboard input without blocking
- Support key remapping via config
- Handle simultaneous key presses
- Emulate controller shift register ($4016, $4017)

**NES Controller Behavior:**
The NES supports multiple buttons being pressed simultaneously and buttons being held down continuously (not as rapid presses). The controller uses a shift register (the 4021 chip) that captures the current state of all eight buttons each frame when the console polls input. When a button is held, the NES reads it as pressed (returning a 1) on every frame until released. The emulator must accurately model this behavior to ensure games that require holding buttons (running, charging attacks, etc.) work correctly.

## Project Structure

```
tui-nes/
├── src/
│   ├── index.ts           # Entry point
│   ├── emulator.ts        # Main emulator orchestration
│   ├── cpu/
│   │   ├── cpu.ts         # 6502 CPU implementation
│   │   ├── opcodes.ts     # Opcode definitions and handlers
│   │   └── addressing.ts  # Addressing mode implementations
│   ├── ppu/
│   │   ├── ppu.ts         # PPU implementation
│   │   ├── renderer.ts    # Terminal rendering logic
│   │   └── palette.ts     # NES color palette definitions
│   ├── apu/
│   │   └── apu.ts         # Audio processing (optional)
│   ├── memory/
│   │   ├── bus.ts         # Memory bus / address decoding
│   │   └── ram.ts         # RAM implementation
│   ├── cartridge/
│   │   ├── cartridge.ts   # ROM loading and parsing
│   │   └── mappers/       # Mapper implementations
│   │       ├── mapper.ts  # Base mapper interface
│   │       ├── mapper0.ts # NROM
│   │       ├── mapper1.ts # MMC1
│   │       └── mapper2.ts # UxROM
│   ├── input/
│   │   └── controller.ts  # Input handling
│   └── ui/
│       ├── terminal.ts    # Terminal setup and management
│       └── display.ts     # Frame buffer to terminal conversion
├── tests/
│   ├── cpu.test.ts        # CPU instruction tests
│   └── ppu.test.ts        # PPU tests
├── roms/                  # Test ROMs (not committed)
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Dependencies

```json
{
  "dependencies": {
    "ink": "^4.0.0",
    "react": "^18.0.0",
    "chalk": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsup": "^8.0.0",
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0"
  }
}
```

**Alternative terminal libraries:**
- `blessed` - Full terminal widget library
- `terminal-kit` - Advanced terminal manipulation
- `ansi-escapes` - Raw ANSI escape sequences

## Implementation Phases

### Phase 1: Foundation
1. Set up TypeScript project with build tooling
2. Implement iNES ROM parser
3. Implement 6502 CPU with all opcodes
4. Create memory bus with basic address decoding
5. Run CPU tests (nestest.nes)

### Phase 2: Graphics
1. Implement PPU registers and state
2. Implement background rendering
3. Implement sprite rendering
4. Create terminal renderer with Unicode blocks
5. Implement NMI timing (vblank)

### Phase 3: Playable
1. Implement controller input
2. Connect CPU/PPU timing (3 PPU cycles per CPU cycle)
3. Implement Mapper 0 (NROM)
4. Test with simple games (Donkey Kong, etc.)

### Phase 4: Compatibility
1. Implement additional mappers (MMC1, UxROM)
2. Fix timing edge cases
3. Implement sprite 0 hit
4. Optimize rendering performance

### Phase 5: Polish
1. Add configuration file support
2. Implement save states
3. Add audio support (optional)
4. Performance profiling and optimization

## Technical Challenges

### Terminal Rendering Performance
- Target 60 FPS (16.67ms per frame)
- Minimize terminal writes (diff-based updates)
- Use double buffering
- Consider reducing effective resolution

### Color Accuracy
- NES has 64 unique colors
- Map to nearest ANSI 256 or true color
- Provide palette customization

### Timing Accuracy
- NES runs at ~60 FPS (NTSC)
- CPU/PPU synchronization is critical
- Use requestAnimationFrame-style timing in Node.js

## Testing Strategy

1. **CPU Tests:** Use nestest.nes ROM for comprehensive CPU testing
2. **PPU Tests:** Visual comparison with known-good emulators
3. **Integration Tests:** Test complete frame generation
4. **Performance Tests:** Measure FPS and timing accuracy

## Commands

```bash
# Development
npm run dev           # Run in development mode
npm run build         # Build for production
npm run test          # Run test suite

# Usage
npm start -- <rom.nes>           # Run a ROM
npm start -- --help              # Show help
npm start -- --scale <n>         # Set display scale
npm start -- --no-color          # Disable colors
```

## References

- [NESdev Wiki](https://www.nesdev.org/wiki/) - Comprehensive NES documentation
- [6502 Reference](http://www.obelisk.me.uk/6502/reference.html) - CPU instruction set
- [NES ROM Header](https://www.nesdev.org/wiki/INES) - iNES file format
- [PPU Rendering](https://www.nesdev.org/wiki/PPU_rendering) - Detailed PPU docs
