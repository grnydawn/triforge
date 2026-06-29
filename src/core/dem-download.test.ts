import { describe, it, expect } from 'vitest';
import type { Grid } from './triton-files';
import { utmToLonLat } from './crs';
import { OPENTOPO_DATASETS, targetGridFromBbox, lonLatBoundsForGrid, buildGlobalDemUrl, resampleToTargetGrid } from './dem-download';

describe('OPENTOPO_DATASETS', () => {
  it('is the clean dataset list', () => {
    expect(OPENTOPO_DATASETS.map((d) => d.id)).toEqual(['SRTMGL1', 'SRTMGL3', 'AW3D30', 'COP30', 'NASADEM']);
  });
});

describe('targetGridFromBbox', () => {
  const bbox = { west: -84.62, south: 34.00, east: -84.42, north: 34.19 };
  it('throws on a degenerate bbox or cellsize', () => {
    expect(() => targetGridFromBbox({ west: 1, south: 0, east: 1, north: 1 }, 30, 32616)).toThrow();
    expect(() => targetGridFromBbox(bbox, 0, 32616)).toThrow();
  });
  it('produces a positive integer UTM grid covering the bbox', () => {
    const spec = targetGridFromBbox(bbox, 30, 32616);
    expect(Number.isInteger(spec.ncols) && spec.ncols > 0).toBe(true);
    expect(Number.isInteger(spec.nrows) && spec.nrows > 0).toBe(true);
    expect(spec.cellsize).toBe(30);
    expect(spec.epsg).toBe(32616);
    // The un-buffered lon/lat bounds of the UTM rect must contain the original bbox.
    const back = lonLatBoundsForGrid(spec, 0);
    expect(back.west).toBeLessThanOrEqual(bbox.west + 1e-9);
    expect(back.east).toBeGreaterThanOrEqual(bbox.east - 1e-9);
    expect(back.south).toBeLessThanOrEqual(bbox.south + 1e-9);
    expect(back.north).toBeGreaterThanOrEqual(bbox.north - 1e-9);
  });
});

describe('buildGlobalDemUrl', () => {
  it('builds an AAIGrid globaldem URL without the API key', () => {
    const url = buildGlobalDemUrl({ demtype: 'SRTMGL1', bounds: { west: -84.6, south: 34.0, east: -84.4, north: 34.2 } });
    expect(url).toBe('https://portal.opentopography.org/API/globaldem?demtype=SRTMGL1&south=34&north=34.2&west=-84.6&east=-84.4&outputFormat=AAIGrid');
    expect(url).not.toMatch(/API_Key/);
  });
});

describe('resampleToTargetGrid', () => {
  const epsg = 32616;
  // 1x1 target whose cell-center is (xll+500, yll+500); build a 2x2 source centered on that point.
  const spec = { ncols: 1, nrows: 1, cellsize: 1000, xll: 719559, yll: 3785639, epsg };
  const { lon, lat } = utmToLonLat(spec.xll + 500, spec.yll + 500, epsg);
  const srcCs = 0.01;
  const src = (vals: number[]): Grid => ({ ncols: 2, nrows: 2, cellsize: srcCs, xll: lon - srcCs, yll: lat - srcCs, nodata: -9999, values: Float64Array.from(vals) });

  it('bilinearly interpolates the 4 neighbors (centered → mean)', () => {
    const g = resampleToTargetGrid(src([10, 20, 30, 40]), spec);
    expect(g.values[0]).toBeCloseTo(25, 6); // 0.25*(10+20+30+40)
    expect(g.crs).toBe('EPSG:32616');
    expect(g.nodata).toBe(-9999);
  });
  it('propagates NODATA when any neighbor is NODATA', () => {
    const g = resampleToTargetGrid(src([10, 20, -9999, 40]), spec);
    expect(g.values[0]).toBe(-9999);
  });
  it('returns NODATA for a target cell outside the source coverage', () => {
    const far = { ...spec, xll: spec.xll + 50000 }; // ~50 km east of the source
    const g = resampleToTargetGrid(src([10, 20, 30, 40]), far);
    expect(g.values[0]).toBe(-9999);
  });
});
