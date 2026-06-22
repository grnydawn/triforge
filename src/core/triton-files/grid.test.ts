import { describe, it, expect } from 'vitest';
import { parseEsriAsciiGrid, parseEsriHeader, parseHeaderlessMatrix, parseHeaderlessBody, parseBinaryGrid } from './grid';

describe('parseEsriAsciiGrid', () => {
  const text = [
    'NCOLS 3', 'NROWS 2', 'XLLCORNER 100', 'YLLCORNER 200', 'CELLSIZE 10', 'NODATA_value -9999',
    '1 2 3', '4 5 -9999',
  ].join('\n');
  it('parses header (case-insensitive) and row-major body', () => {
    const g = parseEsriAsciiGrid(text);
    expect(g.ncols).toBe(3); expect(g.nrows).toBe(2);
    expect(g.cellsize).toBe(10); expect(g.xll).toBe(100); expect(g.yll).toBe(200);
    expect(g.nodata).toBe(-9999);
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4, 5, -9999]);
  });
  it('shifts *center to corner', () => {
    const g = parseEsriAsciiGrid(text.replace('XLLCORNER 100', 'XLLCENTER 105').replace('YLLCORNER 200', 'YLLCENTER 205'));
    expect(g.xll).toBe(100); expect(g.yll).toBe(200); // 105 - 10/2
  });
  it('tolerates variable whitespace and lowercase keys', () => {
    const g = parseEsriAsciiGrid('ncols         3\nnrows         1\ncellsize 30\nNODATA_value  -9999\n7 8 9');
    expect(g.ncols).toBe(3); expect(g.cellsize).toBe(30);
    expect(Array.from(g.values)).toEqual([7, 8, 9]);
  });
  it('throws when the body has too few values', () => {
    expect(() => parseEsriAsciiGrid(text.replace('4 5 -9999', '4 5'))).toThrow(/expected 6 values, got 5/);
  });
  it('throws when the body has too many values', () => {
    expect(() => parseEsriAsciiGrid(text.replace('4 5 -9999', '4 5 -9999 7'))).toThrow(/got more/);
  });
  it('rejects a garbage / non-numeric body token', () => {
    expect(() => parseEsriAsciiGrid(text.replace('4 5 -9999', '4 abc -9999'))).toThrow(/non-numeric value 'abc'/);
  });
  it.each(['5abc', '1,5', '1.2.3'])('rejects a truncatable body token (%s) instead of silently coercing', (bad) => {
    expect(() => parseEsriAsciiGrid(text.replace('4 5 -9999', `4 ${bad} -9999`))).toThrow(/non-numeric value/);
  });
  it('throws when a required header field is missing', () => {
    const missingNrows = [
      'NCOLS 3', 'XLLCORNER 100', 'YLLCORNER 200', 'CELLSIZE 10', 'NODATA_value -9999',
      '1 2 3', '4 5 -9999',
    ].join('\n');
    expect(() => parseEsriAsciiGrid(missingNrows)).toThrow(/missing ncols\/nrows/);
  });
  it('rejects a malformed header value (1.2.3 not silently truncated)', () => {
    expect(() => parseEsriAsciiGrid(text.replace('CELLSIZE 10', 'CELLSIZE 1.2.3'))).toThrow();
  });
});

describe('parseEsriHeader', () => {
  it('reads only the header (no body required)', () => {
    const h = parseEsriHeader('NCOLS 591\nNROWS 673\nXLLCORNER 719559.0\nYLLCORNER 3765449.0\nCELLSIZE 30\nNODATA_value -9999\n305.2 301.1');
    expect(h.ncols).toBe(591); expect(h.nrows).toBe(673); expect(h.cellsize).toBe(30);
    expect(h.xll).toBe(719559.0); expect(h.nodata).toBe(-9999);
  });
});

describe('parseHeaderlessMatrix', () => {
  it('parses a matrix given dimensions', () => {
    const g = parseHeaderlessMatrix('0.1 0.2 0.3\n0.4 0.5 0.6', 3, 2);
    expect(g.ncols).toBe(3); expect(g.nrows).toBe(2);
    expect(Array.from(g.values)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  });
  it('throws when the body has too many values for the supplied dims', () => {
    expect(() => parseHeaderlessMatrix('1 2 3 4 5 6 7', 3, 2)).toThrow(/got more/);
  });
  it('throws when the body has too few values for the supplied dims', () => {
    expect(() => parseHeaderlessMatrix('1 2 3', 3, 2)).toThrow(/expected 6 values, got 3/);
  });
  it('rejects a non-numeric token', () => {
    expect(() => parseHeaderlessMatrix('1 2 3\n4 x 6', 3, 2)).toThrow(/non-numeric value 'x'/);
  });
  it.each([
    [-3, 2],
    [3, 0],
    [2.5, 2],
    [NaN, 2],
  ])('rejects implausible dimensions ncols=%s nrows=%s', (ncols, nrows) => {
    expect(() => parseHeaderlessMatrix('1 2 3', ncols, nrows)).toThrow(/implausible dimensions/);
  });
});

describe('parseHeaderlessBody', () => {
  it('reads a flat value sequence of unknown shape (1xN) for PAR-mode subdomain parts', () => {
    const g = parseHeaderlessBody('0.1 0.2\n0.3', -9999);
    expect(g.nrows).toBe(1); expect(g.ncols).toBe(3);
    expect(Array.from(g.values)).toEqual([0.1, 0.2, 0.3]);
  });
  it('rejects a non-numeric token', () => {
    expect(() => parseHeaderlessBody('1 2 x')).toThrow(/non-numeric value 'x'/);
  });
});

describe('parseBinaryGrid', () => {
  it('reads the 16-byte LE Float64 (nrows,ncols) header + body', () => {
    const buf = Buffer.alloc(16 + 6 * 8);
    buf.writeDoubleLE(2, 0); // nrows
    buf.writeDoubleLE(3, 8); // ncols
    [10, 20, 30, 40, 50, 60].forEach((v, i) => buf.writeDoubleLE(v, 16 + i * 8));
    const g = parseBinaryGrid(buf);
    expect(g.nrows).toBe(2); expect(g.ncols).toBe(3);
    expect(Array.from(g.values)).toEqual([10, 20, 30, 40, 50, 60]);
  });
  it('rejects an implausible header', () => {
    expect(() => parseBinaryGrid(Buffer.alloc(16))).toThrow();
  });
  it('throws when the body is truncated (fewer doubles than the header declares)', () => {
    const buf = Buffer.alloc(16 + 4 * 8); // header declares 2x3=6, body holds only 4
    buf.writeDoubleLE(2, 0); // nrows
    buf.writeDoubleLE(3, 8); // ncols
    expect(() => parseBinaryGrid(buf)).toThrow(/expected .* bytes/);
  });
});
