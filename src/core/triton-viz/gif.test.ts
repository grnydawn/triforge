import { describe, it, expect } from 'vitest';
import { encodeAnimatedGif } from './gif';
import type { IndexedFrame } from './types';

// Independent GIF LZW decoder (does NOT reuse the encoder). Widens one entry
// earlier than the encoder, per the GIF spec (decoder lags by one dict entry).
function lzwDecode(data: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeWidth = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([]); dict.push([]); // placeholders for clear/eoi
    codeWidth = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bitBuf = 0, bitCnt = 0, pos = 0;
  let prev: number[] | null = null;
  const read = (): number => {
    while (bitCnt < codeWidth) { bitBuf |= data[pos++] << bitCnt; bitCnt += 8; }
    const code = bitBuf & ((1 << codeWidth) - 1);
    bitBuf >>>= codeWidth; bitCnt -= codeWidth;
    return code;
  };
  for (;;) {
    const code = read();
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad first code');
    out.push(...entry);
    if (prev) {
      dict.push([...prev, entry[0]]);
      if (dict.length + 1 > (1 << codeWidth) && codeWidth < 12) codeWidth++;
    }
    prev = entry;
  }
  return out;
}

/** Minimal GIF parser: magic, screen dims, loop-ext presence, per-frame decoded indices. */
function parse(gif: Uint8Array): { magic: string; w: number; h: number; loop: boolean; frames: number[][] } {
  const dv = new DataView(gif.buffer, gif.byteOffset, gif.byteLength);
  const magic = String.fromCharCode(...Array.from(gif.slice(0, 6)));
  const w = dv.getUint16(6, true), h = dv.getUint16(8, true);
  const gctSize = gif[10] & 0x7;
  const gctLen = 1 << (gctSize + 1);
  let off = 13 + gctLen * 3;
  let loop = false;
  const frames: number[][] = [];
  while (off < gif.length) {
    const b = gif[off];
    if (b === 0x3b) break;
    if (b === 0x21) { // extension
      if (gif[off + 1] === 0xff) loop = true;
      off += 2;
      while (gif[off] !== 0) off += gif[off] + 1;
      off += 1;
    } else if (b === 0x2c) { // image descriptor
      off += 10; // 0x2c + left/top/w/h (8) + packed (1)
      const minCodeSize = gif[off++];
      const chunks: number[] = [];
      while (gif[off] !== 0) { const n = gif[off++]; for (let i = 0; i < n; i++) chunks.push(gif[off++]); }
      off += 1;
      frames.push(lzwDecode(Uint8Array.from(chunks), minCodeSize));
    } else { off++; }
  }
  return { magic, w, h, loop, frames };
}

describe('encodeAnimatedGif', () => {
  it('round-trips two frames through an independent LZW decoder', () => {
    const w = 16, h = 16;
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < idx.length; i++) idx[i] = (i * 5 + (i >> 2)) & 3; // N=4, varied
    const idx2 = idx.map((v) => 3 - v);
    const f1: IndexedFrame = { width: w, height: h, indices: idx };
    const f2: IndexedFrame = { width: w, height: h, indices: idx2 };
    const pal = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]); // N=4
    const gif = encodeAnimatedGif([f1, f2], pal, { delayMs: 200, loop: 0, transparentIndex: 3 });

    const p = parse(gif);
    expect(p.magic).toBe('GIF89a');
    expect(p.w).toBe(16); expect(p.h).toBe(16);
    expect(p.loop).toBe(true);
    expect(p.frames.length).toBe(2);
    expect(Array.from(p.frames[0])).toEqual(Array.from(idx));
    expect(Array.from(p.frames[1])).toEqual(Array.from(idx2));
  });

  it('round-trips a large frame that forces dictionary growth and a mid-stream Clear', () => {
    const w = 160, h = 160; // 25600 px over N=4 reaches the 4095-code reset
    const idx = new Uint8Array(w * h);
    let s = 0x1234abcd >>> 0;
    for (let i = 0; i < idx.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; idx[i] = s & 3; }
    const pal = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const gif = encodeAnimatedGif([{ width: w, height: h, indices: idx }], pal, { delayMs: 100 });
    const p = parse(gif);
    expect(Array.from(p.frames[0])).toEqual(Array.from(idx));
  });
});
