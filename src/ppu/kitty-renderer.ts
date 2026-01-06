import { nesPalette } from './palette.js';

// Kitty graphics protocol renderer
// https://sw.kovidgoyal.net/kitty/graphics-protocol/

const ESC = '\x1b';
const APC = `${ESC}_G`;  // Application Program Command for graphics
const ST = `${ESC}\\`;   // String Terminator

// NES native resolution
const NES_WIDTH = 256;
const NES_HEIGHT = 240;

// NES aspect ratio (256:240 = 16:15, but displayed on 4:3 TV)
// Terminal cells are roughly 1:2 (width:height), so we need to account for that
const CELL_ASPECT_RATIO = 0.5; // width/height of a terminal cell

export interface KittyRendererOptions {
  scale?: number;  // Scale factor for the image (undefined = auto-fit to terminal)
}

export class KittyRenderer {
  private scale: number;
  private imageId: number = 1;
  private frameNumber: number = 0;
  private autoScale: boolean;
  private displayCols: number;
  private displayRows: number;

  constructor(options: KittyRendererOptions = {}) {
    this.autoScale = options.scale === undefined;

    if (this.autoScale) {
      // Calculate display size in terminal cells
      const { cols, rows } = this.calculateOptimalDisplaySize();
      this.displayCols = cols;
      this.displayRows = rows;
      this.scale = 2; // Use 2x for good image quality, Kitty will scale to display size
    } else {
      this.scale = options.scale!;
      // When scale is specified, calculate display cells from pixel size
      // Kitty will use its own cell size, we just need rough estimates for status row
      this.displayCols = 0; // 0 means let Kitty decide
      this.displayRows = 0;
    }
  }

  // Calculate optimal display size in terminal columns/rows
  private calculateOptimalDisplaySize(): { cols: number; rows: number } {
    const termCols = process.stdout.columns || 80;
    const termRows = process.stdout.rows || 24;

    // Leave 2 rows for status line
    const availableRows = termRows - 2;
    const availableCols = termCols;

    // NES was displayed on 4:3 TVs
    // Terminal cells are ~1:2 (half as wide as tall)
    // For 4:3 aspect ratio: visual_width / visual_height = 4/3
    // cols * cell_width / (rows * cell_height) = 4/3
    // Since cell_height ≈ 2 * cell_width:
    // cols / (rows * 2) = 4/3
    // cols = rows * 8/3 ≈ rows * 2.667

    // Try to fill height first
    let displayRows = availableRows;
    let displayCols = Math.floor(displayRows * 8 / 3);

    // If too wide, constrain by width instead
    if (displayCols > availableCols) {
      displayCols = availableCols;
      // cols = rows * 8/3, so rows = cols * 3/8
      displayRows = Math.floor(displayCols * 3 / 8);
    }

    // Ensure minimum size
    displayCols = Math.max(displayCols, 32);
    displayRows = Math.max(displayRows, 15);

    return { cols: displayCols, rows: displayRows };
  }

  // Get current scale (useful for display info)
  getScale(): number {
    return this.scale;
  }

  // Get display dimensions
  getDisplaySize(): { cols: number; rows: number } {
    return { cols: this.displayCols, rows: this.displayRows };
  }

  // Check if auto-scaling is enabled
  isAutoScale(): boolean {
    return this.autoScale;
  }

  // Convert NES frame buffer to RGB data
  private frameToRgb(frameBuffer: Uint8Array): Uint8Array {
    const width = 256;
    const height = 240;
    const scaledWidth = width * this.scale;
    const scaledHeight = height * this.scale;
    const rgb = new Uint8Array(scaledWidth * scaledHeight * 3);

    for (let y = 0; y < scaledHeight; y++) {
      const srcY = Math.floor(y / this.scale);
      for (let x = 0; x < scaledWidth; x++) {
        const srcX = Math.floor(x / this.scale);
        const nesColor = frameBuffer[srcY * width + srcX] & 0x3f;
        const [r, g, b] = nesPalette[nesColor];

        const dstIdx = (y * scaledWidth + x) * 3;
        rgb[dstIdx] = r;
        rgb[dstIdx + 1] = g;
        rgb[dstIdx + 2] = b;
      }
    }

    return rgb;
  }

  // Encode data to base64
  private toBase64(data: Uint8Array): string {
    return Buffer.from(data).toString('base64');
  }

  // Send image using Kitty graphics protocol with chunked transmission
  private sendImage(rgb: Uint8Array, width: number, height: number): string {
    const base64 = this.toBase64(rgb);
    const chunks: string[] = [];

    // Kitty recommends chunks of 4096 bytes
    const chunkSize = 4096;

    // Use alternating image IDs for double-buffering effect
    const currentId = this.imageId + (this.frameNumber % 2);
    const previousId = this.imageId + ((this.frameNumber + 1) % 2);

    for (let i = 0; i < base64.length; i += chunkSize) {
      const chunk = base64.slice(i, i + chunkSize);
      const isFirst = i === 0;
      const isLast = i + chunkSize >= base64.length;

      let control: string;

      if (isFirst) {
        // First chunk: transmit image data
        // a=T: transmit and display
        // f=24: RGB format (24 bits per pixel)
        // s=width, v=height: image dimensions
        // i=id: image ID
        // p=1: placement ID (allows replacing in place)
        // q=2: suppress response
        // C=1: do not move cursor after displaying
        // c=cols, r=rows: display size in terminal cells (for auto-fit)
        // m=1: more chunks follow (0 if last)
        let displayParams = '';
        if (this.autoScale && this.displayCols > 0 && this.displayRows > 0) {
          displayParams = `,c=${this.displayCols},r=${this.displayRows}`;
        }
        control = `a=T,f=24,s=${width},v=${height},i=${currentId},p=1,q=2,C=1${displayParams},m=${isLast ? 0 : 1}`;
      } else {
        // Subsequent chunks: just continuation
        control = `m=${isLast ? 0 : 1}`;
      }

      chunks.push(`${APC}${control};${chunk}${ST}`);
    }

    // Delete previous frame's image after displaying new one
    if (this.frameNumber > 0) {
      chunks.push(`${APC}a=d,d=I,i=${previousId},q=2${ST}`);
    }

    this.frameNumber++;

    return chunks.join('');
  }

  // Render frame buffer to Kitty graphics
  render(frameBuffer: Uint8Array): string {
    const width = 256 * this.scale;
    const height = 240 * this.scale;

    // Convert frame to RGB
    const rgb = this.frameToRgb(frameBuffer);

    // Build output
    let output = '';

    // Move cursor to top-left for image placement
    output += `${ESC}[1;1H`;

    // Send new image
    output += this.sendImage(rgb, width, height);

    return output;
  }

  // Clear screen
  clearScreen(): string {
    // Delete all images and clear screen
    return `${APC}a=d,d=A,q=2${ST}${ESC}[2J${ESC}[H`;
  }

  // Hide cursor
  hideCursor(): string {
    return `${ESC}[?25l`;
  }

  // Show cursor
  showCursor(): string {
    return `${ESC}[?25h`;
  }

  // Get status row (below the image)
  getStatusRow(): number {
    if (this.autoScale && this.displayRows > 0) {
      // When auto-scaling, we know exactly how many rows the image uses
      return this.displayRows + 1;
    }
    // When using pixel-based scaling, estimate rows needed
    // Each terminal row is typically ~20 pixels high (varies by font)
    const imageHeightPixels = 240 * this.scale;
    const approxRowHeight = 20;
    return Math.ceil(imageHeightPixels / approxRowHeight) + 2;
  }

  // Move cursor to status row
  moveCursorToRow(row: number): string {
    return `${ESC}[${row};1H${ESC}[K`;
  }
}
