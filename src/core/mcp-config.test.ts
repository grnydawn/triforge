import { describe, it, expect } from 'vitest';
import {
  buildServerInvocation,
  buildExternalConfig,
  mergeMcpServers,
  buildClaudeDesktopSnippet,
  claudeDesktopConfigPath,
  appendGitignoreEntries,
  MalformedConfigError,
  MCP_SERVER_NAME,
  PROJECT_LOCAL_TARGETS,
} from './mcp-config';

describe('buildServerInvocation', () => {
  it('builds node <bin> <root> with no flag when read-only', () => {
    const inv = buildServerInvocation({ nodeCommand: 'node', binPath: '/x/bin/triforge-mcp.js', projectRoot: '/p', allowWrite: false });
    expect(inv).toEqual({ command: 'node', args: ['/x/bin/triforge-mcp.js', '/p'] });
  });
  it('appends --allow-write only when allowWrite is true', () => {
    const inv = buildServerInvocation({ nodeCommand: '/usr/bin/node', binPath: '/b.js', projectRoot: '/p', allowWrite: true });
    expect(inv.command).toBe('/usr/bin/node');
    expect(inv.args).toEqual(['/b.js', '/p', '--allow-write']);
  });
});

describe('buildExternalConfig', () => {
  it('wraps the invocation under mcpServers.<name> with a copied args array', () => {
    const inv = { command: 'node', args: ['/b.js', '/p'] };
    const cfg = buildExternalConfig(inv);
    expect(cfg).toEqual({ mcpServers: { [MCP_SERVER_NAME]: { command: 'node', args: ['/b.js', '/p'] } } });
    cfg.mcpServers[MCP_SERVER_NAME].args.push('mutated');
    expect(inv.args).toEqual(['/b.js', '/p']); // original not mutated
  });
});

describe('mergeMcpServers', () => {
  const inv = { command: 'node', args: ['/b.js', '/p'] };
  it('creates a fresh config from undefined/empty input', () => {
    const out = JSON.parse(mergeMcpServers(undefined, inv));
    expect(out).toEqual({ mcpServers: { triforge: { command: 'node', args: ['/b.js', '/p'] } } });
    expect(JSON.parse(mergeMcpServers('   ', inv))).toEqual(out);
  });
  it('preserves other servers and other top-level keys', () => {
    const existing = JSON.stringify({ otherKey: 1, mcpServers: { foo: { command: 'foo', args: [] } } });
    const out = JSON.parse(mergeMcpServers(existing, inv));
    expect(out.otherKey).toBe(1);
    expect(out.mcpServers.foo).toEqual({ command: 'foo', args: [] });
    expect(out.mcpServers.triforge).toEqual({ command: 'node', args: ['/b.js', '/p'] });
  });
  it('replaces a stale triforge entry', () => {
    const existing = JSON.stringify({ mcpServers: { triforge: { command: 'old', args: ['x'] } } });
    expect(JSON.parse(mergeMcpServers(existing, inv)).mcpServers.triforge).toEqual({ command: 'node', args: ['/b.js', '/p'] });
  });
  it('ends with a trailing newline', () => {
    expect(mergeMcpServers(undefined, inv).endsWith('\n')).toBe(true);
  });
  it('throws MalformedConfigError on non-JSON or non-object input', () => {
    expect(() => mergeMcpServers('{not json', inv)).toThrow(MalformedConfigError);
    expect(() => mergeMcpServers('[1,2,3]', inv)).toThrow(MalformedConfigError);
  });
});

describe('buildClaudeDesktopSnippet', () => {
  it('is the pretty-printed external config', () => {
    const snip = buildClaudeDesktopSnippet({ command: 'node', args: ['/b.js', '/p'] });
    expect(JSON.parse(snip)).toEqual({ mcpServers: { triforge: { command: 'node', args: ['/b.js', '/p'] } } });
    expect(snip).toContain('\n'); // pretty-printed
  });
});

describe('claudeDesktopConfigPath', () => {
  it('returns the per-OS path hint', () => {
    expect(claudeDesktopConfigPath('darwin')).toBe('~/Library/Application Support/Claude/claude_desktop_config.json');
    expect(claudeDesktopConfigPath('win32')).toBe('%APPDATA%\\Claude\\claude_desktop_config.json');
    expect(claudeDesktopConfigPath('linux')).toBe('~/.config/Claude/claude_desktop_config.json');
  });
});

describe('appendGitignoreEntries', () => {
  it('creates content from nothing', () => {
    expect(appendGitignoreEntries(undefined, PROJECT_LOCAL_TARGETS)).toBe('.cursor/mcp.json\n.mcp.json\n');
  });
  it('appends only missing entries and is idempotent', () => {
    const first = appendGitignoreEntries('node_modules\n', PROJECT_LOCAL_TARGETS)!;
    expect(first).toBe('node_modules\n.cursor/mcp.json\n.mcp.json\n');
    expect(appendGitignoreEntries(first, PROJECT_LOCAL_TARGETS)).toBeNull(); // nothing to add
  });
  it('handles a file with no trailing newline', () => {
    expect(appendGitignoreEntries('dist', ['.mcp.json'])).toBe('dist\n.mcp.json\n');
  });
});
