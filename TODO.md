# TUI-NES Development TODO

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
- [ ] APU registers ($4000-$4017)

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

### Priority Mappers
- [ ] Mapper 3 (CNROM) - CHR bank switching
- [ ] Mapper 4 (MMC3) - Scanline counter, IRQ
- [ ] Mapper 7 (AxROM) - Single-screen mirroring
- [ ] Mapper 9 (MMC2) - Punch-Out specific

### Extended Mappers
- [ ] Mapper 11 (Color Dreams)
- [ ] Mapper 66 (GxROM)
- [ ] Mapper 71 (Camerica)

---

## Milestone 3: Audio (APU)

### Channels
- [ ] Pulse 1 channel
- [ ] Pulse 2 channel
- [ ] Triangle channel
- [ ] Noise channel
- [ ] DMC (Delta Modulation Channel)

### APU Features
- [ ] Frame counter / sequencer
- [ ] Length counters
- [ ] Envelope generators
- [ ] Sweep units (pulse channels)
- [ ] Linear counter (triangle)
- [ ] Audio output mixing

### Terminal Audio
- [ ] Investigate terminal audio libraries (speaker, node-speaker)
- [ ] Optional audio enable/disable flag
- [ ] Audio sync with emulation

---

## Milestone 4: Input & Controls

### NES Controller Behavior
The NES controller uses a 4021 shift register that captures the state of all 8 buttons each frame when polled. Buttons can be held continuously (not rapid presses) and multiple buttons can be pressed simultaneously.

- [x] Shift register emulation ($4016, $4017)
- [x] Button state capture on strobe
- [x] Sequential bit reading
- [ ] True button hold support (not timeout-based release)
- [ ] Simultaneous multi-button input
- [ ] Per-frame state polling accuracy

### Controller
- [x] Basic keyboard input
- [x] D-pad mapping (WASD + arrows)
- [x] A/B button mapping
- [x] Start/Select mapping
- [ ] Proper key-down/key-up handling (currently uses timeout)
- [ ] Simultaneous button press support
- [ ] Controller 2 support
- [ ] Configurable key bindings (config file)

### Advanced Input
- [ ] Turbo A/B buttons
- [ ] Zapper light gun (mouse-based?)
- [ ] Save/load state hotkeys

---

## Milestone 5: Rendering & Display

### Terminal Renderer
- [x] Unicode half-block characters (▀)
- [x] True color (24-bit) support
- [x] ANSI 256-color fallback
- [x] ASCII grayscale mode
- [x] Configurable resolution
- [ ] Diff-based rendering (only update changed characters)
- [ ] Double buffering optimization
- [ ] Aspect ratio correction

### Display Features
- [ ] Configurable palette (different NES palettes)
- [ ] Grayscale mode via PPU mask
- [ ] Color emphasis bits
- [ ] Scanline effect (optional)

---

## Milestone 6: Performance & Optimization

### CPU Performance
- [ ] Optimize opcode dispatch (switch vs lookup table)
- [ ] Reduce function call overhead
- [ ] Profile hot paths

### PPU Performance
- [ ] Batch tile fetches
- [ ] Cache pattern table lookups
- [ ] Minimize per-pixel calculations

### Rendering Performance
- [ ] Profile terminal write overhead
- [ ] Implement frame skipping option
- [ ] Reduce string allocations

### Timing
- [ ] Accurate frame timing (60 FPS)
- [ ] Handle Node.js event loop delays
- [ ] CPU/PPU cycle synchronization accuracy

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
- [ ] No audio output
- [ ] Key input uses timeout-based release (not proper key-up events)

---

## Future Ideas

- [ ] Web version (WebAssembly + canvas)
- [ ] Netplay / online multiplayer
- [ ] TAS (Tool-Assisted Speedrun) recording
- [ ] ROM database integration
- [ ] Shader-like post-processing effects
- [ ] Game Genie code support
