import { Grid } from './types';
import { GeoTiffTile } from './tiff';
import { VrtMosaic } from './vrt';

/** Map a decoded GeoTIFF tile onto a Grid: top-left origin -> ESRI lower-left; epsg -> crs. */
export function geoTiffTileToGrid(t: GeoTiffTile, nodata = -9999): Grid {
  const [originX, pxW, , originY, , pxH] = t.geoTransform;
  if (pxW <= 0) throw new Error('GeoTIFF: non-positive pixel width');
  return {
    ncols: t.width, nrows: t.height, cellsize: pxW, xll: originX, yll: originY + t.height * pxH,
    nodata: t.nodata ?? nodata, values: t.values, crs: t.epsg ? `EPSG:${t.epsg}` : undefined,
  };
}

/** Compose decoded tiles (in VRT source order) into the full mosaic Grid by each source's DstRect. */
export function stitchVrtMosaic(v: VrtMosaic, tiles: GeoTiffTile[], nodata = -9999): Grid {
  if (tiles.length !== v.sources.length) throw new Error('VRT: tile count != source count');
  const W = v.width, H = v.height;
  const values = new Float64Array(W * H);
  for (let s = 0; s < v.sources.length; s++) {
    const src = v.sources[s], tile = tiles[s];
    if (tile.width !== src.srcRect.xSize || tile.height < src.srcRect.yOff + src.srcRect.ySize) {
      throw new Error(`VRT: tile ${s} dims ${tile.width}x${tile.height} disagree with SrcRect`);
    }
    for (let r = 0; r < src.dstRect.ySize; r++) {
      const dy = src.dstRect.yOff + r, sy = src.srcRect.yOff + r;
      for (let c = 0; c < src.dstRect.xSize; c++) {
        values[dy * W + (src.dstRect.xOff + c)] = tile.values[sy * tile.width + (src.srcRect.xOff + c)];
      }
    }
  }
  const [originX, pxW, , originY, , pxH] = v.geoTransform;
  return { ncols: W, nrows: H, cellsize: pxW, xll: originX, yll: originY + H * pxH, nodata, values, crs: v.epsg ? `EPSG:${v.epsg}` : undefined };
}
