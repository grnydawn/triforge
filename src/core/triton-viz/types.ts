/** Shared value types for the pure triton-viz rendering/encoding layer. */
import type { Grid } from '../triton-files';

export type { Grid };

/** A raster image: RGBA bytes, row-major, 4 bytes/pixel. */
export interface Raster {
  width: number;
  height: number;
  rgba: Uint8ClampedArray; // length 4*width*height
}

/** A palette-indexed frame (1 byte/pixel) for GIF assembly. */
export interface IndexedFrame {
  width: number;
  height: number;
  indices: Uint8Array; // length width*height; each value is a palette index
}

/** A closed value range used for normalization. */
export interface Range { min: number; max: number }

/** Injected DEFLATE compressor (e.g. zlib.deflateSync), kept out of the pure core. */
export type Deflate = (bytes: Uint8Array) => Uint8Array;

/** A named 256-entry RGB lookup table (lut length 768 = 256*3). */
export interface Colormap { name: string; lut: Uint8Array }
