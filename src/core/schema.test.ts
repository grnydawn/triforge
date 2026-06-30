import { describe, it, expect } from 'vitest';
import { applyDefaults, validate, splitUnknown } from './schema';

const fixedClock = () => '2026-06-21T00:00:00.000Z';

describe('applyDefaults', () => {
  it('fills every default for a minimal input', () => {
    const m = applyDefaults({ project: { name: 'P' } }, fixedClock);
    expect(m.schemaVersion).toBe(2);
    expect(m.project).toEqual({ name: 'P', description: '', createdAt: '2026-06-21T00:00:00.000Z', modifiedAt: '2026-06-21T00:00:00.000Z' });
    expect(m.spatial).toEqual({ crs: '', utmZone: '', datum: '' });
    expect(m.io).toEqual({ inputFormat: 'BIN', outputFormat: 'ASC' });
    expect(m.paths).toEqual({ inputDir: 'input', outputDir: 'output', buildDir: 'build' });
  });

  it('preserves provided values', () => {
    const m = applyDefaults({ schemaVersion: 1, project: { name: 'P', createdAt: 'X' }, io: { inputFormat: 'ASC' } }, fixedClock);
    expect(m.project.createdAt).toBe('X');
    expect(m.io.inputFormat).toBe('ASC');
    expect(m.io.outputFormat).toBe('ASC');
  });
});

describe('validate', () => {
  const good = () => applyDefaults({ project: { name: 'P' } }, fixedClock);

  it('accepts a valid manifest', () => {
    expect(validate(good())).toEqual([]);
  });

  it('rejects an empty project name', () => {
    const m = good(); m.project.name = '   ';
    expect(validate(m).map((e) => e.field)).toContain('project.name');
  });

  it('rejects a bad io enum', () => {
    const m = good(); (m.io as any).inputFormat = 'XYZ';
    expect(validate(m).map((e) => e.field)).toContain('io.inputFormat');
  });

  it('rejects an absolute path', () => {
    const m = good(); m.paths.inputDir = '/var/tmp/in';
    expect(validate(m).map((e) => e.field)).toContain('paths.inputDir');
  });

  it('rejects a Windows absolute path', () => {
    const m = good(); m.paths.outputDir = 'C:\\\\out';
    expect(validate(m).map((e) => e.field)).toContain('paths.outputDir');
  });

  it('rejects a malformed crs but allows empty crs', () => {
    const empty = good(); empty.spatial.crs = '';
    expect(validate(empty)).toEqual([]);
    const bad = good(); bad.spatial.crs = 'epsg:3857';
    expect(validate(bad).map((e) => e.field)).toContain('spatial.crs');
  });

  it('requires schemaVersion to be a number but does not reject higher versions', () => {
    const m = good(); m.schemaVersion = 99;
    expect(validate(m)).toEqual([]);
    (m as any).schemaVersion = 'x';
    expect(validate(m).map((e) => e.field)).toContain('schemaVersion');
  });
});

describe('splitUnknown', () => {
  it('returns only non-known top-level keys', () => {
    const u = splitUnknown({ schemaVersion: 1, project: {}, spatial: {}, io: {}, paths: {}, inputs: { a: 1 }, _importedFrom: 'x' });
    expect(u).toEqual({ inputs: { a: 1 }, _importedFrom: 'x' });
  });
});

describe('applyDefaults spatial.grid', () => {
  it('preserves a complete grid', () => {
    const m = applyDefaults({ project: { name: 'P' }, spatial: { grid: { ncols: 10, nrows: 8, cellsize: 30, xll: 700000, yll: 3700000 } } }, fixedClock);
    expect(m.spatial.grid).toEqual({ ncols: 10, nrows: 8, cellsize: 30, xll: 700000, yll: 3700000 });
  });
  it('omits a partial or missing grid', () => {
    expect(applyDefaults({ project: { name: 'P' } }, fixedClock).spatial.grid).toBeUndefined();
    const partial = applyDefaults({ project: { name: 'P' }, spatial: { grid: { ncols: 10, nrows: 8 } } }, fixedClock);
    expect(partial.spatial.grid).toBeUndefined();
  });
});

describe('validate spatial.grid', () => {
  const good = () => applyDefaults({ project: { name: 'P' } }, fixedClock);
  it('accepts a valid grid and flags non-positive dims / cellsize', () => {
    const ok = good(); ok.spatial.grid = { ncols: 4, nrows: 3, cellsize: 30, xll: 0, yll: 0 };
    expect(validate(ok)).toEqual([]);
    const bad = good(); bad.spatial.grid = { ncols: 0, nrows: 3, cellsize: 0, xll: 0, yll: 0 };
    const fields = validate(bad).map((e) => e.field);
    expect(fields).toContain('spatial.grid');
    expect(fields).toContain('spatial.grid.cellsize');
  });
});

describe('applyDefaults execution', () => {
  it('includes a normalized execution when present', () => {
    const m = applyDefaults({ project: { name: 'P' }, execution: { runMode: 'slurm', slurm: { nodes: 2, ntasksPerNode: 4 } } }, fixedClock);
    expect(m.execution).toEqual({ runMode: 'slurm', slurm: { nodes: 2, ntasksPerNode: 4 } });
  });
  it('omits execution when absent or legacy-shaped', () => {
    expect(applyDefaults({ project: { name: 'P' } }, fixedClock).execution).toBeUndefined();
    expect(applyDefaults({ project: { name: 'P' }, execution: { run_command: 'mpirun' } }, fixedClock).execution).toBeUndefined();
  });
});

describe('validate execution', () => {
  it('accepts a valid execution and flags a bad numProcs', () => {
    const m = applyDefaults({ project: { name: 'P' }, execution: { runMode: 'local', local: { numProcs: 8 } } }, fixedClock);
    expect(validate(m)).toEqual([]);
    (m.execution as any).local.numProcs = 0;
    expect(validate(m).map((e) => e.field)).toContain('execution.local.numProcs');
  });
});
