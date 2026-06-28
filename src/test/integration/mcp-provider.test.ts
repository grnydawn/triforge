import * as assert from 'assert';
import * as vscode from 'vscode';
import { ProjectStateKind } from '../../core/types';
import { TriforgeMcpProvider, McpProjectSource } from '../../vscode/mcp-provider';

class StubSource implements McpProjectSource {
  private readonly emitter = new vscode.EventEmitter<ProjectStateKind>();
  readonly onDidChangeState = this.emitter.event;
  state: ProjectStateKind = 'none';
  targetFolder: vscode.Uri | undefined;
  set(state: ProjectStateKind, folder: vscode.Uri | undefined): void {
    this.state = state; this.targetFolder = folder; this.emitter.fire(state);
  }
}

const EXT = vscode.Uri.file('/ext');
const FOLDER = vscode.Uri.file('/proj');

describe('TriforgeMcpProvider', () => {
  it('offers no server when there is no ready project', () => {
    const src = new StubSource();
    const p = new TriforgeMcpProvider(EXT, src, () => false);
    assert.deepStrictEqual(p.provideMcpServerDefinitions({} as any), []);
    src.set('needsImport', FOLDER); // not "ready"
    assert.deepStrictEqual(p.provideMcpServerDefinitions({} as any), []);
    p.dispose();
  });

  it('offers a stdio server pointed at the folder (read-only) when ready', () => {
    const src = new StubSource();
    src.state = 'ready'; src.targetFolder = FOLDER;
    const p = new TriforgeMcpProvider(EXT, src, () => false);
    const defs = p.provideMcpServerDefinitions({} as any) as any[];
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].command, process.execPath);
    assert.ok(defs[0].args[0].endsWith('bin/triforge-mcp.js') || defs[0].args[0].endsWith('bin\\triforge-mcp.js'));
    assert.strictEqual(defs[0].args[1], FOLDER.fsPath);
    assert.ok(!defs[0].args.includes('--allow-write'));
    p.dispose();
  });

  it('adds --allow-write when writes are enabled', () => {
    const src = new StubSource();
    src.state = 'ready'; src.targetFolder = FOLDER;
    const p = new TriforgeMcpProvider(EXT, src, () => true);
    const defs = p.provideMcpServerDefinitions({} as any) as any[];
    assert.ok(defs[0].args.includes('--allow-write'));
    p.dispose();
  });

  it('fires onDidChangeMcpServerDefinitions when the project state changes', () => {
    const src = new StubSource();
    const p = new TriforgeMcpProvider(EXT, src, () => false);
    let fired = 0;
    const sub = p.onDidChangeMcpServerDefinitions(() => { fired++; });
    src.set('ready', FOLDER);
    assert.strictEqual(fired, 1);
    sub.dispose(); p.dispose();
  });
});
