/** Pure helpers projecting a DEM Grid onto a Leaflet image overlay (lat/lng bounds + RGBA raster).
 *  No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import { Grid, Raster, Range } from './types';
import { ColormapName, COLORMAPS } from './colormap';
import { downsample, renderGrid } from './raster';
import { autoRange } from './normalize';
import { utmToLonLat } from '../crs';

export interface LatLngBounds { south: number; west: number; north: number; east: number; }
export interface DemOverlayOptions { colormap: ColormapName; hillshade: boolean; maxDim: number; }

function epsgFromCrs(crs: string): number {
  const m = /^EPSG:(\d+)$/i.exec(crs.trim());
  if (!m) throw new Error(`Unsupported CRS '${crs}' (expected EPSG:NNNNN).`);
  return parseInt(m[1], 10);
}

/** The DEM's UTM extent → a lat/lng bounding box (four corners via utmToLonLat, then min/max). */
export function gridLatLngBounds(grid: Grid, crs: string): LatLngBounds {
  if (grid.xll === undefined || grid.yll === undefined || grid.cellsize === undefined) {
    throw new Error('DEM is missing georeferencing (xll/yll/cellsize).');
  }
  const epsg = epsgFromCrs(crs);
  const e1 = grid.xll + grid.ncols * grid.cellsize;
  const n1 = grid.yll + grid.nrows * grid.cellsize;
  const corners = [
    utmToLonLat(grid.xll, grid.yll, epsg), utmToLonLat(e1, grid.yll, epsg),
    utmToLonLat(grid.xll, n1, epsg), utmToLonLat(e1, n1, epsg),
  ];
  const lons = corners.map((c) => c.lon);
  const lats = corners.map((c) => c.lat);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
}

/** Downsample → colorize (renderGrid applies hillshade when requested) into an RGBA raster + the range used. */
export function buildDemOverlay(grid: Grid, opts: DemOverlayOptions): { raster: Raster; range: Range } {
  const ds = downsample(grid, opts.maxDim);
  const range = autoRange(ds);
  const raster = renderGrid(ds, COLORMAPS[opts.colormap].lut, { range, hillshade: opts.hillshade });
  return { raster, range };
}
