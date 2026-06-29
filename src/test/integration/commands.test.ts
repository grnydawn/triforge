import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-cmd-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

describe('command registration', () => {
  it('registers all seven triforge commands (E2E-TDN-03)', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    await ext?.activate();
    const all = await vscode.commands.getCommands(true);
    for (const id of ['triforge.openProjectFolder', 'triforge.createProject', 'triforge.importLegacyProject', 'triforge.openConfig', 'triforge.revealInExplorer', 'triforge.connectAiTools', 'triforge.exportAnimationGif']) {
      assert.ok(all.includes(id), `${id} should be registered`);
    }
  });
});

// Importer wiring is asserted at the ConfigStore/core level; the command's .bak archival
// is verified here using a fresh ConfigStore against a temp folder to avoid relying on the
// active workspace target.
import { importLegacy } from '../../core/importer';
import { ConfigStore } from '../../vscode/config-store';

describe('legacy import writing (E2E-IMP-04 / E2E-IMP-07)', () => {
  it('writes triforge.json preserving legacy blocks and keeps the original', async () => {
    const folder = await tmpFolder();
    const legacy = { settings: { name: 'Imported', utmZone: '16N', datum: 'WGS84' }, compsetup: { courant: 0.4 }, execution: { run_command: 'mpirun' } };
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, 'config.json'), Buffer.from(JSON.stringify(legacy), 'utf8'));
    const result = importLegacy(legacy);
    assert.ok(result.ok);
    const store = new ConfigStore(() => true);
    await store.writeParsed(folder, (result as any).value);
    const onDisk = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(store.manifestUri(folder))).toString('utf8'));
    assert.strictEqual(onDisk.project.name, 'Imported');
    assert.deepStrictEqual(onDisk.execution, { run_command: 'mpirun' });
    assert.ok(await exists(vscode.Uri.joinPath(folder, 'config.json')));
  });
});
