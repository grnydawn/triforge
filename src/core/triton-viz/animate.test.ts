import { describe, it, expect } from 'vitest';
import type { Grid } from '../triton-files';
import { COLORMAPS } from './colormap';
import { encodeFramesToGif, indexFrame } from './animate';

const grid = (vals: number[], nodata = -9999): Grid =>
  ({ ncols: vals.length, nrows: 1, nodata, values: Float64Array.from(vals) });

describe('encodeFramesToGif', () => {
  it('throws on an empty frame list', () => {
    expect(() => encodeFramesToGif([], { lut: COLORMAPS.depth.lut })).toThrow(/no frames/);
  });

  it('produces a GIF89a stream and a global range across frames', () => {
    const frames = [grid([0, 1, 2]), grid([2, 3, 10])];
    const res = encodeFramesToGif(frames, { lut: COLORMAPS.depth.lut, fps: 4 });
    // GIF89a magic
    expect([...res.gif.slice(0, 6)].map((b) => String.fromCharCode(b)).join('')).toBe('GIF89a');
    expect(res.gif.length).toBeGreaterThan(20);
    expect(res.usedFrames).toBe(2);
    expect(res.range).toEqual({ min: 0, max: 10 }); // global across both frames
    expect(res.width).toBe(3);
    expect(res.height).toBe(1);
  });

  it('honors an explicit range and reports a downsample note past maxFrames', () => {
    const frames = Array.from({ length: 5 }, (_, i) => grid([i, i + 1]));
    const res = encodeFramesToGif(frames, { lut: COLORMAPS.depth.lut, maxFrames: 2, range: { min: 0, max: 1 } });
    expect(res.range).toEqual({ min: 0, max: 1 });
    expect(res.usedFrames).toBeLessThan(5);
    expect(res.note).toMatch(/downsampled from 5 frames/);
  });
});

describe('indexFrame', () => {
  it('maps NODATA to the transparent index and data to 0..254', () => {
    const f = indexFrame(grid([0, 10, -9999]), { min: 0, max: 10 }, 255);
    expect(f.indices[0]).toBe(0);
    expect(f.indices[1]).toBe(254);
    expect(f.indices[2]).toBe(255);
  });
});
