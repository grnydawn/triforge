import { describe, it, expect } from 'vitest';
import { geoTiffTileToGrid, stitchVrtMosaic } from './geotiff';
import { readFloat32GeoTiff } from './tiff';
import { parseVrt } from './vrt';
import { buildTinyGeoTiff, buildTinyVrt } from './geotiff.fixture';

describe('geoTiffTileToGrid', () => {
  it('maps geotransform -> cellsize/xll/yll and epsg -> crs', () => {
    const t = readFloat32GeoTiff(buildTinyGeoTiff(3, 2, [1, 2, 3, 4, 5, 6], 32616, 100, 260, 30));
    const g = geoTiffTileToGrid(t);
    expect(g.cellsize).toBe(30);
    expect(g.xll).toBe(100);
    expect(g.yll).toBe(260 + 2 * -30); // originY + height*pxH
    expect(g.crs).toBe('EPSG:32616');
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('stitchVrtMosaic', () => {
  it('composes vertical strip tiles into the full mosaic Grid', () => {
    const t0 = buildTinyGeoTiff(3, 2, [1, 2, 3, 4, 5, 6], 32616, 0, 90, 30); // rows 0-1
    const t1 = buildTinyGeoTiff(3, 1, [7, 8, 9], 32616, 0, 30, 30);           // row 2
    const xml = buildTinyVrt(3, 3, 32616, [0, 30, 0, 90, 0, -30], [
      { filename: 't0.tif', width: 3, height: 2, dstYOff: 0 },
      { filename: 't1.tif', width: 3, height: 1, dstYOff: 2 },
    ]);
    const v = parseVrt(xml);
    const g = stitchVrtMosaic(v, [readFloat32GeoTiff(t0), readFloat32GeoTiff(t1)]);
    expect([g.ncols, g.nrows]).toEqual([3, 3]);
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.crs).toBe('EPSG:32616');
    expect(g.cellsize).toBe(30);
  });
  it('throws when the tile count disagrees with the source count', () => {
    const v = parseVrt(buildTinyVrt(3, 2, 32616, [0, 1, 0, 0, 0, -1], [{ filename: 't.tif', width: 3, height: 2, dstYOff: 0 }]));
    expect(() => stitchVrtMosaic(v, [])).toThrow(/tile count/);
  });
});
