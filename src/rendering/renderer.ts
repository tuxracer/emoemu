import { nesPalette, nesColorToTrueColor, nesColorToBgTrueColor, nesColorLuminance, nesColorToEmoji } from './palette.js';

const RESET = '\x1b[0m';

// RGB15 to truecolor ANSI helpers (for GBC and other RGB15 cores)
// RGB15 format: XBBBBBGGGGGRRRRR (5 bits per channel)
function rgb15ToTrueColor(color: number): string {
  // Extract 5-bit components and expand to 8-bit
  const r = ((color & 0x001F) << 3) | ((color & 0x001F) >> 2);
  const g = (((color >> 5) & 0x1F) << 3) | (((color >> 5) & 0x1F) >> 2);
  const b = (((color >> 10) & 0x1F) << 3) | (((color >> 10) & 0x1F) >> 2);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function rgb15ToBgTrueColor(color: number): string {
  const r = ((color & 0x001F) << 3) | ((color & 0x001F) >> 2);
  const g = (((color >> 5) & 0x1F) << 3) | (((color >> 5) & 0x1F) >> 2);
  const b = (((color >> 10) & 0x1F) << 3) | (((color >> 10) & 0x1F) >> 2);
  return `\x1b[48;2;${r};${g};${b}m`;
}

function rgb15ToLuminance(color: number): number {
  const r = ((color & 0x001F) << 3) | ((color & 0x001F) >> 2);
  const g = (((color >> 5) & 0x1F) << 3) | (((color >> 5) & 0x1F) >> 2);
  const b = (((color >> 10) & 0x1F) << 3) | (((color >> 10) & 0x1F) >> 2);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Emoji colors with RGB values for color matching
const EMOJI_COLORS: { emoji: string; rgb: [number, number, number] }[] = [
  { emoji: '⬜', rgb: [255, 255, 255] },
  { emoji: '🟨', rgb: [250, 220, 80] },
  { emoji: '🟧', rgb: [240, 140, 20] },
  { emoji: '🟥', rgb: [220, 40, 40] },
  { emoji: '🟫', rgb: [130, 80, 30] },
  { emoji: '🟩', rgb: [50, 160, 30] },
  { emoji: '🟦', rgb: [50, 120, 220] },
  { emoji: '🟪', rgb: [160, 70, 200] },
  { emoji: '⬛', rgb: [0, 0, 0] },
];

function rgb15ToEmoji(color: number): string {
  const r = ((color & 0x001F) << 3) | ((color & 0x001F) >> 2);
  const g = (((color >> 5) & 0x1F) << 3) | (((color >> 5) & 0x1F) >> 2);
  const b = (((color >> 10) & 0x1F) << 3) | (((color >> 10) & 0x1F) >> 2);

  let bestEmoji = EMOJI_COLORS[0].emoji;
  let bestDist = Infinity;

  for (const { emoji, rgb } of EMOJI_COLORS) {
    const dr = r - rgb[0];
    const dg = g - rgb[1];
    const db = b - rgb[2];
    const dist = dr * dr + dg * dg * 1.5 + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestEmoji = emoji;
    }
  }

  return bestEmoji;
}

export interface RendererOptions {
  width: number;
  height: number;
  useColor: boolean;
  useTrueColor: boolean;
  asciiMode: boolean;
  emojiMode: boolean;
  sourceWidth: number;   // Source framebuffer width (e.g., 256 for NES, 160 for GBC)
  sourceHeight: number;  // Source framebuffer height (e.g., 240 for NES, 144 for GBC)
}

// ASCII character ramps for different density levels
const ASCII_CHARS_DENSE = ' .\'`^",:;Il!i><~+_-][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const ASCII_CHARS_SIMPLE = ' .-:=+*#%@';

export class TerminalRenderer {
  private width: number;
  private height: number;
  private useColor: boolean;
  private useTrueColor: boolean;
  private asciiMode: boolean;
  private emojiMode: boolean;
  private asciiChars: string;
  private offsetCol: number = 0;  // Horizontal offset for centering (0-based for padding)
  private offsetRow: number = 1;  // Vertical offset for centering (1-based for ANSI)
  private sourceWidth: number;   // Source framebuffer width
  private sourceHeight: number;  // Source framebuffer height

  constructor(options: Partial<RendererOptions> = {}) {
    this.width = options.width ?? 128;
    this.height = options.height ?? 60;
    this.useColor = options.useColor ?? true;
    this.useTrueColor = options.useTrueColor ?? true;
    this.asciiMode = options.asciiMode ?? false;
    this.emojiMode = options.emojiMode ?? false;
    this.sourceWidth = options.sourceWidth ?? 256;   // Default to NES width
    this.sourceHeight = options.sourceHeight ?? 240; // Default to NES height
    // Use dense character set for better detail in ASCII mode
    this.asciiChars = this.asciiMode ? ASCII_CHARS_DENSE : ASCII_CHARS_SIMPLE;
    // Calculate centering offsets
    this.calculateOffsets();
  }

  // Calculate centering offsets based on terminal size
  private calculateOffsets(): void {
    const termCols = process.stdout.columns || 80;
    const termRows = process.stdout.rows || 24;

    // Leave 2 rows for status line
    const availableRows = termRows - 2;

    // Horizontal centering (0-based for padding)
    // Emoji mode: each character is 2 terminal columns wide
    const displayWidth = this.emojiMode ? this.width * 2 : this.width;
    this.offsetCol = Math.max(0, Math.floor((termCols - displayWidth) / 2));

    // Vertical centering (1-based for ANSI escape sequences)
    this.offsetRow = Math.max(1, Math.floor((availableRows - this.height) / 2) + 1);
  }

  // Render frame buffer to terminal string
  // Uses array + join instead of string concatenation to reduce allocations
  render(frameBuffer: Uint8Array): string {
    const output: string[] = [];

    // Use source resolution from constructor (defaults to NES 256x240)
    // For ASCII/emoji mode: 1 char = 1 pixel (no half-blocks)
    // For terminal mode: half-block characters for 2 vertical pixels per character
    const scaleX = this.sourceWidth / this.width;
    const scaleY = (this.asciiMode || this.emojiMode)
      ? this.sourceHeight / this.height  // ASCII/emoji: 1 char = 1 pixel
      : this.sourceHeight / (this.height * 2); // Terminal: half-blocks

    for (let charY = 0; charY < this.height; charY++) {
      // Use array for line building to avoid O(n²) string concatenation
      const lineChars: string[] = [];

      for (let charX = 0; charX < this.width; charX++) {
        const srcX = Math.floor(charX * scaleX);

        if (this.emojiMode) {
          // Emoji mode: one emoji per pixel (emoji is 2 terminal columns wide)
          // Uses color-matched emoji lookup for accurate color representation
          const srcY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[srcY * this.sourceWidth + srcX] & 0x3f;
          const emoji = nesColorToEmoji(pixel);
          lineChars.push(emoji);
        } else if (this.asciiMode) {
          // ASCII mode: one character per pixel
          const srcY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[srcY * this.sourceWidth + srcX] & 0x3f;
          const lum = nesColorLuminance(pixel);
          const char = this.grayscaleChar(lum);

          if (this.useColor) {
            // Colored ASCII
            const fgColor = nesColorToTrueColor(pixel);
            lineChars.push(fgColor, char, RESET);
          } else {
            // Pure ASCII grayscale
            lineChars.push(char);
          }
        } else {
          // Terminal mode: half-block characters
          const srcY1 = Math.floor(charY * 2 * scaleY);
          const srcY2 = Math.floor((charY * 2 + 1) * scaleY);

          const topPixel = frameBuffer[srcY1 * this.sourceWidth + srcX] & 0x3f;
          const bottomPixel = frameBuffer[srcY2 * this.sourceWidth + srcX] & 0x3f;

          if (this.useColor) {
            // Use half-block character with top pixel as foreground, bottom as background
            if (this.useTrueColor) {
              const fgColor = nesColorToTrueColor(topPixel);
              const bgColor = nesColorToBgTrueColor(bottomPixel);
              lineChars.push(fgColor, bgColor, '\u2580', RESET);
            } else {
              // ANSI 256 color mode
              const [r1, g1, b1] = nesPalette[topPixel];
              const [r2, g2, b2] = nesPalette[bottomPixel];
              const fg = 16 + 36 * Math.round(r1 / 51) + 6 * Math.round(g1 / 51) + Math.round(b1 / 51);
              const bg = 16 + 36 * Math.round(r2 / 51) + 6 * Math.round(g2 / 51) + Math.round(b2 / 51);
              lineChars.push(`\x1b[38;5;${fg}m\x1b[48;5;${bg}m\u2580`, RESET);
            }
          } else {
            // Grayscale half-blocks (fallback)
            const avgTop = nesColorLuminance(topPixel);
            const avgBottom = nesColorLuminance(bottomPixel);
            const avg = (avgTop + avgBottom) / 2;
            lineChars.push(this.grayscaleChar(avg));
          }
        }
      }

      // Add horizontal padding for centering
      if (this.offsetCol > 0) {
        output.push(' '.repeat(this.offsetCol) + lineChars.join(''));
      } else {
        output.push(lineChars.join(''));
      }
    }

    // Move cursor to centered position and output frame
    return this.moveCursorHome() + output.join('\n');
  }

  // Render RGB15 frame buffer (for GBC and other RGB15 cores)
  renderRgb15(frameBuffer: Uint16Array): string {
    const output: string[] = [];

    const scaleX = this.sourceWidth / this.width;
    const scaleY = (this.asciiMode || this.emojiMode)
      ? this.sourceHeight / this.height
      : this.sourceHeight / (this.height * 2);

    for (let charY = 0; charY < this.height; charY++) {
      const lineChars: string[] = [];

      for (let charX = 0; charX < this.width; charX++) {
        const srcX = Math.floor(charX * scaleX);

        if (this.emojiMode) {
          const srcY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[srcY * this.sourceWidth + srcX];
          const emoji = rgb15ToEmoji(pixel);
          lineChars.push(emoji);
        } else if (this.asciiMode) {
          const srcY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[srcY * this.sourceWidth + srcX];
          const lum = rgb15ToLuminance(pixel);
          const char = this.grayscaleChar(lum);

          if (this.useColor) {
            const fgColor = rgb15ToTrueColor(pixel);
            lineChars.push(fgColor, char, RESET);
          } else {
            lineChars.push(char);
          }
        } else {
          // Terminal mode: half-block characters
          const srcY1 = Math.floor(charY * 2 * scaleY);
          const srcY2 = Math.floor((charY * 2 + 1) * scaleY);

          const topPixel = frameBuffer[srcY1 * this.sourceWidth + srcX];
          const bottomPixel = frameBuffer[srcY2 * this.sourceWidth + srcX];

          if (this.useColor) {
            if (this.useTrueColor) {
              const fgColor = rgb15ToTrueColor(topPixel);
              const bgColor = rgb15ToBgTrueColor(bottomPixel);
              lineChars.push(fgColor, bgColor, '\u2580', RESET);
            } else {
              // ANSI 256 color mode - convert RGB15 to 6x6x6 cube
              const r1 = ((topPixel & 0x001F) << 3) | ((topPixel & 0x001F) >> 2);
              const g1 = (((topPixel >> 5) & 0x1F) << 3) | (((topPixel >> 5) & 0x1F) >> 2);
              const b1 = (((topPixel >> 10) & 0x1F) << 3) | (((topPixel >> 10) & 0x1F) >> 2);
              const r2 = ((bottomPixel & 0x001F) << 3) | ((bottomPixel & 0x001F) >> 2);
              const g2 = (((bottomPixel >> 5) & 0x1F) << 3) | (((bottomPixel >> 5) & 0x1F) >> 2);
              const b2 = (((bottomPixel >> 10) & 0x1F) << 3) | (((bottomPixel >> 10) & 0x1F) >> 2);
              const fg = 16 + 36 * Math.round(r1 / 51) + 6 * Math.round(g1 / 51) + Math.round(b1 / 51);
              const bg = 16 + 36 * Math.round(r2 / 51) + 6 * Math.round(g2 / 51) + Math.round(b2 / 51);
              lineChars.push(`\x1b[38;5;${fg}m\x1b[48;5;${bg}m\u2580`, RESET);
            }
          } else {
            const avgTop = rgb15ToLuminance(topPixel);
            const avgBottom = rgb15ToLuminance(bottomPixel);
            const avg = (avgTop + avgBottom) / 2;
            lineChars.push(this.grayscaleChar(avg));
          }
        }
      }

      if (this.offsetCol > 0) {
        output.push(' '.repeat(this.offsetCol) + lineChars.join(''));
      } else {
        output.push(lineChars.join(''));
      }
    }

    return this.moveCursorHome() + output.join('\n');
  }

  // Convert luminance to ASCII character
  private grayscaleChar(luminance: number): string {
    const index = Math.floor(luminance * (this.asciiChars.length - 1));
    return this.asciiChars[Math.min(index, this.asciiChars.length - 1)];
  }

  // Get ANSI escape sequence to move cursor to centered start position
  moveCursorHome(): string {
    return `\x1b[${this.offsetRow};1H`;
  }

  // Clear screen
  clearScreen(): string {
    return '\x1b[2J\x1b[H';
  }

  // Hide cursor
  hideCursor(): string {
    return '\x1b[?25l';
  }

  // Show cursor
  showCursor(): string {
    return '\x1b[?25h';
  }

  // Get the row number for the status line (below the rendered frame)
  getStatusRow(): number {
    return this.offsetRow + this.height;
  }

  // Move cursor to a specific row
  moveCursorToRow(row: number): string {
    return `\x1b[${row};1H`;
  }

  // Update display dimensions (for terminal resize handling)
  setDimensions(width: number, height: number): void {
    this.width = width;
    this.height = height;
    // Recalculate centering offsets
    this.calculateOffsets();
  }

  // Get current dimensions
  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
