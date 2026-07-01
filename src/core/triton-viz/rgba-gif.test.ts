import { describe, it, expect } from 'vitest';
import type { Raster } from './types';
import { encodeRgbaFramesToGif } from './rgba-gif';

const solid = (w: number, h: number, r: number, g: number, b: number): Raster => {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { const o = p * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255; }
  return { width: w, height: h, rgba };
};

describe('encodeRgbaFramesToGif', () => {
  it('throws on an empty frame list', () => {
    expect(() => encodeRgbaFramesToGif([])).toThrow(/no frames/);
  });

  it('emits a GIF89a stream for true-color frames', () => {
    const gif = encodeRgbaFramesToGif([solid(4, 4, 10, 20, 30), solid(4, 4, 200, 100, 50)], { fps: 5 });
    expect([...gif.slice(0, 6)].map((b) => String.fromCharCode(b)).join('')).toBe('GIF89a');
    expect(gif.length).toBeGreaterThan(20);
  });
});
