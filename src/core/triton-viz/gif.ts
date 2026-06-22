// Pure animated-GIF (GIF89a) encoder with a hand-rolled LZW packer.
// No I/O, no external dependencies.
//
// LZW code-width growth is the encoder side of a subtle invariant: the width
// increases the moment a code is ASSIGNED that no longer fits the current width
// (nextCode > 2^codeWidth). A matching decoder must widen one entry EARLIER (it is
// always one dictionary entry behind the encoder).
import type { IndexedFrame } from './types';

export interface AnimatedGifOptions {
  delayMs: number;
  loop?: number;
  transparentIndex?: number;
}

// Minimum bits to represent values 0..n-1 (n symbols), floor of 1.
function bitsNeededFor(n: number): number {
  let bits = 1;
  while ((1 << bits) < n) bits++;
  return bits;
}

// LSB-first bit writer: codes packed least-significant-bit first into bytes.
class BitWriter {
  public readonly bytes: number[] = [];
  private cur = 0;
  private nbits = 0;

  public writeCode(code: number, width: number): void {
    this.cur |= code << this.nbits;
    this.nbits += width;
    while (this.nbits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>>= 8;
      this.nbits -= 8;
    }
  }

  public flush(): void {
    if (this.nbits > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.nbits = 0;
    }
  }
}

// Hand-rolled GIF LZW encoder. Returns the raw LZW byte stream (pre sub-block).
function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const bw = new BitWriter();

  let codeWidth = minCodeSize + 1;
  let dict = new Map<string, number>();
  let nextCode = eoiCode + 1;

  const resetDict = (): void => {
    dict = new Map<string, number>();
    for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
    nextCode = eoiCode + 1;
    codeWidth = minCodeSize + 1;
  };
  resetDict();

  bw.writeCode(clearCode, codeWidth);

  if (indices.length === 0) {
    bw.writeCode(eoiCode, codeWidth);
    bw.flush();
    return Uint8Array.from(bw.bytes);
  }

  let seq = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const cand = seq + ',' + k;
    if (dict.has(cand)) {
      seq = cand;
    } else {
      const code = dict.get(seq);
      if (code === undefined) throw new Error('gif: LZW dictionary miss (internal error)');
      bw.writeCode(code, codeWidth);
      if (nextCode <= 4095) {
        dict.set(cand, nextCode);
        nextCode++;
        if (nextCode > (1 << codeWidth) && codeWidth < 12) {
          codeWidth++;
        }
      } else {
        bw.writeCode(clearCode, codeWidth);
        resetDict();
      }
      seq = String(k);
    }
  }
  const lastCode = dict.get(seq);
  if (lastCode === undefined) throw new Error('gif: LZW dictionary miss (internal error)');
  bw.writeCode(lastCode, codeWidth);
  bw.writeCode(eoiCode, codeWidth);
  bw.flush();
  return Uint8Array.from(bw.bytes);
}

function pushU16LE(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >>> 8) & 0xff);
}

function subBlockify(arr: number[], data: Uint8Array): void {
  let off = 0;
  while (off < data.length) {
    const n = Math.min(255, data.length - off);
    arr.push(n);
    for (let i = 0; i < n; i++) arr.push(data[off + i]);
    off += n;
  }
  arr.push(0x00);
}

export function encodeAnimatedGif(
  frames: IndexedFrame[],
  palette: Uint8Array,
  opts: AnimatedGifOptions,
): Uint8Array {
  if (frames.length === 0) throw new Error('gif: no frames');
  const n = palette.length / 3;
  if (!Number.isInteger(n) || n < 1 || n > 256) {
    throw new Error('gif: palette length must be 3*N, 1<=N<=256');
  }

  const w0 = frames[0].width;
  const h0 = frames[0].height;

  let gctSize = Math.ceil(Math.log2(n)) - 1;
  if (gctSize < 0) gctSize = 0;
  const gctEntries = 1 << (gctSize + 1);

  const out: number[] = [];

  for (const c of 'GIF89a') out.push(c.charCodeAt(0));

  pushU16LE(out, w0);
  pushU16LE(out, h0);
  const colorResolution = 7;
  const packed = (1 << 7) | (colorResolution << 4) | (0 << 3) | gctSize;
  out.push(packed);
  out.push(0);
  out.push(0);

  for (let i = 0; i < gctEntries; i++) {
    if (i < n) {
      out.push(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]);
    } else {
      out.push(0, 0, 0);
    }
  }

  out.push(0x21, 0xff, 0x0b);
  for (const c of 'NETSCAPE2.0') out.push(c.charCodeAt(0));
  out.push(0x03, 0x01);
  pushU16LE(out, opts.loop ?? 0);
  out.push(0x00);

  const minCodeSize = Math.max(2, bitsNeededFor(n));
  const delay = Math.round(opts.delayMs / 10);
  const transparentIndex = opts.transparentIndex;
  const hasTransparent = transparentIndex != null;

  for (const f of frames) {
    out.push(0x21, 0xf9, 0x04);
    const disposal = 1;
    const gcePacked = (hasTransparent ? 1 : 0) | (disposal << 2);
    out.push(gcePacked);
    pushU16LE(out, delay);
    out.push(hasTransparent ? transparentIndex : 0);
    out.push(0x00);

    out.push(0x2c);
    pushU16LE(out, 0);
    pushU16LE(out, 0);
    pushU16LE(out, f.width);
    pushU16LE(out, f.height);
    out.push(0x00);

    out.push(minCodeSize);
    const lzw = lzwEncode(f.indices, minCodeSize);
    subBlockify(out, lzw);
  }

  out.push(0x3b);
  return Uint8Array.from(out);
}
