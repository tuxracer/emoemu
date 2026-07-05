import { clamp } from 'remeda';
import {
  rgb15ToRgb24,
  rgb15ToLuminance,
  rgb15ToEmoji,
  rgb15ToGrayscaleEmoji,
  rgb24ToEmoji,
  rgb24ToGrayscaleEmoji,
  calculateLuminance,
  rgbToAnsi256,
} from '../../utils/color';
import { getTerminalDimensions } from '../../utils/terminal';
import {
  RESET,
  HALF_BLOCK_TOP,
  fgTrueColor,
  bgTrueColor,
  fgAnsi256,
  bgAnsi256,
  moveCursor,
  moveCursorToRow,
  clearScreen,
  hideCursor,
  showCursor,
} from '../shared/ansi';
import type { EffectOptions } from '../postProcessing';
import {
  DEFAULT_SOURCE_WIDTH,
  DEFAULT_SOURCE_HEIGHT,
  DEFAULT_DISPLAY_WIDTH,
  DEFAULT_DISPLAY_HEIGHT,
  STATUS_LINE_ROWS,
  DIFF_GAP_THRESHOLD,
  EMOJI_COLUMN_WIDTH,
  COLOR_CHANNEL_MAX,
  CONTRAST_MIDPOINT,
  GAMMA_LUT_SIZE,
  DEFAULT_GAMMA,
  DEFAULT_SCANLINES,
  DEFAULT_SATURATION,
  DEFAULT_BRIGHTNESS,
  DEFAULT_CONTRAST,
  DEFAULT_VIGNETTE,
  LUMINANCE_R,
  LUMINANCE_G,
  LUMINANCE_B,
  RGB24_BYTES_PER_PIXEL,
  PACK_RED_SHIFT,
  PACK_GREEN_SHIFT,
} from '..';

// RGB24 luminance helper using shared utilities
const rgb24ToLuminance = (r: number, g: number, b: number): number => calculateLuminance(r, g, b);

export interface RendererOptions extends Required<Pick<EffectOptions, 'gamma' | 'scanlines' | 'saturation' | 'brightness' | 'contrast' | 'vignette'>> {
  width: number;
  height: number;
  colorEnabled: boolean;
  trueColorEnabled: boolean;
  asciiMode: boolean;
  emojiMode: boolean;
  sourceWidth: number;   // Source framebuffer width (e.g., 256, 160 for GBC)
  sourceHeight: number;  // Source framebuffer height (e.g., 240, 144 for GBC)
  enableDiffRendering: boolean;  // Enable diff-based rendering optimization (default: true)
}

// ASCII character ramps for different density levels
const ASCII_CHARS_DENSE = ' .\'`^",:;Il!i><~+_-][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const ASCII_CHARS_SIMPLE = ' .-:=+*#%@';

export class TerminalRenderer {
  private width: number;
  private height: number;
  private colorEnabled: boolean;
  private trueColorEnabled: boolean;
  private asciiMode: boolean;
  private emojiMode: boolean;
  private asciiChars: string;
  private offsetCol: number = 0;  // Horizontal offset for centering (0-based for padding)
  private offsetRow: number = 1;  // Vertical offset for centering (1-based for ANSI)
  private sourceWidth: number;   // Source framebuffer width
  private sourceHeight: number;  // Source framebuffer height
  // Pre-computed padding string for centering
  private paddingString: string = '';
  // Diff-based rendering optimization
  private enableDiffRendering: boolean;
  // Diff-based rendering state
  private prevFrameBufferRgb15: Uint16Array | null = null;
  private prevFrameBufferRgb24: Uint8Array | null = null;
  // Previous output grid for character-level diff detection
  // Stores the rendered string for each character position
  private prevOutputGrid: string[][] | null = null;
  private frameNumber: number = 0;
  // Color state tracking for batching (avoid redundant escape codes)
  private currentFg: number = -1;  // Current foreground color (packed RGB or -1 for unset)
  private currentBg: number = -1;  // Current background color (packed RGB or -1 for unset)
  // Post-processing effects
  private gamma: number = 1.0;
  private scanlines: number = 0;
  private saturation: number = 1.0;
  private brightness: number = 1.0;
  private contrast: number = 1.0;
  private vignette: number = 0;
  // Pre-computed lookup tables for effects
  private gammaLUT: Uint8Array | null = null;
  private vignetteMap: Float32Array | null = null;
  // Track if any effects are enabled
  private effectsEnabled: boolean = false;

  constructor(options: Partial<RendererOptions> = {}) {
    this.width = options.width ?? DEFAULT_DISPLAY_WIDTH;
    this.height = options.height ?? DEFAULT_DISPLAY_HEIGHT;
    this.colorEnabled = options.colorEnabled ?? true;
    this.trueColorEnabled = options.trueColorEnabled ?? true;
    this.asciiMode = options.asciiMode ?? false;
    this.emojiMode = options.emojiMode ?? false;
    this.sourceWidth = options.sourceWidth ?? DEFAULT_SOURCE_WIDTH;
    this.sourceHeight = options.sourceHeight ?? DEFAULT_SOURCE_HEIGHT;
    this.enableDiffRendering = options.enableDiffRendering ?? true;
    // Post-processing effects
    this.gamma = options.gamma ?? DEFAULT_GAMMA;
    this.scanlines = options.scanlines ?? DEFAULT_SCANLINES;
    this.saturation = options.saturation ?? DEFAULT_SATURATION;
    this.brightness = options.brightness ?? DEFAULT_BRIGHTNESS;
    this.contrast = options.contrast ?? DEFAULT_CONTRAST;
    this.vignette = options.vignette ?? DEFAULT_VIGNETTE;
    // Use dense character set for better detail in ASCII mode
    this.asciiChars = this.asciiMode ? ASCII_CHARS_DENSE : ASCII_CHARS_SIMPLE;
    // Calculate centering offsets
    this.calculateOffsets();
    // Initialize effect lookup tables
    this.initializeEffects();
  }

  // Calculate centering offsets based on terminal size
  private calculateOffsets(): void {
    const { width: termCols, height: termRows } = getTerminalDimensions();

    // Leave rows for status line
    const availableRows = termRows - STATUS_LINE_ROWS;

    // Horizontal centering (0-based for padding)
    // Emoji mode: each character is EMOJI_COLUMN_WIDTH terminal columns wide
    const displayWidth = this.emojiMode ? this.width * EMOJI_COLUMN_WIDTH : this.width;
    this.offsetCol = Math.max(0, Math.floor((termCols - displayWidth) / 2));

    // Vertical centering (1-based for ANSI escape sequences)
    this.offsetRow = Math.max(1, Math.floor((availableRows - this.height) / 2) + 1);

    // Pre-compute padding string for centering
    this.paddingString = this.offsetCol > 0 ? ' '.repeat(this.offsetCol) : '';

    // Invalidate diff cache when offsets change
    this.invalidateDiffCache();
  }

  // Invalidate the diff cache (called on resize or mode change)
  private invalidateDiffCache(): void {
    this.prevFrameBufferRgb15 = null;
    this.prevFrameBufferRgb24 = null;
    this.prevOutputGrid = null;
    this.frameNumber = 0;
  }

  // Initialize effect lookup tables
  private initializeEffects(): void {
    // Check if any effects are enabled
    this.effectsEnabled = this.gamma !== DEFAULT_GAMMA || this.scanlines > DEFAULT_SCANLINES ||
      this.saturation !== DEFAULT_SATURATION || this.brightness !== DEFAULT_BRIGHTNESS ||
      this.contrast !== DEFAULT_CONTRAST || this.vignette > DEFAULT_VIGNETTE;

    // Build gamma lookup table
    if (this.gamma !== DEFAULT_GAMMA) {
      this.gammaLUT = new Uint8Array(GAMMA_LUT_SIZE);
      for (let i = 0; i < GAMMA_LUT_SIZE; i++) {
        this.gammaLUT[i] = Math.round(Math.pow(i / COLOR_CHANNEL_MAX, this.gamma) * COLOR_CHANNEL_MAX);
      }
    } else {
      this.gammaLUT = null;
    }

    // Build vignette map (based on display dimensions)
    if (this.vignette > DEFAULT_VIGNETTE) {
      // Use source dimensions for vignette calculation
      // Half-block mode uses 2 vertical pixels per character
      const HALF_BLOCK_VERTICAL_SCALE = 2;
      const vignetteWidth = this.width;
      const vignetteHeight = this.asciiMode || this.emojiMode ? this.height : this.height * HALF_BLOCK_VERTICAL_SCALE;
      this.vignetteMap = new Float32Array(vignetteWidth * vignetteHeight);
      const centerX = vignetteWidth / 2;
      const centerY = vignetteHeight / 2;
      const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

      for (let y = 0; y < vignetteHeight; y++) {
        for (let x = 0; x < vignetteWidth; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
          // Smooth falloff using squared distance
          const factor = 1.0 - this.vignette * dist * dist;
          this.vignetteMap[y * vignetteWidth + x] = Math.max(0, factor);
        }
      }
    } else {
      this.vignetteMap = null;
    }
  }

  // Apply all effects to an RGB color
  // charX, charY are in character coordinates; isScanlineRow indicates output-based scanline
  private applyEffects(r: number, g: number, b: number, charX: number, charY: number, isScanlineRow: boolean): [number, number, number] {
    if (!this.effectsEnabled) {
      return [r, g, b];
    }

    // Apply saturation
    if (this.saturation !== DEFAULT_SATURATION) {
      const gray = LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b;
      r = Math.round(gray + this.saturation * (r - gray));
      g = Math.round(gray + this.saturation * (g - gray));
      b = Math.round(gray + this.saturation * (b - gray));
    }

    // Apply brightness
    if (this.brightness !== DEFAULT_BRIGHTNESS) {
      r = Math.round(r * this.brightness);
      g = Math.round(g * this.brightness);
      b = Math.round(b * this.brightness);
    }

    // Apply contrast
    if (this.contrast !== DEFAULT_CONTRAST) {
      r = Math.round((r - CONTRAST_MIDPOINT) * this.contrast + CONTRAST_MIDPOINT);
      g = Math.round((g - CONTRAST_MIDPOINT) * this.contrast + CONTRAST_MIDPOINT);
      b = Math.round((b - CONTRAST_MIDPOINT) * this.contrast + CONTRAST_MIDPOINT);
    }

    // Apply gamma correction
    if (this.gammaLUT) {
      r = this.gammaLUT[clamp(r, { min: 0, max: COLOR_CHANNEL_MAX })];
      g = this.gammaLUT[clamp(g, { min: 0, max: COLOR_CHANNEL_MAX })];
      b = this.gammaLUT[clamp(b, { min: 0, max: COLOR_CHANNEL_MAX })];
    }

    // Apply vignette
    if (this.vignetteMap) {
      const vignetteWidth = this.width;
      const idx = Math.min(charY * vignetteWidth + charX, this.vignetteMap.length - 1);
      const factor = this.vignetteMap[Math.max(0, idx)];
      r = Math.round(r * factor);
      g = Math.round(g * factor);
      b = Math.round(b * factor);
    }

    // Apply scanlines (output-based: consistent spacing regardless of scale)
    if (this.scanlines > DEFAULT_SCANLINES && isScanlineRow) {
      const darkFactor = DEFAULT_BRIGHTNESS - this.scanlines;
      r = Math.round(r * darkFactor);
      g = Math.round(g * darkFactor);
      b = Math.round(b * darkFactor);
    }

    // Clamp values
    return [
      clamp(r, { min: 0, max: COLOR_CHANNEL_MAX }),
      clamp(g, { min: 0, max: COLOR_CHANNEL_MAX }),
      clamp(b, { min: 0, max: COLOR_CHANNEL_MAX })
    ];
  }

  // Reset color state (call at start of frame or after cursor movement)
  private resetColorState(): void {
    this.currentFg = -1;
    this.currentBg = -1;
  }

  // Pack RGB into a single number for comparison
  private packRgb(r: number, g: number, b: number): number {
    return (r << PACK_RED_SHIFT) | (g << PACK_GREEN_SHIFT) | b;
  }

  // Emit foreground color escape sequence only if changed
  private emitFg(r: number, g: number, b: number): string {
    const packed = this.packRgb(r, g, b);
    if (packed === this.currentFg) {return '';}
    this.currentFg = packed;
    return fgTrueColor(r, g, b);
  }

  // Emit background color escape sequence only if changed
  private emitBg(r: number, g: number, b: number): string {
    const packed = this.packRgb(r, g, b);
    if (packed === this.currentBg) {return '';}
    this.currentBg = packed;
    return bgTrueColor(r, g, b);
  }

  // Emit ANSI 256 foreground color only if changed
  private emitFg256(code: number): string {
    if (code === this.currentFg) {return '';}
    this.currentFg = code;
    return fgAnsi256(code);
  }

  // Emit ANSI 256 background color only if changed
  private emitBg256(code: number): string {
    if (code === this.currentBg) {return '';}
    this.currentBg = code;
    return bgAnsi256(code);
  }

  // Simple full-frame render for RGB15 without any diff caching
  // Optimized: tracks color state to avoid redundant escape codes
  private renderFullFrameSimpleRgb15(frameBuffer: Uint16Array, scaleX: number, scaleY: number): string {
    const output: string[] = [];

    for (let charY = 0; charY < this.height; charY++) {
      // Reset color state at start of each line
      this.resetColorState();
      let line = this.paddingString;

      if (this.emojiMode) {
        for (let charX = 0; charX < this.width; charX++) {
          const srcX = Math.floor(charX * scaleX);
          const srcY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[srcY * this.sourceWidth + srcX];
          line += this.colorEnabled ? rgb15ToEmoji(pixel) : rgb15ToGrayscaleEmoji(pixel);
        }
      } else if (this.asciiMode) {
        for (let charX = 0; charX < this.width; charX++) {
          const srcX = Math.floor(charX * scaleX);
          const srcY = Math.floor(charY * scaleY);
          const pixel = frameBuffer[srcY * this.sourceWidth + srcX];
          const lum = rgb15ToLuminance(pixel);
          const char = this.grayscaleChar(lum);
          if (this.colorEnabled) {
            let [r, g, b] = rgb15ToRgb24(pixel);
            [r, g, b] = this.applyEffects(r, g, b, charX, charY, (charY & 1) === 1);
            line += this.emitFg(r, g, b) + char;
          } else {
            line += char;
          }
        }
        if (this.colorEnabled) {line += RESET;}
      } else {
        // Terminal mode: half-block characters with color batching
        for (let charX = 0; charX < this.width; charX++) {
          const srcX = Math.floor(charX * scaleX);
          const srcY1 = Math.floor(charY * 2 * scaleY);
          const srcY2 = Math.floor((charY * 2 + 1) * scaleY);
          const topPixel = frameBuffer[srcY1 * this.sourceWidth + srcX];
          const bottomPixel = frameBuffer[srcY2 * this.sourceWidth + srcX];

          if (this.colorEnabled) {
            if (this.trueColorEnabled) {
              let [r1, g1, b1] = rgb15ToRgb24(topPixel);
              let [r2, g2, b2] = rgb15ToRgb24(bottomPixel);
              [r1, g1, b1] = this.applyEffects(r1, g1, b1, charX, charY, false);
              [r2, g2, b2] = this.applyEffects(r2, g2, b2, charX, charY, true);
              line += this.emitFg(r1, g1, b1);
              line += this.emitBg(r2, g2, b2);
              line += HALF_BLOCK_TOP;
            } else {
              let [r1, g1, b1] = rgb15ToRgb24(topPixel);
              let [r2, g2, b2] = rgb15ToRgb24(bottomPixel);
              [r1, g1, b1] = this.applyEffects(r1, g1, b1, charX, charY, false);
              [r2, g2, b2] = this.applyEffects(r2, g2, b2, charX, charY, true);
              const fg = rgbToAnsi256(r1, g1, b1);
              const bg = rgbToAnsi256(r2, g2, b2);
              line += this.emitFg256(fg) + this.emitBg256(bg) + HALF_BLOCK_TOP;
            }
          } else {
            const lumTop = rgb15ToLuminance(topPixel);
            const lumBottom = rgb15ToLuminance(bottomPixel);
            let grayTop = Math.round(lumTop * COLOR_CHANNEL_MAX);
            let grayBottom = Math.round(lumBottom * COLOR_CHANNEL_MAX);
            [grayTop, , ] = this.applyEffects(grayTop, grayTop, grayTop, charX, charY, false);
            [grayBottom, , ] = this.applyEffects(grayBottom, grayBottom, grayBottom, charX, charY, true);
            line += this.emitFg(grayTop, grayTop, grayTop);
            line += this.emitBg(grayBottom, grayBottom, grayBottom);
            line += HALF_BLOCK_TOP;
          }
        }
        line += RESET;
      }
      output.push(line);
    }

    this.frameNumber++;
    return this.moveCursorHome() + output.join('\n');
  }

  // Render a single character for RGB15 mode
  // Returns the ANSI escape sequence + character for this position
  // Applies the same post-processing effects as the full-frame path
  private renderCharRgb15(frameBuffer: Uint16Array, charX: number, charY: number, scaleX: number, scaleY: number): string {
    const srcX = Math.floor(charX * scaleX);

    if (this.emojiMode) {
      const srcY = Math.floor(charY * scaleY);
      const pixel = frameBuffer[srcY * this.sourceWidth + srcX];
      return this.colorEnabled ? rgb15ToEmoji(pixel) : rgb15ToGrayscaleEmoji(pixel);
    } else if (this.asciiMode) {
      const srcY = Math.floor(charY * scaleY);
      const pixel = frameBuffer[srcY * this.sourceWidth + srcX];
      const lum = rgb15ToLuminance(pixel);
      const char = this.grayscaleChar(lum);

      if (this.colorEnabled) {
        let [r, g, b] = rgb15ToRgb24(pixel);
        [r, g, b] = this.applyEffects(r, g, b, charX, charY, (charY & 1) === 1);
        return fgTrueColor(r, g, b) + char + RESET;
      } else {
        return char;
      }
    } else {
      // Terminal mode: half-block characters
      const srcY1 = Math.floor(charY * 2 * scaleY);
      const srcY2 = Math.floor((charY * 2 + 1) * scaleY);

      const topPixel = frameBuffer[srcY1 * this.sourceWidth + srcX];
      const bottomPixel = frameBuffer[srcY2 * this.sourceWidth + srcX];

      if (this.colorEnabled) {
        let [r1, g1, b1] = rgb15ToRgb24(topPixel);
        let [r2, g2, b2] = rgb15ToRgb24(bottomPixel);
        [r1, g1, b1] = this.applyEffects(r1, g1, b1, charX, charY, false);
        [r2, g2, b2] = this.applyEffects(r2, g2, b2, charX, charY, true);
        if (this.trueColorEnabled) {
          return fgTrueColor(r1, g1, b1) + bgTrueColor(r2, g2, b2) + HALF_BLOCK_TOP + RESET;
        } else {
          const fg = rgbToAnsi256(r1, g1, b1);
          const bg = rgbToAnsi256(r2, g2, b2);
          return fgAnsi256(fg) + bgAnsi256(bg) + HALF_BLOCK_TOP + RESET;
        }
      } else {
        // Grayscale mode: use half-blocks with grayscale ANSI colors
        const lumTop = rgb15ToLuminance(topPixel);
        const lumBottom = rgb15ToLuminance(bottomPixel);
        let grayTop = Math.round(lumTop * COLOR_CHANNEL_MAX);
        let grayBottom = Math.round(lumBottom * COLOR_CHANNEL_MAX);
        [grayTop, , ] = this.applyEffects(grayTop, grayTop, grayTop, charX, charY, false);
        [grayBottom, , ] = this.applyEffects(grayBottom, grayBottom, grayBottom, charX, charY, true);
        return fgTrueColor(grayTop, grayTop, grayTop) + bgTrueColor(grayBottom, grayBottom, grayBottom) + HALF_BLOCK_TOP + RESET;
      }
    }
  }

  // Check if source pixels for a character position have changed (RGB15 version)
  private hasPixelChangedRgb15(
    frameBuffer: Uint16Array,
    prevFrameBuffer: Uint16Array,
    charX: number,
    charY: number,
    scaleX: number,
    scaleY: number
  ): boolean {
    const srcX = Math.floor(charX * scaleX);

    if (this.asciiMode || this.emojiMode) {
      const srcY = Math.floor(charY * scaleY);
      const idx = srcY * this.sourceWidth + srcX;
      return frameBuffer[idx] !== prevFrameBuffer[idx];
    } else {
      const srcY1 = Math.floor(charY * 2 * scaleY);
      const srcY2 = Math.floor((charY * 2 + 1) * scaleY);
      const idx1 = srcY1 * this.sourceWidth + srcX;
      const idx2 = srcY2 * this.sourceWidth + srcX;
      return frameBuffer[idx1] !== prevFrameBuffer[idx1] ||
             frameBuffer[idx2] !== prevFrameBuffer[idx2];
    }
  }

  // Render full frame without diff optimization for RGB15 (used for first frame or when >50% changed)
  // Uses color batching for output, but still updates grid for future diff comparisons
  private renderFullFrameRgb15(frameBuffer: Uint16Array, scaleX: number, scaleY: number): string {
    const outputGrid = this.prevOutputGrid!;

    // Update all characters in output grid (needed for future diff comparisons)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        outputGrid[y][x] = this.renderCharRgb15(frameBuffer, x, y, scaleX, scaleY);
      }
    }

    // Update previous frame buffer
    this.prevFrameBufferRgb15!.set(frameBuffer);

    // Render with color batching (more efficient than joining grid entries)
    const result = this.renderFullFrameSimpleRgb15(frameBuffer, scaleX, scaleY);

    // renderFullFrameSimpleRgb15 increments frameNumber, so don't double-increment
    return result;
  }

  // Render RGB15 frame buffer (for GBC and other RGB15 cores) with diff-based optimization
  renderRgb15(frameBuffer: Uint16Array): string {
    const scaleX = this.sourceWidth / this.width;
    const scaleY = (this.asciiMode || this.emojiMode)
      ? this.sourceHeight / this.height
      : this.sourceHeight / (this.height * 2);

    // If diff rendering is disabled, always render the full frame
    if (!this.enableDiffRendering) {
      return this.renderFullFrameSimpleRgb15(frameBuffer, scaleX, scaleY);
    }

    // Check if frame buffer size changed (can happen with SNES resolution changes)
    if (this.prevFrameBufferRgb15 !== null && frameBuffer.length !== this.prevFrameBufferRgb15.length) {
      this.prevFrameBufferRgb15 = new Uint16Array(frameBuffer.length);
    }

    // First frame or after cache invalidation: render everything
    const isFirstFrame = this.prevFrameBufferRgb15 === null || this.prevOutputGrid === null;

    if (isFirstFrame) {
      // Initialize previous frame buffer
      this.prevFrameBufferRgb15 = new Uint16Array(frameBuffer.length);
      this.prevFrameBufferRgb15.set(frameBuffer);

      // Initialize output grid (needed for future diff comparisons)
      this.prevOutputGrid = [];
      for (let y = 0; y < this.height; y++) {
        this.prevOutputGrid[y] = [];
        for (let x = 0; x < this.width; x++) {
          this.prevOutputGrid[y][x] = this.renderCharRgb15(frameBuffer, x, y, scaleX, scaleY);
        }
      }

      // Render with color batching (renderFullFrameSimpleRgb15 increments frameNumber)
      return this.renderFullFrameSimpleRgb15(frameBuffer, scaleX, scaleY);
    }

    // These are guaranteed non-null after the isFirstFrame check above
    const prevFrame = this.prevFrameBufferRgb15!;
    const outputGrid = this.prevOutputGrid!;

    // Count changed characters to decide whether to use diff or full render
    const totalChars = this.width * this.height;
    let changedCount = 0;

    for (let charY = 0; charY < this.height && changedCount <= totalChars / 2; charY++) {
      for (let charX = 0; charX < this.width && changedCount <= totalChars / 2; charX++) {
        if (this.hasPixelChangedRgb15(frameBuffer, prevFrame, charX, charY, scaleX, scaleY)) {
          changedCount++;
        }
      }
    }

    // If more than 50% changed, use full frame render (more efficient)
    if (changedCount > totalChars / 2) {
      return this.renderFullFrameRgb15(frameBuffer, scaleX, scaleY);
    }

    // Diff-based rendering: only output changed characters
    const output: string[] = [];

    // Column width in terminal cells (emoji is EMOJI_COLUMN_WIDTH columns wide)
    const colWidth = this.emojiMode ? EMOJI_COLUMN_WIDTH : 1;

    for (let charY = 0; charY < this.height; charY++) {
      // Find runs of changed characters on this line
      let runStart = -1;
      let runChars: string[] = [];

      for (let charX = 0; charX < this.width; charX++) {
        const changed = this.hasPixelChangedRgb15(frameBuffer, prevFrame, charX, charY, scaleX, scaleY);

        if (changed) {
          // Render the new character
          const charStr = this.renderCharRgb15(frameBuffer, charX, charY, scaleX, scaleY);
          outputGrid[charY][charX] = charStr;

          if (runStart === -1) {
            runStart = charX;
          }
          runChars.push(charStr);
        } else if (runStart !== -1) {
          // End of a run - check if we should continue or output
          const gapEnd = Math.min(charX + DIFF_GAP_THRESHOLD, this.width);
          let nextChanged = -1;
          for (let i = charX; i < gapEnd; i++) {
            if (this.hasPixelChangedRgb15(frameBuffer, prevFrame, i, charY, scaleX, scaleY)) {
              nextChanged = i;
              break;
            }
          }

          if (nextChanged !== -1) {
            // Small gap - include unchanged chars to avoid cursor movement
            for (let i = charX; i < nextChanged; i++) {
              runChars.push(outputGrid[charY][i]);
            }
            // Skip past the gap - loop will increment to nextChanged
            charX = nextChanged - 1;
          } else {
            // Large gap or end of line - output the run
            const row = this.offsetRow + charY;
            const col = this.offsetCol + runStart * colWidth + 1;
            output.push(moveCursor(row, col) + runChars.join(''));
            runStart = -1;
            runChars = [];
          }
        }
      }

      // Output any remaining run at end of line
      if (runStart !== -1) {
        const row = this.offsetRow + charY;
        const col = this.offsetCol + runStart * colWidth + 1;
        output.push(moveCursor(row, col) + runChars.join(''));
      }
    }

    // Update previous frame buffer
    prevFrame.set(frameBuffer);
    this.frameNumber++;

    // If nothing changed, return empty string
    if (output.length === 0) {
      return '';
    }

    return output.join('');
  }

  // Simple full-frame render for RGB24 without any diff caching
  // Optimized: tracks color state to avoid redundant escape codes
  private renderFullFrameSimpleRgb24(frameBuffer: Uint8Array, scaleX: number, scaleY: number): string {
    const output: string[] = [];

    for (let charY = 0; charY < this.height; charY++) {
      // Reset color state at start of each line
      this.resetColorState();
      let line = this.paddingString;

      if (this.emojiMode) {
        for (let charX = 0; charX < this.width; charX++) {
          const srcX = Math.floor(charX * scaleX);
          const srcY = Math.floor(charY * scaleY);
          const idx = (srcY * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
          const r = frameBuffer[idx];
          const g = frameBuffer[idx + 1];
          const b = frameBuffer[idx + 2];
          line += this.colorEnabled ? rgb24ToEmoji(r, g, b) : rgb24ToGrayscaleEmoji(r, g, b);
        }
      } else if (this.asciiMode) {
        for (let charX = 0; charX < this.width; charX++) {
          const srcX = Math.floor(charX * scaleX);
          const srcY = Math.floor(charY * scaleY);
          const idx = (srcY * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
          let r = frameBuffer[idx];
          let g = frameBuffer[idx + 1];
          let b = frameBuffer[idx + 2];
          const lum = rgb24ToLuminance(r, g, b);
          const char = this.grayscaleChar(lum);
          if (this.colorEnabled) {
            [r, g, b] = this.applyEffects(r, g, b, charX, charY, (charY & 1) === 1);
            line += this.emitFg(r, g, b) + char;
          } else {
            line += char;
          }
        }
        if (this.colorEnabled) {line += RESET;}
      } else {
        // Terminal mode: half-block characters with color batching
        for (let charX = 0; charX < this.width; charX++) {
          const srcX = Math.floor(charX * scaleX);
          const srcY1 = Math.floor(charY * 2 * scaleY);
          const srcY2 = Math.floor((charY * 2 + 1) * scaleY);
          const idx1 = (srcY1 * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
          const idx2 = (srcY2 * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
          let r1 = frameBuffer[idx1];
          let g1 = frameBuffer[idx1 + 1];
          let b1 = frameBuffer[idx1 + 2];
          let r2 = frameBuffer[idx2];
          let g2 = frameBuffer[idx2 + 1];
          let b2 = frameBuffer[idx2 + 2];

          if (this.colorEnabled) {
            if (this.trueColorEnabled) {
              [r1, g1, b1] = this.applyEffects(r1, g1, b1, charX, charY, false);
              [r2, g2, b2] = this.applyEffects(r2, g2, b2, charX, charY, true);
              line += this.emitFg(r1, g1, b1);
              line += this.emitBg(r2, g2, b2);
              line += HALF_BLOCK_TOP;
            } else {
              [r1, g1, b1] = this.applyEffects(r1, g1, b1, charX, charY, false);
              [r2, g2, b2] = this.applyEffects(r2, g2, b2, charX, charY, true);
              const fg = rgbToAnsi256(r1, g1, b1);
              const bg = rgbToAnsi256(r2, g2, b2);
              line += this.emitFg256(fg) + this.emitBg256(bg) + HALF_BLOCK_TOP;
            }
          } else {
            const lum1 = rgb24ToLuminance(r1, g1, b1);
            const lum2 = rgb24ToLuminance(r2, g2, b2);
            let grayTop = Math.round(lum1 * COLOR_CHANNEL_MAX);
            let grayBottom = Math.round(lum2 * COLOR_CHANNEL_MAX);
            [grayTop, , ] = this.applyEffects(grayTop, grayTop, grayTop, charX, charY, false);
            [grayBottom, , ] = this.applyEffects(grayBottom, grayBottom, grayBottom, charX, charY, true);
            line += this.emitFg(grayTop, grayTop, grayTop);
            line += this.emitBg(grayBottom, grayBottom, grayBottom);
            line += HALF_BLOCK_TOP;
          }
        }
        line += RESET;
      }
      output.push(line);
    }

    this.frameNumber++;
    return this.moveCursorHome() + output.join('\n');
  }

  // Render a single character for RGB24 mode
  // Returns the ANSI escape sequence + character for this position
  // Applies the same post-processing effects as the full-frame path
  private renderCharRgb24(frameBuffer: Uint8Array, charX: number, charY: number, scaleX: number, scaleY: number): string {
    const srcX = Math.floor(charX * scaleX);

    if (this.emojiMode) {
      const srcY = Math.floor(charY * scaleY);
      const idx = (srcY * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
      const r = frameBuffer[idx];
      const g = frameBuffer[idx + 1];
      const b = frameBuffer[idx + 2];
      return this.colorEnabled ? rgb24ToEmoji(r, g, b) : rgb24ToGrayscaleEmoji(r, g, b);
    } else if (this.asciiMode) {
      const srcY = Math.floor(charY * scaleY);
      const idx = (srcY * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
      let r = frameBuffer[idx];
      let g = frameBuffer[idx + 1];
      let b = frameBuffer[idx + 2];
      const lum = rgb24ToLuminance(r, g, b);
      const char = this.grayscaleChar(lum);

      if (this.colorEnabled) {
        [r, g, b] = this.applyEffects(r, g, b, charX, charY, (charY & 1) === 1);
        return fgTrueColor(r, g, b) + char + RESET;
      } else {
        return char;
      }
    } else {
      // Terminal mode: half-block characters
      const srcY1 = Math.floor(charY * 2 * scaleY);
      const srcY2 = Math.floor((charY * 2 + 1) * scaleY);
      const idx1 = (srcY1 * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
      const idx2 = (srcY2 * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
      let r1 = frameBuffer[idx1];
      let g1 = frameBuffer[idx1 + 1];
      let b1 = frameBuffer[idx1 + 2];
      let r2 = frameBuffer[idx2];
      let g2 = frameBuffer[idx2 + 1];
      let b2 = frameBuffer[idx2 + 2];

      if (this.colorEnabled) {
        [r1, g1, b1] = this.applyEffects(r1, g1, b1, charX, charY, false);
        [r2, g2, b2] = this.applyEffects(r2, g2, b2, charX, charY, true);
        if (this.trueColorEnabled) {
          return fgTrueColor(r1, g1, b1) + bgTrueColor(r2, g2, b2) + HALF_BLOCK_TOP + RESET;
        } else {
          const fg = rgbToAnsi256(r1, g1, b1);
          const bg = rgbToAnsi256(r2, g2, b2);
          return fgAnsi256(fg) + bgAnsi256(bg) + HALF_BLOCK_TOP + RESET;
        }
      } else {
        // Grayscale mode: use half-blocks with grayscale ANSI colors
        const lum1 = rgb24ToLuminance(r1, g1, b1);
        const lum2 = rgb24ToLuminance(r2, g2, b2);
        let grayTop = Math.round(lum1 * COLOR_CHANNEL_MAX);
        let grayBottom = Math.round(lum2 * COLOR_CHANNEL_MAX);
        [grayTop, , ] = this.applyEffects(grayTop, grayTop, grayTop, charX, charY, false);
        [grayBottom, , ] = this.applyEffects(grayBottom, grayBottom, grayBottom, charX, charY, true);
        return fgTrueColor(grayTop, grayTop, grayTop) + bgTrueColor(grayBottom, grayBottom, grayBottom) + HALF_BLOCK_TOP + RESET;
      }
    }
  }

  // Check if source pixels for a character position have changed (RGB24 version)
  private hasPixelChangedRgb24(
    frameBuffer: Uint8Array,
    prevFrameBuffer: Uint8Array,
    charX: number,
    charY: number,
    scaleX: number,
    scaleY: number
  ): boolean {
    const srcX = Math.floor(charX * scaleX);

    if (this.asciiMode || this.emojiMode) {
      const srcY = Math.floor(charY * scaleY);
      const idx = (srcY * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
      return frameBuffer[idx] !== prevFrameBuffer[idx] ||
             frameBuffer[idx + 1] !== prevFrameBuffer[idx + 1] ||
             frameBuffer[idx + 2] !== prevFrameBuffer[idx + 2];
    } else {
      const srcY1 = Math.floor(charY * 2 * scaleY);
      const srcY2 = Math.floor((charY * 2 + 1) * scaleY);
      const idx1 = (srcY1 * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
      const idx2 = (srcY2 * this.sourceWidth + srcX) * RGB24_BYTES_PER_PIXEL;
      return frameBuffer[idx1] !== prevFrameBuffer[idx1] ||
             frameBuffer[idx1 + 1] !== prevFrameBuffer[idx1 + 1] ||
             frameBuffer[idx1 + 2] !== prevFrameBuffer[idx1 + 2] ||
             frameBuffer[idx2] !== prevFrameBuffer[idx2] ||
             frameBuffer[idx2 + 1] !== prevFrameBuffer[idx2 + 1] ||
             frameBuffer[idx2 + 2] !== prevFrameBuffer[idx2 + 2];
    }
  }

  // Render full frame without diff optimization for RGB24 (used for first frame or when >50% changed)
  // Uses color batching for output, but still updates grid for future diff comparisons
  private renderFullFrameRgb24(frameBuffer: Uint8Array, scaleX: number, scaleY: number): string {
    const outputGrid = this.prevOutputGrid!;

    // Update all characters in output grid (needed for future diff comparisons)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        outputGrid[y][x] = this.renderCharRgb24(frameBuffer, x, y, scaleX, scaleY);
      }
    }

    // Update previous frame buffer
    this.prevFrameBufferRgb24!.set(frameBuffer);

    // Render with color batching (renderFullFrameSimpleRgb24 increments frameNumber)
    return this.renderFullFrameSimpleRgb24(frameBuffer, scaleX, scaleY);
  }

  // Render RGB24 frame buffer (for libretro and other RGB24 cores) with diff-based optimization
  renderRgb24(frameBuffer: Uint8Array): string {
    const scaleX = this.sourceWidth / this.width;
    const scaleY = (this.asciiMode || this.emojiMode)
      ? this.sourceHeight / this.height
      : this.sourceHeight / (this.height * 2);

    // If diff rendering is disabled, always render the full frame
    if (!this.enableDiffRendering) {
      return this.renderFullFrameSimpleRgb24(frameBuffer, scaleX, scaleY);
    }

    // Check if frame buffer size changed (can happen with mid-game resolution changes)
    if (this.prevFrameBufferRgb24 !== null && frameBuffer.length !== this.prevFrameBufferRgb24.length) {
      this.prevFrameBufferRgb24 = new Uint8Array(frameBuffer.length);
    }

    // First frame or after cache invalidation: render everything
    const isFirstFrame = this.prevFrameBufferRgb24 === null || this.prevOutputGrid === null;

    if (isFirstFrame) {
      // Initialize previous frame buffer
      this.prevFrameBufferRgb24 = new Uint8Array(frameBuffer.length);
      this.prevFrameBufferRgb24.set(frameBuffer);

      // Initialize output grid (needed for future diff comparisons)
      this.prevOutputGrid = [];
      for (let y = 0; y < this.height; y++) {
        this.prevOutputGrid[y] = [];
        for (let x = 0; x < this.width; x++) {
          this.prevOutputGrid[y][x] = this.renderCharRgb24(frameBuffer, x, y, scaleX, scaleY);
        }
      }

      // Render with color batching (renderFullFrameSimpleRgb24 increments frameNumber)
      return this.renderFullFrameSimpleRgb24(frameBuffer, scaleX, scaleY);
    }

    // These are guaranteed non-null after the isFirstFrame check above
    const prevFrame = this.prevFrameBufferRgb24!;
    const outputGrid = this.prevOutputGrid!;

    // Count changed characters to decide whether to use diff or full render
    const totalChars = this.width * this.height;
    let changedCount = 0;

    for (let charY = 0; charY < this.height && changedCount <= totalChars / 2; charY++) {
      for (let charX = 0; charX < this.width && changedCount <= totalChars / 2; charX++) {
        if (this.hasPixelChangedRgb24(frameBuffer, prevFrame, charX, charY, scaleX, scaleY)) {
          changedCount++;
        }
      }
    }

    // If more than 50% changed, use full frame render (more efficient)
    if (changedCount > totalChars / 2) {
      return this.renderFullFrameRgb24(frameBuffer, scaleX, scaleY);
    }

    // Diff-based rendering: only output changed characters
    const output: string[] = [];

    // Column width in terminal cells (emoji is EMOJI_COLUMN_WIDTH columns wide)
    const colWidth = this.emojiMode ? EMOJI_COLUMN_WIDTH : 1;

    for (let charY = 0; charY < this.height; charY++) {
      // Find runs of changed characters on this line
      let runStart = -1;
      let runChars: string[] = [];

      for (let charX = 0; charX < this.width; charX++) {
        const changed = this.hasPixelChangedRgb24(frameBuffer, prevFrame, charX, charY, scaleX, scaleY);

        if (changed) {
          // Render the new character
          const charStr = this.renderCharRgb24(frameBuffer, charX, charY, scaleX, scaleY);
          outputGrid[charY][charX] = charStr;

          if (runStart === -1) {
            runStart = charX;
          }
          runChars.push(charStr);
        } else if (runStart !== -1) {
          // End of a run - check if we should continue or output
          const gapEnd = Math.min(charX + DIFF_GAP_THRESHOLD, this.width);
          let nextChanged = -1;
          for (let i = charX; i < gapEnd; i++) {
            if (this.hasPixelChangedRgb24(frameBuffer, prevFrame, i, charY, scaleX, scaleY)) {
              nextChanged = i;
              break;
            }
          }

          if (nextChanged !== -1) {
            // Small gap - include unchanged chars to avoid cursor movement
            for (let i = charX; i < nextChanged; i++) {
              runChars.push(outputGrid[charY][i]);
            }
            // Skip past the gap - loop will increment to nextChanged
            charX = nextChanged - 1;
          } else {
            // Large gap or end of line - output the run
            const row = this.offsetRow + charY;
            const col = this.offsetCol + runStart * colWidth + 1;
            output.push(moveCursor(row, col) + runChars.join(''));
            runStart = -1;
            runChars = [];
          }
        }
      }

      // Output any remaining run at end of line
      if (runStart !== -1) {
        const row = this.offsetRow + charY;
        const col = this.offsetCol + runStart * colWidth + 1;
        output.push(moveCursor(row, col) + runChars.join(''));
      }
    }

    // Update previous frame buffer
    prevFrame.set(frameBuffer);
    this.frameNumber++;

    // If nothing changed, return empty string
    if (output.length === 0) {
      return '';
    }

    return output.join('');
  }

  // Convert luminance to ASCII character
  private grayscaleChar(luminance: number): string {
    const index = Math.floor(luminance * (this.asciiChars.length - 1));
    return this.asciiChars[Math.min(index, this.asciiChars.length - 1)];
  }

  // Get ANSI escape sequence to move cursor to centered start position
  moveCursorHome(): string {
    return moveCursor(this.offsetRow, 1);
  }

  // Clear screen
  clearScreen(): string {
    return clearScreen();
  }

  // Hide cursor
  hideCursor(): string {
    return hideCursor();
  }

  // Show cursor
  showCursor(): string {
    return showCursor();
  }

  // Get the row number for the status line (below the rendered frame)
  getStatusRow(): number {
    return this.offsetRow + this.height;
  }

  // Move cursor to a specific row
  moveCursorToRow(row: number): string {
    return moveCursorToRow(row);
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
