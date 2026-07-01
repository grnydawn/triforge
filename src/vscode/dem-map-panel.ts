import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { parseEsriAsciiGrid, Grid } from '../core/triton-files';
import { gridLatLngBounds, buildDemOverlay, encodePng, COLORMAP_NAMES, COLORMAPS, floodGlobalRange, renderFloodFrame, capFrames } from '../core/triton-viz';
import type { LatLngBounds, DemOverlayOptions, ColormapName, FloodOverlayOptions, Raster } from '../core/triton-viz';
import type { TriforgeManifest } from '../core/types';
import { ProjectStateController } from './state';
import { scanProject } from '../mcp/project';
import { computeFrames } from '../mcp/tools';
import { writeMapGif } from './map-gif-export';

const deflate = (bytes: Uint8Array): Uint8Array => new Uint8Array(zlib.deflateSync(bytes));
const DEFAULT_OPTS: DemOverlayOptions = { colormap: 'terrain', hillshade: false, maxDim: 2048 };

const FLOOD_MAX_DIM = 1024;
const FLOOD_MAX_FRAMES = 200;
const DRY_THRESHOLD = 0.001;

export interface FloodFramesMessage {
  command: 'floodFrames';
  frames: string[];          // per-frame PNG data URIs, in playback order
  bounds: LatLngBounds;      // shared UTM->lat/lng box (== DEM box)
  range: { min: number; max: number };
  width: number;
  height: number;
  frameNumbers: number[];    // original frame index per kept frame (for the label)
  variable: string;
  variables: string[];
  stride: number;
  note: string;
  autoPlay: boolean;
}

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

/**
 * Grid frames + crs + opts → the floodFrames message. Caps the frame count, computes a
 * single global range so colors are stable across playback, renders + PNG-encodes each
 * kept frame here, and shares one lat/lng box (all frames are DEM-sized). Precondition:
 * `frames` is non-empty (callers only invoke this once frames are found).
 */
export function buildFloodFramesMessage(
  frames: Grid[],
  frameNumbers: number[],
  crs: string,
  opts: FloodOverlayOptions,
  meta: { variable: string; variables: string[]; autoPlay: boolean },
): FloodFramesMessage {
  const { frames: kept, stride } = capFrames(frames, FLOOD_MAX_FRAMES);
  const keptNumbers: number[] = [];
  for (let i = 0; i < frameNumbers.length; i += stride) keptNumbers.push(frameNumbers[i]);
  const range = floodGlobalRange(kept, opts.dryThreshold);
  const lut = COLORMAPS[opts.colormap].lut;
  const bounds = gridLatLngBounds(kept[0], crs);
  let width = 0;
  let height = 0;
  const uris = kept.map((g) => {
    const raster = renderFloodFrame(g, lut, range, opts.maxDim, opts.dryThreshold);
    width = raster.width;
    height = raster.height;
    return 'data:image/png;base64,' + Buffer.from(encodePng(raster, deflate)).toString('base64');
  });
  const note = stride > 1 ? `Showing ${kept.length} of ${frames.length} frames (stride ${stride}).` : '';
  return {
    command: 'floodFrames', frames: uris, bounds, range, width, height,
    frameNumbers: keptNumbers, variable: meta.variable, variables: meta.variables, stride, note, autoPlay: meta.autoPlay,
  };
}

function safeColormap(v: unknown): ColormapName {
  return (COLORMAP_NAMES as readonly string[]).includes(v as string) ? (v as ColormapName) : 'terrain';
}

const safeFloodColormap = (v: unknown): ColormapName =>
  (COLORMAP_NAMES as readonly string[]).includes(v as string) ? (v as ColormapName) : 'depth';

export class DemMapPanel {
  static current: DemMapPanel | undefined;

  static show(context: vscode.ExtensionContext, controller: ProjectStateController, autoPlay = false): DemMapPanel {
    if (DemMapPanel.current) {
      DemMapPanel.current.autoPlay = autoPlay;
      DemMapPanel.current.panel.reveal();
      DemMapPanel.current.ready = DemMapPanel.current.load();
      return DemMapPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('triforge.demMap', 'TRITON Map', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    const created = new DemMapPanel(panel, context, controller, autoPlay);
    DemMapPanel.current = created;
    return created;
  }

  /** Resolves when the DEM (or a notice) has been posted to the webview (awaited by tests). */
  ready: Promise<void>;
  private grid: Grid | undefined;
  private crs: string | undefined;
  private floodGrids: Grid[] = [];
  private floodFrameNumbers: number[] = [];
  private floodVariable: string | undefined;
  private floodVariables: string[] = [];
  private floodColormap: ColormapName = 'depth';
  private autoPlay = false;
  private exportBuf: { frames: Raster[]; fps: number; width: number; height: number } | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly controller: ProjectStateController,
    autoPlay: boolean,
  ) {
    this.autoPlay = autoPlay;
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
    await this.loadFlood(folder);
  }

  /** Scan for output frames of the active variable, cache the stitched grids, and post them. */
  private async loadFlood(folder: vscode.Uri): Promise<void> {
    this.floodGrids = [];
    this.floodFrameNumbers = [];
    if (!this.crs) return;
    try {
      const scan = scanProject(folder.fsPath);
      const variables = [...new Set(scan.outputs.asc.map((f) => f.variable))].sort();
      if (variables.length === 0) {
        await this.panel.webview.postMessage({ command: 'noFloodFrames', note: 'No simulation output frames (output/asc/*.out) yet — run the solver to see the flood animation.' });
        return;
      }
      this.floodVariables = variables;
      const variable = this.floodVariable && variables.includes(this.floodVariable) ? this.floodVariable
        : variables.includes('H') ? 'H' : variables[0];
      this.floodVariable = variable;
      const parts = scan.outputs.asc.filter((f) => f.variable === variable);
      const frameNumbers = [...new Set(parts.map((f) => f.frame))].sort((a, b) => a - b);
      const { frames } = computeFrames(folder.fsPath, { paths: parts.map((p) => p.file) });
      this.floodGrids = frames;
      this.floodFrameNumbers = frameNumbers;
      await this.postFlood();
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'noFloodFrames', note: `Could not load flood frames: ${(e as Error).message}` });
    }
  }

  /** Render the cached flood grids with the current water colormap and post them. */
  private async postFlood(): Promise<void> {
    if (!this.crs || this.floodGrids.length === 0) return;
    const opts: FloodOverlayOptions = { colormap: this.floodColormap, maxDim: FLOOD_MAX_DIM, dryThreshold: DRY_THRESHOLD };
    try {
      const msg = buildFloodFramesMessage(this.floodGrids, this.floodFrameNumbers, this.crs, opts,
        { variable: this.floodVariable ?? 'H', variables: this.floodVariables, autoPlay: this.autoPlay });
      await this.panel.webview.postMessage(msg);
      this.autoPlay = false; // one-shot: only the first post after opening via the command auto-plays
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'noFloodFrames', note: `Could not render flood frames: ${(e as Error).message}` });
    }
  }

  /** Exposed so integration tests can drive the protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg) return;
    if (msg.command === 'rerender') {
      if (!this.grid || !this.crs) return;
      await this.postOverlay({ colormap: safeColormap(msg.colormap), hillshade: !!msg.hillshade, maxDim: DEFAULT_OPTS.maxDim });
      return;
    }
    if (msg.command === 'reloadFlood') {
      const folder = this.controller.targetFolder;
      if (!folder || !this.crs) return;
      if (msg.colormap) this.floodColormap = safeFloodColormap(msg.colormap);
      if (msg.variable && msg.variable !== this.floodVariable) {
        this.floodVariable = msg.variable;
        await this.loadFlood(folder);   // re-read for the new variable
      } else {
        await this.postFlood();          // colormap-only: re-render cached grids
      }
    }
    if (msg.command === 'exportBegin') {
      this.exportBuf = { frames: [], fps: typeof msg.fps === 'number' && msg.fps > 0 ? msg.fps : 4, width: msg.width, height: msg.height };
      return;
    }
    if (msg.command === 'exportFrame') {
      const buf = this.exportBuf;
      if (buf && msg.rgba) buf.frames.push({ width: buf.width, height: buf.height, rgba: new Uint8ClampedArray(msg.rgba) });
      return;
    }
    if (msg.command === 'exportAborted') {
      this.exportBuf = undefined;
      await this.panel.webview.postMessage({ command: 'exportDone', ok: false, message: msg.reason || 'Export aborted.' });
      return;
    }
    if (msg.command === 'exportEnd') {
      await this.finishExport();
      return;
    }
  }

  /** Posted by the export command; tells the webview to composite + stream the current view. */
  async requestExport(): Promise<void> {
    await this.ready;
    await this.panel.webview.postMessage({ command: 'requestExport' });
  }

  /** Encode + save the streamed frames, then report back to the webview. */
  private async finishExport(): Promise<void> {
    const buf = this.exportBuf;
    this.exportBuf = undefined;
    const folder = this.controller.targetFolder;
    if (!buf || buf.frames.length === 0 || !folder) {
      await this.panel.webview.postMessage({ command: 'exportDone', ok: false, message: 'No frames captured for export.' });
      return;
    }
    try {
      const res = await writeMapGif(buf.frames, buf.fps, vscode.Uri.joinPath(folder, 'map_animation.gif'));
      if (res.cancelled) { await this.panel.webview.postMessage({ command: 'exportDone', ok: false, message: '' }); return; }
      await this.panel.webview.postMessage({ command: 'exportDone', ok: true, message: `Exported ${buf.frames.length}-frame GIF.` });
      const choice = await vscode.window.showInformationMessage(`Triforge: exported ${res.written}`, 'Open', 'Reveal in Explorer');
      if (choice === 'Open') await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(res.written!));
      else if (choice === 'Reveal in Explorer') await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(res.written!));
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'exportDone', ok: false, message: `Export failed: ${(e as Error).message}` });
    }
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
  #controls button { cursor: pointer; padding: .2rem .7rem; border: none;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #flood-controls { display: none; padding: .4rem .6rem; gap: 1rem; align-items: center; flex-wrap: wrap;
    background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-input-border, #8884); z-index: 1100; }
  #flood-controls.shown { display: flex; }
  #flood-controls select, #flood-controls input[type=range] { background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); }
  #flood-controls button { cursor: pointer; padding: .2rem .7rem; border: none;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #timeline { flex: 1 1 8rem; min-width: 8rem; }
  #frameLabel, #floodNote, #floodHint { opacity: .8; }
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
    <label>Terrain <input type="range" id="opacity" min="0" max="100" value="70"></label>
    <button id="fit" type="button">Fit</button>
    <span id="range"></span>
    <span id="floodHint"></span>
  </div>
  <div id="flood-controls">
    <button id="play" type="button">▶</button>
    <input type="range" id="timeline" min="0" max="0" value="0">
    <span id="frameLabel"></span>
    <label>Water <select id="waterColormap"></select></label>
    <label>Opacity <input type="range" id="waterOpacity" min="0" max="100" value="80"></label>
    <label>fps <select id="fps"></select></label>
    <label id="variableWrap" style="display:none">Variable <select id="variable"></select></label>
    <span id="floodNote"></span>
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
