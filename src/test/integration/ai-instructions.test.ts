import * as assert from 'assert';
import * as vscode from 'vscode';
import { wireAutoRegeneration } from '../../vscode/ai-instructions';
import { ProjectStateController } from '../../vscode/state';
import { ConfigStore } from '../../vscode/config-store';
import { InstructionWriter } from '../../vscode/instruction-writer';
import { ParsedManifest } from '../../core/types';

function parsed(): ParsedManifest {
  return {
    manifest: {
      schemaVersion: 1,
      project: { name: 'Wire', description: '', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' },
      spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' },
      io: { inputFormat: 'BIN', outputFormat: 'ASC' },
      paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
    },
    unknownSections: {},
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AI instruction commands', () => {
  it('registers the commands', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('triforge.generateAiInstructions'));
    assert.ok(cmds.includes('triforge.openKnowledgeBase'));
  });

  it('generateAiInstructions does not throw when no project is open', async () => {
    await vscode.commands.executeCommand('triforge.generateAiInstructions');
  });
});

describe('registerAiInstructions wiring', () => {
  // Builds the wiring with real EventEmitters but fake controller/store/writer + injected config,
  // so the debounced funnel is exercised deterministically with no real config mutation.
  function harness(over: { autoRegenerate?: boolean } = {}) {
    const stateEmitter = new vscode.EventEmitter<unknown>();
    const configEmitter = new vscode.EventEmitter<void>();
    let cfgHandler: () => void = () => undefined;
    let calls = 0;

    const controller = {
      state: 'ready', targetFolder: vscode.Uri.file('/tmp/wire'), onDidChangeState: stateEmitter.event,
    } as unknown as ProjectStateController;
    const store = { current: parsed(), onDidChangeConfig: configEmitter.event } as unknown as ConfigStore;
    const writer = { regenerate: async () => { calls++; return { written: [], skipped: [] }; } } as unknown as InstructionWriter;

    // Exercise the funnel directly via wireAutoRegeneration — NOT registerAiInstructions, which
    // would re-register the already-activated extension's global commands and throw.
    const disposables = wireAutoRegeneration(controller, store, {
      writer,
      readCfg: () => ({ targets: ['agents'], autoRegenerate: over.autoRegenerate ?? true }),
      debounceMs: 20,
      subscribeConfigChange: (h) => { cfgHandler = h; return { dispose() { /* noop */ } }; },
    });

    return {
      stateEmitter, configEmitter,
      fireConfigChange: () => cfgHandler(),
      getCalls: () => calls,
      dispose: () => { for (const d of disposables) d.dispose(); stateEmitter.dispose(); configEmitter.dispose(); },
    };
  }

  it('coalesces the M1 event cascade into a single debounced regen', async () => {
    const h = harness();
    h.configEmitter.fire(); h.configEmitter.fire(); h.stateEmitter.fire('ready'); h.configEmitter.fire();
    await wait(80);
    assert.strictEqual(h.getCalls(), 1);
    h.dispose();
  });

  it('re-runs on a settings change', async () => {
    const h = harness();
    h.fireConfigChange();
    await wait(80);
    assert.strictEqual(h.getCalls(), 1);
    h.dispose();
  });

  it('suppresses regeneration when autoRegenerate is false', async () => {
    const h = harness({ autoRegenerate: false });
    h.configEmitter.fire(); h.stateEmitter.fire('ready'); h.fireConfigChange();
    await wait(80);
    assert.strictEqual(h.getCalls(), 0);
    h.dispose();
  });
});
