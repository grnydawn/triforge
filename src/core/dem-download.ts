/** Pure DEM-acquisition geometry: target-grid-from-bbox, lon/lat request bounds, URL builder, and a bilinear WGS84→UTM resampler. No I/O. */
import type { Grid } from './triton-files';
import { lonLatToUtm, utmToLonLat } from './crs';

export interface LonLatBox { west: number; south: number; east: number; north: number }
export interface GridSpec { ncols: number; nrows: number; cellsize: number; xll: number; yll: number; epsg: number }

/** OpenTopography globaldem datasets we expose (drops the legacy USGS_3DEP/AWS_Terrain switch). */
export const OPENTOPO_DATASETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'SRTMGL1', label: 'SRTM GL1 — global ~30 m' },
  { id: 'SRTMGL3', label: 'SRTM GL3 — global ~90 m' },
  { id: 'AW3D30', label: 'ALOS World 3D — ~30 m (JAXA)' },
  { id: 'COP30', label: 'Copernicus GLO-30 — ~30 m (ESA)' },
  { id: 'NASADEM', label: 'NASADEM — reprocessed SRTM ~30 m' },
];

/** Project the 4 bbox corners to UTM, take the bounding rect, snap to cellsize → an integer UTM grid (xll/yll = rect min). */
export function targetGridFromBbox(bbox: LonLatBox, cellsizeM: number, epsg: number): GridSpec {
  if (!(bbox.west < bbox.east) || !(bbox.south < bbox.north)) {
    throw new Error('targetGridFromBbox: require west < east and south < north');
  }
  if (!(cellsizeM > 0)) throw new Error('targetGridFromBbox: cellsize must be > 0');
  const corners = [
    lonLatToUtm(bbox.west, bbox.south, epsg),
    lonLatToUtm(bbox.east, bbox.south, epsg),
    lonLatToUtm(bbox.west, bbox.north, epsg),
    lonLatToUtm(bbox.east, bbox.north, epsg),
  ];
  const xs = corners.map((c) => c.easting);
  const ys = corners.map((c) => c.northing);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const ncols = Math.max(1, Math.ceil((xmax - xmin) / cellsizeM));
  const nrows = Math.max(1, Math.ceil((ymax - ymin) / cellsizeM));
  return { ncols, nrows, cellsize: cellsizeM, xll: xmin, yll: ymin, epsg };
}

/** Lon/lat box to request: the UTM grid's corners back through utmToLonLat, padded by bufferDeg so edge cells have source data. */
export function lonLatBoundsForGrid(spec: GridSpec, bufferDeg = 0.002): LonLatBox {
  const xur = spec.xll + spec.ncols * spec.cellsize;
  const yur = spec.yll + spec.nrows * spec.cellsize;
  const corners = [
    utmToLonLat(spec.xll, spec.yll, spec.epsg),
    utmToLonLat(xur, spec.yll, spec.epsg),
    utmToLonLat(spec.xll, yur, spec.epsg),
    utmToLonLat(xur, yur, spec.epsg),
  ];
  const lons = corners.map((c) => c.lon);
  const lats = corners.map((c) => c.lat);
  return {
    west: Math.min(...lons) - bufferDeg,
    east: Math.max(...lons) + bufferDeg,
    south: Math.min(...lats) - bufferDeg,
    north: Math.max(...lats) + bufferDeg,
  };
}

/** OpenTopography globaldem URL for an AAIGrid request — WITHOUT the API key (the adapter appends &API_Key=). */
export function buildGlobalDemUrl(p: { demtype: string; bounds: LonLatBox }): string {
  const { demtype, bounds } = p;
  const q = `demtype=${encodeURIComponent(demtype)}`
    + `&south=${bounds.south}&north=${bounds.north}&west=${bounds.west}&east=${bounds.east}`
    + `&outputFormat=AAIGrid`;
  return `https://portal.opentopography.org/API/globaldem?${q}`;
}

/**
 * Bilinear resample of a WGS84 (lon/lat-degree) source grid onto the UTM target grid.
 * Each target cell-center is projected to lon/lat (utmToLonLat), mapped to fractional
 * source indices (0.5-px center offset), and bilinearly interpolated with edge clamping.
 * NODATA if any of the 4 neighbors is NODATA, or the point is >1 px outside the source.
 * Ported from the legacy DemResampler. Target NODATA = -9999.
 */
export function resampleToTargetGrid(source: Grid, spec: GridSpec): Grid {
  if (source.cellsize === undefined || source.xll === undefined || source.yll === undefined) {
    throw new Error('resampleToTargetGrid: source needs cellsize/xll/yll (a georeferenced AAIGrid)');
  }
  const { ncols, nrows, cellsize: cs, xll, yll, epsg } = spec;
  const srcCols = source.ncols, srcRows = source.nrows, srcCs = source.cellsize;
  const srcXll = source.xll, srcNoData = source.nodata;
  const srcTopY = source.yll + srcRows * srcCs;
  const NODATA = -9999;
  const values = new Float64Array(ncols * nrows);
  const at = (r: number, c: number): number => {
    const rr = r < 0 ? 0 : r >= srcRows ? srcRows - 1 : r;
    const cc = c < 0 ? 0 : c >= srcCols ? srcCols - 1 : c;
    return source.values[rr * srcCols + cc];
  };
  for (let r = 0; r < nrows; r++) {
    const utmY = yll + (nrows - 1 - r) * cs + cs / 2;
    for (let c = 0; c < ncols; c++) {
      const utmX = xll + c * cs + cs / 2;
      const { lon, lat } = utmToLonLat(utmX, utmY, epsg);
      const u = (lon - srcXll) / srcCs - 0.5;
      const v = (srcTopY - lat) / srcCs - 0.5;
      if (u < -1 || u > srcCols || v < -1 || v > srcRows) { values[r * ncols + c] = NODATA; continue; }
      const c0 = Math.floor(u), r0 = Math.floor(v);
      const v00 = at(r0, c0), v01 = at(r0, c0 + 1), v10 = at(r0 + 1, c0), v11 = at(r0 + 1, c0 + 1);
      if (v00 === srcNoData || v01 === srcNoData || v10 === srcNoData || v11 === srcNoData) { values[r * ncols + c] = NODATA; continue; }
      const wx = u - c0, wy = v - r0;
      values[r * ncols + c] = (1 - wx) * (1 - wy) * v00 + wx * (1 - wy) * v01 + (1 - wx) * wy * v10 + wx * wy * v11;
    }
  }
  return { ncols, nrows, cellsize: cs, xll, yll, nodata: NODATA, values, crs: `EPSG:${epsg}` };
}
