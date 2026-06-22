import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { parseTritonConfig } from '../core/triton-files';
import { buildWriteHandlers } from './write-tools';

function freshMini(): string {
  const dir = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'triforge-wt-'));
  fs.cpSync(join(process.cwd(), 'resources/triton-examples/mini'), join(dir, 'proj'), { recursive: true });
  return join(dir, 'proj');
}
const parse = (r: any) => JSON.parse((r.content[0] as { text: string }).text);

describe('write gate + config write tools', () => {
  let root: string;
  beforeEach(() => { root = freshMini(); });
  afterEach(() => { fs.rmSync(join(root, '..'), { recursive: true, force: true }); });

  it('refuses every write when allowWrite is false (no fs change)', async () => {
    const h = buildWriteHandlers(root, { allowWrite: false });
    const res = await h.triton_set_config_variable({ path: 'mini.cfg', updates: { sim_duration: '99' } });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/write-disabled/);
    expect(fs.readFileSync(join(root, 'mini.cfg'), 'utf8')).toContain('sim_duration=25');
  });

  it('set_config_variable dry-runs by default (no fs change), then commits with backup', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const dry = parse(await h.triton_set_config_variable({ path: 'mini.cfg', updates: { sim_duration: '50' } }));
    expect(dry.dryRun).toBe(true);
    expect(dry.changes).toContainEqual({ key: 'sim_duration', old: '25', new: '50' });
    expect(fs.readFileSync(join(root, 'mini.cfg'), 'utf8')).toContain('sim_duration=25');

    const done = parse(await h.triton_set_config_variable({ path: 'mini.cfg', updates: { sim_duration: '50' }, confirm: true }));
    expect(done.written).toBe(true);
    const after = fs.readFileSync(join(root, 'mini.cfg'), 'utf8');
    expect(after).toContain('sim_duration=50');
    expect(after).toContain('# mini Triton project'); // comment preserved
    expect(fs.readFileSync(join(root, 'mini.cfg.bak'), 'utf8')).toContain('sim_duration=25'); // backup
  });

  it('set_config_variable errors when the file is missing', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const res = await h.triton_set_config_variable({ path: 'nope.cfg', updates: { a: 'b' }, confirm: true });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/config not found/);
  });

  it('warns (non-blocking) on an unknown config variable', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const dry = parse(await h.triton_set_config_variable({ path: 'mini.cfg', updates: { frobnicate: '1' } }));
    expect(dry.warnings.join(' ')).toMatch(/unknown config variable 'frobnicate'/);
  });

  it('write_config refuses to clobber without overwrite, then creates a new file', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const clob = await h.triton_write_config({ path: 'mini.cfg', entries: { a: 'b' }, confirm: true });
    expect(clob.isError).toBe(true);
    expect(parse(clob).error).toMatch(/exists/);

    const done = parse(await h.triton_write_config({ path: 'new.cfg', entries: { dem_filename: 'd.dem', num_sources: '1' }, confirm: true }));
    expect(done.written).toBe(true);
    const rt = parseTritonConfig(fs.readFileSync(join(root, 'new.cfg'), 'utf8'));
    expect(rt.entries).toEqual({ dem_filename: 'd.dem', num_sources: '1' });
  });
});

import { parseHeaderlessMatrix, parsePointList, parseBoundaries, parseForcingSeries } from '../core/triton-files';

describe('grid & table write tools', () => {
  let root: string;
  beforeEach(() => { root = freshMini(); });
  afterEach(() => { fs.rmSync(join(root, '..'), { recursive: true, force: true }); });

  it('write_grid headerless fill uses the DEM dims and round-trips', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const done = parse(await h.triton_write_grid({ path: 'roughness.mann', format: 'headerless', fill: 0.035, confirm: true }));
    expect(done.written).toBe(true);
    const g = parseHeaderlessMatrix(fs.readFileSync(join(root, 'roughness.mann'), 'utf8'), 3, 2, -9999);
    expect(Array.from(g.values)).toEqual([0.035, 0.035, 0.035, 0.035, 0.035, 0.035]);
  });

  it('write_grid esri fill inherits DEM georef and round-trips', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    parse(await h.triton_write_grid({ path: 'flat.dem', format: 'esri', fill: 1, confirm: true }));
    const txt = fs.readFileSync(join(root, 'flat.dem'), 'utf8');
    expect(txt).toContain('cellsize 10');
    expect(txt).toContain('xllcorner 100');
  });

  it('write_grid rejects an oversized explicit values array', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const res = await h.triton_write_grid({ path: 'big.mann', format: 'headerless', values: new Array(5000).fill(0), ncols: 100, nrows: 50, confirm: true });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/cell cap/);
  });

  it('write_points round-trips and warns on a num_sources mismatch (W7)', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const dry = parse(await h.triton_write_points({ path: 'gauges.obs', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }));
    expect(dry.warnings.join(' ')).toMatch(/num_sources=1 but writing 2/); // mini.cfg has num_sources=1
    parse(await h.triton_write_points({ path: 'gauges.obs', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], confirm: true }));
    expect(parsePointList(fs.readFileSync(join(root, 'gauges.obs'), 'utf8'))).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it('write_boundaries and write_forcing round-trip', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    parse(await h.triton_write_boundaries({ path: 'bc.extbc', segments: [{ bcType: 3, x1: 0, y1: 0, x2: 1, y2: 1, bc: 0.5 }], confirm: true }));
    expect(parseBoundaries(fs.readFileSync(join(root, 'bc.extbc'), 'utf8'))).toEqual([{ bcType: 3, x1: 0, y1: 0, x2: 1, y2: 1, bc: 0.5 }]);

    parse(await h.triton_write_forcing({ path: 'flow.hyg', times: [0, 1, 2], columns: [[10, 20, 5]], confirm: true }));
    const f = parseForcingSeries(fs.readFileSync(join(root, 'flow.hyg'), 'utf8'));
    expect(f.times).toEqual([0, 1, 2]);
    expect(f.columns).toEqual([[10, 20, 5]]);
  });
});

describe('save_image', () => {
  let root: string;
  beforeEach(() => { root = freshMini(); });
  afterEach(() => { fs.rmSync(join(root, '..'), { recursive: true, force: true }); });

  it('renders a grid heatmap to a PNG file on disk', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const dry = parse(await h.triton_save_image({ source: 'grid', out: 'dem.png', path: 'dem.dem' }));
    expect(dry.dryRun).toBe(true);
    expect(dry.mimeType).toBe('image/png');
    expect(fs.existsSync(join(root, 'dem.png'))).toBe(false);

    parse(await h.triton_save_image({ source: 'grid', out: 'dem.png', path: 'dem.dem', confirm: true }));
    expect(Array.from(fs.readFileSync(join(root, 'dem.png')).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('propagates a render error (e.g. path escape) instead of writing', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const res = await h.triton_save_image({ source: 'grid', out: 'x.png', path: '../../etc/passwd', confirm: true });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/render error|escapes/);
  });
});

describe('path-escape rejection at the write tool boundary (M2C-WRITE-06)', () => {
  let root: string;
  beforeEach(() => { root = freshMini(); });
  afterEach(() => { fs.rmSync(join(root, '..'), { recursive: true, force: true }); });

  it('refuses a `..` traversal write and creates no file outside root', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const res = await h.triton_write_grid({ path: '../escape.mann', format: 'headerless', fill: 0, confirm: true });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/escapes/);
    expect(fs.existsSync(join(root, '..', 'escape.mann'))).toBe(false);
  });

  it('refuses a write through a symlinked parent dir on create', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const outsideDir = join(root, '..', 'outside2');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, join(root, 'link'), 'dir');
    const res = await h.triton_write_points({ path: 'link/evil.src', points: [{ x: 1, y: 2 }], confirm: true });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/symlink parent/);
  });
});
