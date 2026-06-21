import * as assert from 'assert';
import * as vscode from 'vscode';

describe('integration harness', () => {
  it('loads VS Code and finds the Triforge extension', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    assert.ok(ext, 'Triforge extension should be discoverable by id grnydawn.triforge');
  });
});
