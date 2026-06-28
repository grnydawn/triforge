import * as vscode from 'vscode';
import { ProjectStateKind } from '../core/types';
import { buildServerInvocation } from '../core/mcp-config';

/** Minimal project surface the provider needs — ProjectStateController satisfies it. */
export interface McpProjectSource {
  readonly state: ProjectStateKind;
  readonly targetFolder: vscode.Uri | undefined;
  readonly onDidChangeState: vscode.Event<ProjectStateKind>;
}

/** Writes are enabled only when the opt-in setting is on AND the workspace is trusted. */
export function mcpWritesEnabled(): boolean {
  return vscode.workspace.getConfiguration('triforge').get<boolean>('mcp.allowWrite') === true
    && vscode.workspace.isTrusted;
}

export class TriforgeMcpProvider implements vscode.McpServerDefinitionProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this._onDidChange.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly source: McpProjectSource,
    private readonly writesEnabled: () => boolean = mcpWritesEnabled,
  ) {
    this.disposables.push(this.source.onDidChangeState(() => this._onDidChange.fire()));
  }

  /** Re-emit so VS Code re-queries (used when the allowWrite setting changes). */
  refresh(): void { this._onDidChange.fire(); }

  provideMcpServerDefinitions(_token: vscode.CancellationToken): vscode.McpServerDefinition[] {
    if (this.source.state !== 'ready' || !this.source.targetFolder) return [];
    const binPath = vscode.Uri.joinPath(this.extensionUri, 'bin', 'triforge-mcp.js').fsPath;
    const inv = buildServerInvocation({
      nodeCommand: process.execPath, // editor's Node, per the MCP API doc note
      binPath,
      projectRoot: this.source.targetFolder.fsPath,
      allowWrite: this.writesEnabled(),
    });
    const def = new vscode.McpStdioServerDefinition('Triforge (Triton project)', inv.command, inv.args);
    def.cwd = this.source.targetFolder;
    return [def];
  }

  dispose(): void {
    this._onDidChange.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
