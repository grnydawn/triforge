import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigStore } from '../../vscode/config-store';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-panel-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

// We test the create message path through ConfigStore (the panel's handler delegates to it).
describe('creation message path (E2E-CRE-01 / E2E-CRE-04 / GAP-MSG-01)', () => {
  it('a valid createProject payload writes the manifest', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true);
    const r = await store.create(folder, { name: 'From Form', utmZone: '16N', datum: 'WGS84' });
    assert.ok(r.ok);
    assert.ok(await exists(store.manifestUri(folder)));
  });

  it('an invalid payload (bad enum) does not write and returns errors (E2E-CRE-04)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true);
    const r = await store.create(folder, { name: 'P', inputFormat: 'XYZ' });
    assert.ok(!r.ok);
    assert.ok(!(await exists(store.manifestUri(folder))));
  });
});
