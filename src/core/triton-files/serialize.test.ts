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

import {
  parsePointList, parseBoundaries, parseForcingSeries,
} from './index';
import {
  serializePointList, serializeBoundaries, serializeForcingSeries,
} from './serialize';

const real = join(process.cwd(), 'resources/triton-examples/real');

describe('table serializers (round-trip through the real parsers)', () => {
  it('point list round-trips (.src) with a canonical header', () => {
    const orig = parsePointList(readFileSync(join(real, 'allatoona.src'), 'utf8'));
    const txt = serializePointList(orig);
    expect(txt.startsWith('%')).toBe(true);
    const rt = parsePointList(txt);
    expect(rt).toEqual(orig);
  });
  it('boundaries round-trip (.extbc)', () => {
    const orig = parseBoundaries(readFileSync(join(real, 'allatoona.extbc'), 'utf8'));
    const rt = parseBoundaries(serializeBoundaries(orig));
    expect(rt).toEqual(orig);
  });
  it('forcing series round-trips (.hyg), re-interleaving time + columns', () => {
    const orig = parseForcingSeries(readFileSync(join(real, 'allatoona.hyg'), 'utf8'));
    const rt = parseForcingSeries(serializeForcingSeries(orig));
    expect(rt.times).toEqual(orig.times);
    expect(rt.columns).toEqual(orig.columns);
  });
  it('forcing rejects a column/time length mismatch', () => {
    expect(() => serializeForcingSeries({ times: [0, 1], columns: [[5]] })).toThrow(/disagrees with times/);
  });
});

import { parseTritonConfig } from './index';
import { serializeConfigCanonical, editConfigText, IsPathVar } from './serialize';

const isPath: IsPathVar = (k) => ['dem_filename', 'src_loc_file', 'n_infile'].includes(k.toLowerCase());

describe('config serializers', () => {
  it('canonical generation round-trips entries+order and quotes path vars only', () => {
    const orig = parseTritonConfig(readFileSync(join(mini, 'mini.cfg'), 'utf8'));
    const txt = serializeConfigCanonical(orig, isPath);
    expect(txt).toContain('dem_filename="dem.dem"');
    expect(txt).toContain('num_sources=1');
    const rt = parseTritonConfig(txt);
    expect(rt.entries).toEqual(orig.entries);
    expect(rt.order).toEqual(orig.order);
  });

  it('surgical edit preserves comments/quoting/order, changing only targeted keys', () => {
    const original = readFileSync(join(mini, 'mini.cfg'), 'utf8');
    const edited = editConfigText(original, { sim_duration: '50', output_format: 'GTIFF' }, isPath);
    expect(edited).toContain('# mini Triton project');
    expect(edited).toContain('dem_filename="dem.dem"');
    expect(edited).toMatch(/(^|\n)sim_duration=50(\n|$)/);
    expect(edited).toMatch(/(^|\n)output_format=GTIFF(\n|$)/);
    expect(edited.split('\n').length).toBe(original.split('\n').length); // no comment/blank lost
    const rt = parseTritonConfig(edited);
    expect(rt.order).toEqual(parseTritonConfig(original).order);
    expect(rt.entries.sim_duration).toBe('50');
    expect(rt.entries.dem_filename).toBe('dem.dem');
    expect(rt.entries.input_format).toBe('ASC');
  });

  it('surgical edit adds a new key (path-quoted) and deletes via null', () => {
    const original = readFileSync(join(mini, 'mini.cfg'), 'utf8');
    const edited = editConfigText(original, { n_infile: 'roughness.mann', num_sources: null }, isPath);
    const rt = parseTritonConfig(edited);
    expect(edited).toContain('n_infile="roughness.mann"');
    expect(rt.entries.n_infile).toBe('roughness.mann');
    expect('num_sources' in rt.entries).toBe(false);
    expect(edited.endsWith('\n')).toBe(true);
  });
});
