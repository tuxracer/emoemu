# Save State Format (.state)

TUI-NES save states capture the complete emulator state, allowing games to be resumed exactly where they were left off.

## File Format

- **Extension**: `.state`
- **Compression**: Gzip (max compression level 9)
- **Contents**: JSON object
- **Location**: Same directory as the ROM file, with `.nes` replaced by `.state`

The loader also supports uncompressed JSON for backwards compatibility, detected by checking for the gzip magic number (`0x1f 0x8b`).

## Top-Level Structure

```json
{
  "version": 1,
  "romPath": "path/to/game.nes",
  "cpu": { ... },
  "ppu": { ... },
  "apu": { ... },
  "bus": { ... },
  "cartridge": { ... },
  "frameCount": 12345
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | number | Save state format version (currently 1) |
| `romPath` | string | Original path to the ROM file |
| `cpu` | object | CPU state |
| `ppu` | object | PPU state |
| `apu` | object | APU state |
| `bus` | object | Memory bus state |
| `cartridge` | object | Cartridge and mapper state |
| `frameCount` | number | Total frames emulated |

## CPU State

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

## PPU State

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

## APU State

```json
{
  "frameCounterMode": 0,
  "frameIRQInhibit": false,
  "frameIRQPending": false,
  "cycleCount": 0,
  "frameCycleCount": 0,
  "frameStep": 0
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

Note: Audio channel state is not saved. Channels are reset on load and regenerate audio from the restored game state.

## Bus State

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

## Cartridge State

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

## Mapper State

Mapper state varies by mapper type. Examples:

### Mapper 0 (NROM)
```json
{}
```
No internal state.

### Mapper 1 (MMC1)
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

### Mapper 4 (MMC3)
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

## Version History

| Version | Changes |
|---------|---------|
| 1 | Initial format |

## Validation

When loading a state file, the following checks are performed:

1. File exists
2. If gzipped (magic bytes `0x1f 0x8b`), decompress successfully
3. Valid JSON syntax
4. Required fields present: `version`, `cpu`, `ppu`, `bus`

If validation fails, a warning is displayed and the game starts fresh.
