import { describe, it, expect } from 'vitest';
import type { Raster } from './types';
import { quantizeFrames } from './quantize';

const solid = (w: number, h: number, r: number, g: number, b: number): Raster => {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { const o = p * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255; }
  return { width: w, height: h, rgba };
};

describe('quantizeFrames', () => {
  it('returns an empty result but a full-size palette for no frames', () => {
    const q = quantizeFrames([]);
    expect(q.indexed).toEqual([]);
    expect(q.palette.length).toBe(256 * 3);
  });

  it('maps solid-color frames to palette entries that round-trip to the color', () => {
    const frames = [solid(2, 2, 255, 0, 0), solid(2, 2, 0, 128, 64)];
    const q = quantizeFrames(frames);
    expect(q.indexed.length).toBe(2);
    const i0 = q.indexed[0].indices[0];
    expect([...q.indexed[0].indices]).toEqual([i0, i0, i0, i0]); // one color → one index
    expect(q.palette[i0 * 3]).toBe(255);
    expect(q.palette[i0 * 3 + 1]).toBe(0);
    expect(q.palette[i0 * 3 + 2]).toBe(0);
    const i1 = q.indexed[1].indices[0];
    expect(q.palette[i1 * 3]).toBe(0);
    expect(q.palette[i1 * 3 + 1]).toBe(128);
    expect(q.palette[i1 * 3 + 2]).toBe(64);
  });

  it('reduces a frame with many distinct colors to at most 256 indices and is deterministic', () => {
    const w = 32, h = 32;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) { const o = p * 4; rgba[o] = (p * 7) & 255; rgba[o + 1] = (p * 13) & 255; rgba[o + 2] = (p * 29) & 255; rgba[o + 3] = 255; }
    const q = quantizeFrames([{ width: w, height: h, rgba }]);
    expect(new Set(q.indexed[0].indices).size).toBeLessThanOrEqual(256);
    const q2 = quantizeFrames([{ width: w, height: h, rgba }]);
    expect([...q2.indexed[0].indices]).toEqual([...q.indexed[0].indices]);
  });
});
