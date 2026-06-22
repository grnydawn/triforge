import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildToolHandlers, TOOL_SPECS } from './tools';
import { buildVizHandlers, VIZ_TOOL_SPECS } from './viz-tools';

/** Resolve the project root from argv[2], TRITON_PROJECT, or cwd. */
export function resolveProjectRoot(argv: string[], env: NodeJS.ProcessEnv, cwd: string): string {
  return argv[2] || env.TRITON_PROJECT || cwd;
}

export function createServer(root: string): McpServer {
  const server = new McpServer({ name: 'triforge-mcp', version: '0.1.0' });
  const handlers = buildToolHandlers(root);
  for (const spec of TOOL_SPECS) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => handlers[spec.name](args ?? {}) as any,
    );
  }
  const vizHandlers = buildVizHandlers(root);
  for (const spec of VIZ_TOOL_SPECS) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => vizHandlers[spec.name](args ?? {}) as any,
    );
  }
  return server;
}

export async function main(): Promise<void> {
  const root = resolveProjectRoot(process.argv, process.env, process.cwd());
  const server = createServer(root);
  await server.connect(new StdioServerTransport());
}
