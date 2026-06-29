import * as assert from 'assert';
import * as vscode from 'vscode';

describe('package.json contribution contract (GAP-PKG-01 / E2E-TDN-03)', () => {
  it('matches the contribution contract (Explorer view, welcome states, chat participant, MCP)', () => {
    const pkg = vscode.extensions.getExtension('grnydawn.triforge')!.packageJSON;
    assert.deepStrictEqual(pkg.activationEvents, ['onStartupFinished']);
    assert.ok(String(pkg.engines.vscode).includes('1.101'));
    // M3b — the project view lives in the native Explorer, not a dedicated activity-bar container.
    assert.ok(!pkg.contributes.viewsContainers, 'no dedicated Triforge activity-bar container (M3b)');
    assert.ok(!pkg.contributes.views.triforge, 'no dedicated triforge view container (M3b)');
    const explorerViews = pkg.contributes.views.explorer;
    const statusView = explorerViews.find((v: any) => v.id === 'triforge.status');
    assert.ok(statusView, 'triforge.status must be contributed to the Explorer');
    assert.strictEqual(statusView.when, 'triforge:state != none');
    assert.strictEqual(statusView.visibility, 'collapsed');
    // No legacy multi-project views.
    assert.ok(!JSON.stringify(pkg.contributes.views).includes('triton-projects'));
    assert.ok(!JSON.stringify(pkg.contributes.views).includes('triton-simulations'));
    const welcomeStates = pkg.contributes.viewsWelcome.map((w: any) => w.when);
    for (const s of ['needsImport', 'invalid']) {
      assert.ok(welcomeStates.some((w: string) => w.includes(`triforge:state == ${s}`)), `welcome for ${s}`);
    }
    assert.ok(!welcomeStates.some((w: string) => w.includes('triforge:state == none')), 'none welcome removed (M3b)');
    // @triton chat participant (M2b).
    const participant = pkg.contributes.chatParticipants.find((p: any) => p.id === 'triforge.triton');
    assert.ok(participant, 'chatParticipants must include triforge.triton');
    assert.strictEqual(participant.name, 'triton');
    assert.strictEqual(participant.fullName, 'Triton');
    assert.strictEqual(participant.isSticky, true);
    assert.deepStrictEqual(
      participant.commands.map((c: any) => c.name),
      ['config', 'files', 'project', 'defaults'],
    );
    // M3a — MCP auto-wiring contributions.
    const mcpProviders = pkg.contributes.mcpServerDefinitionProviders;
    assert.ok(Array.isArray(mcpProviders) && mcpProviders.some((p: any) => p.id === 'triforge.mcp'),
      'mcpServerDefinitionProviders must include triforge.mcp');
    const cmds = pkg.contributes.commands.map((c: any) => c.command);
    assert.ok(cmds.includes('triforge.connectAiTools'), 'triforge.connectAiTools must be declared');
    assert.ok(cmds.includes('triforge.exportAnimationGif'), 'triforge.exportAnimationGif must be declared');
    // The command is gated to a ready project in the palette.
    const palette = pkg.contributes.menus.commandPalette ?? [];
    assert.ok(palette.some((m: any) => m.command === 'triforge.exportAnimationGif' && m.when === 'triforge:active'),
      'exportAnimationGif must be palette-gated on triforge:active');
    const allowWrite = pkg.contributes.configuration.properties['triforge.mcp.allowWrite'];
    assert.ok(allowWrite && allowWrite.type === 'boolean' && allowWrite.default === false,
      'triforge.mcp.allowWrite must be a boolean defaulting to false');
  });
});
