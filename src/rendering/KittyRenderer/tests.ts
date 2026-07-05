import { describe, it, expect } from 'vitest';
import { inflateSync } from 'zlib';
import { KittyRenderer, kittyGridAspectRatio } from '.';
import { parseCellPixelSize } from '@/utils/terminal';
import { fitToTerminal } from '@/rendering/shared/fitToTerminal';
import { isKittyEncodeRequest, type KittyEncodeRequest } from '@/rendering/kittyEncode';
import type { WorkerLike } from '@/rendering/kittyEncodeWorkerClient';
import { buildGammaLUT } from '@/utils/color';

// NES: 256x240 framebuffer, 8:7 pixel aspect ratio.
const NES = { width: 256, height: 240, par: 8 / 7 };
const displayAspect = (NES.width * NES.par) / NES.height;

// The on-screen aspect after Kitty fills a cols x rows cell grid.
const onScreenAspect = (
  gridAspect: number,
  cellWidthPx: number,
  cellHeightPx: number
): number => (gridAspect * cellWidthPx) / cellHeightPx;

describe('kittyGridAspectRatio', () => {
  it('preserves the source display aspect ratio for a normal 9x18 cell', () => {
    const grid = kittyGridAspectRatio(NES.width, NES.height, NES.par, 9, 18);
    expect(onScreenAspect(grid, 9, 18)).toBeCloseTo(displayAspect, 5);
  });

  it('produces the same on-screen aspect ratio regardless of font width', () => {
    // A thin font (7px wide), a normal font (9px), and a wide font (11px) —
    // all with the same 18px cell height — must yield the same on-screen aspect.
    const thin = kittyGridAspectRatio(NES.width, NES.height, NES.par, 7, 18);
    const normal = kittyGridAspectRatio(NES.width, NES.height, NES.par, 9, 18);
    const wide = kittyGridAspectRatio(NES.width, NES.height, NES.par, 11, 18);

    expect(onScreenAspect(thin, 7, 18)).toBeCloseTo(displayAspect, 5);
    expect(onScreenAspect(normal, 9, 18)).toBeCloseTo(displayAspect, 5);
    expect(onScreenAspect(wide, 11, 18)).toBeCloseTo(displayAspect, 5);
  });

  it('requests more columns per row for a thinner cell', () => {
    // Narrower cells need proportionally more columns to fill the same width,
    // which is exactly what stops a thin font from squeezing the image.
    const thin = kittyGridAspectRatio(NES.width, NES.height, NES.par, 7, 18);
    const normal = kittyGridAspectRatio(NES.width, NES.height, NES.par, 9, 18);
    expect(thin).toBeGreaterThan(normal);
  });

  it('fixes a squeezed display for a real thin-font terminal reply', () => {
    // Terminal reports 7x18px cells (thin font). 120x30 grid, 2 status rows.
    const cell = parseCellPixelSize('\x1b[6;18;7t', { cols: 120, rows: 30 });
    expect(cell).toEqual({ width: 7, height: 18 });

    const fitFor = (cw: number, ch: number): { width: number; height: number } =>
      fitToTerminal({
        availableCols: 120,
        availableRows: 28,
        aspectRatio: kittyGridAspectRatio(NES.width, NES.height, NES.par, cw, ch),
      });

    const oldWay = fitFor(9, 18); // previous hardcoded assumption
    const newWay = fitFor(cell!.width, cell!.height); // measured thin cell

    // The old code squeezed the image narrower than the real display aspect;
    // the measured cell size restores the correct on-screen aspect ratio.
    expect(onScreenAspect(oldWay.width / oldWay.height, 7, 18)).toBeLessThan(displayAspect * 0.9);
    expect(newWay.width).toBeGreaterThan(oldWay.width);
    expect(onScreenAspect(newWay.width / newWay.height, 7, 18)).toBeCloseTo(displayAspect, 1);
  });
});

// Decode the pixels out of a rendered Kitty payload (PNG, filter 0 rows)
const decodePayloadPixels = (payload: string): Uint8Array => {
  const escapes = [...payload.matchAll(/\x1b_G([^;\x1b]*);?([^\x1b]*)\x1b\\/g)]
    .filter((m) => !m[1].includes('a=d'));
  const png = Buffer.from(escapes.map((m) => m[2]).join(''), 'base64');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  const idatParts: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'IDAT') {
      idatParts.push(Buffer.from(data));
    }
    offset += 8 + length + 4;
  }

  const raw = inflateSync(Buffer.concat(idatParts));
  const pixels = new Uint8Array(width * height * 3);
  const INDEXED_COLOR_TYPE = 3;
  const rowStride = colorType === INDEXED_COLOR_TYPE ? width : width * 3;
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + rowStride);
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 3;
      if (colorType === INDEXED_COLOR_TYPE) {
        const p = raw[rowStart + 1 + x] * 3;
        pixels.set(palette!.subarray(p, p + 3), dst);
      } else {
        pixels.set(raw.subarray(rowStart + 1 + x * 3, rowStart + 1 + (x + 1) * 3), dst);
      }
    }
  }
  return pixels;
};

describe('KittyRenderer pixel conversion', () => {
  const frame = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 40, 80, 120]); // 2x2 rgb24

  it('round-trips rgb24 pixels exactly with identity gamma', () => {
    const renderer = new KittyRenderer({ sourceWidth: 2, sourceHeight: 2, scale: 1, colorSpace: 'rgb24', gamma: 1.0 });
    expect(decodePayloadPixels(renderer.renderRgb24(frame))).toEqual(frame);
  });

  it('applies the gamma LUT to rgb24 pixels when gamma is not 1.0', () => {
    const gamma = 1.4;
    const renderer = new KittyRenderer({ sourceWidth: 2, sourceHeight: 2, scale: 1, colorSpace: 'rgb24', gamma });
    const lut = buildGammaLUT(gamma);
    const expected = Uint8Array.from(frame, (v) => lut[v]);
    expect(decodePayloadPixels(renderer.renderRgb24(frame))).toEqual(expected);
  });

  it('converts rgb24 to grayscale when color is disabled, even with identity gamma', () => {
    const renderer = new KittyRenderer({
      sourceWidth: 2, sourceHeight: 2, scale: 1, colorSpace: 'rgb24', gamma: 1.0, colorEnabled: false,
    });
    const pixels = decodePayloadPixels(renderer.renderRgb24(frame));
    for (let i = 0; i < pixels.length; i += 3) {
      expect(pixels[i]).toBe(pixels[i + 1]);
      expect(pixels[i + 1]).toBe(pixels[i + 2]);
    }
    // Red, green, blue inputs must produce distinct luminance, not raw copies
    expect(pixels[0]).not.toBe(pixels[3]);
  });

  it('round-trips rgb15 pixels through 5-to-8-bit expansion', () => {
    // XBBBBBGGGGGRRRRR: pure red, green, blue, white
    const rgb15 = Uint16Array.from([0x001f, 0x03e0, 0x7c00, 0x7fff]);
    const renderer = new KittyRenderer({ sourceWidth: 2, sourceHeight: 2, scale: 1, colorSpace: 'rgb15', gamma: 1.0 });
    const pixels = decodePayloadPixels(renderer.renderRgb15(rgb15));
    expect([...pixels.subarray(0, 3)]).toEqual([255, 0, 0]);
    expect([...pixels.subarray(3, 6)]).toEqual([0, 255, 0]);
    expect([...pixels.subarray(6, 9)]).toEqual([0, 0, 255]);
    expect([...pixels.subarray(9, 12)]).toEqual([255, 255, 255]);
  });
});

class FakeWorker implements WorkerLike {
  requests: KittyEncodeRequest[] = [];
  terminated = false;
  private listeners = new Map<string, Array<(arg?: unknown) => void>>();

  postMessage(value: unknown): void {
    if (isKittyEncodeRequest(value)) {
      this.requests.push(value);
    }
  }

  on(event: string, listener: (arg?: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  emit(event: string, arg?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(arg);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(payload: string): void {
    const request = this.requests[this.requests.length - 1];
    this.emit('message', { type: 'encoded', payload, rgb: request.rgb });
  }
}

const makeAsyncRenderer = (worker: FakeWorker | null): { renderer: KittyRenderer; sink: string[] } => {
  const renderer = new KittyRenderer({
    sourceWidth: 2,
    sourceHeight: 2,
    scale: 1,
    colorSpace: 'rgb24',
    encodeWorkerFactory: () => worker,
  });
  const sink: string[] = [];
  renderer.setOutputSink((chunk) => sink.push(chunk));
  return { renderer, sink };
};

const testFrame = (fill: number): Uint8Array => new Uint8Array(2 * 2 * 3).fill(fill);

describe('KittyRenderer worker offload', () => {
  it('dispatches encoding to the worker and returns an empty string', () => {
    const worker = new FakeWorker();
    const { renderer, sink } = makeAsyncRenderer(worker);

    expect(renderer.renderRgb24(testFrame(10))).toBe('');
    expect(worker.requests).toHaveLength(1);

    worker.respond('encoded-payload');
    expect(sink).toEqual(['encoded-payload']);
  });

  it('encodes synchronously when no worker is available', () => {
    const { renderer, sink } = makeAsyncRenderer(null);

    const output = renderer.renderRgb24(testFrame(10));

    expect(output).toContain('\x1b_G'); // full kitty payload, rendered inline
    expect(sink).toEqual([]);
  });

  it('recovers with synchronous full renders after the worker fails mid-session', () => {
    const worker = new FakeWorker();
    const { renderer } = makeAsyncRenderer(worker);

    // Frame dispatched to the worker, then the worker dies (frame lost)
    expect(renderer.renderRgb24(testFrame(10))).toBe('');
    worker.emit('error', new Error('boom'));

    // The same frame content must now render synchronously (not be skipped
    // as "unchanged") so the display repopulates after the lost frame
    const output = renderer.renderRgb24(testFrame(10));
    expect(output).toContain('\x1b_G');
  });

  it('terminates the worker on destroy', () => {
    const worker = new FakeWorker();
    const { renderer } = makeAsyncRenderer(worker);

    renderer.destroy();

    expect(worker.terminated).toBe(true);
  });
});
