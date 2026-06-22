import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { buildToolHandlers } from './tools';

const root = join(process.cwd(), 'resources/triton-examples/mini');
const H = () => buildToolHandlers(root);
const json = (r: { content: { type: string; text: string }[]; isError?: boolean }) => JSON.parse(r.content[0].text);

describe('tool handlers', () => {
  it('project_overview enumerates configs, grid, and frames', async () => {
    const r = json(await H().triton_project_overview({}));
    expect(r.configs).toContain('mini.cfg');
    expect(r.demGrid).toMatchObject({ ncols: 3, nrows: 2 });
    expect(r.outputs.asc.length).toBe(2);
  });
  it('read_config strips quotes and reports resolved files', async () => {
    const r = json(await H().triton_read_config({ path: 'mini.cfg' }));
    expect(r.entries.dem_filename).toBe('dem.dem');
    expect(r.entries.input_format).toBe('ASC');
  });
  it('read_config reports which referenced files exist (spec §8)', async () => {
    const r = json(await H().triton_read_config({ path: 'mini.cfg' }));
    const dem = r.referencedFiles.find((f: { key: string }) => f.key === 'dem_filename');
    const src = r.referencedFiles.find((f: { key: string }) => f.key === 'src_loc_file');
    expect(dem).toMatchObject({ value: 'dem.dem', exists: true });
    expect(src).toMatchObject({ value: 'sources.src', exists: true });
    // only KB path-typed, non-empty entries are checked (not e.g. input_format)
    expect(r.referencedFiles.some((f: { key: string }) => f.key === 'input_format')).toBe(false);
  });
  it('grid_extent on the DEM gives native-CRS bbox', async () => {
    const r = json(await H().triton_grid_extent({ path: 'dem.dem' }));
    expect(r).toMatchObject({ ncols: 3, nrows: 2, widthM: 30, heightM: 20, xmax: 130, ymax: 220 });
  });
  it('grid_stats returns summary only — no raw values', async () => {
    const r = await H().triton_grid_stats({ path: 'dem.dem' });
    expect(json(r)).toMatchObject({ min: 1, max: 6, count: 6 });
    expect(r.content[0].text).not.toMatch(/"values"/);
  });
  it('read_grid is summary-only by default; window and downsample expose raw cells', async () => {
    const summary = await H().triton_read_grid({ path: 'dem.dem' });
    expect(summary.content[0].text).not.toMatch(/"rows"/);
    const win = json(await H().triton_read_grid({ path: 'dem.dem', window: { row: 0, col: 0, height: 1, width: 2 } }));
    expect(win.window.rows).toEqual([[1, 2]]);
    const down = json(await H().triton_read_grid({ path: 'dem.dem', downsample: 2 }));
    expect(down.downsample).toMatchObject({ factor: 2, ncols: 2, nrows: 1 });
    expect(down.downsample.rows).toEqual([[1, 3]]);
  });
  it('read_points parses the .src', async () => {
    expect(json(await H().triton_read_points({ path: 'sources.src' }))).toHaveLength(1);
  });
  it('max_depth aggregates the H frames', async () => {
    const r = json(await H().triton_max_depth({ variable: 'H' }));
    expect(r.stats.max).toBeCloseTo(0.5);
    expect(r.frameCount).toBe(2);
  });
  it('max_depth honors the frame selector and optional grid window', async () => {
    const oneFrame = json(await H().triton_max_depth({ variable: 'H', frame: 1 }));
    expect(oneFrame).toMatchObject({ frame: 1, frameCount: 1 });
    expect(oneFrame.stats.max).toBeCloseTo(0.5);
    const windowed = json(await H().triton_max_depth({ variable: 'H', window: { row: 0, col: 0, height: 1, width: 3 } }));
    expect(windowed.window.rows).toEqual([[0.5, 0.4, 0.3]]);
  });
  it('read_series is summary-only by default; window exposes raw rows', async () => {
    const summary = await H().triton_read_series({ path: 'output/series/H_series.txt' });
    expect(json(summary)).toMatchObject({ rows: 2 });
    expect(summary.content[0].text).not.toMatch(/"window"/);
    const win = json(await H().triton_read_series({ path: 'output/series/H_series.txt', window: { start: 1, count: 1 } }));
    expect(win.window).toMatchObject({ start: 1, count: 1 });
    expect(win.window.rows).toEqual([[1.5, 0.3, 0.4]]);
  });
  it('describe_project blends the scan with KB context', async () => {
    const r = json(await H().triton_describe_project({}));
    expect(r.configs).toContain('mini.cfg');
    expect(r.demGrid).toMatchObject({ ncols: 3, nrows: 2 });
    expect(r.outputs).toMatchObject({ frameCount: 5 }); // 2 asc + 3 bin frames
    expect(r.outputs.variables).toContain('H');
    expect(r.knowledgeBase.configVariables).toBeGreaterThan(0);
    expect(typeof r.summary).toBe('string');
    expect(r.summary).toMatch(/Triton project/);
  });
  it('lookup_config_variable reuses the M2a KB', async () => {
    expect(json(await H().triton_lookup_config_variable({ name: 'courant' })).name).toBe('courant');
  });
  it('rejects paths outside the project root', async () => {
    const r = await H().triton_grid_stats({ path: '../../../etc/passwd' });
    expect(r.isError).toBe(true);
  });
});

// PAR-mode (multi-subdomain) max-depth: the SEQ mini fixture never splits a frame,
// so a dedicated temp project exercises the subdomain stitch the spec requires
// (§8 "stitch subdomains, cellwise max"; §11.3 "incl. subdomain stitch"). Without
// stitching, each 2-cell part would fail the 4-cell DEM size check on the old code.
describe('max_depth across PAR-mode subdomains', () => {
  let parRoot: string;
  beforeAll(() => {
    parRoot = mkdtempSync(join(tmpdir(), 'triforge-par-'));
    const asc = join(parRoot, 'output', 'asc');
    mkdirSync(asc, { recursive: true });
    // DEM 4x1 so each frame splits into two 2-cell subdomains that concatenate to the full row.
    writeFileSync(join(parRoot, 'flat.cfg'), 'dem_filename="dem.dem"\noutput_option=PAR\n');
    writeFileSync(join(parRoot, 'dem.dem'),
      'NCOLS 4\nNROWS 1\nXLLCORNER 0\nYLLCORNER 0\nCELLSIZE 1\nNODATA_value -9999\n1 2 3 4\n');
    // frame 01: [0.1 0.2 | 0.3 0.4]  frame 02: [0.9 0.0 | 0.0 0.5]
    writeFileSync(join(asc, 'H_01_00.out'), '0.1 0.2\n');
    writeFileSync(join(asc, 'H_01_01.out'), '0.3 0.4\n');
    writeFileSync(join(asc, 'H_02_00.out'), '0.9 0.0\n');
    writeFileSync(join(asc, 'H_02_01.out'), '0.0 0.5\n');
  });
  afterAll(() => rmSync(parRoot, { recursive: true, force: true }));

  it('stitches subdomains per frame then takes the cellwise max', async () => {
    const handlers = buildToolHandlers(parRoot);
    const r = json(await handlers.triton_max_depth({ variable: 'H' }));
    expect(r.frameCount).toBe(2); // two timesteps, not four parts
    expect(r.stats.max).toBeCloseTo(0.9);
    expect(r.stats.count).toBe(4); // full DEM-sized stitched grid
    // cellwise max over [0.1,0.2,0.3,0.4] and [0.9,0,0,0.5] = [0.9,0.2,0.3,0.5]
    const win = json(await handlers.triton_max_depth({ variable: 'H', window: { row: 0, col: 0, height: 1, width: 4 } }));
    expect(win.window.rows[0].map((v: number) => Number(v.toFixed(4)))).toEqual([0.9, 0.2, 0.3, 0.5]);
  });

  it('stitches a single selected frame from its subdomains', async () => {
    const handlers = buildToolHandlers(parRoot);
    const r = json(await handlers.triton_max_depth({ variable: 'H', frame: 1, window: { row: 0, col: 0, height: 1, width: 4 } }));
    expect(r).toMatchObject({ frame: 1, frameCount: 1 });
    expect(r.window.rows[0].map((v: number) => Number(v.toFixed(4)))).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});
