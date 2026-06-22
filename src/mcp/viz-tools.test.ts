import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { buildVizHandlers } from './viz-tools';

const root = join(process.cwd(), 'resources/triton-examples/mini');
const real = join(process.cwd(), 'resources/triton-examples/real');
const V = (r: string = root) => buildVizHandlers(r);

interface Img { type: string; data: string; mimeType: string }
const image = (res: { content: Array<{ type: string }> }): Img =>
  res.content.find((c) => c.type === 'image') as unknown as Img;

function pngDims(b64: string): { sig: boolean; w: number; h: number } {
  const buf = Buffer.from(b64, 'base64');
  const sig = buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { sig, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('viz tool handlers', () => {
  it('render_grid returns a PNG of the DEM (3x2)', async () => {
    const im = image(await V().triton_render_grid({ path: 'dem.dem' }));
    expect(im.mimeType).toBe('image/png');
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 3, h: 2 });
  });
  it('render_grid colorizes a headerless ASCII output using DEM dims', async () => {
    const im = image(await V().triton_render_grid({ path: 'output/asc/H_01_00.out', colormap: 'depth' }));
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 3, h: 2 });
  });
  it('render_dem renders (terrain + hillshade by default)', async () => {
    const im = image(await V().triton_render_dem({ path: 'dem.dem' }));
    expect(im.mimeType).toBe('image/png');
    expect(pngDims(im.data).sig).toBe(true);
  });
  it('render_max_depth renders the H frames', async () => {
    const im = image(await V().triton_render_max_depth({ variable: 'H' }));
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 3, h: 2 });
  });
  it('plot_series returns an 800x480 PNG', async () => {
    const im = image(await V().triton_plot_series({ path: 'output/series/H_series.txt' }));
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 800, h: 480 });
  });
  it('plot_forcing renders the allatoona hydrograph (real fixture)', async () => {
    const im = image(await V(real).triton_plot_forcing({ path: 'allatoona.hyg' }));
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 800, h: 480 });
  });
  it('animate returns an animated GIF', async () => {
    const im = image(await V().triton_animate({ variable: 'H', fps: 5 }));
    expect(im.mimeType).toBe('image/gif');
    expect(Buffer.from(im.data, 'base64').slice(0, 6).toString('ascii')).toBe('GIF89a');
  });
  it('the caption text is small and never dumps raw pixels', async () => {
    const res = await V().triton_render_grid({ path: 'dem.dem' });
    const txt = res.content.find((c) => c.type === 'text') as { text: string };
    expect(txt.text.length).toBeLessThan(400);
    expect(txt.text).not.toMatch(/\[\s*\d+\s*,\s*\d+\s*,\s*\d+/);
  });
  it('rejects paths outside the project root', async () => {
    const res = await V().triton_render_grid({ path: '../../../etc/passwd', kind: 'esri' });
    expect(res.isError).toBe(true);
  });
});
