import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { parseEsriAsciiGrid, Grid } from '../core/triton-files';
import { gridLatLngBounds, buildDemOverlay, encodePng, COLORMAP_NAMES } from '../core/triton-viz';
import type { LatLngBounds, DemOverlayOptions, ColormapName } from '../core/triton-viz';
import type { TriforgeManifest } from '../core/types';
import { ProjectStateController } from './state';

const deflate = (bytes: Uint8Array): Uint8Array => new Uint8Array(zlib.deflateSync(bytes));
const DEFAULT_OPTS: DemOverlayOptions = { colormap: 'terrain', hillshade: false, maxDim: 2048 };

export interface OverlayMessage {
  command: 'renderOverlay';
  dataUri: string;
  bounds: LatLngBounds;
  range: { min: number; max: number };
  width: number;
  height: number;
}

/** Grid + crs + render opts → the renderOverlay message (PNG-encode + base64 here). */
export function buildOverlayMessage(grid: Grid, crs: string, opts: DemOverlayOptions): OverlayMessage {
  const bounds = gridLatLngBounds(grid, crs);
  const { raster, range } = buildDemOverlay(grid, opts);
  const dataUri = 'data:image/png;base64,' + Buffer.from(encodePng(raster, deflate)).toString('base64');
  return { command: 'renderOverlay', dataUri, bounds, range, width: raster.width, height: raster.height };
}

function safeColormap(v: unknown): ColormapName {
  return (COLORMAP_NAMES as readonly string[]).includes(v as string) ? (v as ColormapName) : 'terrain';
}

export class DemMapPanel {
  static current: DemMapPanel | undefined;

  static show(context: vscode.ExtensionContext, controller: ProjectStateController): DemMapPanel {
    if (DemMapPanel.current) {
      DemMapPanel.current.panel.reveal();
      DemMapPanel.current.ready = DemMapPanel.current.load();
      return DemMapPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('triforge.demMap', 'TRITON Map', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    const created = new DemMapPanel(panel, context, controller);
    DemMapPanel.current = created;
    return created;
  }

  /** Resolves when the DEM (or a notice) has been posted to the webview (awaited by tests). */
  ready: Promise<void>;
  private grid: Grid | undefined;
  private crs: string | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly controller: ProjectStateController,
  ) {
    panel.webview.html = this.html(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    panel.onDidDispose(() => { if (DemMapPanel.current === this) DemMapPanel.current = undefined; });
    this.ready = this.load();
  }

  dispose(): void { this.panel.dispose(); }

  private async load(): Promise<void> {
    this.grid = undefined;
    this.crs = undefined;
    const folder = this.controller.targetFolder;
    const manifest = this.controller.manifest;
    if (!folder || !manifest) {
      await this.panel.webview.postMessage({ command: 'error', message: 'Open a ready Triton project first.' });
      return;
    }
    let demUri = vscode.Uri.joinPath(folder, manifest.paths.inputDir, 'dem.dem');
    try {
      await vscode.workspace.fs.stat(demUri);
    } catch {
      const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `${manifest.paths.inputDir}/*.dem`));
      if (found.length === 0) {
        await this.panel.webview.postMessage({ command: 'noDem', domain: this.domainBounds(manifest) });
        return;
      }
      demUri = found[0];
    }
    let grid: Grid;
    try {
      grid = parseEsriAsciiGrid(Buffer.from(await vscode.workspace.fs.readFile(demUri)).toString('utf8'));
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'error', message: `Could not read the DEM: ${(e as Error).message}` });
      return;
    }
    const crs = manifest.spatial.crs;
    if (!crs) {
      await this.panel.webview.postMessage({ command: 'noCrs' });
      return;
    }
    this.grid = grid;
    this.crs = crs;
    await this.postOverlay(DEFAULT_OPTS);
  }

  /** Exposed so integration tests can drive the protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg || msg.command !== 'rerender' || !this.grid || !this.crs) return;
    await this.postOverlay({ colormap: safeColormap(msg.colormap), hillshade: !!msg.hillshade, maxDim: DEFAULT_OPTS.maxDim });
  }

  private async postOverlay(opts: DemOverlayOptions): Promise<void> {
    if (!this.grid || !this.crs) return;
    try {
      await this.panel.webview.postMessage(buildOverlayMessage(this.grid, this.crs, opts));
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'error', message: `Could not render the DEM: ${(e as Error).message}` });
    }
  }

  private domainBounds(manifest: TriforgeManifest): LatLngBounds | undefined {
    const g = manifest.spatial.grid;
    const crs = manifest.spatial.crs;
    if (!g || !crs) return undefined;
    const pseudo: Grid = { ncols: g.ncols, nrows: g.nrows, cellsize: g.cellsize, xll: g.xll, yll: g.yll, nodata: 0, values: new Float64Array(0) };
    try { return gridLatLngBounds(pseudo, crs); } catch { return undefined; }
  }

  private html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dem-map.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dem-map.css'));
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; ` +
      `img-src ${webview.cspSource} data: https://*.tile.openstreetmap.org https://server.arcgisonline.com;`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<style>
  html, body { height: 100%; margin: 0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); display: flex; flex-direction: column; position: relative; }
  #controls { padding: .4rem .6rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-input-border, #8884); z-index: 1100; }
  #controls select, #controls input[type=range] { background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); }
  #range { opacity: .8; }
  #map { flex: 1 1 auto; min-height: 0; }
  .leaflet-container { background: var(--vscode-editor-background); }
  #notice { display: none; position: absolute; top: 55%; left: 50%; transform: translate(-50%, -50%);
    background: var(--vscode-editor-background); padding: .6rem 1rem; border: 1px solid var(--vscode-input-border, #8884);
    border-radius: 4px; z-index: 1200; max-width: 24rem; text-align: center; }
</style>
</head>
<body>
  <div id="controls">
    <label>Colormap <select id="colormap"></select></label>
    <label><input type="checkbox" id="hillshade"> Hillshade</label>
    <label>Opacity <input type="range" id="opacity" min="0" max="100" value="70"></label>
    <span id="range"></span>
  </div>
  <div id="map"></div>
  <div id="notice"></div>
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
