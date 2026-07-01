import { describe, it, expect } from 'vitest';
import { gridLatLngBounds, buildDemOverlay } from './dem-overlay';
import { autoRange } from './normalize';
import { utmToLonLat } from '../crs';
import type { Grid } from './types';

function demGrid(values: number[], over: Partial<Grid> = {}): Grid {
  return { ncols: 4, nrows: 4, cellsize: 30, xll: 500000, yll: 4000000, nodata: -9999, values: Float64Array.from(values), ...over };
}
const vals16 = Array.from({ length: 16 }, (_, i) => 100 + i * 10); // 100..250

describe('gridLatLngBounds', () => {
  it('returns the lat/lng bbox of the four UTM corners', () => {
    const g = demGrid(vals16);
    const e = 32616;
    const c = [
      utmToLonLat(500000, 4000000, e), utmToLonLat(500120, 4000000, e),
      utmToLonLat(500000, 4000120, e), utmToLonLat(500120, 4000120, e),
    ];
    const b = gridLatLngBounds(g, 'EPSG:32616');
    expect(b.south).toBeCloseTo(Math.min(...c.map((x) => x.lat)), 6);
    expect(b.north).toBeCloseTo(Math.max(...c.map((x) => x.lat)), 6);
    expect(b.west).toBeCloseTo(Math.min(...c.map((x) => x.lon)), 6);
    expect(b.east).toBeCloseTo(Math.max(...c.map((x) => x.lon)), 6);
    expect(b.south).toBeLessThan(b.north);
    expect(b.west).toBeLessThan(b.east);
  });
  it('throws on a non-EPSG crs', () => {
    expect(() => gridLatLngBounds(demGrid(vals16), 'WGS84')).toThrow();
  });
  it('throws when georeferencing is missing', () => {
    expect(() => gridLatLngBounds(demGrid(vals16, { xll: undefined }), 'EPSG:32616')).toThrow();
  });
});

describe('buildDemOverlay', () => {
  it('renders an RGBA raster at the grid dims with the grid range', () => {
    const g = demGrid(vals16);
    const { raster, range } = buildDemOverlay(g, { colormap: 'terrain', hillshade: false, maxDim: 64 });
    expect(raster.width).toBe(4);
    expect(raster.height).toBe(4);
    expect(raster.rgba.length).toBe(4 * 4 * 4);
    expect(range).toEqual(autoRange(g));
  });
  it('produces different pixels for different colormaps', () => {
    const g = demGrid(vals16);
    const a = buildDemOverlay(g, { colormap: 'terrain', hillshade: false, maxDim: 64 }).raster.rgba;
    const b = buildDemOverlay(g, { colormap: 'viridis', hillshade: false, maxDim: 64 }).raster.rgba;
    expect(a).not.toEqual(b);
  });
});
