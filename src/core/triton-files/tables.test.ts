import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePointList, parseBoundaries, parseForcingSeries, parseOutputSeries, parsePerformance } from './tables';

const real = (f: string) => readFileSync(join(process.cwd(), 'resources/triton-examples/real', f), 'utf8');

describe('parsePointList', () => {
  it('parses % -commented X,Y points (allatoona.src)', () => {
    const pts = parsePointList(real('allatoona.src'));
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ x: 735404.711, y: 3780498.492 });
  });
  it('parses .obs the same way', () => {
    expect(parsePointList(real('allatoona.obs'))).toHaveLength(1);
  });
  it('rejects a non-numeric cell', () => {
    expect(() => parsePointList('1,2\n3,5abc')).toThrow(/non-numeric value '5abc'/);
  });
  it('rejects a too-short row (missing column)', () => {
    expect(() => parsePointList('1,2\n3')).toThrow(/expected 2 columns, got 1/);
  });
  it('rejects a too-wide row (extra trailing column) instead of silently dropping it', () => {
    expect(() => parsePointList('1,2,3')).toThrow(/expected 2 columns, got 3/);
  });
  it('throws on empty input (no data rows)', () => {
    expect(() => parsePointList('% only a comment\n')).toThrow(/no data rows/);
  });
});

describe('parseBoundaries', () => {
  it('parses extbc segments', () => {
    const segs = parseBoundaries(real('allatoona.extbc'));
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ bcType: 3, x1: 719569.048, y1: 3785624.114, x2: 723849.375, y2: 3785624.114, bc: 0.5 });
  });
  it('rejects a non-numeric cell', () => {
    expect(() => parseBoundaries('3,1,2,3,4,abc')).toThrow(/non-numeric value 'abc'/);
  });
  it('rejects a too-short row instead of a misleading undefined error', () => {
    expect(() => parseBoundaries('3,1,2,3,4')).toThrow(/expected 6 columns, got 5/);
  });
  it('rejects a too-wide row (extra trailing column)', () => {
    expect(() => parseBoundaries('3,1,2,3,4,0.5,99')).toThrow(/expected 6 columns, got 7/);
  });
  it('throws on empty input (no data rows)', () => {
    expect(() => parseBoundaries('')).toThrow(/no data rows/);
  });
});

describe('parseForcingSeries', () => {
  it('parses hydrograph: time col + per-source columns', () => {
    const f = parseForcingSeries(real('allatoona.hyg'));
    expect(f.times).toEqual([0, 3, 6, 9]);
    expect(f.columns).toHaveLength(2);
    expect(f.columns[0][0]).toBeCloseTo(1.787598324);
    expect(f.columns[1][2]).toBeCloseTo(12.16067761);
  });
  it('rejects a non-numeric cell', () => {
    expect(() => parseForcingSeries('0 1 2\n3 1.2.3 5')).toThrow(/non-numeric value '1.2.3'/);
  });
  it('rejects a ragged (short) row', () => {
    expect(() => parseForcingSeries('0 1 2\n3 4')).toThrow(/ragged row 1 has 2 columns, expected 3/);
  });
  it('throws on empty input (no columns)', () => {
    expect(() => parseForcingSeries('')).toThrow(/no columns/);
  });
});

describe('parseOutputSeries', () => {
  it('parses a header row + time + per-point columns', () => {
    const s = parseOutputSeries('Time(s),H_at_Point_1,H_at_Point_2\n0.0,0.1,0.2\n1.5,0.3,0.4');
    expect(s.header).toEqual(['Time(s)', 'H_at_Point_1', 'H_at_Point_2']);
    expect(s.times).toEqual([0, 1.5]);
    expect(s.columns[1]).toEqual([0.2, 0.4]);
  });
  it('rejects a non-numeric cell', () => {
    expect(() => parseOutputSeries('Time(s),H_at_Point_1\n0.0,abc')).toThrow(/non-numeric value 'abc'/);
  });
  it('rejects a ragged (short) row vs the header width', () => {
    expect(() => parseOutputSeries('Time(s),H_at_Point_1,H_at_Point_2\n0.0,0.1')).toThrow(/ragged row 0 has 2 columns, expected 3/);
  });
  it('throws on empty input (no header row)', () => {
    expect(() => parseOutputSeries('')).toThrow(/no header row/);
  });
});

describe('parsePerformance', () => {
  it('parses the %-header CSV incl. the Average row', () => {
    const p = parsePerformance(real('performance.txt'));
    expect(p.header[0]).toBe('Rank');
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]['Compute']).toBeCloseTo(0.7065);
    expect(p.rows[2]['Rank']).toBe('Average');
  });
  it('keeps non-numeric cells (e.g. Average) as strings while coercing numbers', () => {
    const p = parsePerformance('%Rank, Total\n0, 4.36\nAverage, 4.36');
    expect(p.rows[0]['Rank']).toBe(0);
    expect(p.rows[1]['Rank']).toBe('Average');
    expect(p.rows[1]['Total']).toBeCloseTo(4.36);
  });
  it('rejects a row whose width does not match the header', () => {
    expect(() => parsePerformance('%Rank, Compute, Total\n0, 0.7\nAverage, 1.7, 4.36')).toThrow(/expected 3 columns, got 2/);
  });
  it('throws on empty input (no header row)', () => {
    expect(() => parsePerformance('')).toThrow(/no header row/);
  });
});
