# Triforge M3a — Auto-wire the MCP server into AI tools (design)

**Status:** approved (brainstorming)
**Date:** 2026-06-28
**Scope:** new VS Code adapter (MCP provider + a command) + one pure core module. First slice of the
M3 "structural port" milestone (making triforge a standalone replacement for the
`triton-vscode-extension` submodule). Sibling slices, separate specs: M3b (native Explorer tree),
M3c (`config.json` reconciliation).

## Goal

Opening a Triton project folder should make triforge's MCP tools available to AI assistants with
**zero manual setup** — automatically inside VS Code's native MCP client, and via one command for
external desktop clients — all pointed at the opened folder, **read-only by default**. This fulfils
`notes.txt` item 4 ("connect the opened project folder to AI assistance tools").

## Context (verified facts)

The MCP server already ships and is smoke-tested; this slice only *wires it in*. It does not change
the server's tools or safety model.

- **Server entry (`src/mcp/server.ts`):** `resolveProjectRoot(argv, env, cwd)` takes the project
  root from the first non-flag positional argv, else `TRITON_PROJECT`, else cwd.
  `resolveAllowWrite(argv, env)` enables writes only on `--allow-write` /
  `TRITON_ALLOW_WRITE=1|true`. Default `allowWrite=false` (read/analyze/visualize only).
- **Bundled bin (`bin/triforge-mcp.js`):** a checked-in esbuild CommonJS bundle of the server,
  launched as `node bin/triforge-mcp.js <projectRoot> [--allow-write]`. Verified end-to-end over
  real stdio with the official `@modelcontextprotocol/sdk` `Client` in `src/mcp/smoke.test.ts`
  (gate-off refusal, dry-run-then-commit, `.vrt` render).
- **Existing single-project model (`src/vscode/state.ts`):** `ProjectStateController` resolves one
  target folder from `workspace.workspaceFolders`, classifies it
  (`none|needsImport|invalid|ready`), exposes `state`, `targetFolder`, and an `onDidChangeState`
  event, and already drives `setContext('triforge:active', state === 'ready')`.
- **Trust model:** `ConfigStore` gates writes on `vscode.workspace.isTrusted`; this slice reuses the
  same signal for the MCP write opt-in.
- **Architecture invariant:** `src/core/**` is pure (no `vscode`, no `fs`), enforced by per-directory
  `purity.test.ts`; `src/vscode/**` and `src/mcp/**` are the thin adapters. The new core module
  obeys this.
- **VS Code MCP provider API (finalized ~1.101):** `contributes.mcpServerDefinitionProviders`
  (array of `{id, label}`) + `vscode.lm.registerMcpServerDefinitionProvider(id, provider)`. The
  provider implements `provideMcpServerDefinitions()` returning `McpServerDefinition[]` (here a
  `McpStdioServerDefinition` with `command`/`args`/`cwd`) and an optional
  `onDidChangeMcpServerDefinitions` event used to re-point or withdraw the server. This feeds VS
  Code's built-in MCP client (Copilot Chat agent mode) — current `engines.vscode` is `^1.95.0`.
- **External-client config shape:** Cursor (`.cursor/mcp.json`), Claude Code (`.mcp.json`), and
  Claude Desktop (global `claude_desktop_config.json`) all read the same
  `{ "mcpServers": { "<name>": { "command", "args" } } }` object.

## Decisions (from brainstorming)

1. **AI surface:** VS Code native MCP registration **and** external-client configs.
2. **Write gate:** **read-only by default** everywhere; writes are a deliberate, trust-gated opt-in.
3. **External configs:** write **project-local** files where supported (`.cursor/mcp.json`,
   `.mcp.json`); for global-only clients (Claude Desktop) show a **copy-paste snippet + path**, never
   a home-dir write.

## Non-goals (YAGNI)

- No npm publish of `triforge-mcp` (the durable `npx -y triforge-mcp` answer for external configs is
  a future improvement, explicitly out of scope).
- No auto-writing of any global / home-directory config file (Claude Desktop is snippet-only).
- No clients beyond Cursor + Claude Code (project-local) and Claude Desktop (snippet).
- External configs are **command-triggered**, not silent-on-open. (Only the in-VS-Code registration
  is automatic.)
- No change to the MCP server's tools, the write tools' per-call `confirm:true`/dry-run gates, or the
  safety/path-confinement model.
- Not in this slice: M3b (Explorer tree), M3c (`config.json` reconciliation).

## Component 1 — pure invocation/config builder (`src/core/mcp-config.ts`)

Single source of truth for *what the server invocation is*. Pure; no `vscode`/`fs`.

```ts
export interface ServerInvocation { command: string; args: string[]; }

/** node <binPath> <projectRoot> [--allow-write] */
export function buildServerInvocation(opts: {
  binPath: string; projectRoot: string; allowWrite: boolean;
}): ServerInvocation;

/** The { mcpServers: { triforge: {command,args} } } object shared by all external clients. */
export function buildExternalConfig(inv: ServerInvocation): {
  mcpServers: Record<string, ServerInvocation>;
};

/**
 * Merge our entry into an existing config's text, preserving other servers.
 * `existing` undefined/empty/whitespace => fresh config. Malformed JSON => throws a
 * typed error the caller turns into a back-up-or-abort decision. Output is pretty-printed JSON.
 */
export function mergeMcpServers(existing: string | undefined, name: string, inv: ServerInvocation): string;

export const MCP_SERVER_NAME = 'triforge';
/** Project-local target files written by the command. */
export const PROJECT_LOCAL_TARGETS = ['.cursor/mcp.json', '.mcp.json'] as const;
```

The Claude Desktop snippet (config object + per-OS path hint) is also derived here as a pure string
builder so it is unit-testable.

## Component 2 — VS Code MCP provider (`src/vscode/mcp-provider.ts`)

```ts
export class TriforgeMcpProvider implements vscode.McpServerDefinitionProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this._onDidChange.event;
  constructor(private readonly context: vscode.ExtensionContext,
              private readonly controller: ProjectStateController) {
    controller.onDidChangeState(() => this._onDidChange.fire());
    // also fire on triforge.mcp.allowWrite config change (registered in activate())
  }
  provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
    if (this.controller.state !== 'ready' || !this.controller.targetFolder) return [];
    const binPath = vscode.Uri.joinPath(this.context.extensionUri, 'bin', 'triforge-mcp.js').fsPath;
    const inv = buildServerInvocation({
      binPath,
      projectRoot: this.controller.targetFolder.fsPath,
      allowWrite: writesEnabled(), // setting === true && vscode.workspace.isTrusted
    });
    const def = new vscode.McpStdioServerDefinition('Triforge (Triton project)', inv.command, inv.args);
    def.cwd = this.controller.targetFolder;
    return [def];
  }
}
```

- Returns `[]` (server withdrawn) unless a **ready** Triton project is open.
- `binPath` recomputed each call from `context.extensionUri` ⇒ always correct across extension
  updates.
- Registered once in `activate()`:
  `vscode.lm.registerMcpServerDefinitionProvider('triforge.mcp', provider)` (id matches the
  contribution). Provider + the config-change listener are pushed to `context.subscriptions`.

## Component 3 — connect command (`triforge.connectAiTools`, in `src/vscode/commands.ts`)

1. Resolve the target folder (warn if none / not a ready project, mirroring existing commands).
2. For each `PROJECT_LOCAL_TARGETS` file: read existing text if present, `mergeMcpServers(...)`,
   write back via `vscode.workspace.fs`. On malformed existing JSON: back it up (`.bak`, rotated like
   the importer) and write fresh, surfacing what happened.
3. Idempotently append `.cursor/mcp.json` and `.mcp.json` to the project's `.gitignore` (create it if
   absent; skip any entry already present), since the captured bin path is machine-specific.
4. Show the Claude Desktop snippet + the OS-specific config path via an information message (or
   output channel) with a **Copy** action.
5. The confirmation states the current **write state** (read-only vs. write-enabled) so it is never a
   surprise.

## Write gate (read-only default, trust-gated opt-in)

- New setting **`triforge.mcp.allowWrite`** — boolean, default `false`, description notes it requires
  a trusted workspace.
- `writesEnabled() === (config.get('triforge.mcp.allowWrite') === true && vscode.workspace.isTrusted)`.
- When enabled: the provider adds `--allow-write`, and re-running `triforge.connectAiTools`
  regenerates the external configs with the flag.
- Changing the setting fires `onDidChangeMcpServerDefinitions`, so VS Code relaunches the server with
  the new gate state. Even when enabled, the server's per-call `confirm:true`/dry-run gates still
  apply — this setting is only the coarse master switch.

## `package.json` changes

- `engines.vscode`: `^1.95.0` → `^1.101.0` (MCP provider API).
- `contributes.mcpServerDefinitionProviders`: `[{ "id": "triforge.mcp", "label": "Triforge (Triton project)" }]`.
- `contributes.commands`: add `{ "command": "triforge.connectAiTools", "title": "Triforge: Connect AI Tools" }`.
- `contributes.configuration`: add `triforge.mcp.allowWrite` (boolean, default `false`).

## Lifecycle

Provider registered once at activation; VS Code re-queries it on every
`onDidChangeMcpServerDefinitions`. We fire that on `controller.onDidChangeState` and on
`triforge.mcp.allowWrite` change ⇒ opening / switching / closing a Triton folder, or toggling writes,
automatically re-points or withdraws the server.

## External-config durability (known constraint)

The bundled bin lives at a versioned path
(`…/extensions/<id>-<ver>/bin/triforge-mcp.js`) that changes on extension update. The VS Code
provider recomputes it each call (always fresh), but the **external** project-local files capture an
absolute path that goes **stale after an extension update** — the user re-runs
`triforge.connectAiTools` to refresh. The command notes this in its output. Because the captured path
is machine-specific, the command also **idempotently appends** `.cursor/mcp.json` and `.mcp.json` to
the project's `.gitignore` (creating the file if absent; skipping entries already present) when it
writes them. Durable long-term fix (npm publish ⇒ `npx -y triforge-mcp`) is out of scope.

## Error handling

- No folder / not a ready project ⇒ warning, no writes (mirrors existing commands).
- Malformed existing external config ⇒ back up + write fresh, with a clear message (never silently
  discard).
- Provider never throws to VS Code: a missing/odd state returns `[]`.
- Claude Desktop is snippet-only ⇒ no home-directory writes ever.

## Testing

- **Pure unit (`src/core/mcp-config.test.ts`):** `buildServerInvocation` with `allowWrite` on/off;
  `buildExternalConfig` shape; `mergeMcpServers` over empty / existing-with-other-servers /
  existing-with-our-server (replace) / malformed (throws typed error); the Claude Desktop snippet
  string. The existing `src/core/purity.test.ts` auto-covers the new file (fs/vscode-free).
- **Integration (extension host):** provider returns `[]` when no ready project and a correctly
  pointed `McpStdioServerDefinition` (command/args/cwd, `--allow-write` only when opted-in+trusted)
  when ready; `onDidChangeMcpServerDefinitions` fires on state change; `triforge.connectAiTools`
  writes the two project-local files with the expected merged content, preserves a pre-existing
  unrelated server entry, idempotently appends both paths to `.gitignore`, and reports the snippet.
- Full `make verify` (check + lint + unit + integration) green; no existing test regresses.

## Files touched

- Create `src/core/mcp-config.ts`, `src/core/mcp-config.test.ts`.
- Create `src/vscode/mcp-provider.ts` (+ integration coverage in the existing integration suite).
- Modify `src/vscode/commands.ts` (add `triforge.connectAiTools`).
- Modify the extension activation (register provider + config-change listener).
- Modify `package.json` (engines, contributions, command, setting).

## Acceptance criteria

1. Opening a **ready** Triton folder makes the `triforge` MCP server appear automatically in VS
   Code's MCP client, pointed at that folder, with **no** `--allow-write` by default.
2. `triforge.mcp.allowWrite = true` **and** a trusted workspace ⇒ the server is relaunched with
   `--allow-write`; otherwise writes stay off. Changing the setting takes effect without reload.
3. Switching/closing the project re-points/withdraws the server automatically.
4. `triforge.connectAiTools` writes merged `.cursor/mcp.json` + `.mcp.json` (preserving other
   servers), reflects the current write state, and shows the Claude Desktop snippet + path; it never
   writes outside the project.
5. `src/core/mcp-config.ts` is pure (purity test passes); full `make verify` green.
6. `engines.vscode` is `^1.101.0` and the provider id matches the contribution.
