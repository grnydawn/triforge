/** A decoded single-band Float32 GeoTIFF tile (pure: bytes in, struct out). */
export interface GeoTiffTile {
  width: number; height: number; values: Float64Array;
  geoTransform: [number, number, number, number, number, number]; // [originX, pxW, rotX, originY, rotY, pxH]
  epsg?: number; nodata?: number;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };

/**
 * Decode a TRITON-style GeoTIFF: little-endian classic TIFF, uncompressed,
 * single-band IEEE Float32, strip-organized. Rejects anything outside that subset
 * (big-endian, BigTIFF, compression, tiled, multiband, non-Float32) with a specific error.
 */
export function readFloat32GeoTiff(buf: Uint8Array): GeoTiffTile {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
  if (b0 === 0x4d && b1 === 0x4d) throw new Error('GeoTIFF: big-endian (MM) not supported');
  if (!(b0 === 0x49 && b1 === 0x49)) throw new Error('GeoTIFF: not a TIFF (bad byte-order mark)');
  const le = true;
  const magic = dv.getUint16(2, le);
  if (magic === 43) throw new Error('GeoTIFF: BigTIFF not supported');
  if (magic !== 42) throw new Error(`GeoTIFF: bad magic ${magic}`);
  const ifdOff = dv.getUint32(4, le);
  const count = dv.getUint16(ifdOff, le);
  type Entry = { type: number; count: number; vals: number[] };
  const tags = new Map<number, Entry>();
  for (let i = 0; i < count; i++) {
    const e = ifdOff + 2 + i * 12;
    const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), cnt = dv.getUint32(e + 4, le);
    const size = TYPE_SIZE[type] ?? 0, total = size * cnt;
    const dataOff = total <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    const vals: number[] = [];
    for (let k = 0; k < cnt; k++) {
      const o = dataOff + k * size;
      if (type === 3) vals.push(dv.getUint16(o, le));
      else if (type === 4) vals.push(dv.getUint32(o, le));
      else if (type === 12) vals.push(dv.getFloat64(o, le));
      else if (type === 11) vals.push(dv.getFloat32(o, le));
      else if (type === 1 || type === 2) vals.push(dv.getUint8(o));
      else if (type === 5) { vals.push(dv.getUint32(o, le)); vals.push(dv.getUint32(o + 4, le)); }
    }
    tags.set(tag, { type, count: cnt, vals });
  }
  const one = (tag: number, dflt?: number): number => {
    const t = tags.get(tag);
    if (!t) { if (dflt !== undefined) return dflt; throw new Error(`GeoTIFF: missing tag ${tag}`); }
    return t.vals[0];
  };
  if (tags.has(322) || tags.has(323)) throw new Error('GeoTIFF: tiled layout not supported (TRITON outputs are stripped)');
  const width = one(256), height = one(257);
  const compression = one(259, 1);
  if (compression !== 1) throw new Error(`GeoTIFF: compression ${compression} not supported (expected uncompressed)`);
  const spp = one(277, 1);
  if (spp !== 1) throw new Error(`GeoTIFF: ${spp} samples/pixel not supported (expected single band)`);
  const bits = one(258), sampleFormat = one(339, 1);
  if (bits !== 32 || sampleFormat !== 3) throw new Error(`GeoTIFF: not Float32 (BitsPerSample=${bits}, SampleFormat=${sampleFormat})`);
  const rowsPerStrip = one(278, height);
  const stripOffsets = tags.get(273)!.vals;
  const values = new Float64Array(width * height);
  let row = 0;
  for (let s = 0; s < stripOffsets.length; s++) {
    const rows = Math.min(rowsPerStrip, height - row);
    let o = stripOffsets[s];
    for (let r = 0; r < rows; r++) for (let c = 0; c < width; c++) { values[(row + r) * width + c] = dv.getFloat32(o, le); o += 4; }
    row += rows;
  }
  if (row !== height) throw new Error(`GeoTIFF: decoded ${row} rows, expected ${height}`);
  const scale = tags.get(33550)?.vals, tie = tags.get(33922)?.vals;
  let geoTransform: GeoTiffTile['geoTransform'] = [0, 1, 0, 0, 0, -1];
  if (scale && tie) {
    const [sx, sy] = scale; const [i, j, , X, Y] = tie;
    geoTransform = [X - i * sx, sx, 0, Y - j * (-sy), 0, -sy];
  }
  let epsg: number | undefined;
  const gk = tags.get(34735)?.vals;
  if (gk) {
    const n = gk[3];
    for (let k = 0; k < n; k++) {
      const keyId = gk[4 + k * 4], loc = gk[4 + k * 4 + 1], val = gk[4 + k * 4 + 3];
      if (loc === 0 && (keyId === 3072 || keyId === 2048)) { epsg = val; if (keyId === 3072) break; }
    }
  }
  const nodataTag = tags.get(42113); // GDAL_NODATA (ASCII) — absent on TRITON outputs
  const nodata = nodataTag ? Number(String.fromCharCode(...nodataTag.vals).trim()) : undefined;
  return { width, height, values, geoTransform, epsg, nodata };
}
