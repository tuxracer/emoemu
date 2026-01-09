# Save State Format (.state)

TUI-NES save states capture the complete emulator state, allowing games to be resumed exactly where they were left off. This document covers the common format shared by all cores, as well as core-specific state data.

## Common Format

### File Format

- **Extension**: `.state` (appended to ROM filename, e.g., `game.nes.state`, `zelda.gbc.state`)
- **Compression**: Gzip (max compression level 9)
- **Contents**: JSON object
- **Location**: Same directory as the ROM file

The loader also supports uncompressed JSON for backwards compatibility, detected by checking for the gzip magic number (`0x1f 0x8b`).

### Top-Level Structure

All save states share this common wrapper structure:

```json
{
  "version": 1,
  "coreId": "nes",
  "gameId": "game.nes",
  "data": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | number | Save state format version (core-specific) |
| `coreId` | string | Core identifier (`"nes"` or `"gbc"`) |
| `gameId` | string | ROM filename (e.g., `game.nes`, `zelda.gbc`) |
| `data` | object | Core-specific state data |

### Validation

When loading a state file, the following checks are performed:

1. File exists
2. If gzipped (magic bytes `0x1f 0x8b`), decompress successfully
3. Valid JSON syntax
4. `coreId` matches the current core
5. `version` is compatible with current core version

If validation fails, a warning is displayed and the game starts fresh.

---

## NES Save States (.nes.state)

NES save states use `coreId: "nes"` and `version: 2`.

### NES State Structure

```json
{
  "version": 1,
  "coreId": "nes",
  "gameId": "game.nes",
  "data": {
    "cpu": { ... },
    "ppu": { ... },
    "apu": { ... },
    "bus": { ... },
    "cartridge": { ... },
    "frameCount": 12345
  }
}
```

### NES CPU State

```json
{
  "a": 0,
  "x": 0,
  "y": 0,
  "sp": 253,
  "pc": 32768,
  "status": 36,
  "cycles": 0,
  "totalCycles": 123456
}
```

| Field | Type | Description |
|-------|------|-------------|
| `a` | number | Accumulator register (0-255) |
| `x` | number | X index register (0-255) |
| `y` | number | Y index register (0-255) |
| `sp` | number | Stack pointer (0-255) |
| `pc` | number | Program counter (0-65535) |
| `status` | number | Status register flags (N, V, B, D, I, Z, C) |
| `cycles` | number | Cycles remaining for current instruction |
| `totalCycles` | number | Total CPU cycles executed |

### NES PPU State

```json
{
  "frameBuffer": "<base64>",
  "vram": "<base64>",
  "paletteRam": "<base64>",
  "oam": "<base64>",
  "ctrl": 0,
  "mask": 0,
  "status": 0,
  "oamAddr": 0,
  "v": 0,
  "t": 0,
  "x": 0,
  "w": false,
  "dataBuffer": 0,
  "scanline": 0,
  "cycle": 0,
  "frameComplete": false,
  "nmiOccurred": false,
  "nmiOutput": false
}
```

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `frameBuffer` | base64 | 61440 bytes | Current frame (256x240 palette indices) |
| `vram` | base64 | 2048 bytes | Video RAM (nametables) |
| `paletteRam` | base64 | 32 bytes | Palette RAM |
| `oam` | base64 | 256 bytes | Object Attribute Memory (sprites) |
| `ctrl` | number | - | PPUCTRL register ($2000) |
| `mask` | number | - | PPUMASK register ($2001) |
| `status` | number | - | PPUSTATUS register ($2002) |
| `oamAddr` | number | - | OAM address ($2003) |
| `v` | number | - | Current VRAM address (15-bit) |
| `t` | number | - | Temporary VRAM address (15-bit) |
| `x` | number | - | Fine X scroll (3-bit) |
| `w` | boolean | - | Write toggle |
| `dataBuffer` | number | - | PPUDATA read buffer |
| `scanline` | number | - | Current scanline (0-261) |
| `cycle` | number | - | Current cycle within scanline (0-340) |
| `frameComplete` | boolean | - | Frame completion flag |
| `nmiOccurred` | boolean | - | NMI occurred flag |
| `nmiOutput` | boolean | - | NMI output enabled |

### NES APU State

```json
{
  "frameCounterMode": 0,
  "frameIRQInhibit": false,
  "frameIRQPending": false,
  "cycleCount": 0,
  "frameCycleCount": 0,
  "frameStep": 0,
  "pulse1": { ... },
  "pulse2": { ... },
  "triangle": { ... },
  "noise": { ... },
  "dmc": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `frameCounterMode` | number | Frame counter mode (0=4-step, 1=5-step) |
| `frameIRQInhibit` | boolean | Frame IRQ inhibit flag |
| `frameIRQPending` | boolean | Frame IRQ pending flag |
| `cycleCount` | number | Total APU cycles |
| `frameCycleCount` | number | Cycles within current frame |
| `frameStep` | number | Current frame sequencer step |
| `pulse1` | object | Pulse 1 channel state |
| `pulse2` | object | Pulse 2 channel state |
| `triangle` | object | Triangle channel state |
| `noise` | object | Noise channel state |
| `dmc` | object | DMC channel state |

#### NES Pulse Channel State

```json
{
  "dutyCycle": 0,
  "lengthHalt": false,
  "constantVolume": false,
  "volume": 0,
  "sweepEnabled": false,
  "sweepPeriod": 0,
  "sweepNegate": false,
  "sweepShift": 0,
  "timerPeriod": 0,
  "lengthCounter": 0,
  "timerValue": 0,
  "sequencePos": 0,
  "envelopeStart": false,
  "envelopeVolume": 0,
  "envelopeValue": 0,
  "sweepReload": false,
  "sweepValue": 0,
  "enabled": true
}
```

#### NES Triangle Channel State

```json
{
  "linearCounterLoad": 0,
  "lengthHalt": false,
  "timerPeriod": 0,
  "lengthCounter": 0,
  "timerValue": 0,
  "sequencePos": 0,
  "linearCounter": 0,
  "linearReload": false,
  "enabled": true
}
```

#### NES Noise Channel State

```json
{
  "lengthHalt": false,
  "constantVolume": false,
  "volume": 0,
  "mode": false,
  "timerPeriod": 0,
  "lengthCounter": 0,
  "timerValue": 0,
  "shiftRegister": 1,
  "envelopeStart": false,
  "envelopeVolume": 0,
  "envelopeValue": 0,
  "enabled": false
}
```

#### NES DMC Channel State

```json
{
  "irqEnabled": false,
  "loop": false,
  "ratePeriod": 0,
  "sampleAddress": 49152,
  "sampleLength": 1,
  "timerValue": 0,
  "outputLevel": 0,
  "currentAddress": 49152,
  "bytesRemaining": 0,
  "sampleBuffer": 0,
  "sampleBufferEmpty": true,
  "shiftRegister": 0,
  "bitsRemaining": 0,
  "silence": true,
  "enabled": false,
  "irqPending": false
}
```

### NES Bus State

```json
{
  "ram": "<base64>",
  "dmaPage": 0,
  "dmaTransfer": false
}
```

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `ram` | base64 | 2048 bytes | Internal RAM ($0000-$07FF) |
| `dmaPage` | number | - | DMA source page |
| `dmaTransfer` | boolean | - | DMA transfer in progress |

### NES Cartridge State

```json
{
  "prgRam": "<base64>",
  "chrRam": "<base64>",
  "mapper": { ... }
}
```

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `prgRam` | base64 | 8192 bytes | PRG RAM (battery-backed save RAM) |
| `chrRam` | base64 | 0-8192 bytes | CHR RAM (if cartridge uses RAM instead of ROM) |
| `mapper` | object | - | Mapper-specific state |

#### NES Mapper State Examples

**Mapper 0 (NROM)**
```json
{}
```
No internal state.

**Mapper 1 (MMC1)**
```json
{
  "shiftRegister": 16,
  "writeCount": 0,
  "control": 12,
  "chrBank0": 0,
  "chrBank1": 0,
  "prgBank": 0,
  "mirrorMode": 0
}
```

**Mapper 4 (MMC3)**
```json
{
  "bankRegisters": [0, 0, 0, 0, 0, 0, 0, 0],
  "bankSelect": 0,
  "prgBankMode": 0,
  "chrA12Inversion": 0,
  "mirrorMode": 0,
  "irqLatch": 0,
  "irqCounter": 0,
  "irqEnable": false,
  "irqReload": false,
  "irqPendingFlag": false
}
```

---

## Game Boy Color Save States (.gbc.state / .gb.state)

GBC save states use `coreId: "gbc"` and `version: 1`.

### GBC State Structure

```json
{
  "version": 1,
  "coreId": "gbc",
  "gameId": "zelda.gbc",
  "data": {
    "cpu": { ... },
    "ppu": { ... },
    "bus": { ... },
    "timer": { ... },
    "cartridge": { ... },
    "cartridgeRam": [...],
    "apu": { ... }
  }
}
```

### GBC CPU State

The Game Boy uses a Sharp LR35902 CPU (Z80-like).

```json
{
  "a": 17,
  "f": 128,
  "b": 0,
  "c": 19,
  "d": 0,
  "e": 216,
  "h": 1,
  "l": 77,
  "sp": 65534,
  "pc": 256,
  "ime": false,
  "halted": false,
  "stopped": false,
  "imeScheduled": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `a` | number | Accumulator register (0-255) |
| `f` | number | Flags register (Z, N, H, C in upper nibble) |
| `b`, `c` | number | BC register pair (0-255 each) |
| `d`, `e` | number | DE register pair (0-255 each) |
| `h`, `l` | number | HL register pair (0-255 each) |
| `sp` | number | Stack pointer (0-65535) |
| `pc` | number | Program counter (0-65535) |
| `ime` | boolean | Interrupt Master Enable flag |
| `halted` | boolean | CPU halted (waiting for interrupt) |
| `stopped` | boolean | CPU stopped (for speed switch) |
| `imeScheduled` | boolean | IME to be enabled after next instruction (EI delay) |

### GBC PPU State

```json
{
  "lcdc": 145,
  "stat": 0,
  "scy": 0,
  "scx": 0,
  "ly": 0,
  "lyc": 0,
  "wy": 0,
  "wx": 0,
  "bgp": 252,
  "obp0": 255,
  "obp1": 255,
  "mode": 2,
  "cycles": 0,
  "windowLine": 0,
  "frameComplete": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `lcdc` | number | LCD Control register ($FF40) |
| `stat` | number | LCD Status register ($FF41) |
| `scy` | number | Scroll Y ($FF42) |
| `scx` | number | Scroll X ($FF43) |
| `ly` | number | Current scanline ($FF44, 0-153) |
| `lyc` | number | LY Compare ($FF45) |
| `wy` | number | Window Y position ($FF4A) |
| `wx` | number | Window X position ($FF4B) |
| `bgp` | number | Background palette (DMG mode, $FF47) |
| `obp0` | number | Object palette 0 (DMG mode, $FF48) |
| `obp1` | number | Object palette 1 (DMG mode, $FF49) |
| `mode` | number | PPU mode (0=HBlank, 1=VBlank, 2=OAM, 3=Drawing) |
| `cycles` | number | Cycles within current mode |
| `windowLine` | number | Internal window line counter |
| `frameComplete` | boolean | Frame completion flag |

### GBC Bus State

```json
{
  "wram": [[...], [...], ...],
  "hram": [...],
  "oam": [...],
  "vram": [[...], [...]],
  "vramBank": 0,
  "wramBank": 1,
  "ie": 0,
  "interruptFlags": 225,
  "joypadState": 255,
  "joypadSelect": 0,
  "speedMode": 0,
  "prepareSpeedSwitch": false,
  "hdmaSource": 0,
  "hdmaDest": 0,
  "hdmaLength": 0,
  "hdmaActive": false,
  "bgPaletteIndex": 0,
  "bgPaletteAutoInc": false,
  "bgPaletteData": [...],
  "objPaletteIndex": 0,
  "objPaletteAutoInc": false,
  "objPaletteData": [...]
}
```

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `wram` | number[][] | 8×4096 bytes | Work RAM (8 banks of 4KB) |
| `hram` | number[] | 127 bytes | High RAM ($FF80-$FFFE) |
| `oam` | number[] | 160 bytes | Object Attribute Memory |
| `vram` | number[][] | 2×8192 bytes | Video RAM (2 banks of 8KB) |
| `vramBank` | number | - | Current VRAM bank (0-1) |
| `wramBank` | number | - | Current WRAM bank (1-7) |
| `ie` | number | - | Interrupt Enable register ($FFFF) |
| `interruptFlags` | number | - | Interrupt Flags register ($FF0F) |
| `joypadState` | number | - | Joypad button state |
| `joypadSelect` | number | - | Joypad selection register |
| `speedMode` | number | - | GBC speed mode (0=normal, 1=double) |
| `prepareSpeedSwitch` | boolean | - | Speed switch pending |
| `hdmaSource` | number | - | HDMA source address |
| `hdmaDest` | number | - | HDMA destination address |
| `hdmaLength` | number | - | HDMA remaining length |
| `hdmaActive` | boolean | - | HDMA transfer active |
| `bgPaletteIndex` | number | - | Background palette index ($FF68) |
| `bgPaletteAutoInc` | boolean | - | Auto-increment on palette write |
| `bgPaletteData` | number[] | 64 bytes | Background palette data (8 palettes) |
| `objPaletteIndex` | number | - | Object palette index ($FF6A) |
| `objPaletteAutoInc` | boolean | - | Auto-increment on palette write |
| `objPaletteData` | number[] | 64 bytes | Object palette data (8 palettes) |

### GBC Timer State

```json
{
  "div": 0,
  "tima": 0,
  "tma": 0,
  "tac": 0,
  "divCounter": 0,
  "timaCounter": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `div` | number | Divider register ($FF04) |
| `tima` | number | Timer counter ($FF05) |
| `tma` | number | Timer modulo ($FF06) |
| `tac` | number | Timer control ($FF07) |
| `divCounter` | number | Internal divider counter |
| `timaCounter` | number | Internal timer counter |

### GBC Cartridge State

```json
{
  "romBank": 1,
  "ramBank": 0,
  "ramEnabled": false,
  "bankingMode": 0,
  "rtcSelect": 0,
  "rtcLatched": false,
  "romBankHigh": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `romBank` | number | Current ROM bank (lower bits) |
| `ramBank` | number | Current RAM bank |
| `ramEnabled` | boolean | External RAM enabled |
| `bankingMode` | number | MBC1 banking mode (0=ROM, 1=RAM) |
| `rtcSelect` | number | MBC3 RTC register selected |
| `rtcLatched` | boolean | MBC3 RTC latched |
| `romBankHigh` | number | MBC5 ROM bank high bit |

The `cartridgeRam` field contains the full external RAM contents as a number array.

### GBC APU State

The Game Boy APU has 4 channels with stereo panning.

```json
{
  "enabled": true,
  "frameSequencer": 0,
  "frameSequencerTimer": 8192,
  "masterVolumeLeft": 7,
  "masterVolumeRight": 7,
  "panLeft": 15,
  "panRight": 15,
  "pulse1": { ... },
  "pulse2": { ... },
  "wave": { ... },
  "noise": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | APU master enable (NR52 bit 7) |
| `frameSequencer` | number | Frame sequencer step (0-7) |
| `frameSequencerTimer` | number | Cycles until next frame sequencer step |
| `masterVolumeLeft` | number | Master volume left (0-7) |
| `masterVolumeRight` | number | Master volume right (0-7) |
| `panLeft` | number | Channel panning to left (bits 0-3) |
| `panRight` | number | Channel panning to right (bits 0-3) |
| `pulse1` | object | Pulse channel 1 state (with sweep) |
| `pulse2` | object | Pulse channel 2 state |
| `wave` | object | Wave channel state |
| `noise` | object | Noise channel state |

#### GBC Pulse Channel State

```json
{
  "enabled": false,
  "dacEnabled": false,
  "lengthCounter": 0,
  "lengthEnabled": false,
  "frequency": 0,
  "duty": 0,
  "dutyPos": 0,
  "timer": 0,
  "volume": 0,
  "volumeInitial": 0,
  "volumeEnvDir": 0,
  "volumeEnvPeriod": 0,
  "volumeEnvTimer": 0,
  "sweepEnabled": false,
  "sweepPeriod": 0,
  "sweepTimer": 0,
  "sweepShift": 0,
  "sweepNegate": false,
  "sweepShadowFreq": 0,
  "sweepCalcWithNegate": false
}
```

#### GBC Wave Channel State

```json
{
  "enabled": false,
  "dacEnabled": false,
  "lengthCounter": 0,
  "lengthEnabled": false,
  "frequency": 0,
  "timer": 0,
  "volume": 0,
  "position": 0,
  "sampleBuffer": 0,
  "waveRam": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}
```

#### GBC Noise Channel State

```json
{
  "enabled": false,
  "dacEnabled": false,
  "lengthCounter": 0,
  "lengthEnabled": false,
  "volume": 0,
  "volumeInitial": 0,
  "volumeEnvDir": 0,
  "volumeEnvPeriod": 0,
  "volumeEnvTimer": 0,
  "divisor": 0,
  "shift": 0,
  "width": false,
  "lfsr": 32767,
  "timer": 0
}
```

---

## Version History

### NES Core

| Version | Changes |
|---------|---------|
| 1 | Initial format |
| 2 | Added full APU channel state |

### GBC Core

| Version | Changes |
|---------|---------|
| 1 | Initial format with full component state |
