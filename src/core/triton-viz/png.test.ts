import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import { encodePng } from './png';
import type { Raster } from './types';

const deflate = (b: Uint8Array): Uint8Array => new Uint8Array(zlib.deflateSync(b));

/** Walk PNG chunks and return the concatenated IDAT payload. */
function idatOf(png: Uint8Array): Uint8Array {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: number[] = [];
  let off = 8;
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (type === 'IDAT') for (let i = 0; i < len; i++) parts.push(png[off + 8 + i]);
    off += 12 + len;
  }
  return Uint8Array.from(parts);
}

describe('encodePng', () => {
  it('emits a valid signature + IHDR and round-trips RGBA through inflate', () => {
    const w = 3, h = 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) & 0xff;
    const png = encodePng({ width: w, height: h, rgba } as Raster, deflate);

    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(dv.getUint32(16)).toBe(w);  // IHDR width
    expect(dv.getUint32(20)).toBe(h);  // IHDR height
    expect(png[24]).toBe(8);           // bit depth
    expect(png[25]).toBe(6);           // color type RGBA

    const raw = new Uint8Array(zlib.inflateSync(Buffer.from(idatOf(png))));
    expect(raw.length).toBe((w * 4 + 1) * h);
    const recovered = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      expect(raw[y * (w * 4 + 1)]).toBe(0); // per-scanline filter byte = none
      for (let x = 0; x < w * 4; x++) recovered[y * w * 4 + x] = raw[y * (w * 4 + 1) + 1 + x];
    }
    expect(Array.from(recovered)).toEqual(Array.from(rgba));
  });
  it('handles a 1x17 image (odd dimension / stride)', () => {
    const w = 1, h = 17;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(123);
    const png = encodePng({ width: w, height: h, rgba } as Raster, deflate);
    const raw = new Uint8Array(zlib.inflateSync(Buffer.from(idatOf(png))));
    expect(raw.length).toBe((w * 4 + 1) * h);
  });
});
