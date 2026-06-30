import { describe, it, expect } from 'vitest';
import { isLegacyConfig, importLegacy } from './importer';

const clock = () => '2026-06-21T00:00:00.000Z';

const legacy = {
  version: '1.0.0',
  settings: { id: 'p1', name: 'Big Muddy Study', createdAt: 1700000000000, lastModified: 1700000005000, utmZone: '16N', datum: 'WGS84', input_format: 'ASC', output_format: 'GTIFF' },
  input: { dem: '/old/abs/input/dem.asc', num_sources: 2 },
  output: { output_directory: '/old/abs/output', geotiff: ['a.vrt'] },
  compsetup: { triton_target: 'gpu', courant: 0.4 },
  execution: { run_command: 'mpirun -n 4' },
};

describe('isLegacyConfig', () => {
  it('detects settings/compsetup shape', () => {
    expect(isLegacyConfig(legacy)).toBe(true);
    expect(isLegacyConfig({ compsetup: {} })).toBe(true);
  });
  it('rejects unrelated JSON', () => {
    expect(isLegacyConfig({ compilerOptions: {} })).toBe(false);
    expect(isLegacyConfig(null)).toBe(false);
    expect(isLegacyConfig([])).toBe(false);
  });
});

describe('importLegacy', () => {
  it('maps known fields and derives crs', () => {
    const r = importLegacy(legacy, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.value.manifest;
    expect(m.schemaVersion).toBe(2);
    expect(m.project.name).toBe('Big Muddy Study');
    expect(m.project.createdAt).toBe(new Date(1700000000000).toISOString());
    expect(m.project.modifiedAt).toBe(new Date(1700000005000).toISOString());
    expect(m.spatial).toEqual({ crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' });
    expect(m.io).toEqual({ inputFormat: 'ASC', outputFormat: 'GTIFF' });
    expect(m.paths).toEqual({ inputDir: 'input', outputDir: 'output', buildDir: 'build' });
  });

  it('preserves legacy blocks verbatim under future section names with a marker', () => {
    const r = importLegacy(legacy, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = r.value.unknownSections;
    expect(u.inputs).toEqual(legacy.input);
    expect(u.outputs).toEqual(legacy.output);
    expect(u.computation).toEqual(legacy.compsetup);
    expect(u.execution).toEqual(legacy.execution);
    expect(typeof u._importedFrom).toBe('string');
  });

  it('fails with an actionable error when legacy name is missing', () => {
    const r = importLegacy({ settings: { utmZone: '16N' }, compsetup: {} }, clock);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field)).toContain('settings.name');
  });

  it('falls back to defaults for legacy formats not in the new enum', () => {
    const r = importLegacy({ settings: { name: 'P', input_format: 'NETCDF', output_format: '' }, compsetup: {} }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.io).toEqual({ inputFormat: 'BIN', outputFormat: 'ASC' });
  });

  it('rejects non-legacy input', () => {
    const r = importLegacy({ hello: 'world' }, clock);
    expect(r.ok).toBe(false);
  });
});
