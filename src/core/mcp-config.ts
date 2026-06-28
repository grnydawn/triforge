/** Pure builders for the triforge MCP server invocation and external-client config text.
 *  No `vscode`, no `fs` — see src/core/purity.test.ts. */

export interface ServerInvocation {
  command: string;
  args: string[];
}

/** Logical name for the server in every config (`mcpServers.triforge`). */
export const MCP_SERVER_NAME = 'triforge';

/** Project-local config files the connect command writes (relative to the project root). */
export const PROJECT_LOCAL_TARGETS = ['.cursor/mcp.json', '.mcp.json'] as const;

/** Thrown when an existing external config cannot be merged (not valid JSON / not an object). */
export class MalformedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedConfigError';
  }
}

/** `<nodeCommand> <binPath> <projectRoot> [--allow-write]`. The server reads the project root
 *  from the first positional argv and the write gate from `--allow-write`. */
export function buildServerInvocation(opts: {
  nodeCommand: string;
  binPath: string;
  projectRoot: string;
  allowWrite: boolean;
}): ServerInvocation {
  const args = [opts.binPath, opts.projectRoot];
  if (opts.allowWrite) args.push('--allow-write');
  return { command: opts.nodeCommand, args };
}

/** The `{ mcpServers: { triforge: {...} } }` object shared by all external clients. */
export function buildExternalConfig(inv: ServerInvocation): { mcpServers: Record<string, ServerInvocation> } {
  return { mcpServers: { [MCP_SERVER_NAME]: { command: inv.command, args: [...inv.args] } } };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Merge our entry into an existing config's text, preserving other servers and top-level keys.
 *  `existing` undefined/blank => fresh config. Malformed JSON / non-object => MalformedConfigError.
 *  Output is pretty-printed JSON with a trailing newline. */
export function mergeMcpServers(existing: string | undefined, inv: ServerInvocation): string {
  let root: Record<string, unknown> = {};
  const trimmed = (existing ?? '').trim();
  if (trimmed) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new MalformedConfigError('existing MCP config is not valid JSON');
    }
    if (!isPlainObject(parsed)) {
      throw new MalformedConfigError('existing MCP config is not a JSON object');
    }
    root = parsed;
  }
  const servers = isPlainObject(root.mcpServers) ? root.mcpServers : {};
  servers[MCP_SERVER_NAME] = { command: inv.command, args: [...inv.args] };
  root.mcpServers = servers;
  return JSON.stringify(root, null, 2) + '\n';
}

/** The copy-paste JSON for Claude Desktop (pretty-printed external config). */
export function buildClaudeDesktopSnippet(inv: ServerInvocation): string {
  return JSON.stringify(buildExternalConfig(inv), null, 2);
}

/** Human-readable Claude Desktop config path hint for the given platform. */
export function claudeDesktopConfigPath(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return '~/Library/Application Support/Claude/claude_desktop_config.json';
  if (platform === 'win32') return '%APPDATA%\\Claude\\claude_desktop_config.json';
  return '~/.config/Claude/claude_desktop_config.json';
}

/** Append any missing `entries` to a `.gitignore` body. Returns the new body, or null if every
 *  entry is already present (idempotent — caller skips the write when null). */
export function appendGitignoreEntries(existing: string | undefined, entries: readonly string[]): string | null {
  const present = new Set((existing ?? '').split(/\r?\n/).map((l) => l.trim()));
  const toAdd = entries.filter((e) => !present.has(e));
  if (!toAdd.length) return null;
  let base = existing ?? '';
  if (base && !base.endsWith('\n')) base += '\n';
  return base + toAdd.join('\n') + '\n';
}
