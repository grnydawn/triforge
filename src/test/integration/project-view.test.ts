import * as assert from 'assert';
import { buildRows } from '../../vscode/project-view';
import { TriforgeManifest } from '../../core/types';

function manifest(over: Partial<TriforgeManifest['spatial']>): TriforgeManifest {
  return {
    schemaVersion: 1,
    project: { name: 'My Flood Study', description: '', createdAt: 'C', modifiedAt: 'C' },
    spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84', ...over },
    io: { inputFormat: 'BIN', outputFormat: 'ASC' },
    paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
  };
}

describe('ProjectStatusView rows', () => {
  it('renders the manifest summary (E2E-OPEN-02)', () => {
    const rows = buildRows(manifest({}));
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    assert.strictEqual(map['Name'], 'My Flood Study');
    assert.strictEqual(map['CRS'], 'EPSG:32616');
    assert.strictEqual(map['Input format'], 'BIN');
    assert.strictEqual(map['Output dir'], 'output');
  });

  it('derives CRS for display when stored crs is empty (E2E-OPEN-06)', () => {
    const rows = buildRows(manifest({ crs: '' }));
    assert.strictEqual(rows.find((r) => r.label === 'CRS')!.value, 'EPSG:32616');
  });

  it('shows "(not set)" when no CRS can be derived (GAP-VIEW-01)', () => {
    const rows = buildRows(manifest({ crs: '', utmZone: '', datum: '' }));
    assert.strictEqual(rows.find((r) => r.label === 'CRS')!.value, '(not set)');
  });
});
