import { describe, it, expect } from 'vitest';
import { readFloat32GeoTiff } from './tiff';
import { buildTinyGeoTiff } from './geotiff.fixture';

describe('readFloat32GeoTiff', () => {
  it('decodes a minimal Float32 strip GeoTIFF (dims, values, geotransform, EPSG)', () => {
    const vals = [1.5, 2.5, 3.5, -4.5, 0, 9.25]; // 3x2 row-major
    const t = readFloat32GeoTiff(buildTinyGeoTiff(3, 2, vals, 32616, 100, 200, 30));
    expect([t.width, t.height]).toEqual([3, 2]);
    expect(Array.from(t.values)).toEqual(vals);
    expect(t.epsg).toBe(32616);
    expect(t.geoTransform).toEqual([100, 30, 0, 200, 0, -30]);
    expect(t.nodata).toBeUndefined();
  });
  const mutate = (fn: (dv: DataView, buf: Uint8Array) => void) => {
    const buf = buildTinyGeoTiff(2, 1, [1, 2], 32616, 0, 0, 1);
    const dv = new DataView(buf.buffer); fn(dv, buf); return buf;
  };
  const tagOff = (dv: DataView, tag: number) => {
    const n = dv.getUint16(8, true);
    for (let i = 0; i < n; i++) { const e = 10 + i * 12; if (dv.getUint16(e, true) === tag) return e; }
    throw new Error('tag not found');
  };
  it('rejects big-endian', () => { expect(() => readFloat32GeoTiff(mutate((_, b) => { b[0] = 0x4d; b[1] = 0x4d; }))).toThrow(/big-endian/); });
  it('rejects BigTIFF', () => { expect(() => readFloat32GeoTiff(mutate((dv) => dv.setUint16(2, 43, true)))).toThrow(/BigTIFF/); });
  it('rejects a non-TIFF buffer', () => { expect(() => readFloat32GeoTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a TIFF|bad magic|byte-order/); });
  it('rejects compression != 1', () => { expect(() => readFloat32GeoTiff(mutate((dv) => dv.setUint16(tagOff(dv, 259) + 8, 5, true)))).toThrow(/compression/); });
  it('rejects non-Float32 sample format', () => { expect(() => readFloat32GeoTiff(mutate((dv) => dv.setUint16(tagOff(dv, 339) + 8, 1, true)))).toThrow(/Float32/); });
});
