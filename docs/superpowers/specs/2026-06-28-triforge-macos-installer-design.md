# Triforge — macOS local-install script (design)

**Status:** approved (brainstorming)
**Date:** 2026-06-28
**Scope:** developer tooling — a robust, novice-friendly Bash script that builds, packages, and
installs the Triforge extension into VS Code on macOS, plus two small repo fixes required to produce
a *working* package. Not part of the M3 milestone; a standalone testing aid.

## Goal

Let a novice user, on macOS, run **one command** that turns the current source tree into an installed,
working Triforge VS Code extension — checking the environment, surfacing actionable guidance for every
likely failure, and leaving the user ready to open a Triton project and test M3a/M3b/M3c.

## Context (verified facts)

- Build: `npm run build` = `node esbuild.js && node esbuild.mcp.js` → produces `dist/extension.js`
  (extension `main`, fully bundled) and `bin/triforge-mcp.js` (the MCP server, bundled). Both are
  self-contained esbuild output, so the `.vsix` needs **no** `node_modules`.
- `engines.vscode` is `^1.101.0`; `publisher` is `grnydawn`; `name` `triforge`; `version` `0.1.0`;
  extension id therefore `grnydawn.triforge`.
- `@vscode/vsce` is **not** a dependency → package via `npx --yes @vscode/vsce` (fetched on demand).
- The repo already has `.vscodeignore`, `LICENSE`, `README.md`, and a `scripts/` dir.

### Two packaging blockers found (both must be fixed for a working `.vsix`)

1. **`.vscodeignore` excludes `bin/**`** — but `bin/triforge-mcp.js` is the MCP server the M3a
   provider launches at runtime (`node <extensionUri>/bin/triforge-mcp.js`). Packaging as-is ships a
   broken AI-tools feature. **Fix:** remove the `bin/**` line so `bin/triforge-mcp.js` ships.
   (`esbuild.mcp.js` and `tsconfig.mcp.json` stay excluded — build-time only.)
2. **`vsce package` rejects SVG icons** (Marketplace requires raster), but `package.json` has
   `"icon": "media/triforge.svg"`. **Fix:** point `icon` at the existing (currently untracked)
   `media/triforge.png` and commit that PNG. (After M3b removed the activity-bar container, the
   top-level `icon` is the only reference to the SVG; the SVG file is left in place, harmless.)

## Deliverables

1. `.vscodeignore` — drop the `bin/**` exclusion.
2. `package.json` — `"icon": "media/triforge.png"`; **commit** `media/triforge.png`.
3. `.gitignore` — add `*.vsix` (the built package is a machine-local artifact).
4. `scripts/install-macos.sh` — the installer (executable; `set -euo pipefail`).

## The script

### Behavior (default run: build → package → install)

```
1. Preamble    set -euo pipefail; color/log helpers (info/ok/warn/err); banner;
               resolve repo root from the script's own path and cd there.
2. Pre-flight  a. macOS check        — uname -s == Darwin, else explain + exit.
               b. repo check         — node -p require(./package.json).name == "triforge".
               c. Node               — present and major >= 20, else guidance (brew / nvm / nodejs.org).
               d. npm                — present, else guidance.
               e. VS Code CLI        — find a usable `code`: PATH first, else app-bundle binaries
                                       (stable, Insiders, VSCodium; /Applications and ~/Applications).
               f. VS Code version    — "$CODE" --version line 1 vs 1.101.0 (sort -V compare);
                                       if older, warn (extension requires >= 1.101) and confirm/abort.
3. Build       g. deps               — run `npm ci` if node_modules is absent (fallback `npm install`).
               h. bundle             — `npm run build` (surfaces a clear error if it fails).
4. Package     i. version            — VER=$(node -p "require('./package.json').version").
               j. vsix               — npx --yes @vscode/vsce package --no-dependencies \
                                         -o "triforge-$VER.vsix"   (overwrites any prior).
5. Install     k. install            — "$CODE" --install-extension "triforge-$VER.vsix" --force.
6. Verify      l. confirm            — "$CODE" --list-extensions --show-versions | grep grnydawn.triforge;
                                       fail loudly if absent.
7. Next steps  m. print              — reload window / open a Triton folder; how to uninstall.
```

### Flags

- (default) — build + package + install.
- `--package-only` — run through step 4, skip install (produces the `.vsix`, prints its path).
- `--uninstall` — `"$CODE" --uninstall-extension grnydawn.triforge`; skip build/package.
- `--help` — usage.

### VS Code discovery (macOS)

Probe in order, first match wins (override implied by whichever is found; stable preferred):
`code` on PATH → `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code` →
`$HOME/Applications/Visual Studio Code.app/...` → `code-insiders` on PATH →
`/Applications/Visual Studio Code - Insiders.app/...` → `codium` on PATH →
`/Applications/VSCodium.app/Contents/Resources/app/bin/codium`. Print which one is used.

### Robustness matrix (every row handled with an actionable message)

| Condition | Handling |
|---|---|
| Not macOS | Message: script targets macOS; exit non-zero. |
| Wrong directory | Resolve script dir; `cd` to repo root; verify manifest name. |
| Node missing / < 20 | State requirement; suggest `brew install node`, nvm, or nodejs.org. |
| npm missing | Explain it ships with Node; re-install Node. |
| `code` not on PATH | Auto-use the app bundle's `code` binary; no manual PATH step needed. |
| No VS Code found | Point to code.visualstudio.com. |
| VS Code < 1.101 | Warn the extension won't activate; prompt to proceed or abort. |
| `npm ci`/build fails | Show the failing output; suggest rerunning `npm run build`. |
| `npx vsce` offline | Detect failure; explain the one-time network requirement. |
| Spaces in app paths | All path variables quoted. |
| Re-run / stale install | `--install-extension … --force` (idempotent). |
| Permissions | Bundle `code` installs to `~/.vscode/extensions` (no sudo). |
| `.vsix` clutter | Written to repo-root `triforge-<version>.vsix`; `*.vsix` git-ignored. |

## Testing

This (Linux) environment has no macOS/VS Code, so verification splits:

- **Verifiable here:** `bash -n scripts/install-macos.sh` (syntax) and, if `shellcheck` is available,
  a lint pass; plus actually running the package step — `npm run build` then
  `npx --yes @vscode/vsce package --no-dependencies` — and asserting the resulting `.vsix` contains
  `extension/dist/extension.js`, `extension/bin/triforge-mcp.js`, `extension/media/triforge.png`, and
  `extension/package.json` (via `unzip -l`). This confirms the two repo fixes and the packaging
  command are correct.
- **Verifiable only on the user's Mac:** steps 5–6 (install into VS Code, list-extensions check) and
  end-to-end activation — which is the script's purpose.

If `npx` cannot reach the network in this sandbox, the packaging assertion is deferred to the user's
Mac and the script is still delivered syntax-clean; this limitation is noted, not hidden.

## Files touched

- Create `scripts/install-macos.sh`.
- Modify `.vscodeignore` (remove `bin/**`).
- Modify `package.json` (`icon` → `media/triforge.png`).
- Add `media/triforge.png` to git.
- Modify `.gitignore` (add `*.vsix`).

## Non-goals (YAGNI)

- macOS only — no Windows/Linux installer.
- No Marketplace publish; no signing; no CHANGELOG (vsce only warns).
- No auto-launch of VS Code or auto-open of a sample project (printed next-steps instead).
- No change to extension source/behavior; no `node_modules` in the `.vsix` (bundled).

## Acceptance criteria

1. `.vscodeignore` no longer excludes `bin/`; `package.json` `icon` is `media/triforge.png` and the
   PNG is committed; `*.vsix` is git-ignored.
2. `scripts/install-macos.sh` is executable, `bash -n`-clean, and runs the
   pre-flight → build → package → install → verify flow with the `--package-only`/`--uninstall`/`--help`
   flags.
3. `npx @vscode/vsce package --no-dependencies` produces a `.vsix` that contains `dist/extension.js`,
   `bin/triforge-mcp.js`, `media/triforge.png`, and `package.json` (verified here if the network
   allows; otherwise on the user's Mac).
4. Every robustness-matrix condition is handled with an actionable message rather than a raw failure.
5. `make verify` still green (the repo fixes don't touch source or tests).
