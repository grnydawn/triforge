import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildToolHandlers, TOOL_SPECS } from './tools';
import { buildVizHandlers, VIZ_TOOL_SPECS } from './viz-tools';
import { buildWriteHandlers, WRITE_TOOL_SPECS } from './write-tools';

/** Resolve the project root from the first non-flag argv, TRITON_PROJECT, or cwd. */
export function resolveProjectRoot(argv: string[], env: NodeJS.ProcessEnv, cwd: string): string {
  const positional = argv.slice(2).find((a) => !a.startsWith('--'));
  return positional || env.TRITON_PROJECT || cwd;
}

/** Writes are off unless explicitly enabled at launch (W1). */
export function resolveAllowWrite(argv: string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes('--allow-write') || env.TRITON_ALLOW_WRITE === '1' || env.TRITON_ALLOW_WRITE === 'true';
}

export function createServer(root: string, allowWrite = false): McpServer {
  const server = new McpServer({ name: 'triforge-mcp', version: '0.1.0' });
  const handlers = buildToolHandlers(root);
  for (const spec of TOOL_SPECS) {
    server.registerTool(spec.name, { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => handlers[spec.name](args ?? {}) as any);
  }
  const vizHandlers = buildVizHandlers(root);
  for (const spec of VIZ_TOOL_SPECS) {
    server.registerTool(spec.name, { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => vizHandlers[spec.name](args ?? {}) as any);
  }
  const writeHandlers = buildWriteHandlers(root, { allowWrite });
  for (const spec of WRITE_TOOL_SPECS) {
    server.registerTool(spec.name, { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => writeHandlers[spec.name](args ?? {}) as any);
  }
  return server;
}

export async function main(): Promise<void> {
  const root = resolveProjectRoot(process.argv, process.env, process.cwd());
  const allowWrite = resolveAllowWrite(process.argv, process.env);
  const server = createServer(root, allowWrite);
  await server.connect(new StdioServerTransport());
}
