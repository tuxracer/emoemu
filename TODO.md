# emoemu Development TODO

## Milestone 1: Core Emulation (MVP)

### CPU
- [x] Implement all 151 official 6502 opcodes
- [x] Implement all 13 addressing modes
- [x] Cycle-accurate timing
- [x] Interrupt handling (NMI, IRQ, Reset)
- [ ] Unofficial/illegal opcodes (for better compatibility)
- [ ] Decimal mode (low priority - unused by NES)

### PPU - Background
- [x] Nametable rendering
- [x] Pattern table decoding
- [x] Attribute table palette selection
- [x] Horizontal scrolling (coarse + fine X)
- [x] Vertical scrolling (coarse + fine Y)
- [x] Nametable mirroring (H, V, single-screen)
- [ ] Mid-frame scroll changes
- [ ] Fine scroll timing accuracy

### PPU - Sprites
- [x] OAM (Object Attribute Memory) rendering
- [x] 8x8 sprite support
- [x] 8x16 sprite support
- [x] Sprite priority (front/behind background)
- [x] Sprite 0 hit detection
- [x] 8 sprites per scanline limit
- [x] Sprite overflow flag

### Memory
- [x] 2KB internal RAM with mirroring
- [x] PPU register access ($2000-$2007)
- [x] OAM DMA ($4014)
- [x] Controller ports ($4016-$4017)
- [x] APU registers ($4000-$4017)

### Cartridge
- [x] iNES file format parsing
- [x] PRG-ROM loading
- [x] CHR-ROM loading
- [x] CHR-RAM support
- [ ] NES 2.0 format support
- [ ] Battery-backed save RAM persistence

---

## Milestone 2: Mapper Support

### Implemented
- [x] Mapper 0 (NROM) - No banking
- [x] Mapper 1 (MMC1) - Bank switching + mirroring control
- [x] Mapper 2 (UxROM) - PRG bank switching
- [x] Mapper 3 (CNROM) - CHR bank switching
- [x] Mapper 4 (MMC3) - Scanline counter, IRQ
- [x] Mapper 7 (AxROM) - Single-screen mirroring
- [x] Mapper 9 (MMC2) - Punch-Out tile-based CHR switching

### Extended Mappers
- [ ] Mapper 11 (Color Dreams)
- [ ] Mapper 66 (GxROM)
- [ ] Mapper 71 (Camerica)

---

## Milestone 3: Audio (APU)

### Channels
- [x] Pulse 1 channel
- [x] Pulse 2 channel
- [x] Triangle channel
- [x] Noise channel
- [x] DMC (Delta Modulation Channel)

### APU Features
- [x] Frame counter / sequencer
- [x] Length counters
- [x] Envelope generators
- [x] Sweep units (pulse channels)
- [x] Linear counter (triangle)
- [x] Audio output mixing (NESDev wiki formula)

### Audio Output
- [x] Audio via audify/RtAudio (22050 Hz stereo)
- [x] Optional audio disable (--no-audio flag)
- [x] Audio sync with emulation (cycle-based sampling)
- [x] Sample buffering for fixed-size frame output

### Audio Architecture Improvements
- [x] Use `frameOutputCallback` for flow control (replace manual timing sync)
- [x] Leverage RtAudio's internal queue (write smaller chunks more frequently)
- [x] Fixed-size ring buffer (prevent unbounded memory growth)
- [x] Higher sample rate (44100 Hz for better quality)
- [x] Error callback for graceful error recovery
- [x] Smaller frame size (10ms for lower latency)

---

## Milestone 4: Input & Controls

### NES Controller Behavior
The NES controller uses a 4021 shift register that captures the state of all 8 buttons each frame when polled. Buttons can be held continuously (not rapid presses) and multiple buttons can be pressed simultaneously.

**Platform Note:** Input uses Kitty keyboard protocol for true keydown/keyup events. Requires Kitty terminal or a terminal that supports the Kitty keyboard protocol.

- [x] Shift register emulation ($4016, $4017)
- [x] Button state capture on strobe
- [x] Sequential bit reading
- [x] True button hold support (using Kitty keyboard protocol)
- [x] Simultaneous multi-button input
- [x] Per-frame state polling accuracy (InputManager.update() called each frame)

### Keyboard Input
- [x] Basic keyboard input
- [x] D-pad mapping (WASD + arrows)
- [x] A/B button mapping
- [x] Start/Select mapping
- [x] Proper key-down/key-up handling (Kitty keyboard protocol)
- [x] Simultaneous button press support
- [x] Controller 1 keyboard support
- [ ] Controller 2 keyboard support
- [ ] Configurable key bindings (config file)

### Gamepad Support
- [x] HID gamepad support via node-hid
- [x] Controller profiles (Xbox, PlayStation, Nintendo, 8BitDo)
- [x] Hotplug detection (3-second polling)
- [x] Controller 1 gamepad support
- [x] Controller 2 gamepad support
- [x] --list-gamepads and --debug-gamepad options

### Advanced Input
- [ ] Turbo A/B buttons
- [ ] Zapper light gun (mouse-based?)
- [ ] Save/load state hotkeys

---

## Milestone 5: Rendering & Display

### Kitty Graphics Renderer
- [x] Kitty graphics protocol support
- [x] Auto-scale to fit terminal
- [x] Aspect ratio correction (4:3)
- [x] Diff-based updates
- [x] Dynamic terminal resize detection

### Terminal Renderer (Half-blocks)
- [x] Unicode half-block characters (▀)
- [x] True color (24-bit) support
- [x] Aspect ratio correction (4:3)
- [x] Dynamic terminal resize detection
- [ ] ANSI 256-color fallback
- [ ] Diff-based rendering (only update changed characters)

### ASCII Renderer
- [x] ASCII grayscale mode
- [x] Optional color support
- [x] Configurable resolution
- [x] Dynamic terminal resize detection

### Display Features
- [ ] Configurable palette (different NES palettes)
- [ ] Grayscale mode via PPU mask
- [ ] Color emphasis bits

### CRT Effects (Kitty Renderer)
Post-processing effects for authentic retro display in Kitty graphics mode.

- [x] Gamma correction (`--gamma`) - Darken midtones for CRT-like contrast
- [x] Scanlines (`--scanlines`) - Horizontal line darkening to simulate CRT phosphor gaps
- [x] Color saturation (`--saturation`) - Boost color vibrancy like CRT displays
- [x] Brightness adjustment (`--brightness`) - Shift overall luminance levels
- [x] Contrast adjustment (`--contrast`) - Expand/compress tonal range around midpoint
- [x] Vignette (`--vignette`) - Darken screen edges to simulate CRT electron beam falloff

#### Future CRT Effects (More Complex)
- [x] Phosphor bloom/glow - Bright pixels bleed into neighbors
- [x] NTSC color artifacts - Horizontal color bleeding from composite video
- [ ] Color temperature/tint - Warmer CRT-like color balance
- [x] CRT curvature - Barrel distortion to simulate curved CRT screens
- [ ] Shadow mask / Aperture grille - Phosphor pattern overlay (dots or vertical lines)
- [ ] Sharpness control - Sharpen or blur the image
- [ ] Phosphor persistence / ghosting - Faint trails from slow phosphor decay
- [ ] Chromatic aberration - RGB color fringing at screen edges
- [ ] LCD grid effect - Visible pixel boundaries for handheld simulation (GB, GBA)
- [ ] Signal noise - Subtle static/grain for analog feel
- [ ] Interlace simulation - Flickering/combing for interlaced output

---

## Milestone 6: Performance & Optimization

### Quick Wins (Low Effort, High Impact)
- [x] Reuse Kitty RGB buffer (`ppu/kitty-renderer.ts:109`)
  - Currently allocates 184KB every frame (11MB/sec GC pressure)
  - Move `new Uint8Array()` to class property, reuse across frames
- [x] Audio buffer pool (`emulator.ts:370`)
  - New buffer allocated per sample batch (~11×/frame)
  - Use 2-3 pre-allocated buffers and rotate
- [x] Palette color escape sequence cache (`ppu/palette.ts` + `ppu/renderer.ts`)
  - ANSI escape sequences generated per-pixel (61,440×/frame)
  - Pre-compute lookup table of 64 formatted strings at init

### Medium Effort Optimizations
- [ ] Memory bus dispatch table (`memory/bus.ts:47-103`)
  - Sequential if-else checks on every memory access (millions/frame)
  - Use page lookup table: `handlers[address >> 8](address)` for O(1) dispatch
- [x] String concatenation in renderer (`ppu/renderer.ts:36-104`)
  - Uses `+=` in hot loop (7,680 concatenations/frame)
  - Switch to array + `.join('')`
- [x] Sprite bit reversal lookup table (`ppu/ppu.ts:365-452`)
  - `reverseBits()` called up to 8× per scanline with 6 bit ops each
  - Pre-compute 256-entry lookup table
- [x] Reusable DMA temp buffer (`memory/bus.ts:112`)
  - 256-byte allocation per OAM DMA
  - Use reusable class-level buffer

### Larger Refactors (Highest Impact)
- [x] PPU tile data caching (`ppu/ppu.ts:464-596`)
  - `renderPixel()` does 4-6 PPU reads per pixel (61,440×/frame)
  - Cache tile pattern data at start of each 8-pixel tile span
  - Pre-compute attribute shifts per tile instead of per pixel
- [x] ASCII luminance lookup table (`ppu/renderer.ts:108-110`)
  - Luminance calculated per pixel in ASCII mode
  - Pre-compute for all 64 palette colors at init

### ROM Scanning & Playlist Optimizations

#### Completed
- [x] Consolidated file I/O - single file open for binary check + metadata extraction
- [x] Directory listing cache - avoid repeated stat() calls for save state/battery checks
- [x] Smart header read sizing - read only what's needed per ROM format (512B-66KB)
- [x] CRC32 caching - reuse CRCs from existing playlists on updates
- [x] Playlist index - O(1) runtime update lookups via `buildPlaylistIndex()`
- [x] Case-sensitive filesystem support - use `realpathSync()` for path normalization

#### Quick Wins (Low Effort)
- [x] Fix `checkForBatterySave()` redundant I/O (`src/frontend/playlist/reader.ts:241-256`)
  - Removed redundant `existsSync()` call - `statSync()` throws on non-existent files
- [x] Export and share `DirectoryCache` (`src/frontend/directory-cache.ts`)
  - Created shared `src/frontend/directory-cache.ts` module
  - Exported from `src/frontend/index.ts` for easy access
  - Rom-scanner now imports from shared module
- [x] Deduplicate ROM sorting logic (`src/frontend/rom-scanner/index.ts`)
  - Exported `sortRoms()` function from rom-scanner
  - Replaced 2 inline sorts in rom-scanner and 2 in playlist reader

#### Medium Effort
- [x] Cache `findMatchingCores()` result in RomInfo (`src/frontend/core-registry.ts:73-88`)
  - Added `coreIds: string[]` to RomInfo interface
  - ROM scanner populates coreIds during scanning
  - Playlist generation uses cached coreIds via `getCoreFactory()` instead of calling `findMatchingCores()` again
- [x] Pre-compute extension→cores map in core registry
  - Added `extensionToCoresCache` map built lazily on first access
  - `findMatchingCores()` now does O(1) lookup instead of filtering
  - Cache invalidated when new cores are registered
- [x] Use smart header sizing in `extractMetadata()` for `getRomTitle()`
  - Was using fixed 64KB, now uses `getRequiredHeaderSize()` per format
- [x] Use directory cache in playlist reader (`src/frontend/playlist/reader.ts`)
  - `checkForSaveState()` and `checkForBatterySave()` now use cached directory listings
  - Added `dirCache` option to `ConversionOptions` for shared cache across calls

#### High Effort (Major Improvements)
- [ ] Streaming CRC32 calculation (`src/utils/crc32.ts:68-77`)
  - Currently loads entire ROM into memory: `readFileSync(filePath)`
  - Implement streaming in 64KB chunks to reduce memory pressure
  - Prevents memory spikes for large ROM collections
- [ ] Optional CRC32 skip during initial scan
  - Add `--skip-crc` flag to use "DETECT" like RetroArch
  - CRC only computed on-demand or during explicit playlist refresh
- [x] Path normalization cache
  - Added `normalizedPathCache` Map to cache `realpathSync()` results
  - Avoids repeated syscalls for the same path

#### Pending Optimizations (Identified 2026-01)

**High Priority**
- [x] Fix redundant file open in `validateRomFile()`
  - Already uses `extractMetadataFromBuffer()` with existing header buffer
  - No extra file open per validated ROM

- [x] Convert sync directory walk to async in `scanDirectoryAsync()`
  - Added `countFilesAsync()` for non-blocking file counting
  - Replaced sync `collectFilePaths()` with async generator `collectFilePathsAsync()`
  - Uses `fs/promises` async I/O and yields control every 50 entries
  - Progress bar preserved by doing async count pass first

**Medium Priority**
- [x] Remove unused `scanDirectoryWithProgress()` function
  - Was dead code superseded by `scanDirectoryAsync()`
  - Had duplicate file counting (2x directory I/O)
  - Removed entirely since not used anywhere

- [x] Move metadata lookup tables to module level
  - Added `GB_CARTRIDGE_TYPES`, `GB_ROM_SIZES`, `GB_RAM_SIZES` to consts.ts
  - Added `SNES_CHIP_TYPES` to consts.ts
  - Lookup tables now shared across all extraction calls

**Low Priority**
- [x] Cache `getSupportedExtensions()` result
  - Added `supportedExtensionsCache` in core-registry.ts
  - Cache invalidated when cores are registered
  - Eliminates repeated array building during scans

#### ROM Browser Optimizations (Identified 2026-01)

**High Priority**
- [x] Memoize empty space and scrollbar arrays (`src/ui/RomBrowser/index.tsx`)
  - Added `emptySpaceElements` and `scrollbarElements` memoized with `useMemo`
  - Eliminates array recreation on every render

- [x] Create memoized option value→label lookup (`src/ui/RomBrowser/index.tsx`)
  - Added `optionLookups` Map providing O(1) value→{label, index} lookups
  - Replaced O(n) find/findIndex calls in display and input handlers

- [x] Reduce cascading re-renders from `localConfig` (`src/ui/RomBrowser/index.tsx`)
  - Added early return guards to skip state updates when value unchanged
  - Prevents unnecessary re-renders when pressing at option boundaries

- [x] Extract duplicate settings filter logic (`src/ui/RomBrowser/index.tsx`)
  - Created `filterSettingsCategories()` helper function
  - Shared by both `useMemo` hook and `useState` initializer

- [x] Optimize save state lazy-loading (`src/frontend/rom-scanner/index.ts`)
  - Check file existence with `existsSync` before reading
  - Sort by mtime to find newest file first
  - Only read the newest file instead of all files

**Medium Priority**
- [x] Add search input debouncing (`src/ui/RomBrowser/index.tsx`)
  - Added 200ms debounce delay via `debouncedSearchQuery` state
  - Filtering now uses debounced query while display uses immediate query

- [x] Optimize mouse event buffer scanning (`src/ui/RomBrowser/index.tsx`)
  - Added 512-byte max buffer size guard
  - Moved regex outside handler for reuse
  - Simplified buffer clearing via lastMatchEnd tracking

- [x] Wrap MetadataPanel in React.memo (`src/ui/RomBrowser/index.tsx`)
  - Prevents unnecessary re-renders when parent state changes
  - Added MetadataPanelProps interface for cleaner typing

**Low Priority**
- [x] Optimize category index calculation (`src/ui/RomBrowser/index.tsx`)
  - Replaced reduce with array spreading with simple for loop using push()
  - Reduced time complexity from O(n²) to O(n)

### Libretro Core Optimizations (Identified 2026-01)

**Critical (Every Frame)**
- [x] Reuse audio Float32Array buffer (`src/cores/libretro/callbacks/index.ts:258-281`)
  - Added `audioOutputBuffer` and `audioOutputCapacity` class properties
  - `drainAudio()` now reuses buffer, only grows when capacity exceeded
  - Returns `subarray()` view instead of new allocation each frame

- [x] Optimize framebuffer copy (`src/cores/libretro/callbacks/index.ts:122-154`)
  - Already optimized: uses `koffi.view()` for zero-copy native memory access
  - `.set()` is necessary since native memory only valid during callback
  - No further optimization possible without FFI changes

- [x] Optimize pixel format conversion loops (`src/cores/libretro/pixel-format/index.ts:96-148`)
  - Replaced manual byte reading `data[idx] | (data[idx + 1] << 8)` with `DataView.getUint16()`
  - DataView provides optimized native 16-bit reads with endianness handling
  - Removed unused `BYTE_SHIFT` constant

**Medium Priority**
- [x] Cache input state bitmask per port (`src/cores/libretro/callbacks/index.ts:214-236`)
  - Replaced Map-based storage with sparse arrays for O(1) lookups
  - Added `buttonBitmask[]` cache updated on `setButtonState()`
  - Bitmask queries now O(1) instead of iterating all buttons

- [x] Optimize audio buffer growth strategy (`src/cores/libretro/callbacks/index.ts:197-212`)
  - Changed from 2x to 1.5x growth factor (more memory-efficient)
  - Added `AUDIO_BUFFER_GROWTH_FACTOR` constant
  - Reduced initial buffer size from 8192 to 4096 samples

**Low Priority**
- [x] Cache pixel format (`src/cores/libretro/index.ts:45,260,320`)
  - Added `cachedPixelFormat` property in LibretroCore
  - Cache populated after ROM load, used in getFramebuffer()
  - Eliminates method call overhead on hot path

- [x] Reuse DataView for message parsing (`src/cores/libretro/environment/index.ts:408-469`)
  - Analyzed: message callbacks are infrequent (not per-frame)
  - Optimization would provide minimal benefit
  - Marked complete - no changes needed

- [x] Cache directory string buffers (`src/cores/libretro/environment/index.ts:355-366`)
  - Replaced `allocatedStrings[]` array with `directoryBufferCache` Map
  - Buffers now cached by path, reused across repeated queries
  - Prevents unbounded memory growth

### General
- [ ] Profile hot paths with Node.js inspector
- [ ] Implement frame skipping option
- [x] Accurate frame timing (60 FPS)
  - [x] Fix timer drift: use `lastFrameTime += targetFrameTime` instead of `lastFrameTime = now`
  - [x] Add frame skipping: run multiple frames without rendering when behind schedule
- [ ] Handle Node.js event loop delays
  - [x] Frame skipping when behind schedule (emulate without rendering to catch up)
  - [ ] Audio-driven timing (let audio buffer drive frame pacing instead of timers)
  - [ ] Adaptive frame timing (track actual elapsed time instead of assuming fixed intervals)
  - [ ] Busy-wait for precision (spin-wait final few ms instead of setTimeout)
  - [ ] Worker thread isolation (move emulation off main event loop)

---

## Code Simplification

Remove micro-optimizations that add complexity without meaningful performance benefits.

### High Priority (Most Complexity, Least Benefit)

- [x] Remove palette ANSI escape caches (`src/rendering/palette.ts:167-231`)
  - 4 separate caches (trueColorCache, bgTrueColorCache, luminanceCache, emojiColorCache) pre-computed at module load
  - ~4KB of module-level state for all 512 NES color combinations
  - String generation for ANSI escapes is fast in modern JS - compute on-demand instead

- [x] Remove directory buffer caching (`src/cores/libretro/environment/index.ts:112-113, 352-366`)
  - `directoryBufferCache` Map caches Buffer objects for system/save directory paths
  - Only queried 1-3 times per core load, not per-frame
  - Buffer creation for small strings is negligible - remove the Map overhead

- [x] Simplify normalized path cache (`src/frontend/playlist/utils.ts:14-39`)
  - Module-level cache that persists and can become stale if files move
  - Called during playlist generation which is already I/O-bound
  - Consider session-scoped cache or remove entirely

### Medium Priority (Unnecessary but Less Harmful)

- [x] Remove useMemo for trivial UI elements (`src/ui/RomBrowser/index.tsx:1653-1686`)
  - `emptySpaceElements` array memoization - simple array creation
  - `scrollbarElements` array memoization - Ink re-renders anyway
  - Scrollbar position/size calculation - trivial math that doesn't need memoization

- [x] Remove useMemo for settings option lookups (`src/ui/RomBrowser/index.tsx:494-506`)
  - Pre-computed Maps for O(1) lookup on ~30 items
  - `.find()` on 30 items is ~10 microseconds - not a bottleneck

---

## Milestone 7: Features & Polish

### Save States
- [ ] Design save state format
- [ ] Serialize CPU state
- [ ] Serialize PPU state (VRAM, OAM, registers)
- [ ] Serialize mapper state
- [ ] Save/load to file
- [ ] Quick save/load hotkeys

### Configuration
- [ ] Config file support (JSON)
- [ ] Key remapping
- [ ] Display settings persistence
- [ ] ROM-specific settings

### User Experience
- [ ] Better error messages for invalid ROMs
- [ ] ROM info display (mapper, PRG/CHR size)
- [ ] Debug mode (show registers, memory)
- [ ] Pause/resume functionality
- [ ] Frame advance (debug)

---

## Milestone 8: Testing & Compatibility

### Test ROMs
- [ ] nestest.nes - CPU instruction test
- [ ] PPU tests (blargg's)
- [ ] Sprite tests
- [ ] Timing tests

### Game Compatibility
- [ ] Donkey Kong (Mapper 0)
- [ ] Super Mario Bros (Mapper 0)
- [ ] The Legend of Zelda (Mapper 1)
- [ ] Mega Man 2 (Mapper 1)
- [ ] Contra (Mapper 2)
- [ ] Super Mario Bros 3 (Mapper 4)

### Automated Testing
- [ ] Unit tests for CPU instructions
- [ ] Unit tests for PPU rendering
- [ ] Integration tests with test ROMs
- [ ] CI/CD pipeline

---

## Known Issues

- [x] ~~Sprites not rendering (not implemented)~~ - FIXED
- [ ] Some games may have graphical glitches (timing)
- [x] ~~No audio output~~ - FIXED (APU fully implemented)
- [x] ~~Key input uses timeout-based release~~ - FIXED (now uses Kitty keyboard protocol)

---

## Milestone 9: RetroArch Compatibility

Improvements to make emoemu more compatible with RetroArch configurations, cores, and workflows.

### High Priority

#### Core Options Support
Libretro cores define configuration options via `SET_CORE_OPTIONS` but emoemu doesn't expose them to users. `GET_VARIABLE` always returns false (`src/cores/libretro/environment/index.ts:336-341`), so cores use defaults.

- [ ] Create core options module to parse `retro_core_option_v2_definition` structures
- [ ] Store option definitions from `SET_CORE_OPTIONS` / `SET_CORE_OPTIONS_V2`
- [ ] Implement `handleGetVariable()` to return configured values
- [ ] Add config file sections for per-core options: `[core_picodrive_options]`
- [ ] Add CLI flag: `--core-opt "Option Name"=value`
- [ ] Fall back to default/first option if not configured (RetroArch behavior)

#### Audio/Video Control
- [x] `GET_AUDIO_VIDEO_ENABLE` should respect `--no-audio` flag (`src/cores/libretro/environment/index.ts:227-232`)
  - ~~Currently hardcoded to `0b11` (both enabled)~~
  - Cores can now skip audio processing when disabled

### Medium Priority

#### Additional Config Keys
Add standard RetroArch config keys to `src/frontend/config.ts:48-130`:
- [ ] `video_aspect_ratio` - explicit aspect ratio control
- [ ] `video_force_aspect` - force a specific aspect ratio
- [ ] `input_driver` - specify input backend preference
- [ ] `savestate_thumbnail_enable` - thumbnail support in states

#### Read More from retroarch.cfg
When `--retroarch` is used, parse additional settings from `retroarch.cfg` (`src/cores/libretro/loader.ts:104-137`):
- [ ] `savefile_directory` - consistent battery save locations
- [ ] `savestate_directory` - consistent state save locations
- [ ] `system_directory` - BIOS files location

#### Environment Callback Improvements
- [ ] Increase `MAX_INPUT_USERS` from 2 to configurable (`src/cores/libretro/environment/consts.ts:13`)
  - Some cores support 4+ players
- [ ] Update `MESSAGE_INTERFACE_VERSION` from 1 to 2 (`src/cores/libretro/environment/consts.ts:19`)
  - Modern cores expect version 2+ for newer message formats
- [ ] Make `DEBUG_ENV` controllable via environment variable (e.g., `EMOEMU_DEBUG_ENV`)

### Low Priority

#### Save State Enhancements
- [ ] Save state thumbnail support (binary PNG instead of base64)
- [ ] Add additional metadata matching RetroArch: `systemId`, `configHash`

#### Per-Core Config Files
- [ ] Read per-core configurations from `~/.retroarch/config/[corename]/` when `--retroarch` is used

#### Memory Maps
- [ ] Handle additional memory regions beyond SRAM in `SET_MEMORY_MAPS` (`src/cores/libretro/environment/index.ts:409-410`)

---

## Netplay Sync Improvements

When connecting as a client to a RetroArch host, emoemu's sync is playable but "jumpy/glitchy" compared to two official RetroArch apps. The following improvements would make sync smoother while staying compatible with RetroArch protocol.

### Critical Issues

#### 1. Stall threshold too aggressive
**File:** `src/netplay/consts.ts:213`

- emoemu: `MAX_FRAMES_BEHIND = 10`
- RetroArch: `NETPLAY_MAX_STALL_FRAMES = 60`

With only 10 frames tolerance, any network jitter causes constant micro-stalls. Increase to 60 frames (1 second at 60fps) to match RetroArch behavior.

```typescript
// Change from:
export const MAX_FRAMES_BEHIND = 10;
// To:
export const MAX_FRAMES_BEHIND = 60;
```

#### 2. Missing catch-up mode
**Files:** `src/netplay/sync-manager.ts`, `src/Emulator/index.ts`

RetroArch has a `catch_up` boolean (netplay_private.h:671) that temporarily disables the frame limiter when the client is behind. This allows smooth fast-forward to catch up instead of stuttery pause/resume cycles.

emoemu only stalls when ahead, never accelerates when behind.

**Fix:**
- Add `shouldCatchUp: boolean` to preFrame() return value
- Detect when `unreadFrame - selfFrame > threshold` (e.g., 60 frames)
- Return `{ shouldStall: false, shouldCatchUp: true }`
- Emulator disables frame limiter when `shouldCatchUp` is true
- Allows client to fast-forward smoothly to catch up

#### 3. Single frame counter instead of two
**Files:** `src/netplay/sync-manager.ts:364-403`, `src/Emulator/index.ts:662-700`

RetroArch uses TWO independent frame counters:
- `self_frame_count` - where INPUT is being read from
- `run_frame_count` - where the core is actually executing

emoemu uses ONE (`_selfFrame`) for both purposes. This causes frame N to be executed with input from frame N+1, creating frame/input mismatch vs RetroArch.

**Fix:**
- Add `readFrame` pointer (input read position)
- Keep `selfFrame` as execution position
- Increment `readFrame` in preFrame() to read frame N's input
- Increment `selfFrame` AFTER core.runFrame() completes
- Base rollback decisions on `readFrame`, not `selfFrame`

### Medium Priority

#### 4. INPUT processing timing
**File:** `src/netplay/client.ts:658-671`

When remote INPUT arrives, rollback is queued but happens in the NEXT `postFrame()` - delayed by 1+ frame. With network latency, this adds perceivable input lag.

**Fix:** Use per-client `readFramePerClient` tracking to immediately detect when we have enough input to advance safely, rather than delayed rollback checking.

#### 5. NOINPUT doesn't update sync state
**File:** `src/netplay/client.ts:821-835`

`handleNoInput()` only updates `_serverFrame`, doesn't notify sync manager. Spectators may stall unnecessarily.

**Fix:** Add `syncManager.advanceFrameWithoutInput(frameNumber)` method for spectators.

### Implementation Priority

1. **Quick wins (high impact, low risk):**
   - [x] Increase `MAX_FRAMES_BEHIND` to 60
   - [x] Add catch-up mode flag to preFrame() return

2. **Medium effort:**
   - [x] Implement dual frame counters for accurate frame/input sync
   - [x] Fix NOINPUT not updating sync state (add advanceFrameWithoutInput)

**Note:** Moving rollback check before sending input was attempted but caused severe stuttering (feedback loop). The original order (send input → rollback) is correct.

### Test Cases

1. **Catch-up mode:** Run emoemu client with RetroArch server, introduce ~100ms latency, verify client speeds up smoothly without visible pausing

2. **Frame sync accuracy:** Run with `--netplay-connect --clear-logs`, check netplay.log for desync messages, should see 0 desyncs on identical cores

3. **Stall/resume smoothness:** Use variable latency (jitter 50-150ms), verify gameplay is smooth not jerky

---

## Future Ideas

- [ ] Web version (WebAssembly + canvas)
- [x] Netplay / online multiplayer
- [ ] TAS (Tool-Assisted Speedrun) recording
- [ ] ROM database integration
- [ ] Shader-like post-processing effects
- [ ] Game Genie code support
