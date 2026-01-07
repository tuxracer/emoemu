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
- [x] Audio via speaker package (44100 Hz)
- [x] Optional audio disable (--no-audio flag)
- [x] Audio sync with emulation (cycle-based sampling)

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
- [x] ~~No audio output~~ - FIXED (APU fully implemented)
- [x] ~~Key input uses timeout-based release~~ - FIXED (now uses Kitty keyboard protocol)

---

## Future Ideas

- [ ] Web version (WebAssembly + canvas)
- [ ] Netplay / online multiplayer
- [ ] TAS (Tool-Assisted Speedrun) recording
- [ ] ROM database integration
- [ ] Shader-like post-processing effects
- [ ] Game Genie code support
