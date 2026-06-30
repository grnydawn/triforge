import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigStore, MANIFEST_FILENAME } from '../../vscode/config-store';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-it-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function read(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

describe('ConfigStore', () => {
  it('creates a manifest and scaffolds input/output/build (E2E-CRE-01)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true, () => '2026-06-21T00:00:00.000Z');
    const r = await store.create(folder, { name: 'My Flood Study', utmZone: '16N', datum: 'WGS84', inputFormat: 'BIN', outputFormat: 'ASC' });
    assert.ok(r.ok);
    const m = JSON.parse(await read(store.manifestUri(folder)));
    assert.strictEqual(m.project.name, 'My Flood Study');
    assert.strictEqual(m.spatial.crs, 'EPSG:32616');
    for (const d of ['input', 'output', 'build']) {
      assert.ok(await exists(vscode.Uri.joinPath(folder, d)), `${d} should exist`);
    }
  });

  it('leaves pre-existing scaffold dirs untouched (E2E-CRE-05)', async () => {
    const folder = await tmpFolder();
    const dem = vscode.Uri.joinPath(folder, 'input', 'dem.asc');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, 'input'));
    await vscode.workspace.fs.writeFile(dem, Buffer.from('DATA', 'utf8'));
    const store = new ConfigStore(() => true);
    const r = await store.create(folder, { name: 'P' });
    assert.ok(r.ok);
    assert.strictEqual(await read(dem), 'DATA');
  });

  it('refuses to overwrite an existing manifest (E2E-CRE-06)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true);
    assert.ok((await store.create(folder, { name: 'First' })).ok);
    const before = await read(store.manifestUri(folder));
    const second = await store.create(folder, { name: 'Second' });
    assert.ok(!second.ok);
    assert.strictEqual(await read(store.manifestUri(folder)), before);
  });

  it('blocks writes when untrusted and nothing lands on disk (E2E-TRUST / E2E-CRE-07)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => false);
    const r = await store.create(folder, { name: 'P' });
    assert.ok(!r.ok);
    assert.ok(!(await exists(store.manifestUri(folder))));
    assert.ok(!(await exists(vscode.Uri.joinPath(folder, 'input'))));
  });

  it('loads + preserves unknown sections and advances modifiedAt on save (E2E-OPEN-09 / E2E-TDN-08)', async () => {
    const folder = await tmpFolder();
    const raw = { schemaVersion: 1, project: { name: 'P', description: '', createdAt: 'C', modifiedAt: 'C' }, spatial: { crs: '', utmZone: '', datum: '' }, io: { inputFormat: 'BIN', outputFormat: 'ASC' }, paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' }, execution: { run_command: 'mpirun' } };
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, MANIFEST_FILENAME), Buffer.from(JSON.stringify(raw), 'utf8'));
    const store = new ConfigStore(() => true, () => '2026-12-25T00:00:00.000Z');
    const loaded = await store.load(folder);
    assert.ok(loaded.ok);
    const saved = await store.save(folder);
    assert.ok(saved.ok);
    const onDisk = JSON.parse(await read(store.manifestUri(folder)));
    assert.deepStrictEqual(onDisk._legacyExecution, { run_command: 'mpirun' });
    assert.strictEqual(onDisk.project.createdAt, 'C');
    assert.strictEqual(onDisk.project.modifiedAt, '2026-12-25T00:00:00.000Z');
  });

  it('returns an error result for corrupt JSON, not a throw (E2E-ERR-01)', async () => {
    const folder = await tmpFolder();
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, MANIFEST_FILENAME), Buffer.from('{ not json', 'utf8'));
    const store = new ConfigStore(() => true);
    const r = await store.load(folder);
    assert.ok(!r.ok);
  });
});
