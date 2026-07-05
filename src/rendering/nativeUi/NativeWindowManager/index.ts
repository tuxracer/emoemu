/**
 * Native Window Manager
 *
 * Singleton that owns the single ink-native window/streams, created once via
 * createStreams() and reused for both Ink UI rendering and game rendering.
 * ink-native owns the window; this manager holds the streams and hands out
 * stdin/stdout (UI) and the framebuffer + pause/resume (game).
 */
import { createStreams, type Streams, type Window, type UiRenderer, type Framebuffer } from 'ink-native';
import { DEFAULT_UI_WIDTH, DEFAULT_UI_HEIGHT } from '..';
import { logger } from '@/utils/logger';
import { NATIVE_WM_LOG_CATEGORY } from '..';

export type NativeWindowManagerErrorCode = 'NOT_INITIALIZED';

export class NativeWindowManagerError extends Error {
  readonly code: NativeWindowManagerErrorCode;
  constructor(code: NativeWindowManagerErrorCode) {
    super(code);
    this.name = 'NativeWindowManagerError';
    this.code = code;
  }
}

export const isNativeWindowManagerError = (error: unknown): error is NativeWindowManagerError => {
  return error instanceof NativeWindowManagerError;
};

/** Window mode */
export type WindowMode = 'ui' | 'game';

/** Window configuration */
export interface WindowConfig {
  title?: string;
  width?: number;
  height?: number;
  /** HiDPI scale factor override (null = auto-detect) */
  scaleFactor?: number | null;
  /** Target frame rate (default: ink-native's 60) */
  frameRate?: number;
}

export class NativeWindowManager {
  private static instance: NativeWindowManager | null = null;

  private streams: Streams | null = null;
  private closed = false;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): NativeWindowManager {
    if (!NativeWindowManager.instance) {
      NativeWindowManager.instance = new NativeWindowManager();
    }
    return NativeWindowManager.instance;
  }

  /** Create the window/streams once. Idempotent. */
  init(config: WindowConfig = {}): void {
    if (this.streams) {
      return;
    }
    const width = config.width ?? DEFAULT_UI_WIDTH;
    const height = config.height ?? DEFAULT_UI_HEIGHT;
    this.streams = createStreams({
      title: config.title ?? 'emoemu',
      width,
      height,
      scaleFactor: config.scaleFactor ?? null,
      frameRate: config.frameRate,
    });
    this.streams.window.on('close', () => {
      this.closed = true;
    });
    logger.info(`Native window manager initialized (${width}x${height})`, NATIVE_WM_LOG_CATEGORY);
  }

  isInitialized(): boolean {
    return this.streams !== null;
  }

  private requireStreams(): Streams {
    if (!this.streams) {
      throw new NativeWindowManagerError('NOT_INITIALIZED');
    }
    return this.streams;
  }

  getStdin(): Streams['stdin'] {
    return this.requireStreams().stdin;
  }

  getStdout(): Streams['stdout'] {
    return this.requireStreams().stdout;
  }

  getWindow(): Window {
    return this.requireStreams().window;
  }

  getRenderer(): UiRenderer {
    return this.requireStreams().renderer;
  }

  getFramebuffer(): Framebuffer {
    return this.requireStreams().renderer.getFramebuffer();
  }

  getDimensions(): { columns: number; rows: number } {
    return this.requireStreams().window.getDimensions();
  }

  isClosed(): boolean {
    if (this.closed) {
      return true;
    }
    return this.streams?.window.isClosed() ?? false;
  }

  /**
   * Switch between UI (Ink) and game (direct framebuffer) rendering.
   * game → pause Ink; ui → reset+clear the renderer and resume Ink.
   */
  setMode(mode: WindowMode): void {
    const streams = this.requireStreams();
    if (mode === 'game') {
      streams.window.pause();
    } else {
      streams.renderer.reset();
      streams.renderer.clear();
      streams.window.resume();
    }
  }

  /** Clear the screen to the background color. */
  clearScreen(): void {
    this.streams?.renderer.clear();
  }

  /** Tear down the window. Call only at final app exit. */
  destroy(): void {
    if (this.streams) {
      // window.close() already stops the event loop, closes the input stream,
      // and destroys the renderer internally — do not also call
      // renderer.destroy() here, as that would double-close the native window.
      this.streams.window.close();
      this.streams = null;
    }
    NativeWindowManager.instance = null;
    logger.info('Native window manager destroyed', NATIVE_WM_LOG_CATEGORY);
  }
}

export const getWindowManager = (): NativeWindowManager => {
  return NativeWindowManager.getInstance();
};
