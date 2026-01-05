import { nesPalette, nesColorToTrueColor, nesColorToBgTrueColor } from './palette.js';

const RESET = '\x1b[0m';

export interface RendererOptions {
  width: number;
  height: number;
  useColor: boolean;
  useTrueColor: boolean;
}

export class TerminalRenderer {
  private width: number;
  private height: number;
  private useColor: boolean;
  private useTrueColor: boolean;

  constructor(options: Partial<RendererOptions> = {}) {
    this.width = options.width ?? 128;
    this.height = options.height ?? 60;
    this.useColor = options.useColor ?? true;
    this.useTrueColor = options.useTrueColor ?? true;
  }

  // Render frame buffer to terminal string
  render(frameBuffer: Uint8Array): string {
    const output: string[] = [];

    // NES resolution is 256x240
    // We'll use half-block characters to get 2 vertical pixels per character
    const scaleX = 256 / this.width;
    const scaleY = 240 / (this.height * 2); // *2 because of half-blocks

    for (let charY = 0; charY < this.height; charY++) {
      let line = '';

      for (let charX = 0; charX < this.width; charX++) {
        // Get the two pixels that will be combined into one character
        const nesX = Math.floor(charX * scaleX);
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
          // ASCII grayscale mode
          const avgTop = this.luminance(topPixel);
          const avgBottom = this.luminance(bottomPixel);
          const avg = (avgTop + avgBottom) / 2;
          line += this.grayscaleChar(avg);
        }
      }

      output.push(line);
    }

    return output.join('\n');
  }

  // Calculate luminance of NES color
  private luminance(nesColor: number): number {
    const [r, g, b] = nesPalette[nesColor & 0x3f];
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // Convert luminance to ASCII character
  private grayscaleChar(luminance: number): string {
    const chars = ' .:-=+*#%@';
    const index = Math.floor(luminance * (chars.length - 1));
    return chars[index];
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
}
