import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigStore } from '../../vscode/config-store';
import { writeBuildRunSetup } from '../../vscode/setup-build-run';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-sbr-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function readJson(uri: vscode.Uri): Promise<any> {
  return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

describe('setupBuildRun (M4j-5)', () => {
  it('writes .vscode tasks/settings and persists the execution block (local)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true, () => '2026-06-30T00:00:00.000Z');
    const created = await store.create(folder, { name: 'P' });
    assert.ok(created.ok);

    const r = await writeBuildRunSetup(
      folder, store, created.value,
      { runMode: 'local', sourceDir: folder.fsPath, local: { numProcs: 4 } },
      { overwriteBatch: true },
    );
    assert.ok(r.written.includes('.vscode/tasks.json'));

    const tasks = await readJson(vscode.Uri.joinPath(folder, '.vscode/tasks.json'));
    const labels = tasks.tasks.map((t: any) => t.label);
    assert.ok(labels.includes('CMake: build TRITON'));
    assert.ok(labels.includes('TRITON: Run (local)'));

    const settings = await readJson(vscode.Uri.joinPath(folder, '.vscode/settings.json'));
    assert.strictEqual(settings['cmake.sourceDirectory'], folder.fsPath);

    const m = await readJson(store.manifestUri(folder));
    assert.strictEqual(m.execution.runMode, 'local');
    assert.strictEqual(m.execution.local.numProcs, 4);
    assert.strictEqual(m.schemaVersion, 2);
  });

  it('switches to SLURM, swaps the run task, and writes the batch script', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true, () => '2026-06-30T00:00:00.000Z');
    const created = await store.create(folder, { name: 'P' });
    assert.ok(created.ok);

    await writeBuildRunSetup(
      folder, store, created.value,
      { runMode: 'local', sourceDir: folder.fsPath, local: { numProcs: 2 } },
      { overwriteBatch: true },
    );
    await writeBuildRunSetup(
      folder, store, created.value,
      { runMode: 'slurm', sourceDir: folder.fsPath, slurm: { nodes: 2, ntasksPerNode: 4 } },
      { overwriteBatch: true },
    );

    const tasks = await readJson(vscode.Uri.joinPath(folder, '.vscode/tasks.json'));
    const labels = tasks.tasks.map((t: any) => t.label);
    assert.ok(labels.includes('TRITON: Submit (SLURM)'));
    assert.ok(!labels.includes('TRITON: Run (local)'));
    assert.ok(await exists(vscode.Uri.joinPath(folder, 'triton_batch.sh')));
  });

  it('registers the triforge.setupBuildRun command', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge')!;
    await ext.activate();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('triforge.setupBuildRun'));
  });
});
