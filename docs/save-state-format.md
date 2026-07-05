# Save State Format (.state)

emoemu save states capture the complete emulator state, allowing games to be resumed exactly where they were left off. All cores use raw binary save states compatible with RetroArch.

## Format

### File Format

- **Naming**: `[rom name without extension].[coreId].state` (e.g., `game.libretro-fceumm.state`, `mario.libretro-bsnes.state`)
- **Format**: Raw binary (RetroArch-compatible)
- **Location**: Same directory as the ROM file

The naming convention includes the core ID because save states are not compatible across different cores. For example, playing `mario.sfc` with bsnes creates `mario.libretro-bsnes.state`, while playing with snes9x creates `mario.libretro-snes9x.state`.

---

## Game Boy Color Save States (.gbc.state / .gb.state)

GBC save states use `coreId: "gbc"` and `version: 1`.

### GBC State Structure

```json
{
  "version": 1,
  "coreId": "gbc",
  "gameId": "zelda.gbc",
  "frameCount": 12345,
  "savedAt": "2025-01-15T12:00:00.000Z",
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

## SNES Save States (.sfc.state / .smc.state)

SNES save states use `coreId: "snes"` and `version: 1`.

### SNES State Structure

```json
{
  "version": 1,
  "coreId": "snes",
  "gameId": "game.sfc",
  "frameCount": 12345,
  "savedAt": "2025-01-15T12:00:00.000Z",
  "data": {
    "cpu": { ... },
    "ppu": { ... },
    "apu": { ... },
    "cartridge": { ... },
    "ram": [...],
    "dmaBadr": [...],
    "dmaAadr": [...],
    ...
  }
}
```

### SNES CPU State (65C816)

```json
{
  "r": [0, 0],
  "br": [0, 0, 0, 511, 0, 0],
  "n": false,
  "v": false,
  "m": true,
  "x": true,
  "d": false,
  "i": false,
  "z": false,
  "c": false,
  "e": true,
  "irqWanted": false,
  "nmiWanted": false,
  "stopped": false,
  "waiting": false,
  "cyclesLeft": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `r` | number[] | 8-bit registers: [DBR, PBR (program bank)] |
| `br` | number[] | 16-bit registers: [A, X, Y, SP, PC, DP] |
| `n` | boolean | Negative flag |
| `v` | boolean | Overflow flag |
| `m` | boolean | Memory/Accumulator size (1=8bit, 0=16bit) |
| `x` | boolean | Index register size (1=8bit, 0=16bit) |
| `d` | boolean | Decimal mode flag |
| `i` | boolean | Interrupt disable flag |
| `z` | boolean | Zero flag |
| `c` | boolean | Carry flag |
| `e` | boolean | Emulation mode flag |
| `irqWanted` | boolean | IRQ pending |
| `nmiWanted` | boolean | NMI pending |
| `stopped` | boolean | CPU stopped (STP instruction) |
| `waiting` | boolean | CPU waiting (WAI instruction) |
| `cyclesLeft` | number | Cycles remaining |

### SNES PPU State

The SNES PPU state is extensive, covering all video registers and memory:

```json
{
  "vram": [...],
  "cgram": [...],
  "oam": [...],
  "highOam": [...],
  "cgramAdr": 0,
  "cgramSecond": false,
  "cgramBuffer": 0,
  "vramInc": 1,
  "vramRemap": 0,
  "vramIncOnHigh": true,
  "vramAdr": 0,
  "vramReadBuffer": 0,
  "tilemapWider": [false, false, false, false],
  "tilemapHigher": [false, false, false, false],
  "tilemapAdr": [0, 0, 0, 0],
  "tileAdr": [0, 0, 0, 0],
  "bgHoff": [0, 0, 0, 0],
  "bgVoff": [0, 0, 0, 0],
  "offPrev1": 0,
  "offPrev2": 0,
  "mode": 0,
  "layer3Prio": false,
  "bigTiles": [false, false, false, false],
  "mosaicEnabled": [false, false, false, false],
  "mosaicSize": 1,
  "mosaicStartLine": 0,
  "mainScreenEnabled": [false, false, false, false, false],
  "subScreenEnabled": [false, false, false, false, false],
  "forcedBlank": true,
  "brightness": 0,
  "oamAdr": 0,
  ...
}
```

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `vram` | number[] | 65536 bytes | Video RAM |
| `cgram` | number[] | 512 bytes | Color palette RAM (256 colors × 2 bytes) |
| `oam` | number[] | 512 bytes | Object Attribute Memory (low table) |
| `highOam` | number[] | 32 bytes | OAM high table (size/position MSB) |
| `mode` | number | - | Background mode (0-7) |
| `brightness` | number | - | Master brightness (0-15) |
| `forcedBlank` | boolean | - | Forced blanking enabled |
| `tilemapAdr` | number[] | - | Tilemap addresses for BG1-4 |
| `tileAdr` | number[] | - | Tile data addresses for BG1-4 |
| `bgHoff` | number[] | - | Horizontal scroll for BG1-4 |
| `bgVoff` | number[] | - | Vertical scroll for BG1-4 |

### SNES APU State

The SNES APU consists of the SPC700 CPU and S-DSP:

```json
{
  "ram": [...],
  "spc": { ... },
  "dsp": { ... },
  "dspAddress": 0,
  "cpuToPorts": [0, 0, 0, 0],
  "portsToCpu": [0, 0, 0, 0],
  "romReadable": true,
  "timer0Target": 0,
  "timer1Target": 0,
  "timer2Target": 0,
  "timer0Counter": 0,
  "timer1Counter": 0,
  "timer2Counter": 0,
  "timer0Div": 0,
  "timer1Div": 0,
  "timer2Div": 0,
  "timer0Enabled": false,
  "timer1Enabled": false,
  "timer2Enabled": false,
  "dspCycleCounter": 0
}
```

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `ram` | number[] | 65536 bytes | Audio RAM (64KB) |
| `spc` | object | - | SPC700 CPU state |
| `dsp` | object | - | S-DSP state |
| `cpuToPorts` | number[] | 4 bytes | CPU → APU communication ports |
| `portsToCpu` | number[] | 4 bytes | APU → CPU communication ports |
| `romReadable` | boolean | - | IPL ROM readable flag |
| `timer*Target` | number | - | Timer target values |
| `timer*Counter` | number | - | Timer output counters |
| `timer*Enabled` | boolean | - | Timer enable flags |

#### SPC700 State

```json
{
  "r": [0, 0, 0, 239],
  "br": [65472],
  "n": false,
  "v": false,
  "p": false,
  "b": false,
  "h": false,
  "i": false,
  "z": false,
  "c": false,
  "cyclesLeft": 7
}
```

| Field | Type | Description |
|-------|------|-------------|
| `r` | number[] | 8-bit registers: [A, X, Y, SP] |
| `br` | number[] | 16-bit registers: [PC] |
| `n` | boolean | Negative flag |
| `v` | boolean | Overflow flag |
| `p` | boolean | Direct page selector |
| `b` | boolean | Break flag |
| `h` | boolean | Half-carry flag |
| `i` | boolean | Interrupt enable |
| `z` | boolean | Zero flag |
| `c` | boolean | Carry flag |
| `cyclesLeft` | number | Cycles remaining |

#### S-DSP State

```json
{
  "ram": [...],
  "decodeBuffer": [...],
  "rateNums": [...],
  "pitch": [...],
  "counter": [...],
  "pitchMod": [...],
  "srcn": [...],
  "decodeOffset": [...],
  "prevFlags": [...],
  "old": [...],
  "older": [...],
  "enableNoise": [...],
  "noiseSample": 0,
  "noiseRate": 0,
  "noiseCounter": 0,
  "rateCounter": [...],
  "adsrState": [...],
  "sustainLevel": [...],
  "useGain": [...],
  "gainMode": [...],
  "directGain": [...],
  "gainValue": [...],
  "gain": [...],
  "channelVolumeL": [...],
  "channelVolumeR": [...],
  "volumeL": 0,
  "volumeR": 0,
  "mute": false,
  "resetFlag": false,
  "noteOff": [...],
  "sampleOut": [...],
  "dirPage": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ram` | number[] | DSP register RAM (128 bytes) |
| `pitch` | number[] | Voice pitch values (8 voices) |
| `adsrState` | number[] | ADSR state per voice (0-3) |
| `gain` | number[] | Current gain level per voice |
| `channelVolumeL` | number[] | Left volume per voice |
| `channelVolumeR` | number[] | Right volume per voice |
| `volumeL` | number | Master left volume |
| `volumeR` | number | Master right volume |
| `mute` | boolean | Master mute flag |
| `noiseSample` | number | Current noise sample value |
| `dirPage` | number | Sample directory page |

### SNES Cartridge State

```json
{
  "sram": [...]
}
```

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `sram` | number[] | varies | Battery-backed SRAM (up to 128KB) |

### SNES Main State Fields

Additional fields stored at the top level of `data`:

```json
{
  "ram": [...],
  "dmaBadr": [...],
  "dmaAadr": [...],
  "dmaAadrBank": [...],
  "dmaSize": [...],
  "hdmaIndBank": [...],
  "hdmaTableAdr": [...],
  "hdmaRepCount": [...],
  "dmaActive": [...],
  "hdmaActive": [...],
  "dmaMode": [...],
  "dmaFixed": [...],
  "dmaDec": [...],
  "hdmaInd": [...],
  "dmaFromB": [...],
  "hdmaDoTransfer": [...],
  "hdmaTerminated": [...],
  "dmaBusy": false,
  "dmaTimer": 0,
  "hdmaTimer": 0,
  "xPos": 0,
  "yPos": 0,
  "frames": 0,
  "cpuCyclesLeft": 0,
  "cpuMemOps": 0,
  "apuCatchCycles": 0,
  "ramAdr": 0,
  "openBus": 0,
  "fastMem": false,
  "hIrqEnabled": false,
  "vIrqEnabled": false,
  "nmiEnabled": false,
  "hTimer": 0,
  "vTimer": 0,
  "inNmi": false,
  "inIrq": false,
  "inHblank": false,
  "inVblank": false,
  "autoJoyRead": false,
  "autoJoyTimer": 0,
  "ppuLatch": false,
  "joypad1Val": 0,
  "joypad2Val": 0,
  "joypad1AutoRead": 0,
  "joypad2AutoRead": 0,
  "joypadStrobe": false,
  "joypad1State": 0,
  "joypad2State": 0,
  "multiplyA": 0,
  "divA": 0,
  "divResult": 0,
  "mulResult": 0
}
```

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `ram` | number[] | 131072 bytes | Main RAM (128KB) |
| `dmaBadr` | number[] | 8 | DMA B-bus address per channel |
| `dmaAadr` | number[] | 8 | DMA A-bus address per channel |
| `dmaSize` | number[] | 8 | DMA transfer size per channel |
| `dmaActive` | boolean[] | 8 | DMA channel active flags |
| `hdmaActive` | boolean[] | 8 | HDMA channel active flags |
| `frames` | number | - | Frame counter |
| `xPos` | number | - | Current horizontal position (dot) |
| `yPos` | number | - | Current vertical position (scanline) |
| `hTimer` | number | - | H-IRQ timer value |
| `vTimer` | number | - | V-IRQ timer value |
| `inNmi` | boolean | - | In NMI handler |
| `inIrq` | boolean | - | In IRQ handler |
| `inHblank` | boolean | - | In horizontal blank |
| `inVblank` | boolean | - | In vertical blank |

---

## Version History

Save state formats are determined by each libretro core internally. State compatibility depends on the core version.
