/** Pure flood-animation pipeline: grids → palette-indexed frames → animated GIF bytes. */
import type { Grid } from '../triton-files';
import type { Range, IndexedFrame } from './types';
import { autoRange, normalize } from './normalize';
import { downsample } from './raster';
import { encodeAnimatedGif } from './gif';

/** Reserved GIF palette slot used for NODATA/out-of-range pixels (transparent). */
const TRANSPARENT_INDEX = 255;

export interface EncodeFramesOptions {
  /** 768-byte colormap LUT (e.g. COLORMAPS.depth.lut). */
  lut: Uint8Array;
  /** Frames per second (default 4). */
  fps?: number;
  /** Longest output dimension in px; frames are downsampled to fit (default 512). */
  maxDim?: number;
  /** Fixed value range; when omitted the global auto-range across kept frames is used. */
  range?: Range;
  /** Cap on encoded frames; past it, frames are strided down (default 200). */
  maxFrames?: number;
}

export interface EncodeFramesResult {
  gif: Uint8Array;
  usedFrames: number;
  range: Range;
  width: number;
  height: number;
  note: string;
}

/** Index a grid against the reserved-slot palette: data → 0..254, NODATA/non-finite → transparentIndex. */
export function indexFrame(g: Grid, range: Range, transparentIndex: number): IndexedFrame {
  const { values, nodata, ncols, nrows } = g;
  const indices = new Uint8Array(ncols * nrows);
  for (let p = 0; p < values.length; p++) {
    const v = values[p];
    indices[p] = v === nodata || !Number.isFinite(v) ? transparentIndex : Math.round(normalize(v, range) * 254);
  }
  return { width: ncols, height: nrows, indices };
}

/** Build a 256-color GIF palette: 255 colormap colors (0..254) + a reserved transparent slot at 255. */
export function animationPalette(lut: Uint8Array): Uint8Array {
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 255; i++) {
    const k = Math.round((i / 254) * 255);
    palette[i * 3] = lut[k * 3];
    palette[i * 3 + 1] = lut[k * 3 + 1];
    palette[i * 3 + 2] = lut[k * 3 + 2];
  }
  return palette; // index 255 left [0,0,0] = transparent color
}

/** Encode a sequence of grids into an animated GIF with a consistent colormap range. */
export function encodeFramesToGif(frames: Grid[], opts: EncodeFramesOptions): EncodeFramesResult {
  if (frames.length === 0) throw new Error('encodeFramesToGif: no frames');
  const maxFrames = opts.maxFrames ?? 200;
  let used = frames;
  let note = '';
  if (frames.length > maxFrames) {
    const stride = Math.ceil(frames.length / maxFrames);
    used = frames.filter((_, i) => i % stride === 0);
    note = ` (downsampled from ${frames.length} frames at stride ${stride})`;
  }
  const maxDim = opts.maxDim ?? 512;
  const small = used.map((g) => downsample(g, maxDim));
  let gmin = Infinity;
  let gmax = -Infinity;
  for (const g of small) {
    const r = autoRange(g);
    if (r.min < gmin) gmin = r.min;
    if (r.max > gmax) gmax = r.max;
  }
  const range: Range = opts.range ? opts.range : Number.isFinite(gmin) ? { min: gmin, max: gmax } : { min: 0, max: 0 };
  const palette = animationPalette(opts.lut);
  const imgs: IndexedFrame[] = small.map((g) => indexFrame(g, range, TRANSPARENT_INDEX));
  const fps = opts.fps ?? 4;
  const gif = encodeAnimatedGif(imgs, palette, { delayMs: Math.round(1000 / fps), loop: 0, transparentIndex: TRANSPARENT_INDEX });
  const d = small[0];
  return { gif, usedFrames: used.length, range, width: d.ncols, height: d.nrows, note };
}
