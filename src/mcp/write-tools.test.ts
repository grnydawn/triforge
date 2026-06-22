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
