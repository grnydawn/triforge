/** Pure median-cut color quantization: true-color RGBA frames → a shared ≤256-color GIF palette.
 *  No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import type { Raster, IndexedFrame } from './types';

const R = (p: number) => (p >> 16) & 255;
const G = (p: number) => (p >> 8) & 255;
const B = (p: number) => p & 255;

interface Box { lo: number; hi: number; rMin: number; rMax: number; gMin: number; gMax: number; bMin: number; bMax: number; }

function makeBox(s: number[], lo: number, hi: number): Box {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (let i = lo; i < hi; i++) {
    const p = s[i], r = R(p), g = G(p), b = B(p);
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  return { lo, hi, rMin, rMax, gMin, gMax, bMin, bMax };
}

function boxRange(b: Box): number {
  return Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);
}

function boxLongest(b: Box): number {
  const dr = b.rMax - b.rMin, dg = b.gMax - b.gMin, db = b.bMax - b.bMin;
  return dr >= dg && dr >= db ? 0 : dg >= db ? 1 : 2;
}

function sortRange(s: number[], lo: number, hi: number, ch: number): void {
  const shift = ch === 0 ? 16 : ch === 1 ? 8 : 0;
  const sub = s.slice(lo, hi);
  sub.sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
  for (let i = 0; i < sub.length; i++) s[lo + i] = sub[i];
}

function boxMean(s: number[], b: Box): [number, number, number] {
  let r = 0, g = 0, bb = 0;
  const n = b.hi - b.lo;
  for (let i = b.lo; i < b.hi; i++) { const p = s[i]; r += R(p); g += G(p); bb += B(p); }
  return n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(bb / n)] : [0, 0, 0];
}

function medianCut(samples: number[], maxColors: number): Box[] {
  let boxes: Box[] = [makeBox(samples, 0, samples.length)];
  while (boxes.length < maxColors) {
    let target = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo <= 1) continue;
      const r = boxRange(b);
      if (r > best) { best = r; target = i; }
    }
    if (target < 0) break;
    const b = boxes[target];
    sortRange(samples, b.lo, b.hi, boxLongest(b));
    const mid = (b.lo + b.hi) >> 1;
    boxes = boxes.slice(0, target).concat([makeBox(samples, b.lo, mid), makeBox(samples, mid, b.hi)], boxes.slice(target + 1));
  }
  return boxes;
}

/**
 * Median-cut quantize a set of RGBA frames to one shared palette. Samples colors by fixed
 * stride across all frames (bounded), splits until ≤maxColors boxes, then maps every pixel
 * of every frame through a 32³ RGB→index cube (O(1)/pixel). Deterministic; opaque input
 * (no transparent index reserved). Palette is always maxColors*3 bytes (unused entries zero).
 */
export function quantizeFrames(frames: Raster[], maxColors = 256): { palette: Uint8Array; indexed: IndexedFrame[] } {
  const palette = new Uint8Array(maxColors * 3);
  if (frames.length === 0) return { palette, indexed: [] };

  const SAMPLE_CAP = 32768;
  let totalPixels = 0;
  for (const f of frames) totalPixels += f.width * f.height;
  const stride = Math.max(1, Math.floor(totalPixels / SAMPLE_CAP));
  const samples: number[] = [];
  let counter = 0;
  for (const f of frames) {
    const d = f.rgba;
    const n = f.width * f.height;
    for (let p = 0; p < n; p++) {
      if (counter++ % stride !== 0) continue;
      const o = p * 4;
      samples.push((d[o] << 16) | (d[o + 1] << 8) | d[o + 2]);
    }
  }
  if (samples.length === 0) samples.push(0);

  const boxes = medianCut(samples, maxColors);
  const colors: [number, number, number][] = boxes.map((b) => boxMean(samples, b));
  for (let i = 0; i < colors.length; i++) {
    palette[i * 3] = colors[i][0]; palette[i * 3 + 1] = colors[i][1]; palette[i * 3 + 2] = colors[i][2];
  }

  const cube = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const rr = r << 3, gg = g << 3, bb = b << 3;
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < colors.length; i++) {
      const dr = rr - colors[i][0], dg = gg - colors[i][1], db = bb - colors[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    cube[(r << 10) | (g << 5) | b] = bestI;
  }

  const indexed = frames.map((f) => {
    const n = f.width * f.height;
    const indices = new Uint8Array(n);
    const d = f.rgba;
    for (let p = 0; p < n; p++) {
      const o = p * 4;
      indices[p] = cube[((d[o] >> 3) << 10) | ((d[o + 1] >> 3) << 5) | (d[o + 2] >> 3)];
    }
    return { width: f.width, height: f.height, indices };
  });

  return { palette, indexed };
}
