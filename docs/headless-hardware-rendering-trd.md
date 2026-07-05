# Headless Hardware Rendering - Technical Requirements Document

This document describes the requirements and implementation approach for supporting libretro cores that require OpenGL/Vulkan hardware rendering in emoemu, using headless GPU contexts with pixel readback.

## Overview

### Goals

1. **Enable GPU-Accelerated Cores**: Support libretro cores that require OpenGL or Vulkan hardware rendering
2. **Headless Operation**: Create GPU contexts without windows, suitable for terminal-based rendering
3. **Seamless Integration**: After GPU rendering, read pixels back and pipe them through existing Kitty/Unicode/ASCII renderers
4. **Cross-Platform Support**: Work on macOS, Linux, and Windows

### Non-Goals

1. Direct GPU output to terminal (not possible)
2. Real-time GPU-to-terminal streaming (always requires pixel readback)
3. Vulkan support in initial implementation (focus on OpenGL first)
4. WebGL compatibility (need full OpenGL, not WebGL subset)

### Background: Why Hardware Rendering?

Some libretro cores require hardware-accelerated rendering:

| Core | System | Why GPU Required |
|------|--------|------------------|
| Beetle PSX HW | PlayStation | Hardware-accelerated rendering with enhancements |
| ParaLLEl N64 | Nintendo 64 | Vulkan-based RDP emulation |
| PPSSPP | PSP | OpenGL ES for PSP GPU emulation |
| Dolphin | GameCube/Wii | Modern GPU required for performance |
| Flycast | Dreamcast | PowerVR GPU emulation |

Currently, emoemu returns `false` for `SET_HW_RENDER` environment callbacks, causing these cores to fail initialization or fall back to slower software rendering (when available).

---

## Architecture

### Current Flow (Software Rendering)

```
┌─────────────────┐     video callback      ┌──────────────────┐
│  Libretro Core  │ ──────────────────────► │  CallbackManager │
│  (CPU renders)  │     (pixel buffer)      │  (framebuffer)   │
└─────────────────┘                         └────────┬─────────┘
                                                     │
                                                     ▼
                                            ┌──────────────────┐
                                            │  Kitty Renderer  │
                                            └──────────────────┘
```

### Proposed Flow (Hardware Rendering)

```
┌─────────────────┐                         ┌──────────────────────────┐
│  Libretro Core  │ ──── OpenGL calls ────► │  HardwareRenderContext   │
│  (GPU renders)  │                         │  - Headless EGL/CGL ctx  │
└─────────────────┘                         │  - FBO management        │
                                            │  - glReadPixels()        │
                                            └────────────┬─────────────┘
                                                         │
                                              pixel readback
                                                         │
                                                         ▼
                                            ┌──────────────────┐
                                            │  CallbackManager │
                                            │  (framebuffer)   │
                                            └────────┬─────────┘
                                                     │
                                                     ▼
                                            ┌──────────────────┐
                                            │  Kitty Renderer  │
                                            └──────────────────┘
```

---

## Libretro Hardware Rendering API

### Environment Commands

| Command | Direction | Purpose |
|---------|-----------|---------|
| `SET_HW_RENDER` | Core → Frontend | Core requests hardware context |
| `GET_HW_RENDER_INTERFACE` | Core → Frontend | Get extended HW interface |
| `GET_PREFERRED_HW_RENDER` | Core → Frontend | Ask frontend's preferred context type |
| `SET_HW_SHARED_CONTEXT` | Core → Frontend | Request shared context |

### retro_hw_render_callback Structure

The core passes this struct via `SET_HW_RENDER`:

| Field | Type | Description |
|-------|------|-------------|
| `context_type` | `enum` | OpenGL, OpenGL Core, GLES2, GLES3, or Vulkan |
| `version_major` | `unsigned` | Requested OpenGL major version |
| `version_minor` | `unsigned` | Requested OpenGL minor version |
| `depth` | `bool` | Core needs depth buffer |
| `stencil` | `bool` | Core needs stencil buffer |
| `bottom_left_origin` | `bool` | Coordinate system origin |
| `cache_context` | `bool` | Frontend should cache context |
| `debug_context` | `bool` | Request debug context |
| `context_reset` | `callback` | Called when context is created/reset |
| `context_destroy` | `callback` | Called before context destruction |
| `get_current_framebuffer` | `callback` | **Frontend provides**: Returns FBO id |
| `get_proc_address` | `callback` | **Frontend provides**: Returns GL function pointer |

### API Flow

```
1. Core calls retro_load_game()
   └── Core calls SET_HW_RENDER with requirements
       └── Frontend creates headless GL context
       └── Frontend writes get_current_framebuffer and get_proc_address to struct
       └── Returns true if successful

2. Frontend calls context_reset callback
   └── Core initializes its GL resources

3. Per frame in retro_run():
   └── Core calls get_current_framebuffer() to get FBO
   └── Core renders to FBO using OpenGL
   └── Core does NOT call video_refresh callback (or calls with NULL)
   └── Frontend calls glReadPixels() to get frame

4. On shutdown:
   └── Frontend calls context_destroy callback
   └── Core cleans up GL resources
   └── Frontend destroys GL context
```

---

## Platform-Specific Context Creation

### macOS: CGL (Core Graphics OpenGL)

macOS does not use EGL. Instead, use the CGL API from the OpenGL framework:

```typescript
// Load OpenGL framework
const opengl = koffi.load('/System/Library/Frameworks/OpenGL.framework/OpenGL');

// CGL types
const CGLContextObj = koffi.pointer('CGLContextObj', koffi.opaque());
const CGLPixelFormatObj = koffi.pointer('CGLPixelFormatObj', koffi.opaque());

// Key functions
const CGLChoosePixelFormat = opengl.func('int CGLChoosePixelFormat(int*, CGLPixelFormatObj*, int*)');
const CGLCreateContext = opengl.func('int CGLCreateContext(CGLPixelFormatObj, CGLContextObj, CGLContextObj*)');
const CGLSetCurrentContext = opengl.func('int CGLSetCurrentContext(CGLContextObj)');
const CGLDestroyContext = opengl.func('int CGLDestroyContext(CGLContextObj)');
```

**Pixel format attributes for offscreen rendering:**

```typescript
const attributes = [
  kCGLPFAOpenGLProfile, kCGLOGLPVersion_3_2_Core,  // OpenGL 3.2 Core
  kCGLPFAColorSize, 24,
  kCGLPFADepthSize, 24,
  kCGLPFAStencilSize, 8,
  kCGLPFAOffScreen,  // Critical: offscreen rendering
  0  // Terminator
];
```

### Linux: EGL

EGL provides platform-agnostic OpenGL context creation:

```typescript
// Load EGL and OpenGL ES libraries
const egl = koffi.load('libEGL.so.1');
const gles = koffi.load('libGLESv2.so.2');

// Or for full OpenGL:
const gl = koffi.load('libGL.so.1');

// Key EGL functions
const eglGetDisplay = egl.func('void* eglGetDisplay(void*)');
const eglInitialize = egl.func('int eglInitialize(void*, int*, int*)');
const eglChooseConfig = egl.func('int eglChooseConfig(void*, int*, void*, int, int*)');
const eglCreateContext = egl.func('void* eglCreateContext(void*, void*, void*, int*)');
const eglMakeCurrent = egl.func('int eglMakeCurrent(void*, void*, void*, void*)');
const eglGetProcAddress = egl.func('void* eglGetProcAddress(const char*)');
```

**Surfaceless context (no window/pbuffer needed):**

```typescript
// Use EGL_NO_SURFACE for surfaceless context
const EGL_NO_SURFACE = null;
eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context);
```

**Alternative: Pbuffer surface (more compatible):**

```typescript
const pbufferAttribs = [
  EGL_WIDTH, 1920,
  EGL_HEIGHT, 1080,
  EGL_NONE
];
const surface = eglCreatePbufferSurface(display, config, pbufferAttribs);
```

### Windows: EGL via ANGLE or WGL

**Option 1: ANGLE (Recommended)**

ANGLE provides EGL on Windows, translating OpenGL ES to DirectX:

```typescript
const egl = koffi.load('libEGL.dll');  // From ANGLE
const gles = koffi.load('libGLESv2.dll');
// Same EGL API as Linux
```

**Option 2: WGL (Native)**

```typescript
const opengl32 = koffi.load('opengl32.dll');
const wglCreateContext = opengl32.func('void* wglCreateContext(void*)');
const wglMakeCurrent = opengl32.func('int wglMakeCurrent(void*, void*)');
const wglGetProcAddress = opengl32.func('void* wglGetProcAddress(const char*)');
```

WGL requires a device context (DC), which typically requires a window. Workaround: create a hidden window.

---

## Implementation Components

### 1. HardwareRenderContext Interface

```typescript
// src/cores/libretro/hardware-render/types.ts

export enum HWContextType {
  NONE = 0,
  OPENGL = 1,
  OPENGLES2 = 2,
  OPENGL_CORE = 3,
  OPENGLES3 = 4,
  OPENGLES_VERSION = 5,
  VULKAN = 6,
}

export interface HWRenderRequest {
  contextType: HWContextType;
  versionMajor: number;
  versionMinor: number;
  depth: boolean;
  stencil: boolean;
  bottomLeftOrigin: boolean;
  cacheContext: boolean;
  debugContext: boolean;
}

export interface HardwareRenderContext {
  /** Initialize the headless GL context */
  init(request: HWRenderRequest): boolean;

  /** Get the FBO id for the core to render to */
  getCurrentFramebuffer(): number;

  /** Get a GL function pointer by name */
  getProcAddress(symbol: string): bigint;

  /** Called after core initializes its GL resources */
  contextReset(): void;

  /** Called before destroying the context */
  contextDestroy(): void;

  /** Read rendered pixels from FBO */
  readPixels(width: number, height: number): Uint8Array;

  /** Resize the FBO */
  resize(width: number, height: number): void;

  /** Clean up all resources */
  destroy(): void;
}
```

### 2. FBO Management

The frontend must provide a framebuffer object (FBO) for the core to render into:

```typescript
// Pseudocode for FBO setup
const fbo = glGenFramebuffers(1);
const colorTexture = glGenTextures(1);
const depthRenderbuffer = glGenRenderbuffers(1);

glBindTexture(GL_TEXTURE_2D, colorTexture);
glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, null);

glBindRenderbuffer(GL_RENDERBUFFER, depthRenderbuffer);
glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, width, height);

glBindFramebuffer(GL_FRAMEBUFFER, fbo);
glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorTexture, 0);
glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, depthRenderbuffer);
```

### 3. Pixel Readback

After each frame, read pixels from the FBO:

```typescript
readPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);  // RGBA

  glBindFramebuffer(GL_FRAMEBUFFER, this.fbo);
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);

  // OpenGL origin is bottom-left, libretro expects top-left
  // Flip vertically if needed (based on bottom_left_origin flag)
  if (!this.bottomLeftOrigin) {
    this.flipVertical(pixels, width, height);
  }

  return pixels;
}
```

### 4. get_proc_address Implementation

Cores need to load OpenGL functions dynamically:

```typescript
getProcAddress(symbol: string): bigint {
  // Platform-specific function lookup
  if (process.platform === 'darwin') {
    return CGLGetProcAddress(symbol);
  } else if (process.platform === 'linux') {
    return eglGetProcAddress(symbol) || dlsym(RTLD_DEFAULT, symbol);
  } else {
    return wglGetProcAddress(symbol) || GetProcAddress(opengl32, symbol);
  }
}
```

### 5. Environment Handler Updates

```typescript
// In environment/index.ts

case RETRO_ENVIRONMENT.SET_HW_RENDER: {
  const request = this.parseHwRenderCallback(data);

  // Check if we support this context type
  if (request.contextType === HWContextType.VULKAN) {
    logger.warn('Vulkan not supported, rejecting SET_HW_RENDER', 'HWRender');
    return false;
  }

  // Create hardware render context
  this.hwContext = createHardwareContext();
  if (!this.hwContext.init(request)) {
    logger.error('Failed to create hardware render context', 'HWRender');
    return false;
  }

  // Write our callbacks back to the struct
  this.writeHwRenderCallbacks(data, {
    get_current_framebuffer: this.hwContext.getCurrentFramebuffer.bind(this.hwContext),
    get_proc_address: this.hwContext.getProcAddress.bind(this.hwContext),
  });

  return true;
}

case RETRO_ENVIRONMENT.GET_PREFERRED_HW_RENDER: {
  // Tell core we prefer OpenGL Core profile
  writeUInt32LE(data, HWContextType.OPENGL_CORE);
  return true;
}
```

---

## Performance Considerations

### Pixel Readback Latency

`glReadPixels()` is synchronous and stalls the GPU pipeline. Mitigation strategies:

| Strategy | Description | Complexity |
|----------|-------------|------------|
| **PBO (Pixel Buffer Object)** | Async readback using buffer objects | Medium |
| **Double/Triple buffering** | Read from previous frame's PBO | Medium |
| **Compute shader copy** | Copy to mapped buffer via compute | High |

**PBO async readback example:**

```typescript
// Setup: create two PBOs for double buffering
const pbos = [glGenBuffer(), glGenBuffer()];
let currentPbo = 0;

// Each frame:
// 1. Start async read into current PBO
glBindBuffer(GL_PIXEL_PACK_BUFFER, pbos[currentPbo]);
glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, 0);

// 2. Map previous PBO (already finished) and get pixels
const prevPbo = 1 - currentPbo;
glBindBuffer(GL_PIXEL_PACK_BUFFER, pbos[prevPbo]);
const pixels = glMapBuffer(GL_PIXEL_PACK_BUFFER, GL_READ_ONLY);
// Copy pixels...
glUnmapBuffer(GL_PIXEL_PACK_BUFFER);

// 3. Swap
currentPbo = prevPbo;
```

### Memory Usage

| Component | Memory |
|-----------|--------|
| FBO color buffer (1080p RGBA) | ~8 MB |
| FBO depth/stencil buffer | ~8 MB |
| PBO for readback (x2) | ~16 MB |
| Readback buffer (CPU) | ~8 MB |
| **Total** | ~40 MB |

### Frame Timing

Hardware rendering adds latency:

```
Core renders to FBO     ──┬── GPU time (varies)
                          │
glReadPixels()          ──┼── GPU→CPU transfer + stall
                          │
Terminal render         ──┴── Already exists
```

With async PBO readback, effective latency is 1 frame behind but throughput is maintained.

---

## File Structure

```
src/cores/libretro/hardware-render/
├── index.ts              # Factory and common logic
├── types.ts              # Interfaces and enums
├── context-cgl.ts        # macOS CGL implementation
├── context-egl.ts        # Linux/Windows EGL implementation
├── context-wgl.ts        # Windows WGL fallback (optional)
├── fbo.ts                # Framebuffer object management
├── gl-loader.ts          # OpenGL function pointer loading
└── consts.ts             # GL constants
```

---

## Implementation Phases

### Phase 1: macOS CGL Context

1. Implement CGL context creation via koffi
2. Create offscreen pixel format
3. Basic FBO setup
4. Implement `get_proc_address` for macOS
5. Simple `glReadPixels` (synchronous)
6. Test with a simple OpenGL core (e.g., Beetle PSX HW in software fallback mode)

### Phase 2: Core Integration

1. Update environment handler for `SET_HW_RENDER`
2. Implement callback struct parsing/writing
3. Wire up `context_reset`/`context_destroy` callbacks
4. Integrate pixel readback into frame loop
5. Handle resolution changes via `SET_GEOMETRY`

### Phase 3: Linux EGL Support

1. Implement EGL context creation
2. Handle surfaceless vs pbuffer contexts
3. Test on Linux systems with and without GPU

### Phase 4: Performance Optimization

1. Implement PBO double-buffering
2. Profile and optimize readback latency
3. Consider compute shader approach for high-res content

### Phase 5: Windows Support

1. Add ANGLE/EGL support
2. Fallback to WGL with hidden window if needed
3. Test on various Windows configurations

### Phase 6: Vulkan (Future)

1. Create headless Vulkan instance
2. Render to offscreen image
3. Copy to host-visible memory
4. Significantly more complex than OpenGL

---

## Testing Strategy

### Test Cores

| Core | Context Type | Notes |
|------|--------------|-------|
| Beetle PSX HW | OpenGL Core | Falls back to software if HW fails |
| mGBA | OpenGL (optional) | Has software fallback |
| Sameboy | OpenGL (optional) | Has software fallback |

### Validation Criteria

1. **Context creation**: GL context initializes without errors
2. **FBO completeness**: `glCheckFramebufferStatus` returns `GL_FRAMEBUFFER_COMPLETE`
3. **Rendering**: Core produces visible output
4. **Pixel accuracy**: Readback matches expected output
5. **Performance**: Maintains target framerate

### Debug Tools

- Set `debug_context = true` to get GL debug callbacks
- Use `GL_KHR_debug` extension for detailed error messages
- Log all GL calls in development mode

---

## Limitations and Risks

### Known Limitations

1. **Vulkan not supported initially**: Focus on OpenGL first
2. **Performance overhead**: Pixel readback adds latency
3. **GPU required**: No software fallback for HW-only cores
4. **Platform dependencies**: Each platform needs specific implementation

### Risks

| Risk | Mitigation |
|------|------------|
| Some cores may not work with offscreen context | Test widely, document unsupported cores |
| Performance may be insufficient for demanding cores | Implement PBO async readback |
| koffi FFI complexity with GL callbacks | Careful memory management, extensive testing |
| macOS deprecating OpenGL | Still works, consider Metal bridge long-term |

---

## Alternatives Considered

### Alternative 1: headless-gl npm Package

The [headless-gl](https://github.com/stackgl/headless-gl) package provides WebGL 1.0 in Node.js.

**Pros:**
- Simple npm install
- Cross-platform
- Well-tested

**Cons:**
- WebGL 1.0 only (subset of OpenGL ES 2.0)
- Many cores require OpenGL 3.x+ features
- No OpenGL Core profile support

**Verdict:** Insufficient for most hardware-accelerated cores.

### Alternative 2: Separate Renderer Process

Run a helper process with full GPU access, communicate via IPC.

**Pros:**
- Isolation from main process
- Could use native GPU frameworks
- Easier error recovery

**Cons:**
- IPC overhead for frame data (~8MB/frame at 1080p)
- Complex synchronization
- Additional process management

**Verdict:** Too complex and slow for real-time rendering.

### Alternative 3: Virtual Display (Xvfb)

Use X virtual framebuffer on Linux.

**Pros:**
- Works with any X11 application
- Well-established technique

**Cons:**
- Linux only
- Requires X11 (not Wayland native)
- Additional dependency

**Verdict:** Linux-only, not cross-platform solution.

---

## Resources

- [Libretro OpenGL Accelerated Cores](https://docs.libretro.com/development/cores/opengl-cores/)
- [retro_hw_render_callback Struct Reference](https://buildbot.libretro.com/doxygen/a23611.html)
- [libretro.h Source](https://github.com/libretro/RetroArch/blob/master/libretro-common/include/libretro.h)
- [headless-gl GitHub](https://github.com/stackgl/headless-gl)
- [EGL Reference](https://registry.khronos.org/EGL/sdk/docs/man/html/)
- [CGL Reference (Apple)](https://developer.apple.com/documentation/opengl/cgl)
- [ANGLE Project](https://chromium.googlesource.com/angle/angle)

---

## Appendix: GL Constants

Common OpenGL constants needed for implementation:

```typescript
// Framebuffer targets
const GL_FRAMEBUFFER = 0x8D40;
const GL_READ_FRAMEBUFFER = 0x8CA8;
const GL_DRAW_FRAMEBUFFER = 0x8CA9;

// Framebuffer attachments
const GL_COLOR_ATTACHMENT0 = 0x8CE0;
const GL_DEPTH_ATTACHMENT = 0x8D00;
const GL_STENCIL_ATTACHMENT = 0x8D20;
const GL_DEPTH_STENCIL_ATTACHMENT = 0x821A;

// Framebuffer status
const GL_FRAMEBUFFER_COMPLETE = 0x8CD5;

// Pixel formats
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;

// Buffer targets (for PBO)
const GL_PIXEL_PACK_BUFFER = 0x88EB;

// Texture targets
const GL_TEXTURE_2D = 0x0DE1;

// Renderbuffer formats
const GL_DEPTH24_STENCIL8 = 0x88F0;
const GL_RGBA8 = 0x8058;
```

---

## Appendix: retro_hw_render_callback Struct Layout

For parsing/writing the callback struct via koffi:

```typescript
// 64-bit layout (pointers are 8 bytes)
const RETRO_HW_RENDER_CALLBACK_LAYOUT = {
  context_type: { offset: 0, size: 4 },           // enum (uint32)
  context_reset: { offset: 8, size: 8 },          // function pointer
  get_current_framebuffer: { offset: 16, size: 8 }, // function pointer
  get_proc_address: { offset: 24, size: 8 },      // function pointer
  depth: { offset: 32, size: 1 },                 // bool
  stencil: { offset: 33, size: 1 },               // bool
  bottom_left_origin: { offset: 34, size: 1 },    // bool
  version_major: { offset: 36, size: 4 },         // unsigned int
  version_minor: { offset: 40, size: 4 },         // unsigned int
  cache_context: { offset: 44, size: 1 },         // bool
  context_destroy: { offset: 48, size: 8 },       // function pointer
  debug_context: { offset: 56, size: 1 },         // bool
  // Total size: ~64 bytes (with padding)
};
```
