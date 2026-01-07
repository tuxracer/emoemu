# 🎮 TUI-NES

A terminal-based NES emulator written in TypeScript. Play classic NES games directly in your terminal using the Kitty graphics protocol, Unicode half-blocks, or ASCII characters.

## ✨ Features

- 🖼️ **Multiple render modes**: Kitty graphics protocol (best quality), Unicode half-blocks, or ASCII art
- 🔊 **Full audio support**: All 5 APU channels (2 pulse, triangle, noise, DMC)
- 🎮 **Gamepad support**: Xbox, PlayStation, Nintendo, and 8BitDo controllers via HID
- ⌨️ **Keyboard input**: Kitty keyboard protocol for accurate key detection, with legacy fallback
- 📐 **Dynamic scaling**: Auto-fits to terminal size with proper 4:3 aspect ratio
- 🗺️ **7 mappers**: Covers ~80% of the NES library

## 📋 Requirements

- Node.js 18+
- A terminal emulator:
  - ⭐ **Recommended**: [Ghostty](https://ghostty.org/) - best graphics and keyboard support
  - ✅ **Full support** (graphics + keyboard protocol): [Kitty](https://sw.kovidgoyal.net/kitty/), [WezTerm](https://wezfurlong.org/wezterm/)
  - 🖼️ **Graphics only**: [Konsole](https://konsole.kde.org/) - use with gamepad
  - ⌨️ **Keyboard protocol only**: [iTerm2](https://iterm2.com/), [Alacritty](https://alacritty.org/), [Foot](https://codeberg.org/dnkl/foot), [Rio](https://raphamorim.io/rio/), Windows Terminal - use `--terminal` mode
  - 👍 **Other terminals**: Use `--terminal` or `--ascii` mode with gamepad

> ⚠️ **Keyboard limitations**: Terminals without Kitty keyboard protocol support cannot detect multiple simultaneous key presses. This affects gameplay requiring combined inputs (e.g., running while jumping). For the best keyboard experience, use Ghostty, Kitty, or WezTerm. Otherwise, a gamepad is recommended.

## 🚀 Quick Start

```bash
npx tui-nes /path/to/game.nes
```

## 📦 Installation

```bash
# Install globally
npm install -g tui-nes

# Run
tui-nes /path/to/game.nes
```

## 🛠️ Usage

```bash
tui-nes <rom.nes> [options]
```

### 🖼️ Render Modes

```bash
tui-nes game.nes              # Kitty graphics (default, best quality)
tui-nes game.nes --terminal   # Unicode half-blocks (▀)
tui-nes game.nes --ascii      # ASCII characters
tui-nes game.nes --ascii --color  # ASCII with color
```

### 📺 Display Options

```bash
tui-nes game.nes --scale 3        # Fixed scale (Kitty mode)
tui-nes game.nes --width 120      # Fixed width (terminal/ASCII)
tui-nes game.nes --height 40      # Fixed height (terminal/ASCII)
```

### 🔊 Audio

```bash
tui-nes game.nes              # Audio enabled (default)
tui-nes game.nes --no-audio   # Disable audio
```

### 🎮 Gamepad

```bash
tui-nes --list-gamepads       # Show detected controllers
tui-nes game.nes --debug-gamepad  # Debug raw HID data
tui-nes game.nes --no-gamepad     # Disable gamepad support
```

## 🕹️ Controls

### ⌨️ Keyboard

| NES Button | Primary | Alternate |
|------------|---------|-----------|
| D-Pad      | WASD    | Arrow keys |
| A          | K       | Z |
| B          | J       | X |
| Start      | Enter   | |
| Select     | Space   | |

Press `Ctrl+C` or `Q` to quit.

### 🎮 Gamepad

Standard gamepad mapping is used. Controllers are auto-detected with hotplug support.

Supported controllers:
- 🟢 Xbox (360, One, Series X/S)
- 🔵 PlayStation (DS4, DualSense)
- 🔴 Nintendo (Switch Pro, Joy-Cons)
- 🟣 8BitDo controllers

## 🗺️ Supported Mappers

| Mapper | Name | Description |
|--------|------|-------------|
| 0 | NROM | No banking (32KB PRG, 8KB CHR) |
| 1 | MMC1 | Bank switching + mirroring control |
| 2 | UxROM | 16KB PRG bank switching |
| 3 | CNROM | 8KB CHR bank switching |
| 4 | MMC3 | Advanced banking + scanline IRQ |
| 7 | AxROM | 32KB PRG + single-screen mirroring |
| 9 | MMC2 | Tile-based CHR switching |

## ✅ Compatibility

The emulator runs most NES games that use the supported mappers. Games with advanced PPU timing requirements may have graphical glitches.

## 🔧 Building from Source

```bash
git clone https://github.com/yourusername/tui-nes.git
cd tui-nes
npm install       # Install dependencies
npm run build     # Build the project
npm run typecheck # Type check without building
npm test          # Run tests
npm start -- /path/to/game.nes
```

## 📁 Project Structure

```
src/
├── index.ts              # CLI entry point
├── emulator.ts           # Main emulation loop
├── cpu/                  # 6502 CPU emulation
├── ppu/                  # Picture Processing Unit
├── apu/                  # Audio Processing Unit
├── memory/               # Memory bus and address decoding
├── cartridge/            # ROM loading and mappers
└── input/                # Keyboard and gamepad input
```

## 📄 License

MIT
