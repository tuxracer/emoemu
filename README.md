# 🎮 TUI-NES

A terminal-based retro emulator written in TypeScript. Play classic games directly in your terminal using the Kitty graphics protocol, Unicode half-blocks, or ASCII characters. Features a multi-core architecture designed to support multiple systems.

## ✨ Features

### General

- **Multiple render modes**: Kitty graphics protocol (best quality), Unicode half-blocks, ASCII art, or emoji
- **Save states**: Automatic save/resume
- **Battery saves**: RetroArch-compatible `.srm` files for games with save RAM
- **Gamepad support**: Xbox, PlayStation, Nintendo, and 8BitDo controllers via HID
- **Keyboard input**: Kitty keyboard protocol for accurate key detection, with legacy fallback
- **Dynamic scaling**: Auto-fits to terminal size with proper aspect ratio
- **Multi-core architecture**: Extensible design for supporting additional systems

### NES

- **Full APU emulation**: All 5 channels (2 pulse, triangle, noise, DMC)
- **7 mappers**: NROM, MMC1, UxROM, CNROM, MMC3, AxROM, MMC2 (~80% of library)
- **Accurate PPU**: Background/sprite rendering, scrolling, sprite 0 hit detection
- **Cycle-accurate timing**: Proper CPU/PPU synchronization

### Game Boy Color

- **Stereo APU**: 4 channels with stereo panning
- **5 MBC types**: No MBC, MBC1, MBC2, MBC3 (with RTC), MBC5
- **Full color support**: 8 background palettes, 8 sprite palettes, dual VRAM banks
- **Double-speed mode**: CGB speed switching support
- **GB compatibility**: Plays original Game Boy games

### Supported Systems

| System         | Status             | Extensions    |
| -------------- | ------------------ | ------------- |
| NES            | ✅ Fully supported | `.nes`        |
| Game Boy Color | ✅ Fully supported | `.gbc`, `.gb` |
| GBA            | 🚧 Planned         | `.gba`        |

## 📋 Requirements

- Node.js 24+
- A terminal emulator (see below)

### Terminal Emulators

You can use any terminal emulator, but for the best experience we recommend using a terminal that supports both:

- **[Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/)** - Enables high-quality pixel-perfect rendering directly in the terminal
- **[Kitty Keyboard Protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)** - Enables detecting multiple simultaneous key presses, which is required for many game actions (e.g., holding B to run while tapping A to jump)

#### ⭐ Recommended

These terminals support both high-quality graphics (Kitty graphics protocol) and the best keyboard experience (Kitty keyboard protocol):

- [Ghostty](https://ghostty.org/)
- [Kitty](https://sw.kovidgoyal.net/kitty/)

#### Keyboard Protocol Only

These terminals support multiple simultaneous key presses but graphics rendering will be limited to Unicode half-blocks or ASCII. Use `--terminal` or `--ascii` mode:

- [iTerm2](https://iterm2.com/)
- [Alacritty](https://alacritty.org/)
- [Foot](https://codeberg.org/dnkl/foot)
- [Rio](https://raphamorim.io/rio/)
- Windows Terminal

#### High-Quality Graphics Only

These terminals support high-quality graphics rendering but cannot detect multiple simultaneous key presses. A gamepad is recommended for the best gameplay experience:

- [WezTerm](https://wezfurlong.org/wezterm/)
- [Konsole](https://konsole.kde.org/)

#### Other Terminals

Any other terminal will work with `--terminal` or `--ascii` mode. A gamepad is recommended since standard terminal input cannot detect multiple simultaneous key presses.

## 🚀 Quick Start

```bash
npx tui-nes /path/to/game.nes
```

## 📥 Installation

```bash
# Install globally
npm install -g tui-nes

# Run
tui-nes /path/to/game.nes
```

## 📖 Usage

```bash
tui-nes <rom> [options]
```

### Core Selection

```bash
tui-nes game.nes              # Auto-detect core by file extension
tui-nes game.nes --core nes   # Explicitly select NES core
tui-nes --list-cores          # Show available cores
```

### Render Modes

```bash
tui-nes game.nes              # Kitty graphics (default, best quality)
tui-nes game.nes --terminal   # Unicode half-blocks
tui-nes game.nes --ascii      # ASCII characters
tui-nes game.nes --emoji      # Emoji characters
```

### Display Options

```bash
tui-nes game.nes --scale 3        # Fixed scale (Kitty mode)
tui-nes game.nes --width 120      # Fixed width (terminal/ASCII)
tui-nes game.nes --height 40      # Fixed height (terminal/ASCII)
```

### Audio

```bash
tui-nes game.nes              # Audio enabled (default)
tui-nes game.nes --no-audio   # Disable audio
```

### Gamepad

```bash
tui-nes --list-gamepads       # Show detected controllers
tui-nes game.nes --debug-gamepad  # Debug raw HID data
tui-nes game.nes --no-gamepad     # Disable gamepad support
```

### Save Data

```bash
tui-nes game.nes                  # Auto-save state and battery saves (default)
tui-nes game.nes --no-save-state  # Disable save state loading/saving
tui-nes game.nes --no-battery-save # Disable battery save (.srm) loading/saving
```

Save states (`.state` files) capture the full emulator state and are saved automatically on exit. Battery saves (`.srm` files) store cartridge SRAM for games with battery-backed saves (e.g., Zelda, Pokemon). Both use RetroArch-compatible formats.

## 🎮 Controls

### Keyboard

| Button | Primary | Alternate  |
| ------ | ------- | ---------- |
| D-Pad  | WASD    | Arrow keys |
| A      | K       | Z          |
| B      | J       | X          |
| Start  | Enter   |            |
| Select | Space   |            |

### Shortcuts

| Key    | Action            |
| ------ | ----------------- |
| M      | Toggle audio mute |
| R      | Cycle render mode |
| Esc    | Quit              |
| Ctrl+C | Quit              |

### Gamepad

Standard gamepad mapping is used. Controllers are auto-detected with hotplug support.

Supported controllers:

- Xbox (360, One, Series X/S)
- PlayStation (DS4, DualSense)
- Nintendo (Switch Pro, Joy-Cons)
- 8BitDo controllers

## 🔨 Building from Source

```bash
git clone https://github.com/yourusername/tui-nes.git
cd tui-nes
npm install       # Install dependencies
npm run build     # Build the project
npm run typecheck # Type check without building
npm test          # Run tests
npm start -- /path/to/game.nes
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── emulator.ts           # Main emulation loop
├── core/                 # Multi-core interface definitions
├── frontend/             # Shared frontend (audio, state, registry)
├── cores/
│   └── nes/              # NES core (CPU, PPU, APU, mappers)
├── input/                # Keyboard and gamepad input
└── rendering/            # Terminal renderers
```

## Architecture

TUI-NES uses a **libretro-inspired** multi-core architecture:

- **Cores** (`src/cores/`): System-specific emulation (CPU, PPU, APU, memory)
- **Frontend** (`src/frontend/`): Shared infrastructure (audio, input, rendering, state)
- **Core Interface** (`src/core/`): Standard interface all cores implement

This separation allows adding new systems without modifying shared code. See [docs/cores-trd.md](docs/cores-trd.md) for the full architecture documentation.

## 📄 License

MIT
