# Native UI Rendering - Technical Requirements Document

This document describes the requirements and implementation approach for rendering the Ink-based UI (ROM browser, settings, dialogs) through a native window instead of the terminal.

> **Implementation note:** This design shipped via the [`ink-native`](https://www.npmjs.com/package/ink-native) package — a bundled `fenster` native window backend plus an embedded Cozette bitmap font, with **zero system dependencies** to install. The CLI flag is `--native` and the config value is `video_driver = "native"`. UI and game share a single native window created once via `createStreams()`; the app hands the window off between UI and game with `window.pause()` / `window.resume()`, and the game renderer writes each post-processed frame directly into ink-native's shared `Uint32Array` framebuffer (`0xAARRGGBB`, via `packColor` + `renderer.present()`). This replaced the custom-SDL2-bindings approach originally proposed in this document.
>
> **Known limitations of the shipped implementation:** no runtime `setTitle` (ink-native exposes none), no runtime scale-factor change (`menu_scale_factor` maps to ink-native's `scaleFactor`, which only applies at window creation), and no programmatic window resize (the game letterboxes into the fixed window instead).
>
> Aside from the "Overview", "Configuration", and "Dependencies" sections (updated to reflect what shipped), the remaining sections below — Implementation Approaches, Text Rendering internals, SDL Bindings Extensions, ANSI Sequence Parsing, Input Handling, UI Window Management, Rendering Pipeline, File Structure, Integration Point, Implementation Phases, Testing Strategy, HiDPI / Retina Display Support, and Alternatives Considered — describe the original custom-SDL2-bindings exploration that predated adopting `ink-native`. They are retained as historical design context — `ink-native` handles window, font, and input internally, so emoemu does not implement any of this bespoke SDL/TTF/ANSI-parsing code, and file/class names like `sdl-ui/`, `SdlUiRenderer`, or `SdlWindowManager` do not exist in the shipped code. Where a passage below asserts something as a current requirement that is no longer true (e.g. a stated dependency on SDL2_ttf), treat this note as the correction.

**Key principle:** UI rendering mode follows game rendering mode. When a user selects native rendering (`--native` or `video_driver = "native"`), both the UI and game render to the native window. When a user selects terminal rendering modes (kitty, terminal, ascii, emoji), both UI and game render to the terminal. There is no separate UI mode selection.

## Overview

### Goals

1. **Unified Experience Per Mode**: UI rendering follows game rendering mode - native mode renders everything in the native window, terminal modes render everything in terminal
2. **Consistent Visuals**: UI and game share the same output target, eliminating context switches
3. **Seamless Transitions**: No terminal/window split when using native mode
4. **Preserve Terminal Mode**: Terminal rendering modes (kitty, terminal, ascii, emoji) continue to work exactly as today

### Non-Goals

1. Separate UI renderer selection - UI mode always matches game renderer mode
2. Complex GUI toolkit features (drag-and-drop, advanced animations)
3. Custom widget rendering (reuse Ink's component model where possible)
4. GPU-accelerated UI rendering

### Background: Pre-`ink-native` Architecture

Before this TRD's design shipped, the (now-removed) `ink-sdl` architecture separated UI and game rendering when SDL mode was selected:

```
┌─────────────────────────────────────┐
│    Terminal (Ink.js/React)          │
│  ├── ROM Browser                    │
│  ├── Settings Panel                 │
│  ├── Core Selector                  │
│  └── Dialogs                        │
└─────────────────────────────────────┘
              ↓ (user selects ROM)
         stdin reset
              ↓
┌─────────────────────────────────────┐
│    Native Window (SDL Renderer)     │
│  ├── Game Output                    │
│  └── Status Bar                     │
└─────────────────────────────────────┘
```

**Pain points (SDL mode only):**

| Issue | Impact |
|-------|--------|
| **Context switching** | User sees terminal → SDL window → terminal transitions |
| **Visual inconsistency** | Terminal UI looks different from SDL game display |
| **Input mode changes** | Keyboard handling differs between terminal (Kitty protocol) and SDL |
| **Window management** | Two separate contexts to manage |

**Note:** Terminal modes (kitty, terminal, ascii, emoji) don't have this problem - everything renders to the terminal consistently. This TRD addresses the native/SDL mode experience only.

### Target Architecture (Shipped, via `ink-native`)

The render mode selection determines both UI and game output:

**Terminal Modes (kitty, terminal, ascii, emoji):**
```
┌─────────────────────────────────────┐
│    Terminal (unified)               │
│  ├── ROM Browser (Ink)              │
│  ├── Game Output (selected mode)    │
│  └── Status Bar                     │
└─────────────────────────────────────┘
        (no change from today)
```

**Native Mode:**
```
┌─────────────────────────────────────────┐
│    Native Window (unified)              │
│  ├── ROM Browser (Ink, via ink-native)  │
│  ├── Game Output (framebuffer blit)     │
│  └── Status Bar                         │
└─────────────────────────────────────────┘
        (unified experience - shipped)
```

---

## Architecture

### Ink Rendering Model

Ink uses a custom renderer built on React's reconciler. Key concepts:

```typescript
// Ink's render pipeline
React Component → Ink Reconciler → Output (yoga layout) → Terminal Output

// Terminal output generates ANSI escape sequences
// Written to stdout via ink's internal render loop
```

**Key files in Ink:**

- `ink/src/render.ts` - Reconciler and render loop
- `ink/src/output.ts` - Terminal output generation
- `ink/src/components/` - Box, Text, and other primitives

### Proposed Solution: Custom Ink Output Target

Create a custom output target that renders to an SDL texture instead of generating ANSI sequences:

```
React Component → Ink Reconciler → Yoga Layout → SDL Texture Output
                                                      ↓
                                              SDL Window Display
```

### High-Level Architecture

```typescript
// New rendering pipeline
interface SdlUiRenderer {
  // Receive layout from Ink
  renderFrame(nodes: InkNode[]): void;

  // Text rendering
  drawText(text: string, x: number, y: number, style: TextStyle): void;

  // Box rendering
  drawBox(x: number, y: number, width: number, height: number, style: BoxStyle): void;

  // Present to screen
  present(): void;
}
```

---

## Implementation Approaches

### Option A: Fork Ink's Output Layer

Modify Ink's output generation to target SDL instead of terminal:

**Pros:**
- Maintains full Ink component compatibility
- Existing UI code works unchanged
- React devtools and debugging still work

**Cons:**
- Requires deep understanding of Ink internals
- May break with Ink updates
- Complex integration with yoga layout

### Option B: Custom React Renderer for SDL

Build a new React reconciler that renders directly to SDL:

**Pros:**
- Clean separation from Ink
- Full control over rendering pipeline
- Can optimize for SDL-specific features

**Cons:**
- Significant implementation effort
- Must reimplement component primitives (Box, Text, etc.)
- Duplicates much of Ink's work

### Option C: Ink Output Interception (Recommended)

Intercept Ink's rendered output and convert to SDL rendering commands:

```typescript
// Intercept Ink's stdout writes
const inkOutputStream = new InkToSdlStream(sdlRenderer);
render(<App />, { stdout: inkOutputStream });

class InkToSdlStream extends Writable {
  write(chunk: Buffer): boolean {
    const text = chunk.toString();
    // Parse ANSI sequences and convert to SDL draw calls
    this.parseAndRender(text);
    return true;
  }
}
```

**Pros:**
- Minimal changes to existing Ink code
- Works with current UI components
- Fallback to terminal is trivial (just use real stdout)

**Cons:**
- ANSI parsing adds complexity
- Some terminal features may not map cleanly to SDL
- Character-based positioning requires font metrics

**Recommendation**: Option C provides the best balance of effort vs. compatibility.

---

## Text Rendering

### Font Requirements

| Requirement | Rationale |
|-------------|-----------|
| **Monospace** | Ink layouts assume fixed-width characters |
| **Unicode support** | Box-drawing characters, symbols |
| **HiDPI support** | Crisp rendering at any scale factor |
| **Consistent metrics** | Layout must match Ink's character grid |

### Approach Comparison

| Factor | TTF (SDL_ttf) | Bitmap Atlas |
|--------|---------------|--------------|
| **HiDPI handling** | Excellent - render at exact physical size | Requires multiple atlases (1x, 2x, 3x) |
| **Fractional scaling** | Native support (Windows 125%, 150%) | Must round to nearest integer |
| **Display changes** | Re-open font at new size | Swap atlas, may cause visual jump |
| **Unicode coverage** | Full (depends on font) | Limited to pre-rendered glyphs |
| **Render performance** | Moderate (glyph caching helps) | Fast (simple texture blits) |
| **Asset management** | Single .ttf file | Multiple .png atlases |
| **Aesthetic** | Modern, smooth | Retro, pixel-perfect |

### Recommendation: TTF with Pixel Font (Updated)

> **Shipped reality:** `ink-native` uses a fixed, embedded **Cozette bitmap font** — not TTF. There is no runtime font selection or re-rasterization; the font is baked into the package and scales via the fixed `scaleFactor` set at window creation. The TTF analysis below was the pre-`ink-native` exploration and does not describe the shipped font pipeline.

Given HiDPI is a core requirement, **TTF is recommended** for the following reasons:

1. **Single asset** - One .ttf file vs. maintaining 3+ bitmap atlases
2. **Fractional scaling** - Windows 125%/150% scaling works without rounding hacks
3. **Display migration** - Moving window between 1x and 2x displays is seamless
4. **Unicode** - Full box-drawing, symbols, and international character support

To preserve the retro aesthetic, use a **pixel/bitmap-style TTF font**:
- [Cozette](https://github.com/slavfox/Cozette) - Bitmap-style TTF, good Unicode coverage
- [Monocraft](https://github.com/IdreesInc/Monocraft) - Minecraft-inspired, TTF format
- [PixelMplus](https://github.com/itouhiro/PixelMplus) - Japanese pixel font with Latin
- [Ark Pixel](https://github.com/TakWolf/ark-pixel-font) - Pan-CJK pixel font

These fonts render with a retro look but scale cleanly via TTF.

### SDL_ttf Implementation

```typescript
// src/rendering/sdl-ui/text-renderer.ts

interface SdlTextRenderer {
  private font: Pointer;
  private fontSize: number;
  private scaleFactor: number;
  private glyphCache: Map<string, SDL_Texture>;

  constructor(fontPath: string, baseSize: number, scaleFactor: number) {
    this.fontSize = baseSize;
    this.scaleFactor = scaleFactor;
    // Open font at physical size for crisp rendering
    const physicalSize = Math.round(baseSize * scaleFactor);
    this.font = TTF_OpenFont(fontPath, physicalSize);
  }

  // Re-open font when scale factor changes (display change)
  updateScaleFactor(newScale: number): void {
    if (newScale !== this.scaleFactor) {
      TTF_CloseFont(this.font);
      this.scaleFactor = newScale;
      const physicalSize = Math.round(this.fontSize * newScale);
      this.font = TTF_OpenFont(this.fontPath, physicalSize);
      this.glyphCache.clear();  // Invalidate cached glyphs
    }
  }

  measureText(text: string): { width: number; height: number } {
    const w = Buffer.alloc(4);
    const h = Buffer.alloc(4);
    TTF_SizeUTF8(this.font, text, w, h);
    return { width: w.readInt32LE(0), height: h.readInt32LE(0) };
  }

  renderText(text: string, color: Color): SDL_Texture {
    // Check cache first
    const cacheKey = `${text}:${color.r}:${color.g}:${color.b}`;
    if (this.glyphCache.has(cacheKey)) {
      return this.glyphCache.get(cacheKey)!;
    }

    const surface = TTF_RenderUTF8_Blended(this.font, text, color);
    const texture = SDL_CreateTextureFromSurface(this.renderer, surface);
    SDL_FreeSurface(surface);

    this.glyphCache.set(cacheKey, texture);
    return texture;
  }
}
```

### Fallback: Bitmap Font (Optional)

For users who prefer pixel-perfect rendering at the cost of flexibility:

```typescript
interface BitmapFont {
  textures: Map<'1x' | '2x' | '3x', SDL_Texture>;
  glyphWidth: number;   // Logical size (e.g., 8)
  glyphHeight: number;  // Logical size (e.g., 16)

  getAtlasForScale(scale: number): { texture: SDL_Texture; physicalGlyphSize: number } {
    const key = scale >= 2.5 ? '3x' : scale >= 1.5 ? '2x' : '1x';
    const multiplier = key === '3x' ? 3 : key === '2x' ? 2 : 1;
    return {
      texture: this.textures.get(key)!,
      physicalGlyphSize: this.glyphWidth * multiplier,
    };
  }
}
```

Can be offered as a config option: `sdl_ui_font_type = "ttf" | "bitmap"`

---

## SDL Bindings Extensions

### New SDL2 Functions Required

Add to `src/rendering/sdl-bindings.ts`:

```typescript
// Text rendering (SDL_ttf)
TTF_Init(): number;
TTF_Quit(): void;
TTF_OpenFont(file: string, ptsize: number): Pointer;
TTF_CloseFont(font: Pointer): void;
TTF_RenderUTF8_Blended(font: Pointer, text: string, color: SDL_Color): Pointer;
TTF_SizeUTF8(font: Pointer, text: string, w: Pointer, h: Pointer): number;

// Additional texture operations
SDL_CreateTextureFromSurface(renderer: Pointer, surface: Pointer): Pointer;
SDL_FreeSurface(surface: Pointer): void;
SDL_SetTextureBlendMode(texture: Pointer, blendMode: number): number;
SDL_SetRenderDrawColor(renderer: Pointer, r: number, g: number, b: number, a: number): number;
SDL_RenderFillRect(renderer: Pointer, rect: Pointer): number;
SDL_RenderDrawRect(renderer: Pointer, rect: Pointer): number;

// HiDPI support
SDL_GetRendererOutputSize(renderer: Pointer, w: Pointer, h: Pointer): number;
SDL_GetWindowDisplayIndex(window: Pointer): number;
SDL_GetDisplayDPI(displayIndex: number, ddpi: Pointer, hdpi: Pointer, vdpi: Pointer): number;
```

### SDL Window Flags

```typescript
// Window creation flags for HiDPI
const SDL_WINDOW_ALLOW_HIGHDPI = 0x00002000;
const SDL_WINDOW_RESIZABLE = 0x00000020;

// Window event types for display changes
const SDL_WINDOWEVENT_DISPLAY_CHANGED = 20;
const SDL_WINDOWEVENT_SIZE_CHANGED = 6;
```

---

## ANSI Sequence Parsing

### Sequences to Support

| Sequence | Purpose | SDL Equivalent |
|----------|---------|----------------|
| `\x1b[{n};{m}H` | Cursor position | Set draw coordinates |
| `\x1b[{n}m` | SGR (colors, styles) | Set text/fill color |
| `\x1b[38;2;{r};{g};{b}m` | 24-bit foreground | RGB text color |
| `\x1b[48;2;{r};{g};{b}m` | 24-bit background | RGB fill color |
| `\x1b[1m` | Bold | Bold font variant or brighter color |
| `\x1b[4m` | Underline | Draw underline |
| `\x1b[7m` | Reverse video | Swap fg/bg colors |
| `\x1b[2J` | Clear screen | Clear texture |

### Parser Implementation

```typescript
// src/rendering/ansi-parser.ts

interface DrawCommand {
  type: 'text' | 'fill' | 'clear' | 'cursor';
  // ... command-specific data
}

const parseAnsiStream = (input: string): DrawCommand[] => {
  const commands: DrawCommand[] = [];
  let cursor = { x: 0, y: 0 };
  let style = { fg: WHITE, bg: BLACK, bold: false, underline: false };

  // State machine to parse escape sequences and text
  // ...

  return commands;
};
```

---

## Input Handling

### Keyboard Input

When UI renders to SDL, keyboard input comes from SDL events instead of stdin:

```typescript
// Map SDL key events to Ink input
const sdlKeyToInkKey = (event: SDL_KeyboardEvent): string | null => {
  switch (event.keysym.sym) {
    case SDLK_UP: return 'up';
    case SDLK_DOWN: return 'down';
    case SDLK_LEFT: return 'left';
    case SDLK_RIGHT: return 'right';
    case SDLK_RETURN: return 'return';
    case SDLK_ESCAPE: return 'escape';
    case SDLK_TAB: return 'tab';
    case SDLK_BACKSPACE: return 'backspace';
    default:
      // Handle printable characters
      if (event.keysym.sym >= 32 && event.keysym.sym < 127) {
        return String.fromCharCode(event.keysym.sym);
      }
      return null;
  }
};
```

### Mouse Input

Ink supports mouse via terminal mouse protocols. For SDL:

```typescript
// SDL mouse events
SDL_MOUSEMOTION → track hover state
SDL_MOUSEBUTTONDOWN → click events
SDL_MOUSEWHEEL → scroll events

// Convert pixel coordinates to character grid
const pixelToChar = (x: number, y: number): { col: number; row: number } => ({
  col: Math.floor(x / glyphWidth),
  row: Math.floor(y / glyphHeight),
});
```

### Input Injection

Create a fake stdin stream that receives SDL input:

```typescript
class SdlInputBridge extends Readable {
  handleSdlEvent(event: SDL_Event): void {
    if (event.type === SDL_KEYDOWN) {
      const key = sdlKeyToInkKey(event.key);
      if (key) {
        // Push to Ink's input stream
        this.push(key);
      }
    }
  }
}
```

---

## UI Window Management

This section applies to SDL mode only. Terminal modes continue to use the existing Ink-based UI with no changes.

### Mode Selection Flow

```
Application Start
       ↓
┌──────────────────────────────────────┐
│  Check video_driver setting          │
└──────────────────────────────────────┘
       ↓                    ↓
   SDL mode            Terminal mode
       ↓                    ↓
┌──────────────┐    ┌──────────────────┐
│ SDL Window   │    │ Terminal (Ink)   │
│ UI + Game    │    │ UI + Game        │
└──────────────┘    └──────────────────┘
```

### SDL Mode Window Lifecycle

```
Application Start (SDL mode)
       ↓
┌──────────────────────────┐
│  SDL UI Window Created   │
│  - ROM Browser renders   │
│  - Settings accessible   │
└──────────────────────────┘
       ↓ (user launches game)
┌──────────────────────────┐
│  Same Window, New Mode   │
│  - Game renders          │
│  - UI overlay (optional) │
└──────────────────────────┘
       ↓ (user exits game)
┌──────────────────────────┐
│  Return to UI Mode       │
│  - ROM Browser renders   │
└──────────────────────────┘
```

### Unified Window vs. Separate Windows

**Option 1: Single Window (Recommended)**

One SDL window used for both UI and game:

```typescript
class UnifiedSdlWindow {
  private mode: 'ui' | 'game' = 'ui';

  setMode(mode: 'ui' | 'game'): void {
    this.mode = mode;
    if (mode === 'ui') {
      this.resize(UI_WIDTH, UI_HEIGHT);
    } else {
      this.resize(gameWidth * scale, gameHeight * scale);
    }
  }
}
```

**Pros:** Seamless transitions, consistent window position
**Cons:** Window resizes between modes

**Option 2: Separate Windows**

UI window and game window are independent:

**Pros:** No resizing needed, can show both simultaneously
**Cons:** More complex window management, less integrated experience

---

## Rendering Pipeline

### Frame Composition

```typescript
class SdlUiRenderer {
  private texture: SDL_Texture;  // UI render target
  private dirtyRegions: SDL_Rect[] = [];

  beginFrame(): void {
    SDL_SetRenderTarget(this.renderer, this.texture);
    SDL_SetRenderDrawColor(this.renderer, 0, 0, 0, 255);
    SDL_RenderClear(this.renderer);
  }

  drawText(text: string, x: number, y: number, style: TextStyle): void {
    // Render text to texture at character grid position
    const pixelX = x * this.glyphWidth;
    const pixelY = y * this.glyphHeight;

    // Draw background if set
    if (style.bg) {
      this.fillRect(pixelX, pixelY, text.length * this.glyphWidth, this.glyphHeight, style.bg);
    }

    // Draw text
    this.renderTextToTexture(text, pixelX, pixelY, style.fg);
  }

  endFrame(): void {
    SDL_SetRenderTarget(this.renderer, null);
    SDL_RenderCopy(this.renderer, this.texture, null, null);
    SDL_RenderPresent(this.renderer);
  }
}
```

### Dirty Region Optimization

Only re-render changed portions:

```typescript
// Track which character cells changed
interface DirtyTracker {
  markDirty(col: number, row: number, width: number, height: number): void;
  getDirtyRegions(): SDL_Rect[];
  clear(): void;
}
```

---

## Component Compatibility

### Ink Components That Work Unchanged

| Component | Notes |
|-----------|-------|
| `Box` | Layout via yoga, renders as colored rectangles |
| `Text` | Direct text rendering |
| `Newline` | Cursor positioning |
| `Spacer` | Layout spacing |

### Components Requiring Adaptation

| Component | Challenge | Solution |
|-----------|-----------|----------|
| `Static` | Scrollback buffer | Maintain virtual buffer |
| `TextInput` | Cursor blinking | SDL timer for cursor |
| Thumbnails (custom) | Kitty graphics protocol | Render directly to SDL |

### Thumbnail Rendering

Current thumbnails use Kitty graphics protocol. For SDL:

```typescript
// Load thumbnail image directly
const thumbnail = SDL_LoadBMP(thumbnailPath);  // or PNG via SDL_image
const texture = SDL_CreateTextureFromSurface(renderer, thumbnail);

// Render at grid position
SDL_RenderCopy(renderer, texture, null, destRect);
```

This actually simplifies thumbnail handling since SDL can render images directly.

---

## Configuration

### Behavior by Render Mode

UI rendering automatically matches the selected game render mode:

| Render Mode | Game Output | UI Output | Input Source |
|-------------|-------------|-----------|--------------|
| `native` | Native window (fenster) | Native window (fenster) | ink-native keyboard events |
| `kitty` | Terminal (Kitty protocol) | Terminal (Ink) | Terminal stdin |
| `terminal` | Terminal (half-blocks) | Terminal (Ink) | Terminal stdin |
| `ascii` | Terminal (ASCII) | Terminal (Ink) | Terminal stdin |
| `emoji` | Terminal (emoji) | Terminal (Ink) | Terminal stdin |

No separate configuration needed - selecting `--native` or `video_driver = "native"` automatically enables native UI rendering.

### Config Keys (Shipped)

Unlike the `sdl_ui_font` / `sdl_ui_font_size` / `sdl_ui_scale` keys originally proposed below, no new config keys shipped. The font is fixed (bundled Cozette, not configurable) and UI/game scale reuses the existing `menu_scale_factor` key, passed to `ink-native` as `scaleFactor`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `menu_scale_factor` | number | auto | UI/window scale, passed to `ink-native` as `scaleFactor`. Applies only at window creation - no runtime change. |

### CLI Usage

```bash
# Native mode: both UI and game render to the native window
emoemu --native

# Terminal modes: both UI and game render to terminal (unchanged behavior)
emoemu --kitty
emoemu --terminal
emoemu --ascii
emoemu --emoji
```

---

## File Structure

```
src/rendering/
├── sdl-renderer.ts          # Existing: Game rendering
├── sdl-bindings.ts          # Existing: SDL2 FFI (extend with TTF)
├── sdl-ui/
│   ├── index.ts             # SdlUiRenderer main class
│   ├── ansi-parser.ts       # ANSI escape sequence parser
│   ├── text-renderer.ts     # Text rendering (bitmap or TTF)
│   ├── input-bridge.ts      # SDL input → Ink input translation
│   ├── bitmap-font.ts       # Bitmap font atlas handling
│   └── fonts/
│       └── default.png      # Built-in bitmap font atlas

src/ui/
├── App.tsx                  # Existing: Entry point (no changes needed)
├── RomBrowser/              # Existing: ROM browser (no changes needed)
└── ...                      # Other UI components (no changes needed)

src/
├── index.ts                 # Modified: Route to SDL or terminal UI based on render mode
└── Emulator/                # Existing: Game rendering (minimal changes)
```

---

## Integration Point

### Routing UI to SDL or Terminal

The main entry point (`src/index.ts`) determines which UI path to use based on the configured render mode:

```typescript
// In src/index.ts - launchBrowser or equivalent

const renderMode = getRenderMode(); // From config or CLI

if (renderMode === 'sdl') {
  // SDL mode: Create SDL window for UI
  const sdlUi = new SdlUiRenderer({
    width: UI_WIDTH,
    height: UI_HEIGHT,
    font: config.sdl_ui_font,
  });

  // Create custom streams that route to SDL
  const sdlOutputStream = new SdlOutputStream(sdlUi);
  const sdlInputStream = new SdlInputStream(sdlUi);

  // Render Ink to SDL
  const { waitUntilExit } = render(<App />, {
    stdout: sdlOutputStream,
    stdin: sdlInputStream,
  });

  await waitUntilExit();
} else {
  // Terminal mode: Use existing Ink setup (unchanged)
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}
```

### Shared SDL Window Between UI and Game

When transitioning from UI to game in SDL mode, reuse the same window:

```typescript
class SdlWindowManager {
  private window: Pointer;
  private renderer: Pointer;

  // UI mode
  getUiRenderer(): SdlUiRenderer {
    return new SdlUiRenderer({ window: this.window, renderer: this.renderer });
  }

  // Game mode
  getGameRenderer(width: number, height: number): SdlRenderer {
    return new SdlRenderer({
      window: this.window,
      renderer: this.renderer,
      width,
      height,
    });
  }
}
```

---

## Implementation Phases

### Phase 1: Foundation

1. Create `sdl-ui/` directory structure
2. Add SDL_ttf bindings to `sdl-bindings.ts`
3. Implement ANSI escape sequence parser
4. Create TTF text renderer with scale-aware font sizing
5. HiDPI window creation with `SDL_WINDOW_ALLOW_HIGHDPI`
6. Scale factor detection and coordinate scaling
7. Bundle Cozette TTF font

**Deliverable:** Can render crisp plain text to SDL window on both standard and HiDPI displays

### Phase 2: Ink Integration

1. Create output stream interceptor (`SdlOutputStream`)
2. Wire Ink render to SDL output
3. Implement cursor positioning
4. Add color support (SGR sequences)

**Deliverable:** Ink components render to SDL (text-only, no interaction)

### Phase 3: Input Handling

1. Implement SDL keyboard → Ink input bridge (`SdlInputStream`)
2. Add mouse support
3. Handle focus and window events

**Deliverable:** Interactive UI in SDL window

### Phase 4: Mode Routing

1. Add render mode check in `src/index.ts`
2. Create `SdlWindowManager` for shared window between UI and game
3. Implement UI → game → UI transitions in SDL mode
4. Verify terminal modes remain unchanged

**Deliverable:** `--native` flag gives unified native-window experience; other modes unchanged

### Phase 5: Visual Polish

1. Box-drawing character support
2. Bold/underline text styles
3. Thumbnail rendering (direct SDL image loading)
4. Consistent styling between UI and game status bar

**Deliverable:** Feature parity with terminal UI

### Phase 6: Optimization

1. Dirty region tracking
2. Texture caching for repeated text
3. Glyph atlas optimization

**Deliverable:** Smooth 60 FPS UI rendering

---

## Testing Strategy

### Unit Tests

| Test | Description |
|------|-------------|
| ANSI parser | Verify correct parsing of all supported sequences |
| Text measurement | Font metrics match expected character grid |
| Input translation | SDL keys map correctly to Ink input |
| Color conversion | SGR codes produce correct RGB values |

### Integration Tests

| Test | Description |
|------|-------------|
| Basic render | Simple Ink app renders to SDL |
| Layout | Box/flex layouts match terminal rendering |
| Interaction | Keyboard navigation works in SDL mode |
| Mode switch | UI → game → UI transitions work cleanly |

### Mode-Specific Tests

Verify both modes work independently:

| Mode | Test | Expected Behavior |
|------|------|-------------------|
| Native | Launch with `--native` | Native window shows ROM browser |
| SDL | Select game | Same window transitions to game |
| SDL | Exit game | Same window returns to ROM browser |
| Kitty | Launch with `--kitty` | Terminal shows ROM browser (unchanged) |
| Kitty | Select game | Terminal shows game (unchanged) |
| Terminal | Launch with `--terminal` | Terminal shows ROM browser (unchanged) |
| Terminal | Select game | Terminal shows game (unchanged) |

### Regression Tests

Ensure terminal modes are not affected:

| Test | Description |
|------|-------------|
| Kitty graphics | Thumbnails render correctly in Kitty mode |
| Mouse support | Terminal mouse (SGR 1006) still works |
| Keyboard input | Kitty keyboard protocol still works |
| Gamepad | Gamepad input works in both modes |

### Visual Tests

| Test | Expected Result |
|------|-----------------|
| ROM browser (SDL) | Grid layout, thumbnails, selection highlight |
| ROM browser (terminal) | Same layout, Kitty/Unicode thumbnails |
| Settings panel | Form inputs, toggles, dropdowns |
| Dialogs | Modal overlays, button focus |
| Search | Text input with cursor |

### Performance Tests

| Metric | Target |
|--------|--------|
| UI frame time (SDL) | < 16ms (60 FPS) |
| UI frame time (terminal) | Unchanged from current |
| Input latency | < 50ms |
| Memory (SDL UI mode) | < 50MB additional |

### HiDPI Tests

| Test Case | Display | Expected Result |
|-----------|---------|-----------------|
| Text rendering | macOS Retina 2x | Crisp, no blur or fuzziness |
| Text rendering | macOS 1x | Normal, sharp text |
| Text rendering | Windows 150% | Crisp (renders at 2x) |
| Font atlas selection | 2x display | Uses 2x bitmap atlas |
| Window move | 1x → 2x display | Re-renders at new scale, stays crisp |
| Window resize | Any | Maintains crisp text at all sizes |
| Thumbnails | 2x display | Sharp image rendering |

---

## Dependencies

### Required (Shipped)

| Dependency | Purpose |
|------------|---------|
| `ink-native` | npm package: bundled `fenster` native window backend + embedded Cozette bitmap font. **No system dependencies** (no SDL2, no SDL2_ttf). |
| Ink | React-based UI (already required) |

There is no "Optional" dependency tier - `ink-native` bundles everything needed for window, font, and thumbnail image display; no equivalent of SDL2_image is required.

### Font Asset (Shipped)

`ink-native` embeds the **Cozette** bitmap font directly in the package - no separate font file to bundle or select:

| Font | Style | Unicode | License |
|------|-------|---------|---------|
| [Cozette](https://github.com/slavfox/Cozette) | Bitmap, embedded in `ink-native` | Good (box-drawing, symbols) | MIT |

The Monocraft/JetBrains Mono alternatives considered below were not adopted - the font is fixed by `ink-native`, not user-selectable.

---

## HiDPI / Retina Display Support

Crisp UI rendering on HiDPI displays (macOS Retina, Windows high-DPI, Linux HiDPI) is essential. Blurry text is unacceptable.

### The HiDPI Challenge

On a 2x Retina display, a "1280x720" window actually has 2560x1440 physical pixels. Without proper handling:
- Text rendered at logical resolution gets scaled up → blurry
- Bitmap fonts look pixelated
- UI appears fuzzy compared to native apps

### SDL HiDPI Architecture

```
┌─────────────────────────────────────────────────────┐
│  Logical Size (what we request): 1280 x 720        │
│  Physical Size (actual pixels): 2560 x 1440        │
│  Scale Factor: 2x                                   │
└─────────────────────────────────────────────────────┘
```

### Implementation Requirements

#### 1. Window Creation with HiDPI Flag

```typescript
// Enable HiDPI support when creating the window
const window = SDL_CreateWindow(
  title,
  SDL_WINDOWPOS_CENTERED,
  SDL_WINDOWPOS_CENTERED,
  logicalWidth,
  logicalHeight,
  SDL_WINDOW_ALLOW_HIGHDPI | SDL_WINDOW_RESIZABLE
);
```

#### 2. Query Actual Drawable Size

```typescript
// Get the real pixel dimensions (not logical)
const getDrawableSize = (window: Pointer): { width: number; height: number } => {
  const w = Buffer.alloc(4);
  const h = Buffer.alloc(4);
  SDL_GetRendererOutputSize(renderer, w, h);
  return {
    width: w.readInt32LE(0),
    height: h.readInt32LE(0),
  };
};

// Calculate scale factor
const logical = { width: 1280, height: 720 };
const physical = getDrawableSize(window);
const scaleFactor = physical.width / logical.width; // 2.0 on Retina
```

#### 3. Render at Native Resolution

All rendering must happen at physical pixel resolution:

```typescript
class SdlUiRenderer {
  private scaleFactor: number;
  private physicalWidth: number;
  private physicalHeight: number;

  constructor(options: SdlUiRendererOptions) {
    // Create window at logical size
    this.window = SDL_CreateWindow(..., logicalWidth, logicalHeight, SDL_WINDOW_ALLOW_HIGHDPI);

    // Get actual pixel dimensions
    const physical = this.getDrawableSize();
    this.physicalWidth = physical.width;
    this.physicalHeight = physical.height;
    this.scaleFactor = physical.width / logicalWidth;

    // Create texture at PHYSICAL size for crisp rendering
    this.texture = SDL_CreateTexture(
      this.renderer,
      SDL_PIXELFORMAT_RGBA8888,
      SDL_TEXTUREACCESS_TARGET,
      this.physicalWidth,  // Physical pixels, not logical
      this.physicalHeight
    );
  }
}
```

#### 4. Scale-Aware Font Rendering

TTF fonts handle HiDPI naturally by rendering at the physical pixel size:

```typescript
// Scale font size by display factor
const baseFontSize = 16;  // Logical size (what we'd use at 1x)
const physicalFontSize = Math.round(baseFontSize * scaleFactor);  // 32 on 2x Retina
const font = TTF_OpenFont(fontPath, physicalFontSize);

// Font renders at native resolution - no scaling artifacts
```

This is the primary advantage of TTF over bitmap fonts for HiDPI - a single font file works at any scale factor without maintaining multiple assets.

#### 5. Scale-Aware Coordinate System

All Ink coordinates (character grid) must be scaled:

```typescript
// Convert character position to physical pixels
const charToPhysical = (col: number, row: number): { x: number; y: number } => ({
  x: col * glyphWidth * scaleFactor,
  y: row * glyphHeight * scaleFactor,
});

// Drawing uses physical coordinates
drawText(text: string, col: number, row: number, style: TextStyle): void {
  const { x, y } = this.charToPhysical(col, row);
  // Render at physical coordinates with scaled font
  this.renderTextAtPhysicalPos(text, x, y, style);
}
```

### Platform-Specific Considerations

| Platform | Scale Factors | Notes |
|----------|---------------|-------|
| macOS Retina | 2x (common), 1x | `SDL_WINDOW_ALLOW_HIGHDPI` required |
| macOS Pro Display XDR | Up to 2x | Same handling |
| Windows | 1x, 1.25x, 1.5x, 2x, etc. | Fractional scaling common |
| Linux (Wayland) | Integer (1x, 2x) | Wayland handles scaling well |
| Linux (X11) | Varies | May need `SDL_VIDEO_X11_NET_WM_BYPASS_COMPOSITOR=0` |

### Fractional Scaling

Windows commonly uses fractional scales (125%, 150%). Options:

**Option A: Round to nearest integer (Recommended)**
```typescript
const effectiveScale = Math.round(scaleFactor);  // 1.5 → 2
```
Slightly larger UI but always crisp.

**Option B: Render at exact scale**
```typescript
const effectiveScale = scaleFactor;  // 1.5 exactly
```
Requires careful sub-pixel rendering, may still have artifacts.

**Recommendation:** Round to nearest integer for guaranteed crispness.

### Testing HiDPI

| Test Case | Expected Result |
|-----------|-----------------|
| macOS Retina 2x | Crisp text, no blur |
| macOS non-Retina 1x | Normal rendering |
| Windows 150% scaling | Crisp (rounded to 2x) |
| Windows 100% scaling | Normal rendering |
| Linux HiDPI | Crisp text |
| Mixed-DPI (move window between displays) | Re-query scale, re-render |

### Display Change Handling

Handle window moving between displays with different DPI:

```typescript
// In SDL event loop
if (event.type === SDL_WINDOWEVENT) {
  if (event.window.event === SDL_WINDOWEVENT_DISPLAY_CHANGED ||
      event.window.event === SDL_WINDOWEVENT_SIZE_CHANGED) {
    // Re-query drawable size - scale factor may have changed
    const newPhysical = this.getDrawableSize();
    if (newPhysical.width !== this.physicalWidth) {
      this.handleScaleChange(newPhysical);
    }
  }
}

handleScaleChange(newPhysical: Size): void {
  this.physicalWidth = newPhysical.width;
  this.physicalHeight = newPhysical.height;
  this.scaleFactor = newPhysical.width / this.logicalWidth;

  // Recreate texture at new size
  SDL_DestroyTexture(this.texture);
  this.texture = SDL_CreateTexture(..., this.physicalWidth, this.physicalHeight);

  // Reload font at new size
  this.reloadFont();

  // Force full redraw
  this.invalidateAll();
}
```

### Config Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `sdl_ui_dpi_aware` | boolean | `true` | Enable HiDPI rendering |
| `sdl_ui_dpi_rounding` | string | `"nearest"` | `"nearest"`, `"floor"`, `"ceil"` for fractional scaling |

---

## Limitations

**Native mode limitations (shipped):**

1. **Character grid constraint**: Native UI must match terminal's character-based model for Ink compatibility
2. **No smooth animations**: Frame-based updates like terminal
3. **Limited typography**: Single embedded font (Cozette), no custom fonts or styling
4. **No rich text**: No inline images (except thumbnails in designated areas)
5. **No runtime `setTitle`**: `ink-native` exposes no API to change the window title after creation
6. **No runtime scale-factor change**: `menu_scale_factor` (→ ink-native's `scaleFactor`) only applies at window creation
7. **No programmatic window resize**: the game letterboxes into the fixed window instead of resizing it

**General limitations:**

1. **No mixed modes**: Cannot use native window for game and terminal for UI (or vice versa)
2. **Font dependency**: Native mode is limited to the font bundled with `ink-native` (Cozette) - no custom font support

---

## Future Enhancements

1. **Smooth scrolling**: Pixel-level scroll instead of line-based
2. **Transitions**: Fade/slide animations between screens
3. **Custom themes**: User-configurable colors and fonts
4. **In-game overlay**: Pause menu, save state UI rendered over game
5. **Sub-pixel text rendering**: LCD sub-pixel antialiasing for even crisper text

---

## Alternatives Considered

### Dear ImGui

Immediate-mode GUI library with SDL backend:

**Pros:** Battle-tested SDL integration, extensive widget library
**Cons:** Would require rewriting all UI code, different paradigm than React

### Electron/WebView

Embed web browser for UI:

**Pros:** Full HTML/CSS capabilities, could reuse Ink with web target
**Cons:** Heavy dependency, complex integration, performance overhead

### SDL_gui / Other SDL GUI Libraries

Various SDL GUI libraries exist:

**Pros:** Native SDL integration
**Cons:** Most are unmaintained, would still require UI rewrite

**Conclusion:** Intercepting Ink output is the least invasive approach that preserves existing UI code while enabling SDL rendering.

---

## Resources

- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [Ink Reconciler Source](https://github.com/vadimdemedes/ink/blob/master/src/reconciler.ts)
- [SDL_ttf Documentation](https://wiki.libsdl.org/SDL2_ttf/FrontPage)
- [ANSI Escape Codes Reference](https://en.wikipedia.org/wiki/ANSI_escape_code)
- [Yoga Layout Engine](https://yogalayout.dev/)
