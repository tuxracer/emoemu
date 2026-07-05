# 🎮 emoemu

<img width="100" alt="icon" src="https://github.com/user-attachments/assets/0447c490-0484-4b57-b35d-095ceaea7565" />

A terminal-based retro emulator written in TypeScript. Play classic games directly in your terminal using the Kitty graphics protocol, Unicode half-blocks, or ASCII characters. Supports **libretro cores** (RetroArch cores) to play NES, Game Boy, SNES, Sega Genesis, GBA, and more.

## ✨ Features

### General

- **Multiple render modes**: Native window (best performance), Kitty graphics protocol (best quality), Unicode half-blocks, ASCII art, or emoji
- **Post-processing modes**: Off, CRT preset, or Custom effects (scanlines, NTSC artifacts, bloom, vignette, gamma, etc.)
- **Diff-based rendering**: Optimized rendering that only updates changed pixels for better performance
- **Save states**: Automatic save/resume with gzip compression
- **Battery saves**: RetroArch-compatible `.srm` files for games with save RAM
- **Playlist generation**: Generate RetroArch-compatible `.lpl` playlists
- **Screenshots**: Capture screenshots with F8/F12, saved using RetroArch naming convention
- **Gamepad support**: Xbox (wired and wireless), PlayStation, Nintendo, and 8BitDo controllers via HID
- **Keyboard input**: Kitty keyboard protocol for accurate key detection, with legacy fallback
- **Dynamic scaling**: Auto-fits to terminal size with pixel aspect ratio correction
- **Multi-core architecture**: Extensible design for supporting additional systems
- **RetroArch integration**: Optionally load cores from existing RetroArch installation (`--retroarch`)
- **Netplay**: RetroArch-compatible multiplayer with rollback netcode

### Supported Systems

| System         | Status             | Extensions      |
| -------------- | ------------------ | --------------- |
| NES            | ✅ Via libretro    | `.nes`          |
| Game Boy / Color | ✅ Via libretro  | `.gb`, `.gbc`   |
| SNES           | ✅ Via libretro    | `.sfc`, `.smc`  |
| Sega Genesis   | ✅ Via libretro    | `.md`, `.gen`   |
| Game Boy Advance | ✅ Via libretro  | `.gba`          |
| Nintendo 64    | ✅ Via libretro    | `.n64`, `.z64`, `.v64` |
| + Many more    | ✅ Via libretro    | Various         |

> **Note:** Libretro cores must be installed separately. See [Using Libretro Cores](#-using-libretro-cores) below.

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

#### Other Terminals

Any other terminal will work with `--terminal` or `--ascii` mode. A gamepad is recommended since standard terminal input cannot detect multiple simultaneous key presses.

## 🚀 Quick Start

```bash
npx emoemu /path/to/game.nes
```

## 📥 Installation

```bash
# Install globally
npm install -g emoemu

# Run
emoemu /path/to/game.nes
```

## 📖 Usage

```bash
emoemu <rom> [options]
```

### Core Selection

```bash
emoemu game.nes              # Auto-detect core by file extension
emoemu game.nes --core fceumm  # Explicitly select a core
emoemu --list-cores          # Show available cores
emoemu --retroarch --list-cores  # Include RetroArch cores
```

When multiple cores support the same ROM extension (e.g., `.sfc` works with both bsnes and snes9x), you'll be prompted to select which core to use. Use `--core <id>` to skip the prompt.

Use `--retroarch` to load libretro cores from RetroArch installation directories (see [Using Libretro Cores](#-using-libretro-cores)).

### Render Modes

```bash
emoemu game.nes --native      # Native window (best performance, zero dependencies)
emoemu game.nes              # Kitty graphics (default for most systems)
emoemu game.nes --terminal   # Unicode half-blocks (default for N64)
emoemu game.nes --ascii      # ASCII characters
emoemu game.nes --emoji      # Emoji characters
```

**Render Mode:** By default, render mode is set to "Auto" which uses system-appropriate defaults: Kitty graphics for most systems (best quality) and Terminal mode for N64 (better performance with software rendering). You can override this in settings or with `--terminal`, `--kitty`, `--native`, etc.

> **Note:** The `--native` mode renders to a native window instead of the terminal, bypassing terminal I/O for the best performance. The window backend (fenster) and bitmap font are bundled — **no system dependencies to install**.

> **Tip:** When using `--terminal`, `--ascii`, or `--emoji` modes, scale your terminal font down to a small size so the characters are small enough to render graphics clearly. For example, on Ghostty or Kitty on macOS, press `Cmd+-` repeatedly. The default Kitty graphics mode renders at pixel level and doesn't require this.

### Display Options

```bash
emoemu game.nes --scale 2        # Fixed scale (Kitty mode, 0.25x-4x)
emoemu game.nes --png-level 3    # PNG compression 1-9 for Kitty mode (default: 1)
emoemu game.nes --width 120      # Fixed width (terminal/ASCII)
emoemu game.nes --height 40      # Fixed height (terminal/ASCII)
emoemu game.nes --no-color       # Disable colors (terminal/ASCII modes)
emoemu game.nes --no-diff-render # Disable diff-based rendering optimization
emoemu game.nes --status         # Show the status bar
```

**Video Scale:** By default, video scale is set to "Auto" which uses system-appropriate defaults: 2x for most systems (NES, SNES, Genesis, etc.) and 0.5x for N64. You can override this in settings or with `--scale`.

**Post-Processing Modes:**

Post-processing can be configured via the settings panel or toggled with the P key during gameplay. Three modes are available:

- **Off**: No effects applied (clean pixels)
- **CRT**: Preset values for an authentic retro look (gamma 1.3, scanlines 0.1, vignette 0.5, NTSC 1.0, curvature 0.1)
- **Custom**: User-defined effect values from config or command line

The P key cycles through: Off → Custom (if defined) → CRT → Off

**Custom Effect Settings:**

```bash
emoemu game.nes --gamma 1.2      # Gamma correction (default: 1.0)
emoemu game.nes --scanlines 0.3  # Scanline intensity (default: 0)
emoemu game.nes --saturation 1.2 # Color saturation (default: 1.0)
emoemu game.nes --brightness 1.1 # Brightness multiplier (default: 1.0)
emoemu game.nes --contrast 1.1   # Contrast adjustment (default: 1.0)
emoemu game.nes --vignette 0.5   # Vignette edge darkening (default: 0)
```

- `--gamma` adjusts display gamma. Values above 1.0 darken midtones for richer colors. Try `1.1` to `1.4`.
- `--scanlines` adds horizontal scanline darkening to simulate CRT phosphor gaps. Try `0.2` to `0.4` for subtle effect.
- `--saturation` boosts color vibrancy. Values above 1.0 increase saturation. Try `1.1` to `1.3` for CRT-like colors.
- `--brightness` adjusts overall brightness. Values above 1.0 brighten, below 1.0 darken.
- `--contrast` adjusts tonal range. Values above 1.0 increase contrast, below 1.0 flatten.
- `--vignette` darkens screen edges to simulate CRT electron beam falloff. Try `0.3` to `0.5`.

**Additional Effects (Kitty mode only):**

```bash
emoemu game.nes --crt             # Start with CRT mode enabled
```

- `--crt` starts the emulator with CRT post-processing mode selected. Use P key or settings to switch to Custom mode if you want to use custom effect values.
- `--bloom` adds phosphor glow around bright areas. Try `0.3` to `0.6` for subtle CRT glow.
- `--bloom-threshold` sets brightness threshold for bloom effect. Default `0.6` (range 0-1).
- `--ntsc` simulates horizontal color bleeding from composite video signals. Try `0.5` to `1.0`.
- `--curvature` applies barrel distortion to simulate curved CRT glass. Try `0.1` to `0.3`.

### Emulation

```bash
emoemu game.nes --fps-limit 30   # Override FPS limit (0 = uncapped)
```

### Audio

```bash
emoemu game.nes              # Audio enabled (default)
emoemu game.nes --no-audio   # Disable audio
```

### Gamepad

```bash
emoemu --list-gamepads       # Show detected controllers
emoemu game.nes --debug-gamepad  # Debug raw HID data
emoemu game.nes --no-gamepad     # Disable gamepad support
```

### Save Data

```bash
emoemu game.nes                  # Auto-save state and battery saves (default)
emoemu game.nes --no-save-state  # Disable save state loading/saving
emoemu game.nes --no-battery-save # Disable battery save (.srm) loading/saving
emoemu game.nes --no-gzip-state  # Save states uncompressed (for debugging)
```

Save states are saved automatically on exit. File names include the core ID (e.g., `game.libretro-fceumm.state`, `game.libretro-bsnes.state`) to prevent conflicts when using different cores for the same ROM.

Battery saves (`.srm` files) store cartridge SRAM for games with battery-backed saves (e.g., Zelda, Pokemon) and are RetroArch-compatible.

### Playlist Generation

Generate RetroArch-compatible `.lpl` playlist files from your ROM collection:

```bash
emoemu --generate-playlist /path/to/roms              # Generate per-system playlists
emoemu --generate-playlist /path/to/roms --single-playlist "My Games"  # Single playlist
emoemu --retroarch --generate-playlist /path/to/roms  # Include RetroArch cores
```

| Option | Description |
|--------|-------------|
| `--generate-playlist [path]` | Scan directory for ROMs (default: current directory) |
| `--playlist-output <dir>` | Output directory (default: platform-specific, e.g., `~/.config/emoemu/playlists/`) |
| `--single-playlist <name>` | Create one playlist instead of per-system |
| `--windows-paths` | Use Windows backslash separators |

### Netplay

Play multiplayer games over the network using RetroArch-compatible netplay:

```bash
# Host a session (player 1)
emoemu game.sfc --netplay-host --netplay-nick "Player1"

# Join via LAN discovery (auto-finds host on local network)
emoemu game.sfc --netplay-connect --netplay-nick "Player2"

# Join a specific host (player 2)
emoemu game.sfc --netplay-connect 192.168.1.100 --netplay-nick "Player2"

# Join with password
emoemu game.sfc --netplay-connect host:55435 --netplay-password secret

# Spectate a session
emoemu game.sfc --netplay-connect 192.168.1.100 --netplay-spectate
```

| Option | Description |
|--------|-------------|
| `--netplay-host` | Host a netplay session (server mode) |
| `--netplay-connect [host]` | Connect to server (host or host:port). Omit host for LAN auto-discovery |
| `--netplay-port <n>` | Port for netplay (default: 55435) |
| `--netplay-password <pw>` | Password for the session |
| `--netplay-spectate` | Join as spectator (view only) |
| `--netplay-nick <name>` | Your nickname (default: Player) |
| `--netplay-frames <n>` | Input delay 0-16 (higher = fewer rollbacks, more latency) |

> **Note:** Netplay requires libretro cores.

## 🔌 Using Libretro Cores

emoemu can load native [libretro cores](https://www.libretro.com/) (the same cores used by RetroArch) to support additional systems without any configuration.

### Using Cores from RetroArch

If you already have RetroArch installed with cores, use the `--retroarch` flag to load them:

```bash
emoemu game.md --retroarch   # Load RetroArch cores and play
emoemu --retroarch --list-cores  # Show all cores including RetroArch
```

This reads your `retroarch.cfg` (read-only) to find the core directory.

### Installing Cores

#### Core Manager (Recommended)

Use the built-in Core Manager to download and manage cores:

1. Launch emoemu and open the ROM browser
2. Tab to the action bar and select **Manage Cores**
3. Switch to the **Download** tab to see recommended cores
4. Press Enter to download a core

The Core Manager shows recommended cores for popular systems and provides access to the full libretro buildbot catalog.

#### Manual Install

1. **Download cores** from the [RetroArch buildbot](https://buildbot.libretro.com/nightly/):
   - macOS: Choose `apple/osx/arm64` or `apple/osx/x86_64`
   - Linux: Choose `linux/x86_64`
   - Windows: Choose `windows/x86_64`

2. **Place cores** in one of these directories:
   | Platform | Directory |
   |----------|-----------|
   | macOS | `~/Library/Application Support/emoemu/cores/` |
   | Linux | `~/.config/emoemu/cores/` |
   | Windows | `%APPDATA%\emoemu\cores\` |

3. **Run your game** - cores are auto-detected by ROM extension:
   ```bash
   emoemu game.md                 # Auto-detects picodrive
   emoemu game.gba                # Auto-detects mgba
   emoemu --list-cores            # Show all available cores
   ```

### Recommended Cores

| Core | Systems |
|------|---------|
| `bsnes` | SNES |
| `mgba` | Game Boy Advance |
| `gambatte` | Game Boy / Color |
| `picodrive` | Sega Genesis / Mega Drive |
| `mupen64plus_next` | Nintendo 64 |

### BIOS Files

Some cores require BIOS files. Place them in `./system/`:
```
./system/
├── gba_bios.bin       # GBA BIOS (optional for mgba)
├── bios_CD_U.bin      # Sega CD BIOS (for picodrive)
└── syscard3.pce       # PC Engine CD BIOS
```

### Limitations

- **Software rendering only**: Cores requiring OpenGL/Vulkan won't work (e.g., PPSSPP, Dolphin)
- **N64 on macOS ARM64**: Requires Xcode CLI tools (`xcode-select --install`). The core is automatically built from source with software rendering since pre-built ARM64 binaries require OpenGL.
- **No core options UI**: Core-specific settings use defaults

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

| Key    | Action                        |
| ------ | ----------------------------- |
| F8/F12 | Take screenshot               |
| M      | Toggle audio mute             |
| P      | Cycle post-processing (Off → Custom → CRT) |
| R      | Cycle render mode             |
| Esc    | Quit                          |
| Ctrl+C | Quit                          |

### Gamepad

Standard gamepad mapping is used. Controllers are auto-detected with hotplug support.

Supported controllers:

- Xbox (360, One, Series X/S)
- PlayStation (DS4, DualSense)
- Nintendo (Switch Pro, Joy-Cons)
- 8BitDo controllers

**Analog stick support**: For systems that require analog input (like N64), the left analog stick is mapped directly to the core's analog axes. This enables proper control in games like Super Mario 64 that need precise analog movement.

## 🔨 Building from Source

```bash
git clone https://github.com/tuxracer/emoemu.git
cd emoemu
pnpm install       # Install dependencies
pnpm run build     # Build the project
pnpm run typecheck # Type check without building
pnpm run test:run  # Run tests
pnpm run check     # Run typecheck, lint, and tests
pnpm run start /path/to/game.nes
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── cli/                  # Argument parsing, commands, emulator runner
├── Emulator/             # Main emulation loop, renderer orchestration
├── core/                 # Multi-core interface definitions
├── frontend/             # Shared frontend (audio, state, registry)
├── cores/
│   └── libretro/         # Libretro core wrapper (RetroArch cores)
├── input/                # Keyboard and gamepad input
├── rendering/            # Terminal renderers
├── netplay/              # RetroArch-compatible netplay (rollback, LAN discovery)
└── ui/                   # React/Ink TUI (ROM browser, settings)
```

## Architecture

emoemu uses a **libretro-inspired** multi-core architecture:

- **Cores** (`src/cores/`): System-specific emulation (CPU, PPU, APU, memory)
- **Frontend** (`src/frontend/`): Shared infrastructure (audio, input, rendering, state)
- **Core Interface** (`src/core/`): Standard interface all cores implement

This separation allows adding new systems without modifying shared code. See [docs/cores-trd.md](docs/cores-trd.md) for the full architecture documentation.

## 📄 License

emoemu is free software, licensed under the [GNU General Public License v3.0 or later](LICENSE) (GPL-3.0-or-later).

The netplay implementation (`src/netplay/`) is derived in part from [RetroArch](https://github.com/libretro/RetroArch)'s netplay code (GPL-3.0-or-later):

- Copyright (C) 2010-2014 Hans-Kristian Arntzen
- Copyright (C) 2011-2017 Daniel De Matteis
- Copyright (C) 2016-2017 Gregor Richards

Libretro cores loaded at runtime are separate works with their own licenses.
