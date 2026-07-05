/**
 * Native Window Renderer
 *
 * Renders emulator output into ink-native's shared framebuffer instead of the
 * terminal. Bypasses terminal I/O for best performance. The window is owned by
 * the NativeWindowManager (ink-native); this renderer writes pixels and reads
 * keyboard/close events from that shared window.
 */
import { clamp } from 'remeda';
import { packColor, type NativeKeyboardEvent, type Window, type UiRenderer } from 'ink-native';
import { getWindowManager } from '../nativeUi';
import { PostProcessingPipeline, type EffectOptions } from '../postProcessing';
import { buildGammaLUT, rgb15ToRgb24, calculateLuminance8 } from '@/utils/color';
import { logger } from '@/utils/logger';
import {
  DEFAULT_NATIVE_WIDTH,
  DEFAULT_NATIVE_HEIGHT,
  DEFAULT_GAMMA,
  RGB24_BYTES_PER_PIXEL,
  DEFAULT_NATIVE_SCALE,
  MIN_NATIVE_SCALE,
  MAX_NATIVE_SCALE,
} from '..';

export type NativeKeyboardCallback = (key: string, pressed: boolean) => void;

export interface NativeRendererOptions extends EffectOptions {
  scale?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  pixelAspectRatio?: number;
  colorEnabled?: boolean;
  title?: string;
  frameRate?: number;
}

/** Aspect-ratio-correct, centered destination rect within the framebuffer. */
export const computeDestRect = (
  fbWidth: number,
  fbHeight: number,
  targetAspectRatio: number,
): { x: number; y: number; width: number; height: number } => {
  const outputAspect = fbWidth / fbHeight;
  let width: number;
  let height: number;
  if (outputAspect > targetAspectRatio) {
    // Window wider than content — pillarbox (bars on sides)
    height = fbHeight;
    width = Math.round(fbHeight * targetAspectRatio);
  } else {
    // Window taller than content — letterbox (bars top/bottom)
    width = fbWidth;
    height = Math.round(fbWidth / targetAspectRatio);
  }
  const x = Math.round((fbWidth - width) / 2);
  const y = Math.round((fbHeight - height) / 2);
  return { x, y, width, height };
};

/** Normalize an ink-native key name to the legacy (lowercased-letter) form. */
export const normalizeKey = (key: string): string => {
  return key.length === 1 ? key.toLowerCase() : key;
};

export class NativeRenderer {
  readonly isWindowBased = true;

  private window: Window;
  private renderer: UiRenderer;

  private sourceWidth: number;
  private sourceHeight: number;
  private pixelAspectRatio: number;

  private colorEnabled: boolean;
  private title: string;
  private closed = false;

  private targetAspectRatio: number;

  public onKeyboard: NativeKeyboardCallback | null = null;

  private rgbBuffer: Uint8Array;
  private gammaLUT: Uint8Array;
  private postProcessing: PostProcessingPipeline;

  private keydownHandler: (event: NativeKeyboardEvent) => void;
  private keyupHandler: (event: NativeKeyboardEvent) => void;
  private closeHandler: () => void;

  constructor(options: NativeRendererOptions = {}) {
    this.sourceWidth = options.sourceWidth ?? DEFAULT_NATIVE_WIDTH;
    this.sourceHeight = options.sourceHeight ?? DEFAULT_NATIVE_HEIGHT;
    this.pixelAspectRatio = options.pixelAspectRatio ?? 1.0;
    this.colorEnabled = options.colorEnabled ?? true;
    this.title = options.title ?? 'emoemu';

    const rawScale = options.scale ?? DEFAULT_NATIVE_SCALE;
    const scale = clamp(Math.round(rawScale), { min: MIN_NATIVE_SCALE, max: MAX_NATIVE_SCALE });

    this.targetAspectRatio = (this.sourceWidth * this.pixelAspectRatio) / this.sourceHeight;

    const gamma = options.gamma ?? DEFAULT_GAMMA;
    this.gammaLUT = buildGammaLUT(gamma);

    this.postProcessing = new PostProcessingPipeline({
      gamma,
      scanlines: options.scanlines,
      saturation: options.saturation,
      brightness: options.brightness,
      contrast: options.contrast,
      vignette: options.vignette,
      bloom: options.bloom,
      bloomThreshold: options.bloomThreshold,
      ntsc: options.ntsc,
      curvature: options.curvature,
      chromaticAberration: options.chromaticAberration,
    });

    this.rgbBuffer = new Uint8Array(this.sourceWidth * this.sourceHeight * RGB24_BYTES_PER_PIXEL);

    // Attach to the shared native window (create it at game size if not up yet).
    const wm = getWindowManager();
    if (!wm.isInitialized()) {
      const windowWidth = Math.round(this.sourceWidth * scale * this.pixelAspectRatio);
      const windowHeight = this.sourceHeight * scale;
      wm.init({ title: this.title, width: windowWidth, height: windowHeight, frameRate: options.frameRate });
    }
    this.window = wm.getWindow();
    this.renderer = wm.getRenderer();
    wm.setMode('game');

    // Wire input + close from the shared window.
    this.keydownHandler = (event) => {
      this.onKeyboard?.(normalizeKey(event.key), true);
    };
    this.keyupHandler = (event) => {
      this.onKeyboard?.(normalizeKey(event.key), false);
    };
    this.closeHandler = () => {
      this.closed = true;
    };
    this.window.on('keydown', this.keydownHandler);
    this.window.on('keyup', this.keyupHandler);
    this.window.on('close', this.closeHandler);

    logger.info(
      `Native game renderer attached to shared window (source: ${this.sourceWidth}x${this.sourceHeight})`,
      'Native',
    );
  }

  shouldClose(): boolean {
    return this.closed || this.window.isClosed();
  }

  renderRgb15(frameBuffer: Uint16Array): string {
    this.frameToRgbFromRgb15(frameBuffer);
    this.presentFrame();
    return '';
  }

  renderRgb24(frameBuffer: Uint8Array): string {
    this.frameToRgbFromRgb24(frameBuffer);
    this.presentFrame();
    return '';
  }

  private frameToRgbFromRgb15(frameBuffer: Uint16Array): void {
    const dst = this.rgbBuffer;
    const gammaLUT = this.gammaLUT;
    const colorEnabled = this.colorEnabled;
    const width = this.sourceWidth;
    const height = this.sourceHeight;
    for (let y = 0; y < height; y++) {
      const srcRowStart = y * width;
      const dstRowStart = y * width * RGB24_BYTES_PER_PIXEL;
      for (let x = 0; x < width; x++) {
        const color = frameBuffer[srcRowStart + x];
        const [r8, g8, b8] = rgb15ToRgb24(color);
        const r = gammaLUT[r8];
        const g = gammaLUT[g8];
        const b = gammaLUT[b8];
        const dstIdx = dstRowStart + x * RGB24_BYTES_PER_PIXEL;
        if (!colorEnabled) {
          const gray = calculateLuminance8(r, g, b);
          dst[dstIdx] = gray; dst[dstIdx + 1] = gray; dst[dstIdx + 2] = gray;
        } else {
          dst[dstIdx] = r; dst[dstIdx + 1] = g; dst[dstIdx + 2] = b;
        }
      }
    }
  }

  private frameToRgbFromRgb24(frameBuffer: Uint8Array): void {
    const dst = this.rgbBuffer;
    const gammaLUT = this.gammaLUT;
    const colorEnabled = this.colorEnabled;
    const width = this.sourceWidth;
    const height = this.sourceHeight;
    for (let y = 0; y < height; y++) {
      const rowStart = y * width * RGB24_BYTES_PER_PIXEL;
      for (let x = 0; x < width; x++) {
        const srcIdx = rowStart + x * RGB24_BYTES_PER_PIXEL;
        const r = gammaLUT[frameBuffer[srcIdx]];
        const g = gammaLUT[frameBuffer[srcIdx + 1]];
        const b = gammaLUT[frameBuffer[srcIdx + 2]];
        const dstIdx = rowStart + x * RGB24_BYTES_PER_PIXEL;
        if (!colorEnabled) {
          const gray = calculateLuminance8(r, g, b);
          dst[dstIdx] = gray; dst[dstIdx + 1] = gray; dst[dstIdx + 2] = gray;
        } else {
          dst[dstIdx] = r; dst[dstIdx + 1] = g; dst[dstIdx + 2] = b;
        }
      }
    }
  }

  /** Post-process, scale/letterbox into the framebuffer, and present. */
  private presentFrame(): void {
    this.postProcessing.apply(this.rgbBuffer, this.sourceWidth, this.sourceHeight);
    this.blitToFramebuffer();
    this.renderer.present();
  }

  private blitToFramebuffer(): void {
    const fb = this.renderer.getFramebuffer();
    const { pixels, width: fbWidth, height: fbHeight } = fb;

    // Clear whole framebuffer to black (letterbox/pillarbox bars).
    pixels.fill(packColor(0, 0, 0));

    const dest = computeDestRect(fbWidth, fbHeight, this.targetAspectRatio);
    const src = this.rgbBuffer;
    const sw = this.sourceWidth;
    const sh = this.sourceHeight;

    for (let dy = 0; dy < dest.height; dy++) {
      const sy = Math.min(sh - 1, Math.floor((dy * sh) / dest.height));
      const fbRow = (dest.y + dy) * fbWidth + dest.x;
      const srcRow = sy * sw * RGB24_BYTES_PER_PIXEL;
      for (let dx = 0; dx < dest.width; dx++) {
        const sx = Math.min(sw - 1, Math.floor((dx * sw) / dest.width));
        const s = srcRow + sx * RGB24_BYTES_PER_PIXEL;
        pixels[fbRow + dx] = packColor(src[s], src[s + 1], src[s + 2]);
      }
    }
  }

  setTitle(title: string): void {
    // ink-native has no runtime setTitle; retained for interface compatibility.
    this.title = title;
  }

  setDimensions(width: number, height: number): void {
    if (width === this.sourceWidth && height === this.sourceHeight) {
      return;
    }
    this.sourceWidth = width;
    this.sourceHeight = height;
    this.targetAspectRatio = (width * this.pixelAspectRatio) / height;
    this.rgbBuffer = new Uint8Array(width * height * RGB24_BYTES_PER_PIXEL);
    logger.info(`Native renderer source resized to ${width}x${height}`, 'Native');
  }

  // Terminal-specific methods (no-op for native window)
  clearScreen(): string { return ''; }
  hideCursor(): string { return ''; }
  showCursor(): string { return ''; }
  getStatusRow(): number { return 0; }
  moveCursorToRow(_row: number): string { return ''; }

  destroy(): void {
    this.window.off('keydown', this.keydownHandler);
    this.window.off('keyup', this.keyupHandler);
    this.window.off('close', this.closeHandler);
    logger.info('Native game renderer detached from shared window', 'Native');
  }
}
