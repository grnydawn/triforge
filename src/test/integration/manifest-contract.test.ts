import * as assert from 'assert';
import * as vscode from 'vscode';

describe('package.json contribution contract (GAP-PKG-01 / E2E-TDN-03)', () => {
  it('matches the M1 design (container, single view, activation, engine)', () => {
    const pkg = vscode.extensions.getExtension('grnydawn.triforge')!.packageJSON;
    assert.deepStrictEqual(pkg.activationEvents, ['onStartupFinished']);
    assert.ok(String(pkg.engines.vscode).includes('1.90'));
    const container = pkg.contributes.viewsContainers.activitybar.find((c: any) => c.id === 'triforge');
    assert.ok(container && container.title === 'Triforge');
    const views = pkg.contributes.views.triforge;
    assert.strictEqual(views.length, 1);
    assert.strictEqual(views[0].id, 'triforge.status');
    // No legacy multi-project views.
    assert.ok(!JSON.stringify(pkg.contributes.views).includes('triton-projects'));
    assert.ok(!JSON.stringify(pkg.contributes.views).includes('triton-simulations'));
    const welcomeStates = pkg.contributes.viewsWelcome.map((w: any) => w.when);
    for (const s of ['none', 'needsImport', 'invalid']) {
      assert.ok(welcomeStates.some((w: string) => w.includes(`triforge:state == ${s}`)), `welcome for ${s}`);
    }
  });
});
