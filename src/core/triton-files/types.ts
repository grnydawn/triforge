/** A 2D raster grid, row-major. Georef fields are absent for headerless/binary grids. */
export interface Grid {
  ncols: number;
  nrows: number;
  cellsize?: number;
  xll?: number;
  yll?: number;
  nodata: number;
  values: Float64Array; // length ncols*nrows, row-major
}

export interface EsriHeader {
  ncols: number;
  nrows: number;
  cellsize?: number;
  xll?: number;
  yll?: number;
  nodata: number;
}

export interface TritonConfig {
  entries: Record<string, string>;
  order: string[];
}

export interface BoundarySegment {
  bcType: number; x1: number; y1: number; x2: number; y2: number; bc: number;
}

/** Forcing series (.hyg/.roff): col 0 = time, cols 1..N per source/zone. */
export interface ForcingData { times: number[]; columns: number[][]; }

/** Output series (output/series/*.txt): header row + time + per-point columns. */
export interface SeriesData { header: string[]; times: number[]; columns: number[][]; }

export interface GridStats {
  min: number; max: number; mean: number; std: number;
  count: number; nodataCount: number; wetCount: number;
}

export interface GridExtent {
  ncols: number; nrows: number;
  cellsize?: number; xll?: number; yll?: number; xmax?: number; ymax?: number;
  widthM?: number; heightM?: number;
}
