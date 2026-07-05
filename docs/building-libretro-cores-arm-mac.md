# Building Libretro Cores for ARM Macs

This guide explains how to build libretro cores from source for Apple Silicon (M1/M2/M3/M4) Macs.

## Automatic Building

**emoemu automatically builds certain cores from source on ARM Macs.** When you try to download a core that requires building (like `mupen64plus_next` for N64), emoemu will:

1. Detect that you're on ARM macOS
2. Clone the source repository
3. Build with the correct flags for software rendering
4. Install the built core to your cores directory

This happens transparently through the Core Manager UI or when the core is needed.

**Requirements for automatic building:**
- Xcode command-line tools (`xcode-select --install`)
- Git (included with Xcode CLI tools)

---

## Why Build From Source?

### Pre-built Core Availability

The libretro/RetroArch project provides pre-built cores, but **ARM64 macOS cores are not officially distributed**. The buildbot only provides:

| Platform | Architecture | Pre-built Available |
|----------|--------------|---------------------|
| macOS | x86_64 (Intel) | Yes |
| macOS | arm64 (Apple Silicon) | **No** |
| Linux | x86_64, arm64 | Yes |
| Windows | x86_64 | Yes |

This means ARM Mac users must either:
1. Run x86_64 cores under Rosetta 2 (slower, compatibility issues)
2. Build cores from source natively (recommended)

### Software Rendering Requirement

For emoemu specifically, we need cores that can render without OpenGL/Vulkan since terminal output doesn't have GPU acceleration. The N64 core (mupen64plus-next) defaults to GlideN64 which requires OpenGL. Building from source ensures we have the Angrylion software renderer available.

---

## Prerequisites

Install Xcode command-line tools and build dependencies:

```bash
# Xcode CLI tools
xcode-select --install

# Build tools (via Homebrew)
brew install cmake nasm pkg-config
```

---

## Building Mupen64Plus-Next (N64)

The mupen64plus-next core is the recommended N64 emulator. It includes multiple RDP plugins, including Angrylion for software-only rendering.

### Clone and Build

```bash
# Clone the repository
git clone https://github.com/libretro/mupen64plus-libretro-nx.git
cd mupen64plus-libretro-nx

# Build for ARM64 macOS
# HAVE_PARALLEL_RDP=0 disables Vulkan-dependent ParaLLEl RDP
# WITH_DYNAREC=aarch64 enables the ARM64 dynamic recompiler
make -j$(sysctl -n hw.ncpu) platform=osx HAVE_PARALLEL_RDP=0 WITH_DYNAREC=aarch64
```

### Build Output

The build produces:
```
mupen64plus_next_libretro.dylib
```

### Install the Core

Copy to emoemu's cores directory:

```bash
# Create cores directory if needed
mkdir -p ~/.config/emoemu/cores

# Copy the built core
cp mupen64plus_next_libretro.dylib ~/.config/emoemu/cores/
```

Or to the system-wide RetroArch location (if using RetroArch as well):

```bash
cp mupen64plus_next_libretro.dylib ~/Library/Application\ Support/RetroArch/cores/
```

---

## Core Configuration for Software Rendering

After building, configure the core to use software rendering. Create or edit the core options file:

**Global options** (`~/.config/emoemu/retroarch-core-options.cfg`):
```ini
mupen64plus-rdp-plugin = "angrylion"
mupen64plus-rsp-plugin = "parallel"
mupen64plus-cpucore = "dynamic_recompiler"
mupen64plus-angrylion-multithread = "all threads"
```

Or use emoemu's built-in preset:

```bash
# emoemu automatically applies software rendering settings for N64
emoemu game.z64 --core libretro-mupen64plus-next
```

### Plugin Options Explained

| Option | Value | Purpose |
|--------|-------|---------|
| `rdp-plugin` | `angrylion` | Software RDP renderer (no GPU needed) |
| `rsp-plugin` | `parallel` | Fast RSP with ARM64 dynarec |
| `cpucore` | `dynamic_recompiler` | ARM64 CPU dynarec for performance |
| `angrylion-multithread` | `all threads` | Use all CPU cores for rendering |

---

## Building Other Cores

### General Build Process

Most libretro cores follow a similar pattern:

```bash
git clone https://github.com/libretro/<core-name>.git
cd <core-name>
make -j$(sysctl -n hw.ncpu) platform=osx
```

### Common Build Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `platform=osx` | Target macOS | Required |
| `ARCH=arm64` | Force ARM64 (usually auto-detected) | Optional |
| `-j$(sysctl -n hw.ncpu)` | Parallel build with all cores | Recommended |

### Cores Tested on ARM Mac

| Core | Repository | Notes |
|------|------------|-------|
| mupen64plus-next | `libretro/mupen64plus-libretro-nx` | N64, use `HAVE_PARALLEL_RDP=0` |
| snes9x | `libretro/snes9x` | SNES, builds cleanly |
| genesis-plus-gx | `libretro/Genesis-Plus-GX` | Genesis/Mega Drive |
| mgba | `libretro/mgba` | GBA |
| nestopia | `libretro/nestopia` | NES (alternative to native) |

---

## Troubleshooting

### "OpenGL support required" Error

If you see this error at runtime:
```
mupen64plus: libretro frontend doesn't have OpenGL support
```

The core is trying to use GlideN64 (OpenGL-based renderer). Solutions:

1. **Set core options before loading**: Ensure `mupen64plus-rdp-plugin = "angrylion"` is set
2. **Check option file location**: Options must be in the correct config path
3. **Verify GET_VARIABLE works**: The frontend must properly return option values to the core

### Build Fails with ARM64 Errors

If the build fails on ARM64-specific code:

```bash
# Explicitly set architecture
make platform=osx ARCH=arm64
```

### Missing Dependencies

```bash
# Install common build dependencies
brew install cmake nasm pkg-config zlib libpng
```

### Core Crashes on Load

1. Verify the `.dylib` is ARM64:
   ```bash
   file mupen64plus_next_libretro.dylib
   # Should show: Mach-O 64-bit dynamically linked shared library arm64
   ```

2. Check for missing symbols:
   ```bash
   nm -u mupen64plus_next_libretro.dylib
   ```

---

## Performance Notes

### ARM64 Advantages

Apple Silicon provides excellent single-threaded performance, which benefits:
- CPU emulation (dynamic recompiler)
- Angrylion multi-threaded rendering

### Expected N64 Performance

| Chip | Angrylion Performance |
|------|----------------------|
| M1 | 45-60 FPS (most games) |
| M1 Pro/Max | 60 FPS (consistent) |
| M2/M3/M4 | 60 FPS (all games) |

Performance depends on:
- Game complexity (Zelda OoT is demanding)
- `angrylion-multithread` setting
- Background system load

---

## Related Documentation

- [N64 Support TRD](n64-support-trd.md) - Detailed N64 emulation requirements
- [Libretro Cores TRD](libretro-cores-trd.md) - General libretro integration
