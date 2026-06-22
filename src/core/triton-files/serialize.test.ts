import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseEsriAsciiGrid, parseHeaderlessMatrix, Grid } from './index';
import { formatNum, serializeEsriAsciiGrid, serializeHeaderlessMatrix } from './serialize';

const mini = join(process.cwd(), 'resources/triton-examples/mini');
const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

describe('formatNum', () => {
  it('emits NUMERIC-valid, round-trippable tokens; integers have no dot', () => {
    for (const x of [0, 1, -9999, 0.035, 1.787598324, 719559.01581497, 1e-7, 1e21, -1e21, 256.057]) {
      const s = formatNum(x);
      expect(NUMERIC.test(s), s).toBe(true);
      expect(Number(s)).toBe(x);
    }
    expect(formatNum(3)).toBe('3');
    expect(formatNum(-9999)).toBe('-9999');
  });
  it('throws on non-finite', () => {
    expect(() => formatNum(NaN)).toThrow();
    expect(() => formatNum(Infinity)).toThrow();
  });
});

describe('grid serializers (round-trip through the real parsers)', () => {
  it('ESRI .dem round-trips value-exact with canonical header', () => {
    const orig = parseEsriAsciiGrid(readFileSync(join(mini, 'dem.dem'), 'utf8'));
    const txt = serializeEsriAsciiGrid(orig);
    expect(txt.startsWith('ncols 3\nnrows 2\n')).toBe(true);
    expect(txt).toContain('NODATA_value -9999');
    const rt = parseEsriAsciiGrid(txt);
    expect(rt.ncols).toBe(orig.ncols);
    expect(rt.nrows).toBe(orig.nrows);
    expect([rt.cellsize, rt.xll, rt.yll, rt.nodata]).toEqual([orig.cellsize, orig.xll, orig.yll, orig.nodata]);
    expect(Array.from(rt.values)).toEqual(Array.from(orig.values));
  });
  it('ESRI write requires georef', () => {
    const g: Grid = { ncols: 2, nrows: 1, nodata: -9999, values: Float64Array.from([1, 2]) };
    expect(() => serializeEsriAsciiGrid(g)).toThrow(/cellsize\/xll\/yll required/);
  });
  it('headerless matrix round-trips value-exact', () => {
    const g: Grid = { ncols: 3, nrows: 2, nodata: -9999, values: Float64Array.from([0.035, 0.035, 0.035, 0.04, 0.04, -9999]) };
    const rt = parseHeaderlessMatrix(serializeHeaderlessMatrix(g), 3, 2, -9999);
    expect(Array.from(rt.values)).toEqual(Array.from(g.values));
  });
  it('rejects a values/dims mismatch', () => {
    const g: Grid = { ncols: 3, nrows: 2, nodata: -9999, values: Float64Array.from([1, 2, 3]) };
    expect(() => serializeHeaderlessMatrix(g)).toThrow(/values length/);
  });
});
