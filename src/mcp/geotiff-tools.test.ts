import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { buildTinyGeoTiff, buildTinyVrt } from '../core/triton-files/geotiff.fixture';
import { buildToolHandlers, loadGrid } from './tools';
import { buildVizHandlers } from './viz-tools';

const parse = (r: any) => JSON.parse((r.content[0] as { text: string }).text);

/** A temp project with output/gtiff/{V_01.vrt + 2 strip tiles} composing a 3x3 EPSG:32616 mosaic. */
function freshGtiff(): string {
  const dir = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'triforge-gt-'));
  const g = join(dir, 'output', 'gtiff');
  fs.mkdirSync(g, { recursive: true });
  const gt = [719559, 30, 0, 90090, 0, -30]; // originY chosen so it's a valid UTM northing
  fs.writeFileSync(join(g, 'H_01_00.tif'), buildTinyGeoTiff(3, 2, [1, 2, 3, 4, 5, 6], 32616, 719559, 90090, 30));
  fs.writeFileSync(join(g, 'H_01_01.tif'), buildTinyGeoTiff(3, 1, [7, 8, 9], 32616, 719559, 90030, 30));
  fs.writeFileSync(join(g, 'H_01.vrt'), buildTinyVrt(3, 3, 32616, gt, [
    { filename: 'H_01_00.tif', width: 3, height: 2, dstYOff: 0 },
    { filename: 'H_01_01.tif', width: 3, height: 1, dstYOff: 2 },
  ]));
  return dir;
}

describe('GeoTIFF MCP read integration', () => {
  let root: string;
  beforeEach(() => { root = freshGtiff(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('loadGrid stitches a .vrt mosaic into a Grid with crs', () => {
    const g = loadGrid(root, 'output/gtiff/H_01.vrt', 'auto', {});
    expect([g.ncols, g.nrows]).toEqual([3, 3]);
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.crs).toBe('EPSG:32616');
  });
  it('loadGrid reads a single .tif tile', () => {
    const g = loadGrid(root, 'output/gtiff/H_01_00.tif', 'auto', {});
    expect([g.ncols, g.nrows]).toEqual([3, 2]);
    expect(g.crs).toBe('EPSG:32616');
  });
  it('triton_geotiff_info reports dims, EPSG, native + lon/lat extent and the tile list', async () => {
    const h = buildToolHandlers(root);
    const r = parse(await h.triton_geotiff_info({ path: 'output/gtiff/H_01.vrt' }));
    expect([r.width, r.height]).toEqual([3, 3]);
    expect(r.epsg).toBe(32616);
    expect(r.crs).toBe('EPSG:32616');
    expect(r.nativeExtent).toMatchObject({ xmin: 719559, cellsize: 30 });
    expect(r.lonLatExtent.west).toBeLessThan(r.lonLatExtent.east);
    expect(r.tiles).toHaveLength(2);
  });
  it('triton_grid_stats works on a .vrt and surfaces the stitched max', async () => {
    const h = buildToolHandlers(root);
    const r = parse(await h.triton_grid_stats({ path: 'output/gtiff/H_01.vrt' }));
    expect(r.max).toBe(9);
  });
  it('rejects (on read) a .vrt whose tile escapes the project root', async () => {
    const g = join(root, 'output', 'gtiff');
    fs.writeFileSync(join(g, 'evil.vrt'), buildTinyVrt(3, 2, 32616, [0, 1, 0, 0, 0, -1], [
      { filename: '../../../../etc/passwd', width: 3, height: 2, dstYOff: 0 },
    ]));
    const h = buildToolHandlers(root);
    // A tile-reading tool (grid_stats -> loadGrid -> loadGeoTiffGrid) resolves each tile path
    // through resolveWithinRoot, so the out-of-root reference is refused.
    const r = await h.triton_grid_stats({ path: 'output/gtiff/evil.vrt' });
    expect(r.isError).toBe(true);
    expect(parse(r).error).toMatch(/escapes/);
  });
});

describe('GeoTIFF frames for max_depth / animate', () => {
  let root: string;
  beforeEach(() => { root = freshGtiff(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('triton_max_depth format=gtiff aggregates over .vrt frames', async () => {
    const h = buildToolHandlers(root);
    const r = parse(await h.triton_max_depth({ variable: 'H', format: 'gtiff' }));
    expect(r.variable).toBe('H');
    expect(r.frameCount).toBe(1);
    expect(r.stats.max).toBe(9);
  });
  it('triton_animate format=gtiff renders a GIF over .vrt frames', async () => {
    const v = buildVizHandlers(root);
    const r = await v.triton_animate({ variable: 'H', format: 'gtiff' });
    const img = (r.content as Array<{ type: string; mimeType?: string; data?: string }>).find((c) => c.type === 'image');
    expect(img?.mimeType).toBe('image/gif');
  });
});
