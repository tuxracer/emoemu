# Mupen64Plus Software-Only Rendering Build - Technical Requirements Document

This document describes the requirements and implementation plan for building a software-rendering-only version of the Mupen64Plus-Next libretro core for use in emoemu's terminal-based emulator.

## Problem Statement

emoemu is a terminal-based emulator that renders graphics using the Kitty graphics protocol, Unicode half-blocks, ASCII, or emoji characters. It has **no access to GPU acceleration** (OpenGL, Vulkan, Metal) because:

1. Terminal emulators don't provide GPU context
2. The emulator runs in headless/terminal environments
3. All rendering must go through a CPU-generated framebuffer

The pre-built Mupen64Plus-Next cores from the RetroArch buildbot **require OpenGL** because they default to GlideN64, a high-level emulation (HLE) renderer that requires OpenGL. Even when configured to use the Angrylion software renderer at runtime, the core still links against OpenGL and may fail to load or initialize in environments without OpenGL support.

### Previous Success

A custom build of mupen64plus_next was previously created that:
- Successfully ran N64 games in terminal mode
- Used Angrylion for software-only RDP rendering
- Used Parallel RSP with ARM64 dynarec for fast RSP emulation
- Did not require any GPU/OpenGL at runtime

This build has been lost and we need to recreate it.

---

## Goals

1. **Software-Only Rendering**: Build a mupen64plus_next core that uses Angrylion RDP exclusively
2. **No GPU Dependencies**: Eliminate OpenGL/Vulkan/Metal linking and runtime requirements
3. **Optimal Performance**: Enable ARM64 dynarec for CPU emulation and Parallel RSP
4. **Automated Building**: Integrate the build process into emoemu's core-builder system
5. **Cross-Platform**: Support ARM64 macOS initially, with potential for Linux ARM64

---

## Background: Mupen64Plus-Next Architecture

### Renderer Plugins

The mupen64plus-libretro-nx core includes multiple RDP (graphics) plugins:

| Plugin | Type | GPU Required | Accuracy | Performance |
|--------|------|--------------|----------|-------------|
| **GlideN64** | HLE | Yes (OpenGL) | Good | Fast |
| **ParaLLEl RDP** | LLE | Yes (Vulkan) | Pixel-perfect | Fast |
| **Angrylion** | LLE | **No** (CPU) | Pixel-perfect | Slow-Medium |

For emoemu, **Angrylion is the only viable option**.

### RSP Plugins

| Plugin | Type | Notes |
|--------|------|-------|
| **HLE RSP** | High-level | Fast but incompatible with Angrylion |
| **Parallel RSP** | Dynarec | Fast, required for Angrylion |
| **Cxd4** | Interpreter | Slower fallback |

**Parallel RSP is recommended** for use with Angrylion.

### Build Flags (from Makefile analysis)

| Flag | Default (macOS) | Purpose |
|------|-----------------|---------|
| `HAVE_PARALLEL_RDP` | 1 | Vulkan-based RDP (we need 0) |
| `HAVE_PARALLEL_RSP` | 1 | RSP dynarec (we need 1) |
| `HAVE_THR_AL` | 1 | Angrylion threading (we need 1) |
| `LLE` | 1 | Low-level emulation (we need 1) |
| `WITH_DYNAREC` | (empty) | CPU dynarec (we need `aarch64`) |
| `GL_LIB` | `-framework OpenGL` | OpenGL linking (problematic) |

---

## Analysis of Current Build Configuration

### Current emoemu Build Config

From `src/frontend/core-builder.ts`:

```typescript
mupen64plus_next: {
  repo: "https://github.com/libretro/mupen64plus-libretro-nx.git",
  buildArgs: [
    "platform=osx",
    "HAVE_PARALLEL_RDP=0", // Disable Vulkan-dependent ParaLLEl RDP
    "WITH_DYNAREC=aarch64", // Enable ARM64 dynamic recompiler
  ],
  outputFile: "mupen64plus_next_libretro.dylib",
  installedFile: "mupen64plus_next_libretro.dylib",
  description: "Nintendo 64 (Mupen64Plus-Next with Angrylion software renderer)",
}
```

### Problems with Current Config

1. **OpenGL Still Linked**: The Makefile's `platform=osx` section hardcodes `GL_LIB := -framework OpenGL`
2. **GlideN64 Still Compiled**: No flag to exclude GlideN64 sources, which depend on OpenGL
3. **Runtime OpenGL Check**: The core may still check for OpenGL at runtime even when using Angrylion
4. **Missing Flags**: `HAVE_THR_AL` and `HAVE_PARALLEL_RSP` should be explicitly set

---

## Proposed Solution

### Option A: Makefile Modifications (Recommended)

Create a modified build that:
1. Sets `GL_LIB` to empty to prevent OpenGL linking
2. Explicitly enables software-only flags
3. Potentially patches out GlideN64 compilation

**Proposed Build Command:**

```bash
make -j$(nproc) \
  platform=osx \
  HAVE_PARALLEL_RDP=0 \
  HAVE_PARALLEL_RSP=1 \
  HAVE_THR_AL=1 \
  LLE=1 \
  WITH_DYNAREC=aarch64 \
  GL_LIB=
```

The key addition is `GL_LIB=` (empty) to prevent OpenGL framework linking.

### Option B: Source Patching

If Option A doesn't work, patch the source:

1. Modify `Makefile` to add a `SOFTWARE_ONLY=1` flag
2. When set, skip GlideN64 sources and clear `GL_LIB`
3. Add preprocessor define to disable OpenGL code paths

### Option C: Fork with Software-Only Configuration

Create a minimal fork that:
1. Removes GlideN64 entirely
2. Removes OpenGL/Vulkan dependencies
3. Keeps only Angrylion + Parallel RSP + Cxd4

---

## Implementation Plan

### Phase 1: Investigate Build Failure

1. Clone mupen64plus-libretro-nx repository
2. Attempt build with current config
3. Capture and analyze build errors
4. Identify exactly what's failing and why

```bash
git clone --depth 1 https://github.com/libretro/mupen64plus-libretro-nx.git
cd mupen64plus-libretro-nx
make -j$(sysctl -n hw.ncpu) platform=osx HAVE_PARALLEL_RDP=0 WITH_DYNAREC=aarch64 2>&1 | tee build.log
```

### Phase 2: Test GL_LIB Override

1. Try building with `GL_LIB=` (empty)
2. If linker fails, identify which objects require OpenGL symbols
3. Determine if those objects can be excluded

```bash
make -j$(sysctl -n hw.ncpu) \
  platform=osx \
  HAVE_PARALLEL_RDP=0 \
  HAVE_PARALLEL_RSP=1 \
  HAVE_THR_AL=1 \
  WITH_DYNAREC=aarch64 \
  GL_LIB= \
  2>&1 | tee build-no-gl.log
```

### Phase 3: Source Analysis

If Phase 2 fails, analyze which source files require OpenGL:

1. Search for OpenGL includes: `grep -r "OpenGL\|GL/gl\|GLES" --include="*.c" --include="*.cpp" --include="*.h"`
2. Identify conditional compilation: `grep -r "#ifdef.*GL\|#if.*OPENGL" --include="*.c" --include="*.cpp"`
3. Find GlideN64 source boundaries in Makefile.common
4. Determine minimal exclusion set

### Phase 4: Implement Software-Only Build

Based on findings, implement one of:

**4A: Build Flag Solution**
```typescript
// Updated core-builder.ts
mupen64plus_next: {
  repo: "https://github.com/libretro/mupen64plus-libretro-nx.git",
  buildArgs: [
    "platform=osx",
    "HAVE_PARALLEL_RDP=0",
    "HAVE_PARALLEL_RSP=1",
    "HAVE_THR_AL=1",
    "LLE=1",
    "WITH_DYNAREC=aarch64",
    "GL_LIB=",  // Prevent OpenGL linking
  ],
  // ...
}
```

**4B: Patch-Based Solution**
```typescript
// Add pre-build patching step
const patchMakefile = (repoDir: string): void => {
  const makefilePath = join(repoDir, 'Makefile');
  let content = readFileSync(makefilePath, 'utf-8');

  // Remove OpenGL linking for osx platform
  content = content.replace(
    /GL_LIB := -framework OpenGL/g,
    'GL_LIB :='
  );

  writeFileSync(makefilePath, content);
};
```

**4C: Fork Solution**

Create `https://github.com/emoemu/mupen64plus-software-only` with:
- Removed GlideN64 directory
- Removed ParaLLEl RDP sources
- Modified Makefile with no OpenGL dependencies
- Simplified build for software-only operation

### Phase 5: Runtime Configuration

Ensure core options are set correctly at runtime:

```typescript
// In core-options.ts - DEFAULT_CORE_OPTIONS
'mupen64plus_next': {
  'mupen64plus-rdp-plugin': 'angrylion',
  'mupen64plus-rsp-plugin': 'parallel',
  'mupen64plus-cpucore': 'dynamic_recompiler',
  'mupen64plus-angrylion-multithread': 'all threads',
}
```

### Phase 6: Validation

1. Build completes without errors
2. Core loads without OpenGL errors
3. N64 ROM boots and renders
4. Frame output appears in terminal
5. Performance is acceptable (30+ FPS on M1)

---

## Core Options for Software Rendering

These options must be applied when loading the core:

```ini
; RDP Plugin - MUST be angrylion for software rendering
mupen64plus-rdp-plugin = "angrylion"

; RSP Plugin - parallel is fastest, cxd4 is fallback
mupen64plus-rsp-plugin = "parallel"

; CPU Core - dynamic recompiler for performance
mupen64plus-cpucore = "dynamic_recompiler"

; Threading - use all CPU cores for Angrylion
mupen64plus-angrylion-multithread = "all threads"

; VI output - bilinear filtering (optional)
mupen64plus-angrylion-vioverlay = "Filtered"
```

---

## Testing the Build

To test building the core with emoemu's built-in core builder:

```bash
pnpm run start -- --install-core mupen64plus_next
```

This will:
1. Detect that mupen64plus_next requires building from source on ARM Mac
2. Clone the repository
3. Build with the configured flags
4. Install to cores directory (see Data Directories below)
5. Display progress and any errors to the console

For development, you can also build manually to capture full output:

```bash
git clone --depth 1 https://github.com/libretro/mupen64plus-libretro-nx.git
cd mupen64plus-libretro-nx
make -j$(sysctl -n hw.ncpu) platform=osx HAVE_PARALLEL_RDP=0 WITH_DYNAREC=aarch64 2>&1 | tee build.log
```

---

## Testing Checklist

### Build Verification
- [ ] Clone repository succeeds
- [ ] Build completes without errors
- [ ] Output .dylib is ARM64 architecture (`file` command)
- [ ] No OpenGL symbols in binary (`nm -u` shows no GL references)
- [ ] File size is reasonable (smaller than full build)

### Runtime Verification
- [ ] Core loads in emoemu without OpenGL errors
- [ ] `retro_load_game()` succeeds
- [ ] Frame callback receives valid framebuffer data
- [ ] Video renders correctly in terminal

### Game Compatibility
- [ ] Super Mario 64 boots and is playable
- [ ] The Legend of Zelda: Ocarina of Time renders correctly
- [ ] Audio plays without issues
- [ ] Save states work

### Performance
- [ ] Achieves 30+ FPS on Apple M1
- [ ] Achieves 60 FPS on Apple M1 Pro/Max
- [ ] Multi-threading is functional

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| GlideN64 cannot be excluded | Medium | High | Fork with sources removed |
| OpenGL symbols required at runtime | Low | High | Patch source to remove checks |
| Angrylion too slow | Low | Medium | Enable all multi-threading options |
| Build system changes upstream | Low | Low | Pin to specific commit |

---

## Alternative Approaches

### Use Different N64 Core

**parallel-n64** is another libretro N64 core that may be easier to build software-only. However:
- Less actively maintained
- May have different accuracy/compatibility
- Still includes GPU renderers

### RetroArch Headless Mode

RetroArch has a `--video-driver=null` option but this doesn't help with core linking requirements.

### Emscripten/WASM Build

Some libretro cores have been compiled to WebAssembly which doesn't have OpenGL linking. This approach is complex but guarantees no GPU dependencies.

---

## Resources

- [mupen64plus-libretro-nx Repository](https://github.com/libretro/mupen64plus-libretro-nx)
- [Mupen64Plus-Next 2.0 Announcement](https://www.libretro.com/index.php/mupen64plus-next-2-0-64dd-support-angrylion-and-gliden64-in-one-build-parallel-rsp-support-and-android/)
- [Angrylion RDP Plus](https://github.com/ata4/angrylion-rdp-plus)
- [Libretro Docs - Mupen64Plus](https://docs.libretro.com/library/mupen64plus/)
- [Emulation General Wiki - N64 Plugins](https://emulation.gametechwiki.com/index.php/Recommended_N64_plugins)

---

## Appendix: Makefile Deep Dive

### macOS Platform Block (from Makefile)

```makefile
else ifeq ($(platform), osx)
   TARGET := $(TARGET_NAME)_libretro.dylib
   LDFLAGS += -dynamiclib
   OSXVER = $(shell sw_vers -productVersion | cut -d. -f 1)
   OSX_LT_MAVERICKS = $(shell [ $(OSXVER) -lt 10 ] && echo "YES")
   LDFLAGS += -mmacosx-version-min=10.7
   LDFLAGS += -stdlib=libc++

   PLATFLAGS += -DOS_MAC_OS_X
   GL_LIB := -framework OpenGL   # <-- PROBLEM: hardcoded

   CFLAGS += -DOS_MAC_OS_X
   CPUFLAGS := -msse -msse2
   WITH_DYNAREC =                 # <-- PROBLEM: dynarec disabled by default
   HAVE_PARALLEL_RSP = 1
   HAVE_PARALLEL_RDP = 1          # <-- We override to 0
   HAVE_THR_AL = 1
   LLE = 1
```

### Key Variables to Override

```bash
# Required overrides for software-only build
HAVE_PARALLEL_RDP=0    # Disable Vulkan RDP
WITH_DYNAREC=aarch64   # Enable ARM64 CPU dynarec
GL_LIB=                # Empty to prevent OpenGL linking (needs testing)

# Should already be set by platform=osx but explicit is safer
HAVE_PARALLEL_RSP=1    # Enable fast RSP dynarec
HAVE_THR_AL=1          # Enable Angrylion threading
LLE=1                  # Enable low-level emulation
```

---

## Implementation Status: COMPLETE

The software-only build is now working. The solution required:

### 1. Source Patches for macOS Compatibility

Two patches are automatically applied before building:

**Patch 1: libpng fp.h fix**
```c
// custom/dependencies/libpng/pngpriv.h
// Replace: #include <fp.h>
// With:    #include <math.h>
```
The `fp.h` header was for Classic Mac OS and doesn't exist on modern macOS.

**Patch 2: libzlib fdopen fix**
```c
// custom/dependencies/libzlib/zutil.h
// Replace: #if defined(MACOS) || defined(TARGET_OS_MAC)
// With:    #if (defined(MACOS) || defined(TARGET_OS_MAC)) && !defined(__APPLE__)
```
The bundled zlib incorrectly defines `fdopen()` as NULL for `TARGET_OS_MAC`, but modern macOS has `fdopen()`. This breaks when `_stdio.h` is included.

### 2. Build Flags

The final working build configuration:
```bash
make platform=osx \
  HAVE_PARALLEL_RDP=0 \   # Disable Vulkan RDP
  HAVE_PARALLEL_RSP=1 \   # Enable RSP dynarec
  HAVE_THR_AL=1 \         # Enable Angrylion threading
  LLE=1                   # Enable low-level emulation
```

**Note:** `WITH_DYNAREC=aarch64` is intentionally omitted because the ARM64 dynarec assembly uses GNU syntax (`.hidden`, `.type %function`) that's incompatible with macOS's LLVM assembler. The CPU runs in interpreter mode, which is slower but compatible. The Parallel RSP still uses its own dynarec which does work.

### 3. What Gets Built

The resulting core includes:
- **Angrylion RDP**: Software renderer (CPU-only, no GPU)
- **Parallel RSP**: Fast RSP with dynarec
- **GlideN64**: Also compiled (OpenGL), but runtime core options select Angrylion

At runtime, the core options are set to use Angrylion:
```ini
mupen64plus-rdp-plugin = "angrylion"
mupen64plus-rsp-plugin = "parallel"
```

### Installation

```bash
pnpm run start -- --install-core mupen64plus_next
```

This will:
1. Clone the repository
2. Apply source patches automatically
3. Build with software rendering flags
4. Install to cores directory (see Data Directories below)

---

## Data Directories

emoemu stores data in platform-specific directories:

| Platform | Base Directory |
|----------|----------------|
| macOS    | `~/Library/Application Support/emoemu/` |
| Linux    | `~/.config/emoemu/` |
| Windows  | `%APPDATA%\emoemu\` |

**Subdirectories:**

| Directory | Purpose |
|-----------|---------|
| `cores/`  | Installed libretro cores (`.dylib`, `.so`, `.dll`) |
| `logs/`   | Log files including `emoemu.log` |
| `saves/`  | Save data (SRAM, memory cards) |
| `states/` | Save states |
| `system/` | BIOS files and system data |
| `config/` | Per-core configuration files |

---

## Debugging the N64 Core

If the core builds and installs but displays all black when running, follow these steps to debug:

### Step 1: Clean Environment

Kill any lingering node processes that might be holding state:

```bash
killall -9 node
```

### Step 2: Remove Existing Core

Remove the currently installed core to ensure a fresh build:

```bash
pnpm run start -- --remove-core mupen64plus_next
```

### Step 3: Rebuild the Project

If you made changes to the core builder, rebuild:

```bash
pnpm run build
```

### Step 4: Install Fresh Core

Install the core with the updated build process:

```bash
pnpm run start -- --install-core mupen64plus_next
```

### Step 5: Test with Emoji Mode

Run a ROM with emoji mode (good for debugging since it's simple output):

```bash
pnpm run start -- --core mupen64plus_next ~/ROMs/N64/Super\ Mario\ 64\ \(USA\).z64 --emoji
```

**Expected behavior:**
- After a brief loading period, you should see colored emoji output
- If you only see black emojis after 10-15 seconds, the core is not rendering properly

### Step 6: Check Logs

If rendering fails, kill the process and check the logs:

```bash
killall -9 node
```

Then examine the log file:

```bash
cat ~/Library/Application\ Support/emoemu/logs/emoemu.log  # macOS
cat ~/.config/emoemu/logs/emoemu.log                       # Linux
```

Look for errors related to:
- `mupen64plus` or `angrylion` - RDP plugin issues
- `OpenGL` or `GL` - Indicates the core is trying to use GPU rendering
- `GET_VARIABLE` - Core options not being applied correctly
- `video callback` - Framebuffer issues

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| All black output | Core using GlideN64 instead of Angrylion | Check core options are set correctly |
| "OpenGL support required" | Core built with wrong flags | Rebuild with `HAVE_PARALLEL_RDP=0` |
| Crash on load | Missing dependencies | Check build output for errors |
| Very slow / stuttering | CPU dynarec not working | Expected on macOS (interpreter mode) |

### Verify Core Options

The core options should be set to use Angrylion. Check the core options file (macOS: `~/Library/Application Support/emoemu/retroarch-core-options.cfg`, Linux: `~/.config/emoemu/retroarch-core-options.cfg`) contains:

```ini
mupen64plus-rdp-plugin = "angrylion"
mupen64plus-rsp-plugin = "parallel"
```

If these aren't being applied, the core may default to GlideN64 which requires OpenGL.

### Adding More Logging

If the logs don't provide enough information to diagnose the issue, you may need to add additional logging or adjust log verbosity:

**1. Enable debug logging in config:**

Edit `~/.config/emoemu/emoemu.cfg` (or `~/Library/Application Support/emoemu/emoemu.cfg` on macOS):

```ini
log_verbosity = 2
```

**2. Add logging to libretro environment handler:**

Key file: `src/cores/libretro/environment/index.ts`

Add `logger.info()` calls to trace:
- Which environment commands are being called
- What values are being requested/returned for `GET_VARIABLE`
- When video callbacks are triggered

Example:
```typescript
case RETRO_ENVIRONMENT.GET_VARIABLE:
  logger.info(`GET_VARIABLE called with data: ${data}`, 'Environ');
  const result = this.handleGetVariable(data);
  logger.info(`GET_VARIABLE result: ${result}`, 'Environ');
  return result;
```

**3. Add logging to video callback:**

Key file: `src/cores/libretro/callbacks/index.ts`

Log framebuffer details when video callback is invoked:
```typescript
logger.info(`Video callback: ${width}x${height}, pitch=${pitch}, format=${pixelFormat}`, 'Video');
```

**4. Add logging to core options:**

Key file: `src/cores/libretro/core-options.ts`

Log when default options are applied:
```typescript
logger.info(`Applying default options for ${coreName}: ${JSON.stringify(options)}`, 'CoreOptions');
```

**5. Rebuild and test:**

After adding logging:
```bash
pnpm run build
killall -9 node
pnpm run start -- --remove-core mupen64plus_next
pnpm run start -- --install-core mupen64plus_next
pnpm run start -- --core mupen64plus_next ~/ROMs/N64/game.z64 --emoji
```

Then check the logs again for the additional output.

---

## Solved Issue: macOS Library Loading Hang

**Status: RESOLVED**

On macOS with ARM64 (Apple Silicon), the pre-built mupen64plus_next core (and even custom builds linked against OpenGL) hung indefinitely during the initial library loading phase (`koffi.load()`). This happened before any libretro API functions were called.

### Root Cause

The mupen64plus core links against OpenGL.framework even when configured to use the Angrylion software renderer. When the OpenGL framework is loaded on macOS, it performs GPU capability probing during its static initialization. In a terminal environment without a GPU context, this probing appears to block indefinitely.

### Solution: Stub OpenGL Library

The solution was to create a stub OpenGL library that provides empty implementations of the OpenGL functions the core links against. Since we use Angrylion (which is CPU-only software rendering), the OpenGL functions are never actually called at runtime.

**Implementation:**

1. **Stub Library Creation**: The core-builder creates a stub library (`libGL_stub.dylib`) with no-op implementations of the ~35 OpenGL functions the core references.

2. **Build with Stub**: The core is built linking against the stub library instead of OpenGL.framework:
   ```bash
   make platform=osx HAVE_PARALLEL_RDP=0 GL_LIB="-L/path/to/stub -lGL_stub"
   ```

3. **Library Path Fix**: After building, `install_name_tool` is used to change the stub library reference to an absolute path so it can be found at runtime.

**Files involved:**
- `src/frontend/core-builder.ts` - Creates stub library and builds with it
- The stub library is installed alongside the core in the cores directory

### Technical Details

The stub library provides empty implementations for these OpenGL functions:
- `glBindTexture`, `glBlendFunc`, `glClear`, `glClearColor`, etc.
- `glGenTextures` (returns nothing), `glGetError` (returns 0)
- `glGetString` (returns empty string)
- ~35 functions total

Since Angrylion doesn't use OpenGL for rendering, these functions are never actually called. The stub just satisfies the linker and allows the library to load without pulling in the real OpenGL framework.

### For Users

N64 emulation now works out of the box on macOS ARM64:

```bash
# Install the core (builds automatically with stub library)
pnpm run start -- --install-core mupen64plus_next

# Run an N64 game
pnpm run start -- ~/ROMs/N64/game.z64
```

The core uses Angrylion for software rendering, which is pixel-perfect accurate but slower than GPU-based renderers. Performance is acceptable on Apple Silicon Macs.

---

## Solved Issue: Initial Black Screen During Boot

**Status: RESOLVED - Normal Behavior**

After fixing the library loading hang, the N64 emulator would show "all black" video output for the first few seconds. Investigation revealed this is **normal N64 boot behavior**, not a bug.

### What Happens During N64 Boot

1. **Frames 1-130 (~2 seconds)**: The N64 bootstrap runs. During this time, the RDP (graphics processor) hasn't been initialized yet, so the video callback receives `null` data (frame dupes).

2. **Frames 131-150**: The game starts initializing graphics. First frames are very dark (max pixel value ~1).

3. **Frames 150+**: Full video output with normal brightness (max pixel value 249).

This is the same boot sequence that happens on real N64 hardware and in RetroArch with the same core.

### Key Findings

- **Video callback IS being called** with correct dimensions (640x240) and pixel format (XRGB8888)
- **Frame duping** (null data) is used during boot when no RDP output is available
- **getFramebuffer()** correctly waits for valid frame data before returning non-empty buffers
- **Pixel format conversion** (XRGB8888 → RGB24) works correctly

### Core Options Confirmed Working

The following options are correctly applied:

```ini
mupen64plus-rdp-plugin = "angrylion"        # Software RDP (confirmed)
mupen64plus-rsp-plugin = "cxd4"             # RSP interpreter (required for Angrylion)
mupen64plus-cpucore = "cached_interpreter"  # ARM64 has no dynarec support
mupen64plus-angrylion-multithread = "all threads"
mupen64plus-FrameDuping = "False"
```

Note: `mupen64plus-cpucore = "dynamic_recompiler"` is requested, but ARM64 macOS doesn't have a compatible dynarec, so the core automatically falls back to "Cached Interpreter". This is slower but works correctly.

### For Developers

When debugging N64 video issues:

1. **Run at least 200 frames** before concluding video is broken (boot takes ~140 frames)
2. **Check the video callback** - if it receives null data, that's expected during boot
3. **Check max pixel values** - should increase from 0 to ~249 as the game fades in
4. **Frame buffer size changes** - initial size matches SystemInfo, then changes to actual RDP output size
