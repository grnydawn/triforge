import * as vscode from 'vscode';
import { CreationInput } from '../core/types';
import { deriveCrs } from '../core/crs';
import { ConfigStore } from './config-store';
import { ProjectStateController } from './state';

export class CreationPanel {
  static current: CreationPanel | undefined;

  static show(context: vscode.ExtensionContext, folder: vscode.Uri, store: ConfigStore, controller: ProjectStateController): CreationPanel {
    if (CreationPanel.current) { CreationPanel.current.panel.reveal(); return CreationPanel.current; }
    const panel = vscode.window.createWebviewPanel('triforge.creation', 'Create Triforge Project', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    const created = new CreationPanel(panel, context, folder, store, controller);
    CreationPanel.current = created;
    return created;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly folder: vscode.Uri,
    private readonly store: ConfigStore,
    private readonly controller: ProjectStateController,
  ) {
    panel.webview.html = this.html(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    panel.onDidDispose(() => { if (CreationPanel.current === this) CreationPanel.current = undefined; });
  }

  /** Exposed so integration tests can drive the message protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg || typeof msg.command !== 'string') return; // ignore junk (GAP-MSG-01)
    switch (msg.command) {
      case 'requestCrs': {
        const crs = deriveCrs(String(msg.utmZone ?? ''), String(msg.datum ?? ''));
        await this.panel.webview.postMessage({ command: 'crsPreview', crs });
        return;
      }
      case 'createProject': {
        const data = (msg.data ?? {}) as CreationInput;
        const result = await this.store.create(this.folder, data);
        if (!result.ok) {
          await this.panel.webview.postMessage({ command: 'error', errors: result.errors });
          return;
        }
        await this.controller.refresh();
        this.panel.dispose();
        return;
      }
      case 'cancel':
        this.panel.dispose();
        return;
      default:
        return; // unknown command ignored
    }
  }

  private html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'creation.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-foreground); }
  label { display:block; margin-top: .75rem; font-weight: 600; }
  input, select { width: 100%; max-width: 28rem; padding: .35rem; margin-top: .25rem;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); }
  .row { display:flex; gap:1rem; max-width: 28rem; }
  .row > div { flex:1; }
  .preview { margin-top:.25rem; opacity:.8; font-size: .9em; }
  .error { color: var(--vscode-errorForeground); margin-top:.75rem; white-space: pre-wrap; }
  button { margin-top: 1rem; padding: .4rem 1rem; cursor:pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); border:none; }
  button:disabled { opacity:.5; cursor:not-allowed; }
</style>
</head>
<body>
  <h2>Create Triforge Project</h2>
  <label for="name">Project name *</label>
  <input id="name" type="text" placeholder="My Flood Study" />
  <label for="description">Description</label>
  <input id="description" type="text" />
  <div class="row">
    <div>
      <label for="utmZone">UTM zone</label>
      <input id="utmZone" type="text" placeholder="16N" />
    </div>
    <div>
      <label for="datum">Datum</label>
      <select id="datum"><option value="">—</option><option>WGS84</option><option>NAD83</option></select>
    </div>
  </div>
  <div class="preview" id="crsPreview"></div>
  <label for="crs">…or CRS directly (EPSG)</label>
  <input id="crs" type="text" placeholder="EPSG:32616" />
  <div class="row">
    <div>
      <label for="inputFormat">Input format</label>
      <select id="inputFormat"><option>BIN</option><option>ASC</option></select>
    </div>
    <div>
      <label for="outputFormat">Output format</label>
      <select id="outputFormat"><option>ASC</option><option>BIN</option><option>GTIFF</option></select>
    </div>
  </div>
  <div class="error" id="error"></div>
  <button id="create" disabled>Create</button>
  <button id="cancel">Cancel</button>
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
