import { describe, it, expect } from 'vitest';
import {
  listConfigVariables, lookupConfigVariable, getConfigVariablesBySection,
  listFileTypes, lookupFileType,
} from './queries';

describe('config queries', () => {
  it('lists all config variables', () => {
    expect(listConfigVariables()).toHaveLength(38);
  });
  it('looks up by name, case-insensitively', () => {
    expect(lookupConfigVariable('courant')?.name).toBe('courant');
    expect(lookupConfigVariable('COURANT')?.name).toBe('courant');
    expect(lookupConfigVariable('nope')).toBeUndefined();
  });
  it('filters by section', () => {
    const ic = getConfigVariablesBySection('Initial Conditions').map((v) => v.name).sort();
    expect(ic).toEqual(['h_infile', 'qx_infile', 'qy_infile']);
    expect(getConfigVariablesBySection('Nonexistent')).toEqual([]);
  });
});

describe('file-type queries', () => {
  it('lists all file types', () => {
    expect(listFileTypes()).toHaveLength(22);
  });
  it('looks up by id', () => {
    expect(lookupFileType('hydrograph')?.label).toBe('Streamflow hydrograph');
    expect(lookupFileType('nope')).toBeUndefined();
  });
});

import { deriveProjectContext } from './queries';
import { ParsedManifest } from '../types';

function parsed(over: Partial<ParsedManifest['manifest']> = {}, unknown: Record<string, unknown> = {}): ParsedManifest {
  return {
    manifest: {
      schemaVersion: 1,
      project: { name: 'Demo', description: 'd', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-02-02T00:00:00.000Z' },
      spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' },
      io: { inputFormat: 'BIN', outputFormat: 'ASC' },
      paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
      ...over,
    },
    unknownSections: unknown,
  };
}

describe('deriveProjectContext', () => {
  it('maps the 10 non-volatile data fields and excludes timestamps', () => {
    const ctx = deriveProjectContext(parsed());
    expect(ctx).toMatchObject({
      name: 'Demo', description: 'd', crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84',
      inputFormat: 'BIN', outputFormat: 'ASC', inputDir: 'input', outputDir: 'output', buildDir: 'build',
      hasImportedLegacy: false,
    });
    expect(ctx).not.toHaveProperty('createdAt');
    expect(ctx).not.toHaveProperty('modifiedAt');
  });

  it('sets derivedCrs only when deriveCrs returns non-empty', () => {
    expect(deriveProjectContext(parsed()).derivedCrs).toBe('EPSG:32616'); // WGS84 16N
    // NAD83 southern hemisphere → deriveCrs returns '' → no derivedCrs
    const ctx = deriveProjectContext(parsed({ spatial: { crs: '', utmZone: '16S', datum: 'NAD83' } }));
    expect(ctx.derivedCrs).toBeUndefined();
    expect(ctx.crs).toBe('');
  });

  it('flags hasImportedLegacy when _importedFrom is present', () => {
    expect(deriveProjectContext(parsed({}, { _importedFrom: 'config.json' })).hasImportedLegacy).toBe(true);
    expect(deriveProjectContext(parsed({}, {})).hasImportedLegacy).toBe(false);
  });
});
