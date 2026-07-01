import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseEsriAsciiGrid } from '../../core/triton-files';
import { buildOverlayMessage, buildFloodFramesMessage } from '../../vscode/dem-map-panel';
import type { Grid } from '../../core/triton-files';

const DEM = `ncols 4
nrows 4
xllcorner 500000
yllcorner 4000000
cellsize 30
NODATA_value -9999
100 110 120 130
140 150 160 170
180 190 200 210
220 230 240 250
`;

describe('DemMapPanel (M4d)', () => {
  it('buildOverlayMessage → PNG data URI + lat/lng bounds + range', () => {
    const grid = parseEsriAsciiGrid(DEM);
    const msg = buildOverlayMessage(grid, 'EPSG:32616', { colormap: 'terrain', hillshade: false, maxDim: 64 });
    assert.strictEqual(msg.command, 'renderOverlay');
    assert.ok(msg.dataUri.startsWith('data:image/png;base64,'));
    assert.ok(msg.dataUri.length > 'data:image/png;base64,'.length);
    assert.strictEqual(msg.width, 4);
    assert.strictEqual(msg.height, 4);
    assert.ok(msg.bounds.south < msg.bounds.north && msg.bounds.west < msg.bounds.east);
    assert.strictEqual(msg.range.min, 100);
    assert.strictEqual(msg.range.max, 250);
  });

  it('different colormap yields a different overlay PNG', () => {
    const grid = parseEsriAsciiGrid(DEM);
    const a = buildOverlayMessage(grid, 'EPSG:32616', { colormap: 'terrain', hillshade: false, maxDim: 64 });
    const b = buildOverlayMessage(grid, 'EPSG:32616', { colormap: 'viridis', hillshade: false, maxDim: 64 });
    assert.notStrictEqual(a.dataUri, b.dataUri);
  });

  it('registers the triforge.openMap command', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge')!;
    await ext.activate();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('triforge.openMap'));
  });
});

describe('DemMapPanel flood frames (M4e)', () => {
  const floodGrid = (rows: number[][]): Grid => ({
    ncols: rows[0].length, nrows: rows.length, cellsize: 30, xll: 500000, yll: 4000000,
    nodata: -9999, values: Float64Array.from(rows.flat()),
  });
  const frames = [floodGrid([[0, 1], [2, 0]]), floodGrid([[0, 3], [4, 0]])];

  it('buildFloodFramesMessage → N frame data URIs + shared bounds/range', () => {
    const msg = buildFloodFramesMessage(
      frames, [0, 1], 'EPSG:32616',
      { colormap: 'depth', maxDim: 64, dryThreshold: 0.001 },
      { variable: 'H', variables: ['H'], autoPlay: true },
    );
    assert.strictEqual(msg.command, 'floodFrames');
    assert.strictEqual(msg.frames.length, 2);
    assert.ok(msg.frames[0].startsWith('data:image/png;base64,'));
    assert.deepStrictEqual(msg.frameNumbers, [0, 1]);
    assert.strictEqual(msg.range.min, 1); // wet cells across frames: 1,2,3,4
    assert.strictEqual(msg.range.max, 4);
    assert.ok(msg.bounds.south < msg.bounds.north && msg.bounds.west < msg.bounds.east);
    assert.strictEqual(msg.variable, 'H');
    assert.strictEqual(msg.autoPlay, true);
    assert.strictEqual(msg.stride, 1);
  });

  it('a different water colormap yields different frame PNGs', () => {
    const meta = { variable: 'H', variables: ['H'], autoPlay: false };
    const a = buildFloodFramesMessage(frames, [0, 1], 'EPSG:32616', { colormap: 'depth', maxDim: 64, dryThreshold: 0.001 }, meta);
    const b = buildFloodFramesMessage(frames, [0, 1], 'EPSG:32616', { colormap: 'viridis', maxDim: 64, dryThreshold: 0.001 }, meta);
    assert.notStrictEqual(a.frames[0], b.frames[0]);
  });
});
