import * as vscode from 'vscode';
import * as https from 'https';
import { ProjectStateController } from './state';
import { ConfigStore } from './config-store';
import { parseEsriAsciiGrid, serializeEsriAsciiGrid } from '../core/triton-files';
import { utmEpsgFor } from '../core/crs';
import {
  OPENTOPO_DATASETS, targetGridFromBbox, lonLatBoundsForGrid, buildGlobalDemUrl, resampleToTargetGrid,
} from '../core/dem-download';
import type { GridSpec } from '../core/dem-download';

const SECRET_KEY = 'triforge.openTopographyApiKey';
const MAX_CELLS = 16_000_000;

/** Single https GET → { status, body }. The only networked unit; not run in CI. */
function httpsGetBuffer(url: string, timeoutMs = 60_000): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs} ms`)));
  });
}

function parseBboxInput(raw: string): { west: number; south: number; east: number; north: number } | undefined {
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return undefined;
  return { west, south, east, north };
}

export async function clearOpenTopographyApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
  vscode.window.showInformationMessage('Triforge: cleared the stored OpenTopography API key.');
}

export async function downloadDem(context: vscode.ExtensionContext, controller: ProjectStateController, store: ConfigStore): Promise<void> {
  const folder = controller.targetFolder;
  if (!folder || controller.state !== 'ready') {
    vscode.window.showInformationMessage('Triforge: open a Triton project folder first.');
    return;
  }
  if (!vscode.workspace.isTrusted) {
    vscode.window.showInformationMessage('Triforge: workspace is untrusted — grant trust to download a DEM.');
    return;
  }
  const manifest = controller.manifest;
  if (!manifest) { vscode.window.showErrorMessage('Triforge: no project manifest loaded.'); return; }

  const dataset = await vscode.window.showQuickPick(
    OPENTOPO_DATASETS.map((d) => ({ label: d.id, description: d.label, id: d.id })),
    { title: 'Download DEM — dataset', placeHolder: 'Elevation source' },
  );
  if (!dataset) return;

  const bboxRaw = await vscode.window.showInputBox({
    title: 'Download DEM — area (geographic)',
    prompt: 'Bounding box as west,south,east,north in decimal degrees',
    placeHolder: 'e.g. -84.62,34.00,-84.42,34.19',
    validateInput: (v) => (parseBboxInput(v) ? null : 'Enter four numbers west,south,east,north (W<E, S<N, within ±180/±90).'),
  });
  if (!bboxRaw) return;
  const bbox = parseBboxInput(bboxRaw)!;

  const cellRaw = await vscode.window.showInputBox({
    title: 'Download DEM — resolution',
    prompt: 'Target cell size in metres (UTM)',
    placeHolder: 'e.g. 30',
    validateInput: (v) => (Number(v) > 0 ? null : 'Enter a positive number of metres.'),
  });
  if (!cellRaw) return;
  const cellsize = Number(cellRaw);

  // CRS: use the manifest's, else derive from the bbox centre and remember to persist it.
  let epsg: number;
  let deriveCrsFields: { crs: string; utmZone: string; datum: string } | undefined;
  const m = /^EPSG:(\d+)$/.exec(manifest.spatial.crs);
  if (m) {
    epsg = Number(m[1]);
  } else {
    epsg = utmEpsgFor((bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2);
    const zone = epsg >= 32700 ? `${epsg - 32700}S` : `${epsg - 32600}N`;
    deriveCrsFields = { crs: `EPSG:${epsg}`, utmZone: zone, datum: 'WGS84' };
  }

  let spec: GridSpec;
  try {
    spec = targetGridFromBbox(bbox, cellsize, epsg);
  } catch (e) {
    vscode.window.showErrorMessage(`Triforge: ${(e as Error).message}`);
    return;
  }
  if (spec.ncols * spec.nrows > MAX_CELLS) {
    vscode.window.showErrorMessage(`Triforge: that area at ${cellsize} m is ${spec.ncols}×${spec.nrows} cells (> ${MAX_CELLS}). Use a coarser cell size or a smaller area.`);
    return;
  }

  // Persist the domain (and derived CRS) into triforge.json.
  const cur = store.current;
  if (cur) {
    const nextManifest = {
      ...cur.manifest,
      spatial: {
        ...cur.manifest.spatial,
        ...(deriveCrsFields ?? {}),
        grid: { ncols: spec.ncols, nrows: spec.nrows, cellsize: spec.cellsize, xll: spec.xll, yll: spec.yll },
      },
    };
    await store.writeParsed(folder, { manifest: nextManifest, unknownSections: cur.unknownSections });
    await controller.refresh();
  }

  // API key (SecretStorage).
  let apiKey = await context.secrets.get(SECRET_KEY);
  if (!apiKey) {
    apiKey = await vscode.window.showInputBox({
      title: 'OpenTopography API key',
      prompt: 'Required. Get a free key at portal.opentopography.org',
      password: true, ignoreFocusOut: true,
    });
    if (!apiKey) return;
    await context.secrets.store(SECRET_KEY, apiKey);
  }

  const inputDir = vscode.Uri.joinPath(folder, manifest.paths.inputDir);
  const target = vscode.Uri.joinPath(inputDir, 'dem.dem');
  try {
    await vscode.workspace.fs.stat(target);
    const ow = await vscode.window.showWarningMessage(`Triforge: ${manifest.paths.inputDir}/dem.dem exists. Overwrite?`, { modal: true }, 'Overwrite');
    if (ow !== 'Overwrite') return;
  } catch { /* no existing file */ }

  let summary = '';
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Triforge: downloading ${dataset.id} DEM…`, cancellable: false },
      async () => {
        const url = buildGlobalDemUrl({ demtype: dataset.id, bounds: lonLatBoundsForGrid(spec) }) + `&API_Key=${encodeURIComponent(apiKey!)}`;
        const { status, body } = await httpsGetBuffer(url);
        if (status === 401 || status === 403) {
          await context.secrets.delete(SECRET_KEY);
          throw new Error(`authentication failed (${status}); the stored API key was cleared — re-run to re-enter it.`);
        }
        if (status !== 200) throw new Error(`OpenTopography returned ${status}: ${body.toString('utf8').slice(0, 200)}`);
        if (body[0] === 0x1f && body[1] === 0x8b) throw new Error('OpenTopography returned a gzip/archive body, not AAIGrid text.');
        const text = body.toString('utf8');
        if (!/^\s*ncols\b/i.test(text)) throw new Error(`unexpected response (not an AAIGrid): ${text.slice(0, 200)}`);
        const source = parseEsriAsciiGrid(text);
        const grid = resampleToTargetGrid(source, spec);
        await vscode.workspace.fs.createDirectory(inputDir);
        await vscode.workspace.fs.writeFile(target, Buffer.from(serializeEsriAsciiGrid(grid), 'utf8'));
        summary = `${spec.ncols}×${spec.nrows} @ ${cellsize} m (EPSG:${spec.epsg})`;
      },
    );
  } catch (e) {
    vscode.window.showErrorMessage(`Triforge: DEM download failed — ${(e as Error).message}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(`Triforge: wrote ${manifest.paths.inputDir}/dem.dem (${summary}).`, 'Open', 'Reveal in Explorer');
  if (choice === 'Open') await vscode.commands.executeCommand('vscode.open', target);
  else if (choice === 'Reveal in Explorer') await vscode.commands.executeCommand('revealInExplorer', target);
}
