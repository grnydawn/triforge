import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { scanProject } from './project';

const root = join(process.cwd(), 'resources/triton-examples/mini');

describe('scanProject', () => {
  it('finds configs, the DEM grid, and output frames', () => {
    const s = scanProject(root);
    expect(s.configs.map((c) => c.replace(root + '/', ''))).toContain('mini.cfg');
    expect(s.demGrid).toMatchObject({ ncols: 3, nrows: 2, cellsize: 10, nodata: -9999 });
    expect(s.outputs.asc).toHaveLength(2);
    expect(s.outputs.asc[0]).toMatchObject({ variable: 'H', frame: 1, subdomain: 0 });
  });

  it('classifies bin frames and sorts by frame then subdomain (tiebreaker)', () => {
    const s = scanProject(root);
    // The bin/ fixture holds two subdomains of frame 1 plus frame 2, on disk in a
    // non-sorted order — so the (frame, subdomain) comparator is genuinely exercised.
    expect(s.outputs.bin.map((f) => [f.frame, f.subdomain])).toEqual([
      [1, 0],
      [1, 1],
      [2, 0],
    ]);
    expect(s.outputs.bin.every((f) => f.variable === 'H')).toBe(true);
  });

  it('classifies output series, performance, and gtiff mosaics', () => {
    const s = scanProject(root);
    expect(s.outputs.series.some((p) => p.endsWith('/series/H_series.txt'))).toBe(true);
    expect(s.outputs.performance.some((p) => p.endsWith('/performance.txt'))).toBe(true);
    expect(s.outputs.gtiff.some((p) => p.endsWith('.vrt'))).toBe(true);
    expect(s.outputs.gtiff.some((p) => p.endsWith('.tif'))).toBe(true);
    // gtiff tiles must not leak into the asc/bin frame lists.
    expect(s.outputs.asc.concat(s.outputs.bin).every((f) => !f.file.endsWith('.tif'))).toBe(true);
  });

  it('ignores macOS ._ AppleDouble files', () => {
    // Guard against a vacuous assertion: the fixture must actually contain AppleDouble
    // files for the dotfile skip in walk() to be doing real work here.
    expect(existsSync(join(root, '._dem.dem'))).toBe(true);
    expect(existsSync(join(root, 'output/asc/._H_01_00.out'))).toBe(true);
    const s = scanProject(root);
    expect([...s.inputs, ...s.outputs.asc.map((f) => f.file)].every((p) => !p.includes('/._'))).toBe(true);
  });

  it('ignores ordinary dotfiles too (not just AppleDouble)', () => {
    expect(existsSync(join(root, '.hidden'))).toBe(true);
    const s = scanProject(root);
    expect(s.inputs.every((p) => !p.endsWith('/.hidden'))).toBe(true);
  });
});
