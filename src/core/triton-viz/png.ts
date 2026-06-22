/**
 * Pure PNG encoder (8-bit, color type 6 RGBA, no interlace). DEFLATE is injected
 * (e.g. zlib.deflateSync) so this module imports neither zlib nor fs.
 */
import type { Raster, Deflate } from './types';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([
    type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3),
  ]);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crc = crc32(crcInput);

  const out = new Uint8Array(4 + 4 + data.length + 4);
  out.set(u32be(data.length), 0);
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(u32be(crc), 8 + data.length);
  return out;
}

/**
 * Encode an RGBA raster as a PNG. Scanlines use filter type 0 (none): each row is
 * one 0x00 byte then width*4 RGBA bytes; the concatenation is `deflate`d into IDAT.
 */
export function encodePng(r: Raster, deflate: Deflate): Uint8Array {
  const { width, height, rgba } = r;

  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (stride + 1);
    raw[rawOffset] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), rawOffset + 1);
  }

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', deflate(raw));
  const iendChunk = chunk('IEND', new Uint8Array(0));

  const total = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let p = 0;
  out.set(PNG_SIGNATURE, p); p += PNG_SIGNATURE.length;
  out.set(ihdrChunk, p); p += ihdrChunk.length;
  out.set(idatChunk, p); p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}
