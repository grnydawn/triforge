import * as assert from 'assert';
import * as vscode from 'vscode';
import type { TriforgeApi } from '../../extension';

describe('activation', () => {
  it('activates without throwing and exposes the API (E2E-OPEN-01)', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    assert.ok(ext);
    const api = (await ext!.activate()) as TriforgeApi;
    assert.ok(api);
    assert.ok(['none', 'needsImport', 'ready', 'invalid'].includes(api.getState()));
  });

  it('does not prompt for a global workspace path on startup (E2E-TDN-02)', async () => {
    // The legacy extension force-opened a settings webview when no workspacePath was set.
    // Triforge must not. Assert no Triforge settings/registry command exists.
    const all = await vscode.commands.getCommands(true);
    assert.ok(!all.includes('triforge.openSettings'), 'no global-settings command should exist');
    assert.ok(!all.includes('triforge.removeProject'), 'no multi-project command should exist');
  });
});
