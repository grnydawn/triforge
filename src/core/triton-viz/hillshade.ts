/** Horn's-method hillshade relief + multiplicative blend (pure). */
import type { Grid, Raster } from './types';

export interface HillshadeOptions {
  azimuth?: number;
  altitude?: number;
  zFactor?: number;
}

function clampByte(x: number): number {
  const v = Math.round(x);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Horn's-method hillshade. Returns length ncols*nrows, each 0..1.
 * Defaults: azimuth=315, altitude=45, zFactor=1; cellsize = g.cellsize ?? 1.
 * Edges clamp neighbor indices; nodata neighbors are treated as elevation 0.
 */
export function hillshade(g: Grid, o: HillshadeOptions = {}): Float64Array {
  const azimuth = o.azimuth ?? 315;
  const altitude = o.altitude ?? 45;
  const zFactor = o.zFactor ?? 1;
  const cs = g.cellsize ?? 1;
  const { ncols, nrows, values, nodata } = g;
  const azRad = (360 - azimuth + 90) * (Math.PI / 180);
  const zenRad = (90 - altitude) * (Math.PI / 180);
  const out = new Float64Array(ncols * nrows);

  const at = (r: number, c: number): number => {
    const rr = r < 0 ? 0 : r >= nrows ? nrows - 1 : r;
    const cc = c < 0 ? 0 : c >= ncols ? ncols - 1 : c;
    const v = values[rr * ncols + cc];
    return v === nodata || !Number.isFinite(v) ? 0 : v;
  };

  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      const a = at(r - 1, c - 1);
      const b = at(r - 1, c);
      const cc = at(r - 1, c + 1);
      const d = at(r, c - 1);
      const f = at(r, c + 1);
      const gg = at(r + 1, c - 1);
      const h = at(r + 1, c);
      const ii = at(r + 1, c + 1);
      const dzdx = (((cc + 2 * f + ii) - (a + 2 * d + gg)) / (8 * cs)) * zFactor;
      const dzdy = (((gg + 2 * h + ii) - (a + 2 * b + cc)) / (8 * cs)) * zFactor;
      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      let aspect: number;
      if (dzdx !== 0) {
        aspect = Math.atan2(dzdy, -dzdx);
        if (aspect < 0) aspect += 2 * Math.PI;
      } else if (dzdy > 0) {
        aspect = Math.PI / 2;
      } else if (dzdy < 0) {
        aspect = 2 * Math.PI - Math.PI / 2;
      } else {
        aspect = 0;
      }
      let hs =
        Math.cos(zenRad) * Math.cos(slope) +
        Math.sin(zenRad) * Math.sin(slope) * Math.cos(azRad - aspect);
      if (hs < 0) hs = 0;
      out[r * ncols + c] = hs;
    }
  }
  return out;
}

/** Multiply each pixel's rgb by (1 - strength + strength*shade[i]); alpha untouched. strength default 0.6. */
export function blendHillshade(r: Raster, shade: Float64Array, strength = 0.6): Raster {
  const rgba = new Uint8ClampedArray(r.rgba.length);
  for (let p = 0, i = 0; p < r.rgba.length; p += 4, i++) {
    const m = 1 - strength + strength * shade[i];
    rgba[p] = clampByte(r.rgba[p] * m);
    rgba[p + 1] = clampByte(r.rgba[p + 1] * m);
    rgba[p + 2] = clampByte(r.rgba[p + 2] * m);
    rgba[p + 3] = r.rgba[p + 3];
  }
  return { width: r.width, height: r.height, rgba };
}
