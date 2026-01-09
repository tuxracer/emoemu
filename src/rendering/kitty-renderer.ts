import { nesPaletteFlat } from './palette.js';
import { deflateSync } from 'zlib';

// Kitty graphics protocol renderer
// https://sw.kovidgoyal.net/kitty/graphics-protocol/

const ESC = '\x1b';
const APC = `${ESC}_G`;  // Application Program Command for graphics
const ST = `${ESC}\\`;   // String Terminator

// NES native resolution
const NES_WIDTH = 256;
const NES_HEIGHT = 240;

// PNG constants
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Pre-computed CRC32 table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crcData = Buffer.alloc(4 + data.length);
  crcData.write(type, 0, 4, 'ascii');
  data.copy(crcData, 4);
  chunk.writeUInt32BE(crc32(crcData), 8 + data.length);
  return chunk;
}

// Default to NES native resolution 256x240 with 8:7 pixel aspect ratio (PAR)
// Display aspect ratio ≈ 1.219:1 when PAR-corrected

export interface KittyRendererOptions {
  scale?: number;  // Scale factor for the image (undefined = auto-fit to terminal)
  sourceWidth?: number;   // Source framebuffer width (default: 256)
  sourceHeight?: number;  // Source framebuffer height (default: 240)
  colorSpace?: 'indexed' | 'rgb15';  // Color format (default: indexed/NES palette)
}

// Typical terminal cell pixel dimensions (width x height)
// Most terminals use fonts that result in cells roughly twice as tall as wide
const CELL_WIDTH_PX = 9;
const CELL_HEIGHT_PX = 18;

export class KittyRenderer {
  private integerScale: number;  // Integer scale factor (1, 2, 3, etc.)
  private imageId: number = 1;
  private frameNumber: number = 0;
  private autoScale: boolean;
  private displayCols: number;
  private displayRows: number;
  private offsetCol: number = 1;  // Horizontal offset for centering
  private offsetRow: number = 1;  // Vertical offset for centering
  // Source framebuffer dimensions
  private sourceWidth: number;
  private sourceHeight: number;
  // Scaled image dimensions in pixels (integer multiple of source resolution)
  private scaledWidth: number;
  private scaledHeight: number;
  // Pre-allocated RGB buffer for scaled output
  private scaledRgbBuffer!: Uint8Array;
  // Pre-allocated row buffer for horizontal scaling
  private scaledRowBuffer!: Uint8Array;
  // Previous frame buffer for row-level memoization (skip unchanged rows)
  // For indexed: Uint8Array (1 byte per pixel)
  // For rgb15: Uint16Array (2 bytes per pixel)
  private prevFrameBuffer: Uint8Array | Uint16Array;
  // Cached PNG data from last encode
  private pngBuffer: Buffer = Buffer.alloc(0);
  // Color space for framebuffer interpretation
  private colorSpace: 'indexed' | 'rgb15';

  constructor(options: KittyRendererOptions = {}) {
    this.sourceWidth = options.sourceWidth ?? NES_WIDTH;
    this.sourceHeight = options.sourceHeight ?? NES_HEIGHT;
    this.colorSpace = options.colorSpace ?? 'indexed';
    // Allocate prevFrameBuffer based on color space
    const pixelCount = this.sourceWidth * this.sourceHeight;
    this.prevFrameBuffer = this.colorSpace === 'rgb15'
      ? new Uint16Array(pixelCount)
      : new Uint8Array(pixelCount);
    this.autoScale = options.scale === undefined;

    if (this.autoScale) {
      // Calculate optimal integer scale that fits terminal
      const { integerScale, cols, rows, offsetCol, offsetRow } = this.calculateOptimalIntegerScale();
      this.integerScale = integerScale;
      this.displayCols = cols;
      this.displayRows = rows;
      this.offsetCol = offsetCol;
      this.offsetRow = offsetRow;
      this.scaledWidth = this.sourceWidth * integerScale;
      this.scaledHeight = this.sourceHeight * integerScale;
    } else {
      this.integerScale = Math.max(1, Math.round(options.scale!));
      this.scaledWidth = this.sourceWidth * this.integerScale;
      this.scaledHeight = this.sourceHeight * this.integerScale;
      // Calculate display cells from pixel size
      this.displayCols = Math.ceil(this.scaledWidth / CELL_WIDTH_PX);
      this.displayRows = Math.ceil(this.scaledHeight / CELL_HEIGHT_PX);
      // Calculate centering for fixed scale mode
      this.calculateFixedScaleOffsets();
    }

    // Allocate buffers for integer scaling
    this.scaledRgbBuffer = new Uint8Array(this.scaledWidth * this.scaledHeight * 3);
    this.scaledRowBuffer = new Uint8Array(this.scaledWidth * 3);
  }

  // Calculate centering offsets for fixed scale mode
  private calculateFixedScaleOffsets(): void {
    const termCols = process.stdout.columns || 80;
    const termRows = process.stdout.rows || 24;
    const cols = Math.ceil(this.scaledWidth / CELL_WIDTH_PX);
    const rows = Math.ceil(this.scaledHeight / CELL_HEIGHT_PX);

    this.offsetCol = Math.max(1, Math.floor((termCols - cols) / 2) + 1);
    this.offsetRow = Math.max(1, Math.floor((termRows - 2 - rows) / 2) + 1);
  }

  // Calculate optimal integer scale factor and display size
  // Uses nearest integer scale for crisp pre-scaling, then Kitty handles small final adjustment
  private calculateOptimalIntegerScale(): { integerScale: number; cols: number; rows: number; offsetCol: number; offsetRow: number } {
    const termCols = process.stdout.columns || 80;
    const termRows = process.stdout.rows || 24;

    // Leave 2 rows for status line
    const availableRows = termRows - 2;
    const availableCols = termCols;

    // Calculate display size in cells to fill terminal
    // Formula: cols = rows * (sourceWidth * PAR) / sourceHeight * (cellHeight / cellWidth)
    // For NES (256x240, 8:7 PAR): cols ≈ rows * 2.438
    // For GBC (160x144, 1:1 PAR): cols ≈ rows * 2.222
    let displayRows = availableRows;
    const aspectRatio = (this.sourceWidth * CELL_HEIGHT_PX) / (this.sourceHeight * CELL_WIDTH_PX);
    let displayCols = Math.floor(displayRows * aspectRatio);

    if (displayCols > availableCols) {
      displayCols = availableCols;
      displayRows = Math.floor(displayCols / aspectRatio);
    }

    displayCols = Math.max(displayCols, 32);
    displayRows = Math.max(displayRows, 15);

    // Calculate pixel dimensions for the display area
    const displayWidthPx = displayCols * CELL_WIDTH_PX;
    const displayHeightPx = displayRows * CELL_HEIGHT_PX;

    // Find nearest integer scale (round, not floor) for crisp pre-scaling
    // Kitty will handle the small remaining scale adjustment
    const idealScale = Math.min(displayWidthPx / this.sourceWidth, displayHeightPx / this.sourceHeight);
    const integerScale = Math.max(1, Math.round(idealScale));

    // Calculate centering offsets (1-based for ANSI escape sequences)
    const offsetCol = Math.max(1, Math.floor((termCols - displayCols) / 2) + 1);
    const offsetRow = Math.max(1, Math.floor((availableRows - displayRows) / 2) + 1);

    return { integerScale, cols: displayCols, rows: displayRows, offsetCol, offsetRow };
  }

  // Get current scale (useful for display info)
  getScale(): number {
    return this.integerScale;
  }

  // Get display dimensions
  getDisplaySize(): { cols: number; rows: number } {
    return { cols: this.displayCols, rows: this.displayRows };
  }

  // Check if auto-scaling is enabled
  isAutoScale(): boolean {
    return this.autoScale;
  }

  // Update display dimensions (for terminal resize handling)
  setDimensions(): void {
    if (this.autoScale) {
      const { integerScale, cols, rows, offsetCol, offsetRow } = this.calculateOptimalIntegerScale();
      this.displayCols = cols;
      this.displayRows = rows;
      this.offsetCol = offsetCol;
      this.offsetRow = offsetRow;
      // Recalculate scaled dimensions if scale changed
      const newWidth = this.sourceWidth * integerScale;
      const newHeight = this.sourceHeight * integerScale;
      if (newWidth !== this.scaledWidth || newHeight !== this.scaledHeight) {
        this.integerScale = integerScale;
        this.scaledWidth = newWidth;
        this.scaledHeight = newHeight;
        // Reallocate buffers for new size
        this.scaledRgbBuffer = new Uint8Array(this.scaledWidth * this.scaledHeight * 3);
        this.scaledRowBuffer = new Uint8Array(this.scaledWidth * 3);
      }
    } else {
      this.calculateFixedScaleOffsets();
    }
  }

  // Convert indexed (palette-based) frame buffer to scaled RGB
  // Uses row-level memoization to skip unchanged rows
  private frameToRgbScaledIndexed(frameBuffer: Uint8Array): void {
    const palette = nesPaletteFlat;
    const dst = this.scaledRgbBuffer;
    const scale = this.integerScale;
    const scaledRowBytes = this.scaledWidth * 3;
    const rowBuffer = this.scaledRowBuffer;
    const prevFrame = this.prevFrameBuffer as Uint8Array;

    for (let srcY = 0; srcY < this.sourceHeight; srcY++) {
      const srcRowStart = srcY * this.sourceWidth;

      // Check if this row changed from previous frame
      let rowChanged = false;
      for (let x = 0; x < this.sourceWidth; x++) {
        if (frameBuffer[srcRowStart + x] !== prevFrame[srcRowStart + x]) {
          rowChanged = true;
          break;
        }
      }

      // Skip scaling if row unchanged (scaled buffer already has correct data)
      if (!rowChanged) continue;

      // Scale one source row horizontally into rowBuffer
      let rowIdx = 0;
      for (let srcX = 0; srcX < this.sourceWidth; srcX++) {
        const paletteIdx = (frameBuffer[srcRowStart + srcX] & 0x3f) * 3;
        const r = palette[paletteIdx];
        const g = palette[paletteIdx + 1];
        const b = palette[paletteIdx + 2];

        // Write pixel 'scale' times horizontally
        for (let sx = 0; sx < scale; sx++) {
          rowBuffer[rowIdx] = r;
          rowBuffer[rowIdx + 1] = g;
          rowBuffer[rowIdx + 2] = b;
          rowIdx += 3;
        }
      }

      // Copy the scaled row 'scale' times vertically using TypedArray.set()
      const dstRowStart = srcY * scale * scaledRowBytes;
      for (let sy = 0; sy < scale; sy++) {
        dst.set(rowBuffer, dstRowStart + sy * scaledRowBytes);
      }
    }

    // Store current frame for next comparison
    prevFrame.set(frameBuffer);
  }

  // Convert RGB15 frame buffer to scaled RGB24
  // RGB15 format: XBBBBBGGGGGRRRRR (5 bits per channel, X is unused)
  private frameToRgbScaledRgb15(frameBuffer: Uint16Array): void {
    const dst = this.scaledRgbBuffer;
    const scale = this.integerScale;
    const scaledRowBytes = this.scaledWidth * 3;
    const rowBuffer = this.scaledRowBuffer;
    const prevFrame = this.prevFrameBuffer as Uint16Array;

    for (let srcY = 0; srcY < this.sourceHeight; srcY++) {
      const srcRowStart = srcY * this.sourceWidth;

      // Check if this row changed from previous frame
      let rowChanged = false;
      for (let x = 0; x < this.sourceWidth; x++) {
        if (frameBuffer[srcRowStart + x] !== prevFrame[srcRowStart + x]) {
          rowChanged = true;
          break;
        }
      }

      // Skip scaling if row unchanged
      if (!rowChanged) continue;

      // Scale one source row horizontally into rowBuffer
      let rowIdx = 0;
      for (let srcX = 0; srcX < this.sourceWidth; srcX++) {
        const color = frameBuffer[srcRowStart + srcX];
        // Extract RGB15 components (5 bits each) and expand to 8 bits
        const r = ((color & 0x001F) << 3) | ((color & 0x001F) >> 2);
        const g = (((color >> 5) & 0x1F) << 3) | (((color >> 5) & 0x1F) >> 2);
        const b = (((color >> 10) & 0x1F) << 3) | (((color >> 10) & 0x1F) >> 2);

        // Write pixel 'scale' times horizontally
        for (let sx = 0; sx < scale; sx++) {
          rowBuffer[rowIdx] = r;
          rowBuffer[rowIdx + 1] = g;
          rowBuffer[rowIdx + 2] = b;
          rowIdx += 3;
        }
      }

      // Copy the scaled row 'scale' times vertically
      const dstRowStart = srcY * scale * scaledRowBytes;
      for (let sy = 0; sy < scale; sy++) {
        dst.set(rowBuffer, dstRowStart + sy * scaledRowBytes);
      }
    }

    // Store current frame for next comparison
    prevFrame.set(frameBuffer);
  }

  // Encode scaled RGB buffer to PNG format
  private encodePng(): void {
    const width = this.scaledWidth;
    const height = this.scaledHeight;
    const rgbData = this.scaledRgbBuffer;
    const rowBytes = width * 3;

    // Build raw image data with filter bytes
    // Each row: 1 filter byte (0x00 = none) + RGB data
    const rawDataSize = height * (1 + rowBytes);
    const rawData = Buffer.alloc(rawDataSize);

    for (let y = 0; y < height; y++) {
      const rawRowStart = y * (1 + rowBytes);
      rawData[rawRowStart] = 0; // Filter type: none
      // Copy RGB row
      const srcStart = y * rowBytes;
      for (let i = 0; i < rowBytes; i++) {
        rawData[rawRowStart + 1 + i] = rgbData[srcStart + i];
      }
    }

    // Compress with deflate (fast compression for real-time)
    const compressed = deflateSync(rawData, { level: 1 });

    // Build PNG
    // IHDR chunk
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // color type: RGB
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const ihdrChunk = createPngChunk('IHDR', ihdr);
    const idatChunk = createPngChunk('IDAT', compressed);
    const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

    // Combine all chunks
    this.pngBuffer = Buffer.concat([PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk]);
  }

  // Send image using Kitty graphics protocol with chunked transmission
  private sendImage(): string {
    // Encode to PNG (compressed)
    this.encodePng();
    const base64 = this.pngBuffer.toString('base64');
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
        // f=100: PNG format
        // i=id: image ID
        // p=1: placement ID (allows replacing in place)
        // q=2: suppress response
        // C=1: do not move cursor after displaying
        // c=cols, r=rows: display size in terminal cells
        // m=1: more chunks follow (0 if last)
        const displayParams = `,c=${this.displayCols},r=${this.displayRows}`;
        control = `a=T,f=100,i=${currentId},p=1,q=2,C=1${displayParams},m=${isLast ? 0 : 1}`;
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

  // Check if entire frame is unchanged from previous (for indexed/Uint8Array)
  private isFrameUnchangedIndexed(frameBuffer: Uint8Array): boolean {
    const prev = this.prevFrameBuffer as Uint8Array;
    const len = frameBuffer.length;
    for (let i = 0; i < len; i++) {
      if (frameBuffer[i] !== prev[i]) return false;
    }
    return true;
  }

  // Check if entire frame is unchanged from previous (for rgb15/Uint16Array)
  private isFrameUnchangedRgb15(frameBuffer: Uint16Array): boolean {
    const prev = this.prevFrameBuffer as Uint16Array;
    const len = frameBuffer.length;
    for (let i = 0; i < len; i++) {
      if (frameBuffer[i] !== prev[i]) return false;
    }
    return true;
  }

  // Render indexed (palette-based) frame buffer to Kitty graphics
  render(frameBuffer: Uint8Array): string {
    // Skip entirely if frame unchanged (after first frame)
    if (this.frameNumber > 0 && this.isFrameUnchangedIndexed(frameBuffer)) {
      return '';
    }

    // Convert frame to scaled RGB using nearest-neighbor interpolation
    this.frameToRgbScaledIndexed(frameBuffer);

    // Build output
    let output = '';

    // Move cursor to centered position for image placement
    output += `${ESC}[${this.offsetRow};${this.offsetCol}H`;

    // Send PNG-compressed image
    output += this.sendImage();

    return output;
  }

  // Render RGB15 frame buffer to Kitty graphics
  renderRgb15(frameBuffer: Uint16Array): string {
    // Skip entirely if frame unchanged (after first frame)
    if (this.frameNumber > 0 && this.isFrameUnchangedRgb15(frameBuffer)) {
      return '';
    }

    // Convert RGB15 frame to scaled RGB24
    this.frameToRgbScaledRgb15(frameBuffer);

    // Build output
    let output = '';

    // Move cursor to centered position for image placement
    output += `${ESC}[${this.offsetRow};${this.offsetCol}H`;

    // Send PNG-compressed image
    output += this.sendImage();

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
    // We know exactly how many rows the image uses from displayRows
    // Account for vertical centering offset
    return this.offsetRow + this.displayRows;
  }

  // Move cursor to status row
  moveCursorToRow(row: number): string {
    return `${ESC}[${row};1H${ESC}[K`;
  }
}
