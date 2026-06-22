import * as fs from 'fs';
import * as path from 'path';
import { parseEsriHeader } from '../core/triton-files';

export interface OutputFrame { variable: string; frame: number; subdomain: number; file: string; }
export interface ProjectScan {
  root: string;
  configs: string[];
  inputs: string[];
  outputs: { asc: OutputFrame[]; bin: OutputFrame[]; series: string[]; performance: string[]; gtiff: string[] };
  demGrid?: { path: string; ncols: number; nrows: number; cellsize?: number; xll?: number; yll?: number; nodata: number };
}

const FRAME_RE = /^([A-Za-z]+)_(\d+)_(\d+)\.(out|tif)$/;
const DEM_HEADER_BYTES = 4096;

/** Read only the first `n` bytes of a file (cheap header sniff; never loads a huge DEM whole). */
function readPrefix(file: string, n: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = fs.readSync(fd, buf, 0, n, 0);
    return buf.toString('utf8', 0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skips dotfiles incl. macOS ._ AppleDouble
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc); else acc.push(full);
  }
  return acc;
}

function frameOf(file: string): OutputFrame | undefined {
  const m = path.basename(file).match(FRAME_RE);
  return m ? { variable: m[1], frame: Number(m[2]), subdomain: Number(m[3]), file } : undefined;
}

/** Scan a Triton project folder: configs, inputs, outputs (frames/series/perf), detected DEM grid. */
export function scanProject(root: string): ProjectScan {
  const all = walk(root);
  const rel = (p: string) => p;
  const configs = all.filter((p) => p.endsWith('.cfg') && !p.includes(`${path.sep}output${path.sep}`));
  const outDir = `${path.sep}output${path.sep}`;
  const inputs = all.filter((p) => !p.includes(outDir) && !p.endsWith('.cfg'));
  const ascOut = all.filter((p) => p.includes(`${path.sep}asc${path.sep}`) && p.endsWith('.out'));
  const binOut = all.filter((p) => p.includes(`${path.sep}bin${path.sep}`) && p.endsWith('.out'));
  const outputs = {
    asc: ascOut.map(frameOf).filter((x): x is OutputFrame => !!x).sort((a, b) => a.frame - b.frame || a.subdomain - b.subdomain),
    bin: binOut.map(frameOf).filter((x): x is OutputFrame => !!x).sort((a, b) => a.frame - b.frame || a.subdomain - b.subdomain),
    series: all.filter((p) => p.includes(`${path.sep}series${path.sep}`) && p.endsWith('.txt')),
    performance: all.filter((p) => path.basename(p) === 'performance.txt'),
    gtiff: all.filter((p) => p.endsWith('.vrt') || p.endsWith('.tif')),
  };

  let demGrid: ProjectScan['demGrid'];
  for (const cfgPath of configs) {
    try {
      const cfg = fs.readFileSync(cfgPath, 'utf8');
      const m = cfg.match(/^\s*dem_filename\s*=\s*"?([^"\n]+)"?/m);
      if (!m) continue;
      const demPath = path.resolve(path.dirname(cfgPath), m[1]);
      if (!fs.existsSync(demPath)) continue;
      const head = readPrefix(demPath, DEM_HEADER_BYTES);
      const h = parseEsriHeader(head);
      demGrid = { path: demPath, ncols: h.ncols, nrows: h.nrows, cellsize: h.cellsize, xll: h.xll, yll: h.yll, nodata: h.nodata };
      break;
    } catch { /* skip unreadable/odd config */ }
  }

  return { root, configs: configs.map(rel), inputs: inputs.map(rel), outputs, demGrid };
}
