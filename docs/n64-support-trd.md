# Nintendo 64 Support - Technical Requirements Document

This document describes the requirements and implementation approach for Nintendo 64 emulation in emoemu using libretro cores with software rendering.

## Overview

### Goals

1. **Software-Only Rendering**: Use CPU-based rendering that outputs a standard framebuffer compatible with emoemu's terminal renderers
2. **No GPU Requirements**: Avoid OpenGL/Vulkan dependencies that would require hardware acceleration
3. **RetroArch Compatibility**: Use existing Mupen64Plus-Next libretro core with appropriate plugin configuration
4. **Acceptable Performance**: Achieve playable framerates on modern multi-core CPUs

### Non-Goals

1. High-resolution rendering or graphical enhancements
2. Hardware-accelerated rendering (ParaLLEl RDP with Vulkan)
3. Native N64 core implementation (too complex, use libretro instead)

### Background: N64 Graphics Architecture

The N64's Reality Display Processor (RDP) is notoriously difficult to emulate. Most N64 emulators use one of two approaches:

| Approach | Description | GPU Required |
|----------|-------------|--------------|
| **HLE (High-Level Emulation)** | Interprets graphics commands and renders via OpenGL/Vulkan | Yes |
| **LLE (Low-Level Emulation)** | Emulates the RDP at the hardware level | No (software) or Yes (ParaLLEl) |

For emoemu, we need LLE with software rendering.

---

## Recommended Core Configuration

### Core: Mupen64Plus-Next

The `mupen64plus_next_libretro` core supports multiple RDP and RSP plugins. For software-only rendering:

| Plugin Type | Recommended | Alternative | Notes |
|-------------|-------------|-------------|-------|
| **RDP (Graphics)** | Angrylion | - | Only software option |
| **RSP (Signal Processor)** | Parallel RSP | Cxd4 | Parallel is faster (dynarec) |
| **CPU** | New Dynarec | Interpreter | Dynarec for performance |

### Core Options

These options must be set via `RETRO_ENVIRONMENT_GET_VARIABLE`:

```
mupen64plus-rdp-plugin = "angrylion"
mupen64plus-rsp-plugin = "parallel"
mupen64plus-cpucore = "dynamic_recompiler"
mupen64plus-angrylion-multithread = "all threads"
```

---

## Angrylion RDP

### Overview

Angrylion is a pixel-accurate, low-level software renderer for the N64's RDP. Key characteristics:

- **CPU-only**: No GPU, OpenGL, or Vulkan required
- **Pixel-perfect**: Produces output identical to real N64 hardware
- **Multi-threaded**: Angrylion RDP Plus fork uses scan-line interleaving across CPU cores
- **No enhancements**: Native resolution only (typically 320x240)

### Performance Characteristics

| Factor | Impact |
|--------|--------|
| CPU cores | Linear scaling with Angrylion RDP Plus multi-threading |
| Clock speed | Significant impact on single-threaded bottlenecks |
| Resolution | Fixed at native N64 resolution |
| Game complexity | Some games are more demanding than others |

### Accuracy vs Performance Trade-off

Angrylion is the most accurate N64 graphics emulation available but at a significant CPU cost. For comparison:

| Renderer | Accuracy | Performance | GPU Required |
|----------|----------|-------------|--------------|
| GlideN64 (HLE) | Good | Fast | Yes (OpenGL) |
| ParaLLEl RDP | Pixel-perfect | Fast | Yes (Vulkan) |
| Angrylion | Pixel-perfect | Slow | No |

---

## RSP Plugin Selection

The Reality Signal Processor handles audio, physics, and some graphics tasks. Two software options:

### Parallel RSP (Recommended)

- Dynamic recompiler (dynarec)
- Significantly faster than interpreter
- Good compatibility

### Cxd4

- Pure interpreter
- Slower but potentially more compatible
- Fallback option if Parallel RSP has issues

---

## Implementation Requirements

### Core Options Support

emoemu's libretro wrapper must support setting core options. This requires handling `RETRO_ENVIRONMENT_GET_VARIABLE` in the environment callback:

```typescript
// In environment.ts
case RETRO_ENVIRONMENT.GET_VARIABLE: {
  const variable = parseRetroVariable(data);
  const value = this.coreOptions.get(variable.key);
  if (value) {
    writeStringToPointer(variable.value, value);
    return true;
  }
  return false;
}
```

### Configuration File

Add N64-specific defaults to the config system:

```typescript
// Core options for N64 software rendering
const N64_SOFTWARE_OPTIONS = {
  'mupen64plus-rdp-plugin': 'angrylion',
  'mupen64plus-rsp-plugin': 'parallel',
  'mupen64plus-cpucore': 'dynamic_recompiler',
  'mupen64plus-angrylion-multithread': 'all threads',
};
```

### Resolution Handling

N64 games typically output at these resolutions:

| Mode | Resolution | Aspect |
|------|------------|--------|
| Low-res | 320x240 | 4:3 |
| High-res | 640x480 | 4:3 |
| Widescreen hacks | Various | 16:9 |

The low native resolution is actually advantageous for terminal rendering, as it produces reasonable output even with Unicode half-blocks or ASCII rendering.

---

## BIOS Requirements

Mupen64Plus-Next does not require BIOS files for most games. However, some features may require:

| File | Purpose | Required |
|------|---------|----------|
| None | Basic operation | - |
| 64DD IPL | 64DD disk support | Only for 64DD games |

---

## Input Mapping

The N64 controller has a unique layout that must be mapped to the standard libretro joypad:

| N64 Button | Libretro ID | Notes |
|------------|-------------|-------|
| A | `RETRO_DEVICE_ID_JOYPAD_A` | |
| B | `RETRO_DEVICE_ID_JOYPAD_B` | |
| Z | `RETRO_DEVICE_ID_JOYPAD_L2` | Trigger |
| Start | `RETRO_DEVICE_ID_JOYPAD_START` | |
| D-Pad | `RETRO_DEVICE_ID_JOYPAD_UP/DOWN/LEFT/RIGHT` | |
| L | `RETRO_DEVICE_ID_JOYPAD_L` | Shoulder |
| R | `RETRO_DEVICE_ID_JOYPAD_R` | Shoulder |
| C-Up | `RETRO_DEVICE_ID_JOYPAD_X` | Or right analog |
| C-Down | `RETRO_DEVICE_ID_JOYPAD_Y` | Or right analog |
| C-Left | `RETRO_DEVICE_ID_JOYPAD_L` | Overloaded |
| C-Right | `RETRO_DEVICE_ID_JOYPAD_R` | Overloaded |
| Analog Stick | Analog axes | Requires analog support |

### Analog Stick Support

The N64 analog stick is critical for most games. This requires extending emoemu's input system to support analog axes via `RETRO_DEVICE_INDEX_ANALOG_*`.

---

## Performance Considerations

### CPU Requirements

Angrylion is CPU-intensive. Estimated requirements:

| Tier | CPU | Expected Performance |
|------|-----|---------------------|
| Minimum | 4-core 2.5GHz | 30-40 FPS |
| Recommended | 6-core 3.5GHz | 50-60 FPS |
| Optimal | 8+ core 4.0GHz+ | Full speed |

### Terminal Rendering Impact

Terminal I/O adds overhead on top of emulation. Mitigation strategies:

1. **Frame skipping**: Skip terminal output for some frames while running emulation at full speed
2. **Resolution**: Native N64 resolution (320x240) is small enough for efficient terminal rendering
3. **Render mode**: Kitty graphics protocol is fastest; ASCII/emoji will be slower

### Memory Usage

| Component | Estimated Memory |
|-----------|-----------------|
| N64 RAM emulation | 4-8 MB |
| Framebuffer (32-bit) | ~1.2 MB (640x480x4) |
| Core state | Variable |
| Audio buffers | ~1 MB |

---

## Testing Strategy

### Test Games

Recommended games for testing compatibility and performance:

| Game | Why Test |
|------|----------|
| Super Mario 64 | Most compatible, good baseline |
| The Legend of Zelda: Ocarina of Time | Complex graphics, good stress test |
| GoldenEye 007 | Notorious for emulation issues |
| Mario Kart 64 | Tests various rendering features |
| Paper Mario | 2D/3D hybrid rendering |

### Validation Criteria

1. **Boots successfully**: Game reaches title screen
2. **Playable**: Responsive input, stable framerate
3. **Audio**: Sound effects and music play correctly
4. **Saves**: Battery saves and save states work

---

## Limitations

### Known Issues with Angrylion

1. **Performance**: Will not achieve full speed on all systems
2. **No upscaling**: Locked to native resolution
3. **No texture filtering**: Raw, unfiltered output (pixel-perfect but chunky)

### Games Requiring OpenGL

Some N64 games have rendering features that Angrylion handles differently than HLE renderers. Visual differences may occur but should not affect playability.

---

## Implementation Phases

### Phase 1: Core Options Support

1. Extend environment callback to handle `GET_VARIABLE`/`SET_VARIABLES`
2. Add configuration for core-specific options
3. Test with existing libretro cores

### Phase 2: N64 Integration

1. Add N64 to supported systems list
2. Configure Mupen64Plus-Next with Angrylion defaults
3. Test basic game loading and rendering

### Phase 3: Input Enhancement

1. Add analog stick support to input system
2. Implement N64-specific button mapping
3. Test with games requiring analog input

### Phase 4: Optimization

1. Profile performance bottlenecks
2. Implement frame skipping if needed
3. Optimize terminal rendering for N64 resolution

---

## Resources

- [Mupen64Plus-Next - Libretro Docs](https://docs.libretro.com/library/mupen64plus/)
- [Angrylion RDP Plus - GitHub](https://github.com/ata4/angrylion-rdp-plus)
- [Mupen64Plus-Next 2.0 Release Notes](https://www.libretro.com/index.php/mupen64plus-next-2-0-64dd-support-angrylion-and-gliden64-in-one-build-parallel-rsp-support-and-android/)
- [Emulation General Wiki - N64 Plugins](https://emulation.gametechwiki.com/index.php/Recommended_N64_plugins)

---

## Appendix: Core Option Reference

Full list of relevant Mupen64Plus-Next options for software rendering:

| Option Key | Values | Default | Description |
|------------|--------|---------|-------------|
| `mupen64plus-rdp-plugin` | `gliden64`, `angrylion` | `gliden64` | RDP graphics plugin |
| `mupen64plus-rsp-plugin` | `hle`, `parallel`, `cxd4` | `hle` | RSP plugin |
| `mupen64plus-cpucore` | `pure_interpreter`, `cached_interpreter`, `dynamic_recompiler` | `dynamic_recompiler` | CPU emulation mode |
| `mupen64plus-angrylion-multithread` | `1`, `2`, `4`, `all threads` | `all threads` | Thread count for Angrylion |
| `mupen64plus-angrylion-overscan` | `disabled`, `enabled` | `disabled` | Show overscan area |
