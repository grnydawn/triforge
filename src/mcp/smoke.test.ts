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
});
