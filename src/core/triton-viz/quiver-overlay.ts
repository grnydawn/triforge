/** Pure projection of a qx/qy vector field onto lat/lng arrow primitives for a map quiver layer.
 *  No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import type { Grid } from './types';
import { sampleVectorField } from './vector';
import { utmToLonLat } from '../crs';

export interface LatLng { lat: number; lng: number }
export interface QuiverArrow { base: LatLng; tip: LatLng; magnitude: number }
export interface QuiverOptions { maxArrows?: number; scale?: number; refMagnitude?: number }
export interface Quiver { arrows: QuiverArrow[]; maxMagnitude: number; stride: number }

function epsgFromCrs(crs: string): number {
  const m = /^EPSG:(\d+)$/i.exec(crs.trim());
  if (!m) throw new Error(`Unsupported CRS '${crs}' (expected EPSG:NNNNN).`);
  return parseInt(m[1], 10);
}

/**
 * Sample qx/qy and project each arrow's cell-centre base + (u,v)-scaled tip to lat/lng. The peak
 * arrow spans ~ stride·cellsize·scale metres, normalized by `refMagnitude` (or this field's own
 * max). Throws on missing georeferencing / a non-EPSG CRS.
 */
export function buildQuiver(qx: Grid, qy: Grid, crs: string, opts: QuiverOptions = {}): Quiver {
  if (qx.xll === undefined || qx.yll === undefined || qx.cellsize === undefined) {
    throw new Error('Vector grid is missing georeferencing (xll/yll/cellsize).');
  }
  const xll = qx.xll, yll = qx.yll, cellsize = qx.cellsize;
  const epsg = epsgFromCrs(crs);
  const { arrows: sampled, maxMagnitude, stride } = sampleVectorField(qx, qy, { maxArrows: opts.maxArrows });
  if (maxMagnitude <= 0) return { arrows: [], maxMagnitude: 0, stride };
  const ref = opts.refMagnitude && opts.refMagnitude > 0 ? opts.refMagnitude : maxMagnitude;
  const L = (stride * cellsize * (opts.scale ?? 1)) / ref;
  const arrows: QuiverArrow[] = sampled.map((a) => {
    const x = xll + (a.col + 0.5) * cellsize;
    const y = yll + (qx.nrows - a.row - 0.5) * cellsize;
    const base = utmToLonLat(x, y, epsg);
    const tip = utmToLonLat(x + a.u * L, y + a.v * L, epsg);
    return { base: { lat: base.lat, lng: base.lon }, tip: { lat: tip.lat, lng: tip.lon }, magnitude: a.magnitude };
  });
  return { arrows, maxMagnitude, stride };
}
