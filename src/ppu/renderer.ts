import { nesPalette, nesColorToTrueColor, nesColorToBgTrueColor } from './palette.js';

const RESET = '\x1b[0m';

export interface RendererOptions {
  width: number;
  height: number;
  useColor: boolean;
  useTrueColor: boolean;
  asciiMode: boolean;
}

// ASCII character ramps for different density levels
const ASCII_CHARS_DENSE = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const ASCII_CHARS_SIMPLE = ' .-:=+*#%@';

export class TerminalRenderer {
  private width: number;
  private height: number;
  private useColor: boolean;
  private useTrueColor: boolean;
  private asciiMode: boolean;
  private asciiChars: string;

  constructor(options: Partial<RendererOptions> = {}) {
    this.width = options.width ?? 128;
    this.height = options.height ?? 60;
    this.useColor = options.useColor ?? true;
    this.useTrueColor = options.useTrueColor ?? true;
    this.asciiMode = options.asciiMode ?? false;
    // Use dense character set for better detail in ASCII mode
    this.asciiChars = this.asciiMode ? ASCII_CHARS_DENSE : ASCII_CHARS_SIMPLE;
  }

  // Render frame buffer to terminal string
  render(frameBuffer: Uint8Array): string {
    const output: string[] = [];

    // NES resolution is 256x240
    // For ASCII mode: 1 char = 1 pixel (no half-blocks)
    // For terminal mode: half-block characters for 2 vertical pixels per character
    const scaleX = 256 / this.width;
    const scaleY = this.asciiMode
      ? 240 / this.height  // ASCII: 1 char = 1 pixel
      : 240 / (this.height * 2); // Terminal: half-blocks

    for (let charY = 0; charY < this.height; charY++) {
      let line = '';

      for (let charX = 0; charX < this.width; charX++) {
        const nesX = Math.floor(charX * scaleX);

        if (this.asciiMode) {
          // ASCII mode: one character per pixel
          const nesY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[nesY * 256 + nesX] & 0x3f;
          const lum = this.luminance(pixel);
          const char = this.grayscaleChar(lum);

          if (this.useColor) {
            // Colored ASCII
            const fgColor = nesColorToTrueColor(pixel);
            line += `${fgColor}${char}${RESET}`;
          } else {
            // Pure ASCII grayscale
            line += char;
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
              line += `${fgColor}${bgColor}\u2580${RESET}`;
            } else {
              // ANSI 256 color mode
              const [r1, g1, b1] = nesPalette[topPixel];
              const [r2, g2, b2] = nesPalette[bottomPixel];
              const fg = 16 + 36 * Math.round(r1 / 51) + 6 * Math.round(g1 / 51) + Math.round(b1 / 51);
              const bg = 16 + 36 * Math.round(r2 / 51) + 6 * Math.round(g2 / 51) + Math.round(b2 / 51);
              line += `\x1b[38;5;${fg}m\x1b[48;5;${bg}m\u2580${RESET}`;
            }
          } else {
            // Grayscale half-blocks (fallback)
            const avgTop = this.luminance(topPixel);
            const avgBottom = this.luminance(bottomPixel);
            const avg = (avgTop + avgBottom) / 2;
            line += this.grayscaleChar(avg);
          }
        }
      }

      output.push(line);
    }

    // Move cursor home and output frame
    return this.moveCursorHome() + output.join('\n');
  }

  // Calculate luminance of NES color
  private luminance(nesColor: number): number {
    const [r, g, b] = nesPalette[nesColor & 0x3f];
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // Convert luminance to ASCII character
  private grayscaleChar(luminance: number): string {
    const index = Math.floor(luminance * (this.asciiChars.length - 1));
    return this.asciiChars[Math.min(index, this.asciiChars.length - 1)];
  }

  // Get ANSI escape sequence to move cursor to top-left
  moveCursorHome(): string {
    return '\x1b[H';
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
    return this.height + 1;
  }

  // Move cursor to a specific row
  moveCursorToRow(row: number): string {
    return `\x1b[${row};1H`;
  }

  // Update display dimensions (for terminal resize handling)
  setDimensions(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  // Get current dimensions
  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
