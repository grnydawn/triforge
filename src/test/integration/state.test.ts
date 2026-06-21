import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigStore, MANIFEST_FILENAME } from '../../vscode/config-store';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-state-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

describe('ConfigStore + detection wiring (state building blocks)', () => {
  it('a valid manifest loads as ready data (E2E-OPEN-01)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true);
    await store.create(folder, { name: 'Ready Study', utmZone: '16N', datum: 'WGS84' });
    const fresh = new ConfigStore(() => true);
    const loaded = await fresh.load(folder);
    assert.ok(loaded.ok);
    assert.strictEqual(loaded.value.manifest.project.name, 'Ready Study');
  });

  it('load does not rewrite a manifest with derivable-but-empty crs (E2E-OPEN-06; display derivation asserted in Task 11)', async () => {
    const folder = await tmpFolder();
    const raw = { schemaVersion: 1, project: { name: 'P' }, spatial: { utmZone: '16N', datum: 'WGS84' } };
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, MANIFEST_FILENAME), Buffer.from(JSON.stringify(raw), 'utf8'));
    // Derivation happens in buildManifest/import paths; on plain load the stored crs is '' —
    // the status view derives for display (see Task 11). Here assert the file was NOT rewritten on load.
    const before = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, MANIFEST_FILENAME));
    const store = new ConfigStore(() => true);
    await store.load(folder);
    const after = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, MANIFEST_FILENAME));
    assert.strictEqual(before.mtime, after.mtime, 'load must not rewrite the manifest');
  });
});
