import { nesPalette, nesColorToTrueColor, nesColorToBgTrueColor, nesColorLuminance } from './palette.js';

const RESET = '\x1b[0m';

export interface RendererOptions {
  width: number;
  height: number;
  useColor: boolean;
  useTrueColor: boolean;
  asciiMode: boolean;
  emojiMode: boolean;
}

// ASCII character ramps for different density levels
const ASCII_CHARS_DENSE = ' .\'`^",:;Il!i><~+_-][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const ASCII_CHARS_SIMPLE = ' .-:=+*#%@';

// Emoji ramp from dark to light (each emoji is 2 terminal columns wide)
// Includes all colored squares and circles, ordered by perceived luminance
const EMOJI_CHARS = [
  '⬛', '⚫',           // black
  '🟤', '🟫',           // brown
  '🟣', '🟪',           // purple
  '🔵', '🟦',           // blue
  '🔴', '🟥',           // red
  '🟢', '🟩',           // green
  '🟠', '🟧',           // orange
  '🟡', '🟨',           // yellow
  '⚪', '⬜',           // white
];

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

  constructor(options: Partial<RendererOptions> = {}) {
    this.width = options.width ?? 128;
    this.height = options.height ?? 60;
    this.useColor = options.useColor ?? true;
    this.useTrueColor = options.useTrueColor ?? true;
    this.asciiMode = options.asciiMode ?? false;
    this.emojiMode = options.emojiMode ?? false;
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

    // NES resolution is 256x240
    // For ASCII/emoji mode: 1 char = 1 pixel (no half-blocks)
    // For terminal mode: half-block characters for 2 vertical pixels per character
    const scaleX = 256 / this.width;
    const scaleY = (this.asciiMode || this.emojiMode)
      ? 240 / this.height  // ASCII/emoji: 1 char = 1 pixel
      : 240 / (this.height * 2); // Terminal: half-blocks

    for (let charY = 0; charY < this.height; charY++) {
      // Use array for line building to avoid O(n²) string concatenation
      const lineChars: string[] = [];

      for (let charX = 0; charX < this.width; charX++) {
        const nesX = Math.floor(charX * scaleX);

        if (this.emojiMode) {
          // Emoji mode: one emoji per pixel (emoji is 2 terminal columns wide)
          const nesY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[nesY * 256 + nesX] & 0x3f;
          const lum = nesColorLuminance(pixel);
          const emoji = this.luminanceToEmoji(lum);
          lineChars.push(emoji);
        } else if (this.asciiMode) {
          // ASCII mode: one character per pixel
          const nesY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[nesY * 256 + nesX] & 0x3f;
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
          const nesY1 = Math.floor(charY * 2 * scaleY);
          const nesY2 = Math.floor((charY * 2 + 1) * scaleY);

          const topPixel = frameBuffer[nesY1 * 256 + nesX] & 0x3f;
          const bottomPixel = frameBuffer[nesY2 * 256 + nesX] & 0x3f;

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

  // Convert luminance to ASCII character
  private grayscaleChar(luminance: number): string {
    const index = Math.floor(luminance * (this.asciiChars.length - 1));
    return this.asciiChars[Math.min(index, this.asciiChars.length - 1)];
  }

  // Convert luminance to emoji
  private luminanceToEmoji(luminance: number): string {
    const index = Math.floor(luminance * (EMOJI_CHARS.length - 1));
    return EMOJI_CHARS[Math.min(index, EMOJI_CHARS.length - 1)];
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
