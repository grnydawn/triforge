#!/usr/bin/env node
/*
 * Creates manual-fixtures/{empty,ready,legacy} for cross-OS manual E2E testing
 * with the Triforge dev host (see `make e2e`). Idempotent. The folder is gitignored.
 *
 * - empty/   : no manifest, no legacy config  -> tests the "create / welcome" flow
 * - ready/   : a valid triforge.json          -> tests "ready" activation + status view
 * - legacy/  : a legacy Triton config.json    -> tests "needsImport" + import flow
 */
const fs = require('fs');
const path = require('path');

const root = path.join(process.cwd(), 'manual-fixtures');

const readyManifest = {
  schemaVersion: 1,
  project: {
    name: 'Manual Ready Study',
    description: 'Fixture for manual E2E (ready state).',
    createdAt: '2026-06-21T00:00:00.000Z',
    modifiedAt: '2026-06-21T00:00:00.000Z',
  },
  spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' },
  io: { inputFormat: 'BIN', outputFormat: 'ASC' },
  paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
};

const legacyConfig = {
  version: '1.0.0',
  settings: {
    id: 'legacy-1',
    name: 'Manual Legacy Study',
    createdAt: 1700000000000,
    lastModified: 1700000005000,
    utmZone: '16N',
    datum: 'WGS84',
    input_format: 'ASC',
    output_format: 'GTIFF',
  },
  input: { dem: '/old/abs/input/dem.asc', num_sources: 2 },
  output: { output_directory: '/old/abs/output', geotiff: ['mosaic.vrt'] },
  compsetup: { triton_target: 'gpu', courant: 0.4, domain_decomposition: 'static' },
  execution: { execution_type: 'local', run_command: 'mpirun -n 4', print_interval: 900 },
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

ensureDir(path.join(root, 'empty'));
// .gitkeep-style marker so the empty fixture survives an archive/copy
fs.writeFileSync(path.join(root, 'empty', 'README.txt'), 'Open this folder via "Triforge: Open Project Folder…" to test creation.\n');

ensureDir(path.join(root, 'ready'));
fs.writeFileSync(path.join(root, 'ready', 'triforge.json'), JSON.stringify(readyManifest, null, 2) + '\n');

ensureDir(path.join(root, 'legacy'));
fs.writeFileSync(path.join(root, 'legacy', 'config.json'), JSON.stringify(legacyConfig, null, 2) + '\n');

console.log('Created manual fixtures under:', root);
console.log('  empty/   -> create / welcome flow');
console.log('  ready/   -> ready activation + status view');
console.log('  legacy/  -> needsImport + import flow');
