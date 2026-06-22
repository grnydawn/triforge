import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(process.cwd(), 'resources/triton-examples/mini');

describe('stdio MCP smoke', () => {
  beforeAll(() => { execSync('node esbuild.mcp.js', { stdio: 'inherit' }); }); // ensure the bin is built

  it('lists tools and serves project_overview over stdio', async () => {
    const transport = new StdioClientTransport({ command: 'node', args: [join(process.cwd(), 'bin/triforge-mcp.js'), root] });
    const client = new Client({ name: 'smoke', version: '0.0.0' });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain('triton_project_overview');
      expect(names).toContain('triton_grid_stats');

      const res = await client.callTool({ name: 'triton_project_overview', arguments: {} });
      const text = (res.content as { type: string; text: string }[])[0].text;
      expect(JSON.parse(text).demGrid).toMatchObject({ ncols: 3, nrows: 2 });
    } finally {
      await client.close();
    }
  }, 30000);

  it('lists the viz tools and serves render_grid as image content over stdio', async () => {
    const transport = new StdioClientTransport({ command: 'node', args: [join(process.cwd(), 'bin/triforge-mcp.js'), root] });
    const client = new Client({ name: 'smoke-viz', version: '0.0.0' });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('triton_render_grid');
      expect(names).toContain('triton_animate');

      const res = await client.callTool({ name: 'triton_render_grid', arguments: { path: 'dem.dem' } });
      const content = res.content as Array<{ type: string; data?: string; mimeType?: string }>;
      const img = content.find((c) => c.type === 'image');
      expect(img?.mimeType).toBe('image/png');
      const buf = Buffer.from(img!.data as string, 'base64');
      expect(Array.from(buf.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    } finally {
      await client.close();
    }
  }, 30000);
});
