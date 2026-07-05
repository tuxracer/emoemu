import { describe, it, expect } from 'vitest';
import { TerminalRenderer } from '.';
import type { RendererOptions } from '.';
import { fgTrueColor, bgTrueColor } from '../shared/ansi';
import { getTerminalDimensions } from '@/utils/terminal';

// Display: 4 chars wide, 2 chars tall. Terminal (half-block) mode maps each
// character cell to two vertically stacked source pixels, so a 4x4 source
// renders at exactly 1:1 (scaleX = 1, scaleY = 1).
const WIDTH = 4;
const HEIGHT = 2;
const SOURCE_WIDTH = 4;
const SOURCE_HEIGHT = 4;

const makeRenderer = (overrides: Partial<RendererOptions> = {}): TerminalRenderer =>
  new TerminalRenderer({
    width: WIDTH,
    height: HEIGHT,
    sourceWidth: SOURCE_WIDTH,
    sourceHeight: SOURCE_HEIGHT,
    colorEnabled: true,
    trueColorEnabled: true,
    asciiMode: false,
    emojiMode: false,
    ...overrides,
  });

const solidBuffer = (
  r: number,
  g: number,
  b: number,
  width = SOURCE_WIDTH,
  height = SOURCE_HEIGHT,
): Uint8Array => {
  const buffer = new Uint8Array(width * height * 3);
  for (let i = 0; i < buffer.length; i += 3) {
    buffer[i] = r;
    buffer[i + 1] = g;
    buffer[i + 2] = b;
  }
  return buffer;
};

const setPixel = (
  buffer: Uint8Array,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
): void => {
  const idx = (y * SOURCE_WIDTH + x) * 3;
  buffer[idx] = r;
  buffer[idx + 1] = g;
  buffer[idx + 2] = b;
};

describe('TerminalRenderer.renderRgb24 diff rendering', () => {
  it('returns an empty string when consecutive frames are identical', () => {
    const renderer = makeRenderer();
    const frame = solidBuffer(10, 20, 30);

    renderer.renderRgb24(frame);

    expect(renderer.renderRgb24(solidBuffer(10, 20, 30))).toBe('');
  });

  it('renders the first frame identically to a diff-disabled full render', () => {
    const diffRenderer = makeRenderer();
    const fullRenderer = makeRenderer({ enableDiffRendering: false });
    const frame = solidBuffer(10, 20, 30);

    expect(diffRenderer.renderRgb24(frame)).toBe(fullRenderer.renderRgb24(frame));
  });

  it('re-renders only a changed cell, positioning the cursor at it', () => {
    const renderer = makeRenderer();
    renderer.renderRgb24(solidBuffer(10, 20, 30));

    // Change both source pixels of character cell (2, 1)
    const frame = solidBuffer(10, 20, 30);
    setPixel(frame, 2, 2, 200, 0, 0);
    setPixel(frame, 2, 3, 0, 200, 0);
    const output = renderer.renderRgb24(frame);

    // Exactly one cursor-positioning run, targeting the changed cell
    const moves = output.match(/\x1b\[\d+;\d+H/g) ?? [];
    expect(moves).toHaveLength(1);

    const homeRow = Number(/\x1b\[(\d+);/.exec(renderer.moveCursorHome())![1]);
    const { width: termCols } = getTerminalDimensions();
    const offsetCol = Math.max(0, Math.floor((termCols - WIDTH) / 2));
    expect(moves[0]).toBe(`\x1b[${homeRow + 1};${offsetCol + 2 + 1}H`);

    // The new cell colors are emitted; unchanged cells are not re-emitted
    expect(output).toContain(fgTrueColor(200, 0, 0));
    expect(output).toContain(bgTrueColor(0, 200, 0));
    expect(output).not.toContain(fgTrueColor(10, 20, 30));
  });

  it('falls back to a full-frame render when more than half the cells change', () => {
    const renderer = makeRenderer();
    renderer.renderRgb24(solidBuffer(10, 20, 30));

    const output = renderer.renderRgb24(solidBuffer(90, 90, 90));

    expect(output.startsWith(renderer.moveCursorHome())).toBe(true);
    expect(output).toContain(fgTrueColor(90, 90, 90));
  });

  it('applies post-processing effects identically in diff and full renders', () => {
    const renderer = makeRenderer({ gamma: 2.0 });
    renderer.renderRgb24(solidBuffer(10, 20, 30));

    const frame = solidBuffer(10, 20, 30);
    setPixel(frame, 1, 0, 200, 100, 50);
    const diffOutput = renderer.renderRgb24(frame);
    const fullOutput = makeRenderer({ gamma: 2.0, enableDiffRendering: false }).renderRgb24(frame);

    // Every color escape the diff update emits must also appear in a full
    // render of the same frame (dual code paths must stay consistent)
    const colorEscapes = diffOutput.match(/\x1b\[[0-9;]*m/g) ?? [];
    expect(colorEscapes.length).toBeGreaterThan(0);
    for (const escape of colorEscapes) {
      expect(fullOutput).toContain(escape);
    }
  });

  it('re-renders every frame in full when diff rendering is disabled', () => {
    const renderer = makeRenderer({ enableDiffRendering: false });
    const frame = solidBuffer(10, 20, 30);

    const first = renderer.renderRgb24(frame);

    expect(renderer.renderRgb24(frame)).toBe(first);
  });

  it('recovers with a full render when the framebuffer size changes', () => {
    const renderer = makeRenderer();
    renderer.renderRgb24(solidBuffer(10, 20, 30));

    // Simulate a mid-game resolution change (different buffer length)
    const output = renderer.renderRgb24(solidBuffer(90, 90, 90, 8, 8));

    expect(output.startsWith(renderer.moveCursorHome())).toBe(true);
  });

  it('returns an empty string for identical frames in emoji mode', () => {
    const renderer = makeRenderer({ emojiMode: true });
    const frame = solidBuffer(10, 20, 30);

    renderer.renderRgb24(frame);

    expect(renderer.renderRgb24(solidBuffer(10, 20, 30))).toBe('');
  });

  it('returns an empty string for identical frames in ascii mode', () => {
    const renderer = makeRenderer({ asciiMode: true });
    const frame = solidBuffer(10, 20, 30);

    renderer.renderRgb24(frame);

    expect(renderer.renderRgb24(solidBuffer(10, 20, 30))).toBe('');
  });
});

// RGB15 format is XBBBBBGGGGGRRRRR with 5-bit components
const packRgb15 = (r5: number, g5: number, b5: number): number => (b5 << 10) | (g5 << 5) | r5;

const solidBuffer15 = (color: number): Uint16Array =>
  new Uint16Array(SOURCE_WIDTH * SOURCE_HEIGHT).fill(color);

describe('TerminalRenderer.renderRgb15 diff rendering', () => {
  it('returns an empty string when consecutive frames are identical', () => {
    const renderer = makeRenderer();
    const color = packRgb15(2, 4, 6);

    renderer.renderRgb15(solidBuffer15(color));

    expect(renderer.renderRgb15(solidBuffer15(color))).toBe('');
  });

  it('applies post-processing effects identically in diff and full renders', () => {
    const renderer = makeRenderer({ gamma: 2.0 });
    const base = packRgb15(2, 4, 6);
    renderer.renderRgb15(solidBuffer15(base));

    const frame = solidBuffer15(base);
    frame[0 * SOURCE_WIDTH + 1] = packRgb15(25, 12, 6); // top pixel of cell (1, 0)
    const diffOutput = renderer.renderRgb15(frame);
    const fullOutput = makeRenderer({ gamma: 2.0, enableDiffRendering: false }).renderRgb15(frame);

    // Every color escape the diff update emits must also appear in a full
    // render of the same frame (dual code paths must stay consistent)
    const colorEscapes = diffOutput.match(/\x1b\[[0-9;]*m/g) ?? [];
    expect(colorEscapes.length).toBeGreaterThan(0);
    for (const escape of colorEscapes) {
      expect(fullOutput).toContain(escape);
    }
  });
});
