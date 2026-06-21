import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

describe('multi-project teardown (E2E-TDN-01 / TDN-03 / TDN-05)', () => {
  it('exposes no legacy multi-project commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['triton.openSettings', 'triton.createProject', 'triton.removeProject', 'triton.openProject', 'triforge.openSettings']) {
      assert.ok(!all.includes(id), `${id} must not exist`);
    }
  });

  it('the new source tree contains no ~/.triton / projects.json / workspacePath tokens', () => {
    // Scan only the NEW production source (src/core/ and src/vscode/), not test files
    // (test files legitimately mention these tokens as negative assertions).
    const root = path.resolve(__dirname, '..', '..', '..', 'src');
    const offenders: string[] = [];
    let walkedFiles = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip test directories — they legitimately reference forbidden tokens
          // as negative assertions (e.g. this file itself).
          if (entry.name === 'test') { continue; }
          walk(p);
          continue;
        }
        if (!p.endsWith('.ts')) { continue; }
        walkedFiles++;
        const text = fs.readFileSync(p, 'utf8');
        for (const token of ['.triton/projects.json', 'workspacePath', 'projects.json', 'MigrationManager', 'ProjectsView', 'GlobalSettingsManager']) {
          if (text.includes(token)) { offenders.push(`${p}: ${token}`); }
        }
      }
    };
    walk(root);
    // Verify the scan actually walked files (not a missing/empty dir).
    assert.ok(walkedFiles > 0, `Expected to walk at least one .ts file under ${root}, but found none — check __dirname resolution`);
    assert.deepStrictEqual(offenders, [], `forbidden tokens found:\n${offenders.join('\n')}`);
  });
});
