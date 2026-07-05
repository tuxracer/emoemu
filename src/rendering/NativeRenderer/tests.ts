import { describe, it, expect, vi, beforeEach } from 'vitest';
import { packColor } from 'ink-native';

// Mock the shared native window manager so NativeRenderer never touches a
// real window. Fixtures live inside vi.hoisted() because vi.mock calls are
// hoisted above regular top-level const declarations, and importing
// NativeRenderer below pulls in '../nativeUi' before the rest of this file's
// body executes.
const { fakeWindow, fakeRenderer, fakeWindowManager } = vi.hoisted(() => {
  const fakeWindow = {
    on: vi.fn(),
    off: vi.fn(),
    isClosed: vi.fn(() => false),
  };
  const fakeRenderer = {
    getFramebuffer: vi.fn(),
    present: vi.fn(),
  };
  const fakeWindowManager = {
    isInitialized: vi.fn(() => true),
    init: vi.fn(),
    getWindow: vi.fn(() => fakeWindow),
    getRenderer: vi.fn(() => fakeRenderer),
    setMode: vi.fn(),
  };
  return { fakeWindow, fakeRenderer, fakeWindowManager };
});
vi.mock('../nativeUi', () => ({
  getWindowManager: () => fakeWindowManager,
}));

import { NativeRenderer, computeDestRect, normalizeKey } from '.';

const makeFramebuffer = (width: number, height: number): { pixels: Uint32Array; width: number; height: number } => {
  return { pixels: new Uint32Array(width * height), width, height };
};

describe('computeDestRect', () => {
  it('pillarboxes when the window is wider than the content (4:3 into 16:9)', () => {
    // target aspect 4/3 ≈ 1.333; framebuffer 1600x900 (16:9)
    const rect = computeDestRect(1600, 900, 4 / 3);
    expect(rect.height).toBe(900);
    expect(rect.width).toBe(1200); // 900 * 4/3
    expect(rect.x).toBe(200);      // centered: (1600-1200)/2
    expect(rect.y).toBe(0);
  });

  it('letterboxes when the window is taller than the content', () => {
    // target aspect 4/3; framebuffer 800x900 (taller)
    const rect = computeDestRect(800, 900, 4 / 3);
    expect(rect.width).toBe(800);
    expect(rect.height).toBe(600); // 800 / (4/3)
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(150);      // (900-600)/2
  });

  it('fills exactly when aspect ratios match', () => {
    const rect = computeDestRect(1024, 768, 4 / 3);
    expect(rect).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
  });
});

describe('normalizeKey', () => {
  it('lowercases single letters to match legacy SDL key names', () => {
    expect(normalizeKey('A')).toBe('a');
    expect(normalizeKey('z')).toBe('z');
  });
  it('leaves named keys untouched', () => {
    expect(normalizeKey('ArrowUp')).toBe('ArrowUp');
    expect(normalizeKey('Enter')).toBe('Enter');
    expect(normalizeKey(' ')).toBe(' ');
  });
});

describe('NativeRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeWindowManager.isInitialized.mockReturnValue(true);
    fakeWindowManager.getWindow.mockReturnValue(fakeWindow);
    fakeWindowManager.getRenderer.mockReturnValue(fakeRenderer);
  });

  it('blits a source frame into the letterboxed dest rect, fills bars with black, and presents', () => {
    // 2x2 source (square) into a 4x2 framebuffer (2:1) pillarboxes to a
    // centered 2x2 dest rect at x=1..2, leaving column 0 and column 3 as bars.
    fakeRenderer.getFramebuffer.mockReturnValue(makeFramebuffer(4, 2));

    const renderer = new NativeRenderer({ sourceWidth: 2, sourceHeight: 2, scale: 1 });

    // RGB24, 2x2, row-major: row0 = [red, green], row1 = [blue, white]
    const frame = new Uint8Array([
      255, 0, 0, 0, 255, 0,
      0, 0, 255, 255, 255, 255,
    ]);
    renderer.renderRgb24(frame);

    const fb = fakeRenderer.getFramebuffer.mock.results[0]?.value as { pixels: Uint32Array };
    const black = packColor(0, 0, 0);

    // Pillarbox bars (dest x=0 and x=3 on both rows)
    expect(fb.pixels[0]).toBe(black); // (0,0)
    expect(fb.pixels[3]).toBe(black); // (3,0)
    expect(fb.pixels[4]).toBe(black); // (0,1)
    expect(fb.pixels[7]).toBe(black); // (3,1)

    // Content area (dest x=1..2), mapped 1:1 to the source pixels
    expect(fb.pixels[1]).toBe(packColor(255, 0, 0));     // dest(1,0) <- src red
    expect(fb.pixels[2]).toBe(packColor(0, 255, 0));     // dest(2,0) <- src green
    expect(fb.pixels[5]).toBe(packColor(0, 0, 255));     // dest(1,1) <- src blue
    expect(fb.pixels[6]).toBe(packColor(255, 255, 255)); // dest(2,1) <- src white

    expect(fakeRenderer.present).toHaveBeenCalledTimes(1);
  });

  it('registers keydown/keyup/close on the window and removes the same handlers on destroy', () => {
    fakeRenderer.getFramebuffer.mockReturnValue(makeFramebuffer(2, 2));

    const renderer = new NativeRenderer({ sourceWidth: 2, sourceHeight: 2, scale: 1 });

    expect(fakeWindow.on).toHaveBeenCalledTimes(3);
    const registered = new Map(fakeWindow.on.mock.calls.map(([event, handler]) => [event as string, handler]));
    expect(registered.get('keydown')).toBeInstanceOf(Function);
    expect(registered.get('keyup')).toBeInstanceOf(Function);
    expect(registered.get('close')).toBeInstanceOf(Function);

    renderer.destroy();

    expect(fakeWindow.off).toHaveBeenCalledTimes(3);
    for (const [event, handler] of fakeWindow.off.mock.calls) {
      expect(registered.get(event as string)).toBe(handler);
    }
  });
});
