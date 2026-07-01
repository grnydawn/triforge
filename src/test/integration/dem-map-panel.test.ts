import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseEsriAsciiGrid } from '../../core/triton-files';
import { buildOverlayMessage } from '../../vscode/dem-map-panel';

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
