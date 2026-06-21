import { describe, it, expect } from 'vitest';
import { buildManifest } from './create';

const clock = () => '2026-06-21T00:00:00.000Z';

describe('buildManifest', () => {
  it('derives crs from utmZone+datum and sets equal timestamps', () => {
    const r = buildManifest({ name: 'My Flood Study', utmZone: '16N', datum: 'WGS84', inputFormat: 'BIN', outputFormat: 'ASC' }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.value.manifest;
    expect(m.spatial.crs).toBe('EPSG:32616');
    expect(m.project.createdAt).toBe(m.project.modifiedAt);
    expect(m.paths).toEqual({ inputDir: 'input', outputDir: 'output', buildDir: 'build' });
    expect(r.value.unknownSections).toEqual({});
  });

  it('uses an explicit EPSG verbatim and does NOT fabricate utmZone/datum', () => {
    const r = buildManifest({ name: 'Coastal', crs: 'EPSG:3857', outputFormat: 'GTIFF' }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.spatial).toEqual({ crs: 'EPSG:3857', utmZone: '', datum: '' });
    expect(r.value.manifest.io.outputFormat).toBe('GTIFF');
  });

  it('prefers an explicit crs over utmZone/datum derivation', () => {
    const r = buildManifest({ name: 'P', crs: 'EPSG:3857', utmZone: '16N', datum: 'WGS84' }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.spatial.crs).toBe('EPSG:3857');
  });

  it('rejects a blank name', () => {
    const r = buildManifest({ name: '   ' }, clock);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field)).toContain('project.name');
  });

  it('rejects a malformed explicit EPSG', () => {
    for (const crs of ['EPSG:', 'epsg:3857', '3857', 'EPSG:abc']) {
      const r = buildManifest({ name: 'P', crs }, clock);
      expect(r.ok, crs).toBe(false);
    }
  });

  it('rejects a bad io format', () => {
    const r = buildManifest({ name: 'P', inputFormat: 'XYZ' }, clock);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field)).toContain('io.inputFormat');
  });

  it('round-trips a non-empty unicode description', () => {
    const r = buildManifest({ name: 'P', description: 'Río Grande 2026 — flood\nstudy' }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.project.description).toBe('Río Grande 2026 — flood\nstudy');
  });
});
