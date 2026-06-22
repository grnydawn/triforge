import { describe, it, expect } from 'vitest';
import { plotSeries } from './plot';
import { makeRaster, drawText } from './font';

const at = (r: { width: number; rgba: Uint8ClampedArray }, x: number, y: number): number[] => {
  const i = (y * r.width + x) * 4;
  return [r.rgba[i], r.rgba[i + 1], r.rgba[i + 2]];
};

describe('plotSeries', () => {
  it('renders an 800x480 raster with a white corner and a black axis box', () => {
    const r = plotSeries([0, 1, 2], [[0, 5, 10]]);
    expect(r.width).toBe(800); expect(r.height).toBe(480);
    expect(at(r, 0, 0)).toEqual([255, 255, 255]);   // background
    expect(at(r, 60, 200)).toEqual([0, 0, 0]);       // left axis at x=MARGIN.left
  });
  it('draws the data polyline (line-colored pixel at the series midpoint)', () => {
    const r = plotSeries([0, 1, 2], [[0, 5, 10]]);
    // x=1 -> 60 + 360 = 420; y=5 -> 440 - 0.5*410 = 235
    const px = at(r, 420, 235);
    expect(px[0] !== 255 || px[1] !== 255 || px[2] !== 255).toBe(true);
  });
});

describe('drawText', () => {
  it('renders glyph pixels and leaves the rest as background', () => {
    const r = makeRaster(40, 10);
    drawText(r, 1, 1, '123', [0, 0, 0]);
    let set = 0;
    for (let i = 0; i < r.rgba.length; i += 4) if (r.rgba[i] === 0) set++;
    expect(set).toBeGreaterThan(0);
    expect(at(r, 39, 9)).toEqual([255, 255, 255]); // untouched corner stays white
  });
});
