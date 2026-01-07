// NES color palette (64 colors)
// Each entry is [R, G, B] from 0-255
export const nesPalette: [number, number, number][] = [
  [84, 84, 84],    // 0x00
  [0, 30, 116],    // 0x01
  [8, 16, 144],    // 0x02
  [48, 0, 136],    // 0x03
  [68, 0, 100],    // 0x04
  [92, 0, 48],     // 0x05
  [84, 4, 0],      // 0x06
  [60, 24, 0],     // 0x07
  [32, 42, 0],     // 0x08
  [8, 58, 0],      // 0x09
  [0, 64, 0],      // 0x0A
  [0, 60, 0],      // 0x0B
  [0, 50, 60],     // 0x0C
  [0, 0, 0],       // 0x0D
  [0, 0, 0],       // 0x0E
  [0, 0, 0],       // 0x0F
  [152, 150, 152], // 0x10
  [8, 76, 196],    // 0x11
  [48, 50, 236],   // 0x12
  [92, 30, 228],   // 0x13
  [136, 20, 176],  // 0x14
  [160, 20, 100],  // 0x15
  [152, 34, 32],   // 0x16
  [120, 60, 0],    // 0x17
  [84, 90, 0],     // 0x18
  [40, 114, 0],    // 0x19
  [8, 124, 0],     // 0x1A
  [0, 118, 40],    // 0x1B
  [0, 102, 120],   // 0x1C
  [0, 0, 0],       // 0x1D
  [0, 0, 0],       // 0x1E
  [0, 0, 0],       // 0x1F
  [236, 238, 236], // 0x20
  [76, 154, 236],  // 0x21
  [120, 124, 236], // 0x22
  [176, 98, 236],  // 0x23
  [228, 84, 236],  // 0x24
  [236, 88, 180],  // 0x25
  [236, 106, 100], // 0x26
  [212, 136, 32],  // 0x27
  [160, 170, 0],   // 0x28
  [116, 196, 0],   // 0x29
  [76, 208, 32],   // 0x2A
  [56, 204, 108],  // 0x2B
  [56, 180, 204],  // 0x2C
  [60, 60, 60],    // 0x2D
  [0, 0, 0],       // 0x2E
  [0, 0, 0],       // 0x2F
  [236, 238, 236], // 0x30
  [168, 204, 236], // 0x31
  [188, 188, 236], // 0x32
  [212, 178, 236], // 0x33
  [236, 174, 236], // 0x34
  [236, 174, 212], // 0x35
  [236, 180, 176], // 0x36
  [228, 196, 144], // 0x37
  [204, 210, 120], // 0x38
  [180, 222, 120], // 0x39
  [168, 226, 144], // 0x3A
  [152, 226, 180], // 0x3B
  [160, 214, 228], // 0x3C
  [160, 162, 160], // 0x3D
  [0, 0, 0],       // 0x3E
  [0, 0, 0],       // 0x3F
];

// Convert NES palette index to ANSI 256-color code
export function nesColorToAnsi256(nesColor: number): number {
  const [r, g, b] = nesPalette[nesColor & 0x3f];

  // Convert to 6x6x6 color cube (16-231)
  const r6 = Math.round((r / 255) * 5);
  const g6 = Math.round((g / 255) * 5);
  const b6 = Math.round((b / 255) * 5);

  return 16 + (36 * r6) + (6 * g6) + b6;
}

// Get RGB hex string for NES color
export function nesColorToHex(nesColor: number): string {
  const [r, g, b] = nesPalette[nesColor & 0x3f];
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Pre-computed ANSI escape sequence caches to avoid string generation per-pixel
// These are computed once at module load, eliminating 61,440+ string allocations per frame
const trueColorCache: string[] = new Array(64);
const bgTrueColorCache: string[] = new Array(64);

// Initialize caches
for (let i = 0; i < 64; i++) {
  const [r, g, b] = nesPalette[i];
  trueColorCache[i] = `\x1b[38;2;${r};${g};${b}m`;
  bgTrueColorCache[i] = `\x1b[48;2;${r};${g};${b}m`;
}

// Get ANSI true color escape sequence (uses pre-computed cache)
export function nesColorToTrueColor(nesColor: number): string {
  return trueColorCache[nesColor & 0x3f];
}

// Get ANSI true color background escape sequence (uses pre-computed cache)
export function nesColorToBgTrueColor(nesColor: number): string {
  return bgTrueColorCache[nesColor & 0x3f];
}
