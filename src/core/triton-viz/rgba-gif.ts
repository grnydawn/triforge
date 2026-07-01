/** Encode true-color RGBA frames to an animated GIF: median-cut quantize → the palette-indexed
 *  GIF89a encoder. No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import type { Raster } from './types';
import { quantizeFrames } from './quantize';
import { encodeAnimatedGif } from './gif';

export interface RgbaGifOptions { fps?: number; loop?: number; }

/** Quantize same-size RGBA frames to a shared 256-color palette, then GIF89a-encode. Throws if empty. */
export function encodeRgbaFramesToGif(frames: Raster[], opts: RgbaGifOptions = {}): Uint8Array {
  if (frames.length === 0) throw new Error('no frames to encode');
  const fps = opts.fps && opts.fps > 0 ? opts.fps : 4;
  const { palette, indexed } = quantizeFrames(frames);
  return encodeAnimatedGif(indexed, palette, { delayMs: Math.round(1000 / fps), loop: opts.loop ?? 0 });
}
