/**
 * Pure colormap module: four 256-entry RGB lookup tables built by linear
 * interpolation between a small set of control points, plus a clamped sampler.
 * No I/O — all data is embedded.
 */
import type { Colormap } from './types';

/** A control point: a fractional position in [0,1] and its anchor RGB. */
type Anchor = readonly [number, readonly [number, number, number]];

const VIRIDIS_ANCHORS: readonly Anchor[] = [
  [0.0, [68, 1, 84]],
  [0.125, [72, 40, 120]],
  [0.25, [62, 74, 137]],
  [0.375, [49, 104, 142]],
  [0.5, [38, 130, 142]],
  [0.625, [31, 158, 137]],
  [0.75, [53, 183, 121]],
  [0.875, [110, 206, 88]],
  [1.0, [253, 231, 37]],
];

const DEPTH_ANCHORS: readonly Anchor[] = [
  [0.0, [247, 251, 255]],
  [0.25, [198, 219, 239]],
  [0.5, [107, 174, 214]],
  [0.75, [33, 113, 181]],
  [1.0, [8, 48, 107]],
];

const TERRAIN_ANCHORS: readonly Anchor[] = [
  [0.0, [44, 123, 182]],
  [0.25, [171, 217, 233]],
  [0.5, [255, 255, 191]],
  [0.75, [166, 217, 106]],
  [1.0, [26, 150, 65]],
];

const GRAYSCALE_ANCHORS: readonly Anchor[] = [
  [0.0, [0, 0, 0]],
  [1.0, [255, 255, 255]],
];

// Legacy parity (triton-vscode-extension Colors.ts): piecewise-linear, breakpoints on anchors.
const RAINBOW_ANCHORS: readonly Anchor[] = [
  [0.0, [0, 0, 255]],
  [0.25, [0, 255, 255]],
  [0.5, [0, 255, 0]],
  [0.75, [255, 255, 0]],
  [1.0, [255, 0, 0]],
];

const MAGMA_ANCHORS: readonly Anchor[] = [
  [0.0, [0, 0, 0]],
  [0.33, [80, 0, 80]],
  [0.66, [255, 100, 0]],
  [1.0, [255, 255, 150]],
];

const BLUES_ANCHORS: readonly Anchor[] = [
  [0.0, [247, 251, 255]],
  [0.5, [107, 174, 214]],
  [1.0, [8, 48, 107]],
];

const TEAL_ANCHORS: readonly Anchor[] = [
  [0.0, [224, 255, 255]],
  [0.5, [100, 200, 200]],
  [1.0, [0, 100, 100]],
];

const WATER_ANCHORS: readonly Anchor[] = [
  [0.0, [200, 200, 255]],
  [1.0, [0, 0, 255]],
];

/** Build a 768-byte LUT by linear interpolation across the given anchors. */
function buildLut(anchors: readonly Anchor[]): Uint8Array {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let lo = anchors[0];
    let hi = anchors[anchors.length - 1];
    for (let a = 0; a < anchors.length - 1; a++) {
      if (t >= anchors[a][0] && t <= anchors[a + 1][0]) {
        lo = anchors[a];
        hi = anchors[a + 1];
        break;
      }
    }
    const span = hi[0] - lo[0];
    const f = span === 0 ? 0 : (t - lo[0]) / span;
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = Math.round(lo[1][c] + (hi[1][c] - lo[1][c]) * f);
    }
  }
  return lut;
}

function makeCmap(name: string, anchors: readonly Anchor[]): Colormap {
  return { name, lut: buildLut(anchors) };
}

/** Canonical ordered tuple of all supported colormap names. */
export const COLORMAP_NAMES = ['viridis', 'depth', 'terrain', 'grayscale', 'rainbow', 'magma', 'teal', 'water', 'blues'] as const;
export type ColormapName = (typeof COLORMAP_NAMES)[number];

/** The nine available colormaps, keyed by name. */
export const COLORMAPS: Record<ColormapName, Colormap> = {
  viridis: makeCmap('viridis', VIRIDIS_ANCHORS),
  depth: makeCmap('depth', DEPTH_ANCHORS),
  terrain: makeCmap('terrain', TERRAIN_ANCHORS),
  grayscale: makeCmap('grayscale', GRAYSCALE_ANCHORS),
  rainbow: makeCmap('rainbow', RAINBOW_ANCHORS),
  magma: makeCmap('magma', MAGMA_ANCHORS),
  teal: makeCmap('teal', TEAL_ANCHORS),
  water: makeCmap('water', WATER_ANCHORS),
  blues: makeCmap('blues', BLUES_ANCHORS),
};

/**
 * Sample a colormap at normalized position `t01`, clamped to [0,1]
 * (t<0 -> entry 0, t>1 -> entry 255). Nearest of the 256 entries.
 */
export function sample(cmap: Colormap, t01: number): [number, number, number] {
  const t = t01 < 0 ? 0 : t01 > 1 ? 1 : t01;
  let i = Math.round(t * 255);
  if (i < 0) i = 0;
  if (i > 255) i = 255;
  return [cmap.lut[i * 3], cmap.lut[i * 3 + 1], cmap.lut[i * 3 + 2]];
}
