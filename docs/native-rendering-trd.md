# Native Rendering Support - Technical Requirements Document

This document describes the requirements and implementation approach for adding a native-window rendering backend in emoemu, providing a native window alternative to terminal-based rendering.

> **Implementation note:** This design shipped via the [`ink-native`](https://www.npmjs.com/package/ink-native) package (bundled `fenster` window backend + embedded Cozette bitmap font) instead of the custom SDL2/koffi bindings originally proposed below - **zero system dependencies** are required (no SDL2 install). The CLI flag is `--native` and the config value is `video_driver = "native"`. `ink-native` owns the single native window (created via `createStreams()`); the game renderer writes each post-processed frame directly into ink-native's shared `Uint32Array` framebuffer (`0xAARRGGBB`, via `packColor`) and calls `renderer.present()`, while the Ink UI renders into the same window. The app hands the window off between UI and game with `window.pause()` / `window.resume()`. See [native-ui-rendering-trd.md](./native-ui-rendering-trd.md) for the UI side of this design.
>
> **Known limitations of the shipped implementation:** no runtime `setTitle` (ink-native exposes none - see "Status Bar / OSD" below, which is superseded), no runtime scale-factor change (`menu_scale_factor` maps to ink-native's `scaleFactor`, applied only at window creation), and no programmatic window resize (the game software-scales/letterboxes into the fixed window instead). The low-level `SDL_*` pseudocode throughout this document (SDL2 API surface, koffi bindings, `SdlRenderer` class) describes the pre-`ink-native` exploration and was not implemented as written - `ink-native` handles window/framebuffer management internally.

## Overview

### Goals

1. **Native Window Rendering**: Render emulator output to a native window instead of the terminal
2. **Performance**: Eliminate terminal I/O bottleneck that limits frame rates
3. **Cross-Platform**: Support macOS, Linux, and Windows via the bundled `fenster` backend (via `ink-native`), with zero system dependencies
4. **Feature Parity**: Support all post-processing effects available in terminal renderers
5. **Seamless Integration**: Add "native" as a new video driver alongside kitty, terminal, ascii, emoji

### Non-Goals

1. Hardware-accelerated rendering (GPU shaders) - native rendering uses CPU/software rendering
2. Multiple window support
3. Fullscreen exclusive mode (windowed fullscreen is acceptable)
4. Custom window chrome or UI elements beyond the game display

### Background: Terminal I/O Bottleneck

Terminal rendering has inherent limitations:

| Issue | Impact |
|-------|--------|
| **I/O bandwidth** | Writing pixels as ANSI escape codes or PNG data is slower than direct framebuffer access |
| **Terminal parsing** | Terminal emulators must parse escape sequences, adding latency |
| **Redraw overhead** | Full-screen updates require significant data transfer |
| **Protocol limitations** | Even Kitty graphics protocol has per-frame overhead |

A native window bypasses all of these by rendering directly to a window's framebuffer.

---

## Architecture

### Renderer Interface

All renderers implement the `Renderer` interface defined in `src/Emulator/types.ts`:

```typescript
interface Renderer {
  render(frameBuffer: Uint8Array): string;
  renderRgb15?(frameBuffer: Uint16Array): string;
  renderRgb24?(frameBuffer: Uint8Array): string;
  clearScreen(): string;
  hideCursor(): string;
  showCursor(): string;
  getStatusRow(): number;
  moveCursorToRow(row: number): string;
  setDimensions?(width: number, height: number): void;
}
```

**Challenge**: The interface returns strings (ANSI escape sequences) written to stdout. SDL rendering doesn't output strings.

### Proposed Solution: Dual-Mode Architecture

Modify the rendering pipeline to support both terminal-based and window-based renderers:

```typescript
interface Renderer {
  // Existing string-based methods (terminal renderers)
  render(frameBuffer: Uint8Array): string;
  renderRgb15?(frameBuffer: Uint16Array): string;
  renderRgb24?(frameBuffer: Uint8Array): string;

  // New: Direct rendering (window-based renderers)
  renderDirect?(frameBuffer: Uint8Array): void;
  renderRgb15Direct?(frameBuffer: Uint16Array): void;
  renderRgb24Direct?(frameBuffer: Uint8Array): void;

  // Renderer type indicator
  readonly isWindowBased?: boolean;

  // Terminal-specific (no-op for window renderers)
  clearScreen(): string;
  hideCursor(): string;
  showCursor(): string;
  getStatusRow(): number;
  moveCursorToRow(row: number): string;

  // Window-specific (optional)
  setDimensions?(width: number, height: number): void;
  destroy?(): void;  // Cleanup SDL resources
}
```

### Emulator Integration

In `emulator.ts`, modify the render dispatch:

```typescript
// In the render method
if (this.renderer.isWindowBased) {
  // Direct rendering - no stdout write
  if (colorFormat === 'rgb24' && this.renderer.renderRgb24Direct) {
    this.renderer.renderRgb24Direct(framebuffer);
  } else if (colorFormat === 'rgb15' && this.renderer.renderRgb15Direct) {
    this.renderer.renderRgb15Direct(framebuffer);
  } else if (this.renderer.renderDirect) {
    this.renderer.renderDirect(framebuffer);
  }
} else {
  // Existing terminal-based rendering
  const output = this.renderer.render(framebuffer);
  process.stdout.write(output);
}
```

---

## SDL Integration

> **Historical design exploration:** This section (Library Selection, SDL2 API Surface, `SdlRenderer` class) predates adopting `ink-native` and was not implemented as written - see the Implementation note at the top of this document. `ink-native` bundles its own `fenster` window backend; emoemu does not write any SDL2/koffi bindings.

### Library Selection

**Recommended**: `@aspect-energy/node-sdl2` or `@aspect-energy/sdl-bindings`

| Library | Pros | Cons |
|---------|------|------|
| `node-sdl2` | Active maintenance, TypeScript support | May require native compilation |
| `sdl2-ffi` | Pure FFI via ffi-napi | Older, less maintained |
| Custom koffi bindings | Full control, consistent with libretro approach | More implementation work |

**Recommendation**: Use koffi (already used for libretro) to create SDL2 bindings. This maintains consistency and avoids adding new native dependencies.

### SDL2 API Surface

Minimal SDL2 functions needed:

```typescript
// Initialization
SDL_Init(SDL_INIT_VIDEO): number;
SDL_Quit(): void;

// Window
SDL_CreateWindow(title: string, x: number, y: number, w: number, h: number, flags: number): Pointer;
SDL_DestroyWindow(window: Pointer): void;
SDL_SetWindowTitle(window: Pointer, title: string): void;

// Renderer (SDL's 2D renderer, not to be confused with our Renderer interface)
SDL_CreateRenderer(window: Pointer, index: number, flags: number): Pointer;
SDL_DestroyRenderer(renderer: Pointer): void;
SDL_RenderClear(renderer: Pointer): number;
SDL_RenderPresent(renderer: Pointer): void;

// Texture
SDL_CreateTexture(renderer: Pointer, format: number, access: number, w: number, h: number): Pointer;
SDL_DestroyTexture(texture: Pointer): void;
SDL_UpdateTexture(texture: Pointer, rect: Pointer | null, pixels: Buffer, pitch: number): number;
SDL_RenderCopy(renderer: Pointer, texture: Pointer, src: Pointer | null, dst: Pointer | null): number;

// Events (for window close, resize)
SDL_PollEvent(event: Pointer): number;
```

### SdlRenderer Class

```typescript
// src/rendering/sdl-renderer.ts

export interface SdlRendererOptions {
  width: number;
  height: number;
  scale?: number;
  title?: string;
  // Post-processing options
  gamma?: number;
  scanlines?: number;
  saturation?: number;
  brightness?: number;
  contrast?: number;
  vignette?: number;
  bloom?: number;
  ntsc?: number;
  curvature?: number;
  chromaticAberration?: number;
}

export class SdlRenderer implements Renderer {
  readonly isWindowBased = true;

  private window: Pointer;
  private sdlRenderer: Pointer;
  private texture: Pointer;
  private frameBuffer: Uint8Array;

  constructor(options: SdlRendererOptions) {
    // Initialize SDL
    // Create window at scaled dimensions
    // Create renderer and texture
  }

  renderDirect(frameBuffer: Uint8Array): void {
    // Apply post-processing effects to frameBuffer
    // Convert indexed color to RGB24
    // Update texture with pixel data
    // Render texture to window
    // Present
  }

  renderRgb15Direct(frameBuffer: Uint16Array): void {
    // Convert RGB15 to RGB24
    // Apply effects
    // Update and present
  }

  renderRgb24Direct(frameBuffer: Uint8Array): void {
    // Apply effects directly
    // Update and present
  }

  // Terminal methods return empty strings (no-op)
  render(_frameBuffer: Uint8Array): string { return ''; }
  clearScreen(): string { return ''; }
  hideCursor(): string { return ''; }
  showCursor(): string { return ''; }
  getStatusRow(): number { return 0; }
  moveCursorToRow(_row: number): string { return ''; }

  destroy(): void {
    // Clean up SDL resources
    SDL_DestroyTexture(this.texture);
    SDL_DestroyRenderer(this.sdlRenderer);
    SDL_DestroyWindow(this.window);
    SDL_Quit();
  }
}
```

---

## Type System Changes (Shipped)

### VideoDriver Type

**File**: `src/frontend/config/types.ts`

```typescript
// Before
export type VideoDriver = "kitty" | "terminal" | "ascii" | "emoji";

// After (shipped)
export type VideoDriver = "native" | "kitty" | "terminal" | "ascii" | "emoji";
```

### RenderMode Type

**File**: `src/frontend/SettingsManager/index.ts`

```typescript
// Before
export type RenderMode = 'kitty' | 'terminal' | 'ascii' | 'emoji';

// After (shipped)
export type RenderMode = 'native' | 'kitty' | 'terminal' | 'ascii' | 'emoji';
```

### Type Guards

**File**: `src/frontend/config/types.ts`

```typescript
export const VIDEO_DRIVERS: readonly VideoDriver[] = ['native', 'kitty', 'terminal', 'ascii', 'emoji'];

export const isVideoDriver = (value: unknown): value is VideoDriver => {
  return isString(value) && VIDEO_DRIVERS.includes(value as VideoDriver);
};
```

---

## CLI Integration

### New Flag (Shipped as `--native`)

**File**: `src/index.ts`

Added `--native` flag alongside existing video driver flags:

```typescript
.option('--native', 'Use native window rendering (best performance)')
.option('--kitty', 'Use Kitty graphics protocol')
.option('--terminal', 'Use terminal character rendering')
.option('--ascii', 'Use colored ASCII character rendering')
.option('--emoji', 'Use emoji character rendering')
```

### Driver Selection Function

```typescript
const videoDriverToRenderMode = (driver: VideoDriver | null): RenderMode | undefined => {
  switch (driver) {
    case null: return undefined;
    case "native": return "native";
    case "kitty": return "kitty";
    case "terminal": return "terminal";
    case "ascii": return "ascii";
    case "emoji": return "emoji";
    default: return "kitty";
  }
};
```

---

## Configuration

### Config File

**File**: `~/.config/emoemu/emoemu.cfg`

```ini
video_driver = "native"
menu_scale_factor = 3
```

### Config Keys (Shipped)

Unlike the `sdl_scale` / `sdl_vsync` / `sdl_window_width` / `sdl_window_height` keys originally proposed below, no new config keys shipped. Window scale reuses the existing `menu_scale_factor` key (passed to `ink-native` as `scaleFactor`, applied only at window creation); `ink-native` has no VSync toggle or window-size override:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `menu_scale_factor` | number | auto | Window scale, passed to `ink-native` as `scaleFactor`. Applies only at window creation. |

---

## Window Management

> **Historical design (SDL):** This section describes the original SDL-based window management design. The shipped implementation uses `ink-native` (fenster), which owns the window and has no VSync toggle (fixed `frameRate`, default 60), no runtime `setTitle`, and no programmatic window resize.

### Initialization

1. Calculate window size: `sourceWidth * scale` x `sourceHeight * scale`
2. Create centered window with title "emoemu - {game_name}"
3. Create SDL renderer with VSync if enabled
4. Create streaming texture matching source dimensions

### Event Handling

Poll SDL events in the main loop to handle:

| Event | Action |
|-------|--------|
| `SDL_QUIT` | Clean shutdown |
| `SDL_WINDOWEVENT_RESIZED` | Update scale/viewport |
| `SDL_WINDOWEVENT_FOCUS_LOST` | Optional: pause emulation |

### Input Considerations

SDL can capture keyboard events. Two approaches:

1. **Hybrid mode**: Continue using terminal keyboard input (Kitty protocol), SDL only for display
2. **Full SDL mode**: Use SDL for both display and keyboard input

**Recommendation**: Start with hybrid mode (SDL display + terminal input) to minimize changes. Full SDL input can be added later.

---

## Post-Processing Effects

Reuse existing post-processing pipeline from `src/rendering/post-processing/`:

```typescript
import { applyEffects, EffectOptions } from './post-processing';

// In the native renderer's RGB conversion path (NativeRenderer)
const processed = applyEffects(frameBuffer, width, height, {
  gamma: this.gamma,
  scanlines: this.scanlines,
  saturation: this.saturation,
  // ... other effects
});
```

The effects operate on raw pixel data, so they work identically for native and terminal renderers.

---

## Status Bar / OSD

Terminal renderers display status information (FPS, core info) in terminal rows below the game display. For a native window:

> **Shipped reality:** `ink-native` exposes no runtime `setTitle`, so **Option C below is not available** - it was the original recommendation but could not be implemented. Options A and B remain the viable approaches for status/OSD in native mode.

### Option A: Render to Texture

Draw status text directly on the native framebuffer using a bitmap font. Simple but limited styling.

### Option B: Separate Terminal Output

Keep status/OSD in terminal while game renders to the native window. Users see:
- Native window with game display
- Terminal with status info, notifications

### Option C: Window Title (not available - see note above)

Put key status info in window title: "emoemu - Super Mario Bros [60 FPS]". Not possible with `ink-native`, which has no runtime title-setting API.

---

## File Structure

```
src/rendering/
├── index.ts                 # Add SdlRenderer export
├── sdl-renderer.ts          # New: SDL renderer implementation
├── sdl-bindings.ts          # New: koffi SDL2 bindings
├── renderer.ts              # Existing: TerminalRenderer
├── kitty-renderer.ts        # Existing: KittyRenderer
└── ...
```

---

## Implementation Phases

### Phase 1: SDL Bindings

1. Create `sdl-bindings.ts` with koffi FFI definitions
2. Implement basic window creation and destruction
3. Test standalone (outside emulator)

### Phase 2: SdlRenderer Class

1. Implement `SdlRenderer` with basic RGB24 rendering
2. Add to renderer exports
3. Integrate with emulator's renderer selection

### Phase 3: Type System & CLI

1. Update `VideoDriver` and `RenderMode` types
2. Add `--native` CLI flag
3. Update type guards
4. Add config keys

### Phase 4: Color Format Support

1. Implement indexed color rendering (NES palette conversion)
2. Implement RGB15 rendering (GBC, SNES)
3. Test with various cores

### Phase 5: Post-Processing

1. Integrate existing effects pipeline
2. Add SDL-specific effect options if needed
3. Test all effects

### Phase 6: Polish

1. Window management (resize, close handling)
2. Status display (window title or terminal)
3. Documentation updates

---

## Testing Strategy

### Manual Testing

| Test Case | Expected Result |
|-----------|-----------------|
| Launch with `--native` | Native window opens, game renders |
| NES ROM (indexed color) | Correct colors from palette |
| SNES ROM (RGB15) | Correct color conversion |
| N64 ROM (RGB24) | Direct rendering, good performance |
| Window close | Clean shutdown, no crash |
| Effects (CRT preset) | Visual effects applied |

### Performance Testing

Compare frame rates between SDL and terminal modes:

| System | Terminal (Kitty) | SDL | Expected Improvement |
|--------|-----------------|-----|---------------------|
| NES | 60 FPS | 60 FPS | Equivalent (not bottlenecked) |
| N64 | 30-40 FPS | 50-60 FPS | ~50% improvement |

### Compatibility Testing

Test on:
- macOS (Apple Silicon and Intel)
- Linux (X11 and Wayland)
- Windows (if supported)

---

## Dependencies

### Runtime (Shipped)

`ink-native` bundles its `fenster` native window backend and the Cozette bitmap font directly in the npm package - **zero system dependencies**. No SDL2 install of any kind is required on any platform:

| Platform | Installation |
|----------|-------------|
| macOS | None - bundled with `ink-native` |
| Linux | None - bundled with `ink-native` |
| Windows | None - bundled with `ink-native` |

### Build Dependencies

None - `ink-native` ships prebuilt/bundled, so there is no native compilation step (this matches the original goal of avoiding one, though the mechanism changed from koffi FFI to `ink-native`'s bundled backend).

---

## Limitations

1. **No hardware acceleration**: software rendering is used; GPU shaders not available
2. **Shared window with UI**: Game and Ink UI share a single native window (see [native-ui-rendering-trd.md](./native-ui-rendering-trd.md)), not integrated into the terminal
3. **Input latency**: May have slightly different input characteristics than terminal mode
4. **Status display**: Limited compared to terminal's flexible text output
5. **No runtime `setTitle`**: `ink-native` exposes no API to change the window title after creation
6. **No runtime scale-factor change**: `menu_scale_factor` (→ `scaleFactor`) only applies at window creation
7. **No programmatic window resize**: the game letterboxes into the fixed window instead of resizing it

---

## Future Enhancements

1. **SDL GPU renderer**: Use SDL's GPU-accelerated renderer for better scaling
2. **Shader support**: Add shader passes for advanced effects
3. **Full SDL input**: Use SDL for keyboard/gamepad input
4. **Fullscreen mode**: Toggle between windowed and fullscreen
5. **Multiple windows**: Support for debug views (VRAM, nametables)

---

## Resources

- [SDL2 Documentation](https://wiki.libsdl.org/SDL2/FrontPage)
- [SDL2 Rendering API](https://wiki.libretro.com/index.php/SDL2_Rendering)
- [koffi FFI Library](https://koffi.dev/)
