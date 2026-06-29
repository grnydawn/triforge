import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { SolverConfigPanel } from '../../vscode/solver-config-panel';

describe('SolverConfigPanel (M4j-2)', () => {
  it('opens against a context, loads a cfg, and saves a surgical edit preserving comments', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge')!;
    await ext.activate();
    const context = { extensionUri: ext.extensionUri } as vscode.ExtensionContext;

    const folder = vscode.Uri.file(path.join(os.tmpdir(), `triforge-solver-${process.pid}`));
    await vscode.workspace.fs.createDirectory(folder);
    const cfgUri = vscode.Uri.joinPath(folder, 'triton_execution.cfg');
    await vscode.workspace.fs.writeFile(cfgUri, Buffer.from('# my run\ntime_step=1.0\ncourant=0.5\n', 'utf8'));

    const panel = SolverConfigPanel.show(context, cfgUri);
    assert.ok(SolverConfigPanel.current, 'panel registered as current');
    await panel.ready;

    await panel.handleMessage({ command: 'save', edited: { courant: '0.4', time_step: '1.0' } });
    const after = Buffer.from(await vscode.workspace.fs.readFile(cfgUri)).toString('utf8');
    assert.ok(after.includes('courant=0.4'), 'changed key written');
    assert.ok(after.includes('# my run'), 'comment preserved');
    assert.ok(after.includes('time_step=1.0'), 'unchanged key preserved');

    panel.dispose();
    assert.strictEqual(SolverConfigPanel.current, undefined, 'current cleared on dispose');
  });
});
