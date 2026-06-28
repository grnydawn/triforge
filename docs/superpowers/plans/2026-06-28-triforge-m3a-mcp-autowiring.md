# Triforge M3a — MCP Auto-wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a Triton project folder auto-exposes triforge's MCP tools to AI assistants — automatically in VS Code's native MCP client and via one command for external desktop clients — pointed at the opened folder, read-only by default.

**Architecture:** A new **pure** core module (`src/core/mcp-config.ts`) is the single source of truth for the server invocation and external-config text (fully unit-tested, vscode/fs-free). Two thin VS Code adapters consume it: a `McpServerDefinitionProvider` (`src/vscode/mcp-provider.ts`) registered via `vscode.lm.registerMcpServerDefinitionProvider`, and a project-file writer (`src/vscode/connect-ai-tools.ts`) driven by a new `triforge.connectAiTools` command. The write gate stays off unless `triforge.mcp.allowWrite` is set **and** the workspace is trusted.

**Tech Stack:** TypeScript, VS Code extension API (MCP provider API, finalized 1.101), vitest (unit), `@vscode/test-electron` (integration). No new runtime deps; `@types/vscode@1.125.0` is already installed (declares the MCP API), so **no `npm install` is required**.

---

## Reference facts (verified against current code)

- **Server invocation:** `node <binPath> <projectRoot> [--allow-write]`. `src/mcp/server.ts` `resolveProjectRoot` reads the first non-flag positional argv first; `resolveAllowWrite` enables writes on `--allow-write`. The bundled bin is `bin/triforge-mcp.js`.
- **Bin path in the extension:** `vscode.Uri.joinPath(context.extensionUri, 'bin', 'triforge-mcp.js').fsPath`.
- **VS Code MCP API (in `@types/vscode@1.125.0`):**
  - `vscode.lm.registerMcpServerDefinitionProvider(id: string, provider: McpServerDefinitionProvider): Disposable`
  - `interface McpServerDefinitionProvider { onDidChangeMcpServerDefinitions?: Event<void>; provideMcpServerDefinitions(token: CancellationToken): ProviderResult<McpServerDefinition[]>; }`
  - `class McpStdioServerDefinition` — `constructor(label, command, args?, env?, version?)`; `label` readonly; `command`, `args`, `env` settable; `cwd?: Uri` settable. The doc note explicitly suggests Node servers use `process.execPath` (the editor's Node) for `command`.
- **Controller surface (`src/vscode/state.ts`):** `ProjectStateController` exposes `state: ProjectStateKind`, `targetFolder: vscode.Uri | undefined`, `onDidChangeState: Event<ProjectStateKind>` — it already satisfies the `McpProjectSource` interface this plan introduces.
- **Established injectable-deps pattern:** `ConfigStore(canWrite = () => vscode.workspace.isTrusted)`, `wireAutoRegeneration(..., deps)` — mirror it so adapters are testable without the live workspace.
- **Purity tests are per-subdir** (`triton-files/`, `triton-kb/`, `triton-viz/`); **root `src/core/*.ts` has none.** Root core is currently vscode-free and fs-free (verified) — adding `src/core/purity.test.ts` is safe and closes the gap.
- **`manifest-contract.test.ts` asserts `String(pkg.engines.vscode).includes('1.95')`** — must change to `1.101` when engines is bumped.
- **Test commands:** unit `npx vitest run <path>`; typecheck `npm run check`; integration compile `npm run compile:tests` (fast RED via tsc), full run `npm run test:integration`.

## File structure (what each unit owns)

- **Create `src/core/mcp-config.ts`** — pure builders/parsers: `buildServerInvocation`, `buildExternalConfig`, `mergeMcpServers`, `buildClaudeDesktopSnippet`, `claudeDesktopConfigPath`, `appendGitignoreEntries`, `MalformedConfigError`, constants. No `vscode`/`fs`.
- **Create `src/core/mcp-config.test.ts`** — vitest unit tests for the above.
- **Create `src/core/purity.test.ts`** — asserts no top-level `src/core/*.ts` imports `vscode`.
- **Create `src/vscode/mcp-provider.ts`** — `McpProjectSource` interface, `mcpWritesEnabled()`, `TriforgeMcpProvider`.
- **Create `src/test/integration/mcp-provider.test.ts`** — provider behavior via a stub source.
- **Create `src/vscode/connect-ai-tools.ts`** — `writeAiToolConfigs(folder, inv)` (project-local writes + `.gitignore`).
- **Create `src/test/integration/connect-ai-tools.test.ts`** — file-writing behavior against a temp folder.
- **Modify `src/vscode/commands.ts`** — register `triforge.connectAiTools`.
- **Modify `src/extension.ts`** — construct + register the provider; refresh on `triforge.mcp.allowWrite` change.
- **Modify `package.json`** — `engines`/`@types/vscode` → `^1.101.0`; add `mcpServerDefinitionProviders`, the command, the `triforge.mcp.allowWrite` setting.
- **Modify `src/test/integration/manifest-contract.test.ts`** + **`commands.test.ts`** — assert the new contributions/command.

---

## Task 1: Pure core module `src/core/mcp-config.ts`

**Files:**
- Create: `src/core/mcp-config.ts`
- Test: `src/core/mcp-config.test.ts`, `src/core/purity.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/core/mcp-config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/core/mcp-config.test.ts`
Expected: FAIL — cannot resolve module `./mcp-config` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/core/mcp-config.ts`:

```ts
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
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run src/core/mcp-config.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Write the root purity test**

Create `src/core/purity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('src/core root purity', () => {
  it('no module directly under src/core imports vscode', () => {
    const dir = join(process.cwd(), 'src/core');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/from ['"]vscode['"]/.test(src), `${f} imports vscode`).toBe(false);
    }
  });
});
```

- [ ] **Step 6: Run the purity test to verify it passes**

Run: `npx vitest run src/core/purity.test.ts`
Expected: PASS (root core, including the new `mcp-config.ts`, is vscode-free).

- [ ] **Step 7: Commit**

```bash
git add src/core/mcp-config.ts src/core/mcp-config.test.ts src/core/purity.test.ts
git commit -m "$(cat <<'EOF'
feat(m3a): pure MCP invocation/config builders + root core purity test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 2: VS Code MCP provider `src/vscode/mcp-provider.ts`

**Files:**
- Create: `src/vscode/mcp-provider.ts`
- Test: `src/test/integration/mcp-provider.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/test/integration/mcp-provider.test.ts`:

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ProjectStateKind } from '../../core/types';
import { TriforgeMcpProvider, McpProjectSource } from '../../vscode/mcp-provider';

class StubSource implements McpProjectSource {
  private readonly emitter = new vscode.EventEmitter<ProjectStateKind>();
  readonly onDidChangeState = this.emitter.event;
  state: ProjectStateKind = 'none';
  targetFolder: vscode.Uri | undefined;
  set(state: ProjectStateKind, folder: vscode.Uri | undefined): void {
    this.state = state; this.targetFolder = folder; this.emitter.fire(state);
  }
}

const EXT = vscode.Uri.file('/ext');
const FOLDER = vscode.Uri.file('/proj');

describe('TriforgeMcpProvider', () => {
  it('offers no server when there is no ready project', () => {
    const src = new StubSource();
    const p = new TriforgeMcpProvider(EXT, src, () => false);
    assert.deepStrictEqual(p.provideMcpServerDefinitions({} as any), []);
    src.set('needsImport', FOLDER); // not "ready"
    assert.deepStrictEqual(p.provideMcpServerDefinitions({} as any), []);
    p.dispose();
  });

  it('offers a stdio server pointed at the folder (read-only) when ready', () => {
    const src = new StubSource();
    src.state = 'ready'; src.targetFolder = FOLDER;
    const p = new TriforgeMcpProvider(EXT, src, () => false);
    const defs = p.provideMcpServerDefinitions({} as any) as any[];
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].command, process.execPath);
    assert.ok(defs[0].args[0].endsWith('bin/triforge-mcp.js') || defs[0].args[0].endsWith('bin\\triforge-mcp.js'));
    assert.strictEqual(defs[0].args[1], FOLDER.fsPath);
    assert.ok(!defs[0].args.includes('--allow-write'));
    p.dispose();
  });

  it('adds --allow-write when writes are enabled', () => {
    const src = new StubSource();
    src.state = 'ready'; src.targetFolder = FOLDER;
    const p = new TriforgeMcpProvider(EXT, src, () => true);
    const defs = p.provideMcpServerDefinitions({} as any) as any[];
    assert.ok(defs[0].args.includes('--allow-write'));
    p.dispose();
  });

  it('fires onDidChangeMcpServerDefinitions when the project state changes', () => {
    const src = new StubSource();
    const p = new TriforgeMcpProvider(EXT, src, () => false);
    let fired = 0;
    const sub = p.onDidChangeMcpServerDefinitions(() => { fired++; });
    src.set('ready', FOLDER);
    assert.strictEqual(fired, 1);
    sub.dispose(); p.dispose();
  });
});
```

- [ ] **Step 2: Verify it fails (fast compile RED)**

Run: `npm run compile:tests`
Expected: FAIL — `Cannot find module '../../vscode/mcp-provider'` (file does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/vscode/mcp-provider.ts`:

```ts
import * as vscode from 'vscode';
import { ProjectStateKind } from '../core/types';
import { buildServerInvocation } from '../core/mcp-config';

/** Minimal project surface the provider needs — ProjectStateController satisfies it. */
export interface McpProjectSource {
  readonly state: ProjectStateKind;
  readonly targetFolder: vscode.Uri | undefined;
  readonly onDidChangeState: vscode.Event<ProjectStateKind>;
}

/** Writes are enabled only when the opt-in setting is on AND the workspace is trusted. */
export function mcpWritesEnabled(): boolean {
  return vscode.workspace.getConfiguration('triforge').get<boolean>('mcp.allowWrite') === true
    && vscode.workspace.isTrusted;
}

export class TriforgeMcpProvider implements vscode.McpServerDefinitionProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this._onDidChange.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly source: McpProjectSource,
    private readonly writesEnabled: () => boolean = mcpWritesEnabled,
  ) {
    this.disposables.push(this.source.onDidChangeState(() => this._onDidChange.fire()));
  }

  /** Re-emit so VS Code re-queries (used when the allowWrite setting changes). */
  refresh(): void { this._onDidChange.fire(); }

  provideMcpServerDefinitions(_token: vscode.CancellationToken): vscode.McpServerDefinition[] {
    if (this.source.state !== 'ready' || !this.source.targetFolder) return [];
    const binPath = vscode.Uri.joinPath(this.extensionUri, 'bin', 'triforge-mcp.js').fsPath;
    const inv = buildServerInvocation({
      nodeCommand: process.execPath, // editor's Node, per the MCP API doc note
      binPath,
      projectRoot: this.source.targetFolder.fsPath,
      allowWrite: this.writesEnabled(),
    });
    const def = new vscode.McpStdioServerDefinition('Triforge (Triton project)', inv.command, inv.args);
    def.cwd = this.source.targetFolder;
    return [def];
  }

  dispose(): void {
    this._onDidChange.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
```

- [ ] **Step 4: Verify the suite passes**

Run: `npm run compile:tests && npm run test:integration`
Expected: PASS — the four `TriforgeMcpProvider` tests pass; no existing integration test regresses.

- [ ] **Step 5: Commit**

```bash
git add src/vscode/mcp-provider.ts src/test/integration/mcp-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(m3a): TriforgeMcpProvider exposing the project-pointed MCP server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 3: `package.json` contributions + contract test

**Files:**
- Modify: `package.json`
- Test: `src/test/integration/manifest-contract.test.ts`

- [ ] **Step 1: Update the failing contract test**

In `src/test/integration/manifest-contract.test.ts`, change the engine assertion and add the new-contribution assertions. Replace:

```ts
    assert.ok(String(pkg.engines.vscode).includes('1.95'));
```

with:

```ts
    assert.ok(String(pkg.engines.vscode).includes('1.101'));
```

and add, immediately before the closing `});` of the `it(...)` block:

```ts
    // M3a — MCP auto-wiring contributions.
    const mcpProviders = pkg.contributes.mcpServerDefinitionProviders;
    assert.ok(Array.isArray(mcpProviders) && mcpProviders.some((p: any) => p.id === 'triforge.mcp'),
      'mcpServerDefinitionProviders must include triforge.mcp');
    const cmds = pkg.contributes.commands.map((c: any) => c.command);
    assert.ok(cmds.includes('triforge.connectAiTools'), 'triforge.connectAiTools must be declared');
    const allowWrite = pkg.contributes.configuration.properties['triforge.mcp.allowWrite'];
    assert.ok(allowWrite && allowWrite.type === 'boolean' && allowWrite.default === false,
      'triforge.mcp.allowWrite must be a boolean defaulting to false');
```

- [ ] **Step 2: Verify it fails**

Run: `npm run compile:tests && npm run test:integration`
Expected: FAIL — the contract test fails (engines still `^1.95.0`; no `mcpServerDefinitionProviders`, command, or setting).

- [ ] **Step 3: Update `package.json`**

(a) Bump the engine in `package.json`:

```json
  "engines": {
    "vscode": "^1.101.0"
  },
```

(b) Bump `@types/vscode` in `devDependencies` (documentation only — `1.125.0` is already installed; do **not** run `npm install`):

```json
    "@types/vscode": "^1.101.0",
```

(c) Add a new top-level key inside `"contributes"` (e.g. right after the `"views"` block):

```json
    "mcpServerDefinitionProviders": [
      {
        "id": "triforge.mcp",
        "label": "Triforge (Triton project)"
      }
    ],
```

(d) Add the command to the `"contributes.commands"` array (after `triforge.openKnowledgeBase`):

```json
      {
        "command": "triforge.connectAiTools",
        "title": "Connect AI Tools",
        "category": "Triforge"
      }
```

(e) Add the setting to `"contributes.configuration.properties"` (after `triforge.ai.autoRegenerate`):

```json
        "triforge.mcp.allowWrite": {
          "type": "boolean",
          "default": false,
          "markdownDescription": "Allow the auto-wired Triton MCP server to use the file-**writing** tools. Off by default (read/analyze/visualize only). Takes effect only in a trusted workspace; even when enabled, write tools still require per-call `confirm: true`."
        }
```

- [ ] **Step 4: Verify it passes**

Run: `npm run check && npm run compile:tests && npm run test:integration`
Expected: PASS — `npm run check` (typecheck) is clean; the contract test passes.

- [ ] **Step 5: Commit**

```bash
git add package.json src/test/integration/manifest-contract.test.ts
git commit -m "$(cat <<'EOF'
feat(m3a): declare MCP provider, connect command, and write-gate setting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 4: Register the provider in activation

**Files:**
- Modify: `src/extension.ts`
- Test: `src/test/integration/activation.test.ts`

- [ ] **Step 1: Add the failing activation assertion**

In `src/test/integration/activation.test.ts`, add this test inside the `describe('activation', ...)` block:

```ts
  it('exposes the MCP provider API at the bumped engine and activates with it wired (M3a)', async () => {
    assert.strictEqual(typeof vscode.lm.registerMcpServerDefinitionProvider, 'function');
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    const api = (await ext!.activate()) as TriforgeApi; // must not throw with the provider wired
    assert.ok(api);
  });
```

- [ ] **Step 2: Verify the current state**

Run: `npm run compile:tests && npm run test:integration`
Expected: PASS already for the assertion's API check, but this step exists to confirm the baseline; proceed to wire the provider so activation genuinely exercises it. (If `vscode.lm.registerMcpServerDefinitionProvider` were missing the test would fail — it guards the engine bump.)

- [ ] **Step 3: Wire the provider into `activate()`**

In `src/extension.ts`, add the import near the other `./vscode/*` imports:

```ts
import { TriforgeMcpProvider } from './vscode/mcp-provider';
```

Then, inside `activate()`, after `context.subscriptions.push(controller, store);` and before `await controller.start();`, add:

```ts
  const mcpProvider = new TriforgeMcpProvider(context.extensionUri, controller);
  context.subscriptions.push(
    mcpProvider,
    vscode.lm.registerMcpServerDefinitionProvider('triforge.mcp', mcpProvider),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('triforge.mcp.allowWrite')) mcpProvider.refresh();
    }),
  );
```

- [ ] **Step 4: Verify it passes**

Run: `npm run check && npm run compile:tests && npm run test:integration`
Expected: PASS — extension activates with the provider registered; all integration tests green.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/test/integration/activation.test.ts
git commit -m "$(cat <<'EOF'
feat(m3a): register the MCP provider on activation, refresh on setting change

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 5: `triforge.connectAiTools` command + project-config writer

**Files:**
- Create: `src/vscode/connect-ai-tools.ts`
- Modify: `src/vscode/commands.ts`
- Test: `src/test/integration/connect-ai-tools.test.ts`, `src/test/integration/commands.test.ts`

- [ ] **Step 1: Write the failing integration test for the writer**

Create `src/test/integration/connect-ai-tools.test.ts`:

```ts
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { writeAiToolConfigs } from '../../vscode/connect-ai-tools';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-connect-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function readText(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

const INV = { command: 'node', args: ['/ext/bin/triforge-mcp.js', '/proj'] };

describe('writeAiToolConfigs', () => {
  it('writes both project-local configs and gitignores them', async () => {
    const folder = await tmpFolder();
    const res = await writeAiToolConfigs(folder, INV);
    assert.deepStrictEqual(res.written, ['.cursor/mcp.json', '.mcp.json']);
    assert.strictEqual(res.gitignoreUpdated, true);
    const cursor = JSON.parse(await readText(vscode.Uri.joinPath(folder, '.cursor/mcp.json')));
    assert.deepStrictEqual(cursor.mcpServers.triforge, { command: 'node', args: ['/ext/bin/triforge-mcp.js', '/proj'] });
    const mcp = JSON.parse(await readText(vscode.Uri.joinPath(folder, '.mcp.json')));
    assert.deepStrictEqual(mcp.mcpServers.triforge, cursor.mcpServers.triforge);
    const gi = await readText(vscode.Uri.joinPath(folder, '.gitignore'));
    assert.ok(gi.includes('.cursor/mcp.json') && gi.includes('.mcp.json'));
  });

  it('preserves a pre-existing unrelated server and is gitignore-idempotent', async () => {
    const folder = await tmpFolder();
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, '.mcp.json'),
      Buffer.from(JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }), 'utf8'));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, '.gitignore'),
      Buffer.from('.cursor/mcp.json\n.mcp.json\n', 'utf8'));
    const res = await writeAiToolConfigs(folder, INV);
    const mcp = JSON.parse(await readText(vscode.Uri.joinPath(folder, '.mcp.json')));
    assert.deepStrictEqual(mcp.mcpServers.other, { command: 'x', args: [] });
    assert.ok(mcp.mcpServers.triforge);
    assert.strictEqual(res.gitignoreUpdated, false); // already present
    const gi = await readText(vscode.Uri.joinPath(folder, '.gitignore'));
    assert.strictEqual(gi.match(/\.mcp\.json/g)!.length, 1); // no duplicate
  });

  it('backs up a malformed existing config and writes fresh', async () => {
    const folder = await tmpFolder();
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, '.mcp.json'),
      Buffer.from('{ not valid json', 'utf8'));
    const res = await writeAiToolConfigs(folder, INV);
    assert.strictEqual(res.backedUp.length, 1);
    assert.ok(await exists(vscode.Uri.joinPath(folder, '.mcp.json.bak')));
    const mcp = JSON.parse(await readText(vscode.Uri.joinPath(folder, '.mcp.json')));
    assert.ok(mcp.mcpServers.triforge);
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `npm run compile:tests`
Expected: FAIL — `Cannot find module '../../vscode/connect-ai-tools'`.

- [ ] **Step 3: Write the writer**

Create `src/vscode/connect-ai-tools.ts`:

```ts
import * as vscode from 'vscode';
import {
  ServerInvocation,
  PROJECT_LOCAL_TARGETS,
  mergeMcpServers,
  appendGitignoreEntries,
  MalformedConfigError,
} from '../core/mcp-config';

export interface ConnectResult {
  written: string[];
  backedUp: string[];
  gitignoreUpdated: boolean;
}

async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); } catch { return undefined; }
}
async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
/** Copy `uri` to a rotated `.bak` sibling and return the backup uri. */
async function backupRotate(uri: vscode.Uri): Promise<vscode.Uri> {
  let bak = uri.with({ path: `${uri.path}.bak` });
  let n = 1;
  while (await uriExists(bak)) bak = uri.with({ path: `${uri.path}.bak.${n++}` });
  await vscode.workspace.fs.copy(uri, bak, { overwrite: false });
  return bak;
}

/** Write the project-local MCP configs (merging into any existing ones) and gitignore them. */
export async function writeAiToolConfigs(folder: vscode.Uri, inv: ServerInvocation): Promise<ConnectResult> {
  const written: string[] = [];
  const backedUp: string[] = [];

  for (const rel of PROJECT_LOCAL_TARGETS) {
    const uri = vscode.Uri.joinPath(folder, rel);
    const existing = await readTextIfExists(uri);
    let merged: string;
    try {
      merged = mergeMcpServers(existing, inv);
    } catch (e) {
      if (e instanceof MalformedConfigError && existing !== undefined) {
        backedUp.push((await backupRotate(uri)).fsPath);
        merged = mergeMcpServers(undefined, inv);
      } else {
        throw e;
      }
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..')); // e.g. .cursor/
    await vscode.workspace.fs.writeFile(uri, Buffer.from(merged, 'utf8'));
    written.push(rel);
  }

  const giUri = vscode.Uri.joinPath(folder, '.gitignore');
  const newGi = appendGitignoreEntries(await readTextIfExists(giUri), PROJECT_LOCAL_TARGETS);
  let gitignoreUpdated = false;
  if (newGi !== null) {
    await vscode.workspace.fs.writeFile(giUri, Buffer.from(newGi, 'utf8'));
    gitignoreUpdated = true;
  }

  return { written, backedUp, gitignoreUpdated };
}
```

- [ ] **Step 4: Verify the writer passes**

Run: `npm run compile:tests && npm run test:integration`
Expected: PASS — the three `writeAiToolConfigs` tests pass.

- [ ] **Step 5: Register the command (extend the command-registration test first)**

In `src/test/integration/commands.test.ts`, extend the registered-commands assertion to include the new command. Change the test title and id list in the first `it(...)`:

```ts
  it('registers all six triforge commands (E2E-TDN-03)', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    await ext?.activate();
    const all = await vscode.commands.getCommands(true);
    for (const id of ['triforge.openProjectFolder', 'triforge.createProject', 'triforge.importLegacyProject', 'triforge.openConfig', 'triforge.revealInExplorer', 'triforge.connectAiTools']) {
      assert.ok(all.includes(id), `${id} should be registered`);
    }
  });
```

- [ ] **Step 6: Verify it fails**

Run: `npm run compile:tests && npm run test:integration`
Expected: FAIL — `triforge.connectAiTools should be registered` (command not yet registered).

- [ ] **Step 7: Implement the command**

In `src/vscode/commands.ts`, add these imports at the top (after the existing imports):

```ts
import { buildServerInvocation, buildClaudeDesktopSnippet, claudeDesktopConfigPath } from '../core/mcp-config';
import { mcpWritesEnabled } from './mcp-provider';
import { writeAiToolConfigs } from './connect-ai-tools';
```

Then add this registration inside `registerCommands(...)`, after the `triforge.revealInExplorer` block:

```ts
  reg('triforge.connectAiTools', async () => {
    const folder = controller.targetFolder;
    if (!folder || controller.state !== 'ready') {
      vscode.window.showWarningMessage('Triforge: open a Triforge project first, then connect AI tools.');
      return;
    }
    if (!vscode.workspace.isTrusted) {
      vscode.window.showInformationMessage('Triforge: workspace is untrusted — grant trust to write AI tool configs.');
      return;
    }
    const binPath = vscode.Uri.joinPath(context.extensionUri, 'bin', 'triforge-mcp.js').fsPath;
    const writeOn = mcpWritesEnabled();
    const inv = buildServerInvocation({ nodeCommand: 'node', binPath, projectRoot: folder.fsPath, allowWrite: writeOn });
    const res = await writeAiToolConfigs(folder, inv);
    const state = writeOn ? 'write-enabled' : 'read-only';
    const bak = res.backedUp.length ? ` (backed up ${res.backedUp.length} malformed file(s))` : '';
    const choice = await vscode.window.showInformationMessage(
      `Triforge: connected AI tools — wrote ${res.written.join(', ')} (${state})${bak}. ` +
      `For Claude Desktop, add the server to ${claudeDesktopConfigPath(process.platform)}. ` +
      `Re-run this after a Triforge update to refresh the bin path.`,
      'Copy Claude Desktop Snippet',
    );
    if (choice === 'Copy Claude Desktop Snippet') {
      await vscode.env.clipboard.writeText(buildClaudeDesktopSnippet(inv));
    }
  });
```

- [ ] **Step 8: Verify it passes**

Run: `npm run check && npm run compile:tests && npm run test:integration`
Expected: PASS — the command is registered; all integration tests green; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/vscode/connect-ai-tools.ts src/vscode/commands.ts src/test/integration/connect-ai-tools.test.ts src/test/integration/commands.test.ts
git commit -m "$(cat <<'EOF'
feat(m3a): triforge.connectAiTools writes project-local MCP configs + snippet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `make verify`
Expected: PASS — `npm run check` (typecheck of `tsconfig.json` + `tsconfig.mcp.json`), `npm run lint`, `npx vitest run` (unit, incl. the new `mcp-config` + root purity tests), and the VS Code extension-host integration suite all green; zero regressions.

- [ ] **Step 2: Confirm no stray working-tree changes**

Run: `git status -sb`
Expected: only the pre-existing untracked `media/triforge.png` and `notes.txt`; everything else committed.

---

## Acceptance criteria (maps to the spec)

1. A **ready** Triton folder auto-exposes the `triforge` MCP server in VS Code, pointed at the folder, **read-only** by default — Tasks 2 + 4 (`provideMcpServerDefinitions`, `process.execPath`, no `--allow-write`).
2. `triforge.mcp.allowWrite = true` + trusted ⇒ `--allow-write` added; setting change re-points without reload — Tasks 2 (`mcpWritesEnabled`, `refresh`) + 4 (config listener).
3. Switching/closing the project re-points/withdraws the server — Task 2 (`onDidChangeState` → `onDidChangeMcpServerDefinitions`; `[]` when not ready).
4. `triforge.connectAiTools` writes merged `.cursor/mcp.json` + `.mcp.json` (preserving other servers), gitignores them, reports write state, offers the Claude Desktop snippet, never writes outside the project — Task 5.
5. `src/core/mcp-config.ts` is pure; full `make verify` green — Tasks 1 + 6.
6. `engines.vscode` is `^1.101.0`; provider id matches the contribution — Task 3.
