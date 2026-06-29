import * as vscode from 'vscode';
import { parseTritonConfig, editConfigText, buildConfigForm, diffConfigEdits } from '../core/triton-files';
import type { ConfigFormModel } from '../core/triton-files';
import { pathVarNames } from '../core/triton-kb';

const isPathVar = (k: string) => pathVarNames().has(k.toLowerCase());

export class SolverConfigPanel {
  static current: SolverConfigPanel | undefined;

  static show(context: vscode.ExtensionContext, cfgUri: vscode.Uri): SolverConfigPanel {
    if (SolverConfigPanel.current) {
      SolverConfigPanel.current.cfgUri = cfgUri;
      SolverConfigPanel.current.panel.reveal();
      SolverConfigPanel.current.ready = SolverConfigPanel.current.load();
      return SolverConfigPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('triforge.solverConfig', 'Solver Configuration', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    const created = new SolverConfigPanel(panel, context, cfgUri);
    SolverConfigPanel.current = created;
    return created;
  }

  /** Resolves when the current cfg has been read + posted to the webview (awaited by tests). */
  ready: Promise<void>;
  private originalText = '';
  private model: ConfigFormModel = { sections: [] };

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private cfgUri: vscode.Uri,
  ) {
    panel.webview.html = this.html(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    panel.onDidDispose(() => { if (SolverConfigPanel.current === this) SolverConfigPanel.current = undefined; });
    this.ready = this.load();
  }

  dispose(): void { this.panel.dispose(); }

  private async load(): Promise<void> {
    try {
      this.originalText = Buffer.from(await vscode.workspace.fs.readFile(this.cfgUri)).toString('utf8');
      this.model = buildConfigForm(parseTritonConfig(this.originalText));
      await this.panel.webview.postMessage({
        command: 'load',
        model: this.model,
        fileLabel: vscode.workspace.asRelativePath(this.cfgUri),
        trusted: vscode.workspace.isTrusted,
      });
    } catch (e) {
      await this.panel.webview.postMessage({
        command: 'error',
        message: `Could not read ${vscode.workspace.asRelativePath(this.cfgUri)}: ${(e as Error).message}`,
      });
    }
  }

  /** Exposed so integration tests can drive the protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg || typeof msg.command !== 'string') return;
    if (msg.command === 'cancel') { this.panel.dispose(); return; }
    if (msg.command !== 'save') return;
    if (!vscode.workspace.isTrusted) {
      await this.panel.webview.postMessage({ command: 'error', message: 'Workspace is untrusted — cannot save.' });
      return;
    }
    const edited = (msg.edited ?? {}) as Record<string, string>;
    const updates = diffConfigEdits(this.model, edited);
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      await this.panel.webview.postMessage({ command: 'saved', summary: 'No changes.' });
      return;
    }
    const conflictNames = new Set(this.model.sections.flatMap((s) => s.fields).filter((f) => f.conflictNote).map((f) => f.name));
    const changedConflicts = keys.filter((k) => conflictNames.has(k)).length;
    try {
      const nextText = editConfigText(this.originalText, updates, isPathVar);
      await vscode.workspace.fs.writeFile(this.cfgUri, Buffer.from(nextText, 'utf8'));
      await this.load(); // refresh originalText + model from the saved file
      const removed = keys.filter((k) => updates[k] === null).length;
      const set = keys.length - removed;
      const conflictNote = changedConflicts ? ` (${changedConflicts} changed key(s) carry template-vs-UI conflicts)` : '';
      await this.panel.webview.postMessage({
        command: 'saved',
        summary: `Saved ${set} change(s)${removed ? `, removed ${removed} key(s)` : ''}.${conflictNote}`,
      });
    } catch (e) {
      await this.panel.webview.postMessage({
        command: 'error',
        message: `Could not save ${vscode.workspace.asRelativePath(this.cfgUri)}: ${(e as Error).message}`,
      });
    }
  }

  private html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'solver-config.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-foreground); }
  h2 { margin-top: 0; }
  details { border: 1px solid var(--vscode-input-border, #8884); border-radius: 4px; margin: .5rem 0; padding: .25rem .5rem; }
  summary { font-weight: 600; cursor: pointer; padding: .25rem 0; }
  .field { margin: .5rem 0; }
  label { display: block; font-weight: 600; margin-bottom: .2rem; }
  input, select { width: 100%; max-width: 28rem; padding: .35rem;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); }
  .unit { font-weight: 400; opacity: .7; margin-left: .25rem; }
  .badge { color: var(--vscode-editorWarning-foreground, #c80); font-weight: 400; font-size: .85em; margin-left: .5rem; }
  .hint { opacity: .7; font-size: .85em; margin-top: .15rem; max-width: 40rem; }
  .toolbar { position: sticky; top: 0; background: var(--vscode-editor-background); padding: .5rem 0; }
  button { padding: .4rem 1rem; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  #status { margin-left: 1rem; opacity: .9; }
  #status.error { color: var(--vscode-errorForeground); }
</style>
</head>
<body>
  <h2>Solver Configuration</h2>
  <div class="toolbar"><button id="save">Save</button><span id="status"></span></div>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
