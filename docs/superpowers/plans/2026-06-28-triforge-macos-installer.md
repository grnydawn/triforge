# Triforge macOS Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-command Bash installer (`scripts/install-macos.sh`) that builds, packages, and installs the Triforge extension into VS Code on macOS, plus the two repo fixes needed to produce a working `.vsix`.

**Architecture:** Two tiny repo fixes (un-exclude `bin/` from `.vscodeignore`; switch the manifest `icon` from the vsce-rejected SVG to the existing `media/triforge.png`) make the package valid. The script then does pre-flight checks → `npm run build` → `npx @vscode/vsce package --no-dependencies` → `code --install-extension --force` → verify, with an actionable message for every likely failure. `--package-only` is OS-portable (so it can be verified off-macOS); the full install flow is macOS-gated.

**Tech Stack:** Bash, Node/npm (build), `@vscode/vsce` via `npx` (packaging), the VS Code `code` CLI (install). No new repo dependencies.

---

## Reference facts (verified against current code)

- Build: `npm run build` = `node esbuild.js && node esbuild.mcp.js` → `dist/extension.js` (bundled `main`) + `bin/triforge-mcp.js` (bundled MCP server). Both self-contained ⇒ `.vsix` needs no `node_modules` (`--no-dependencies`).
- `package.json`: `name` `triforge`, `version` `0.1.0`, `publisher` `grnydawn` (ext id `grnydawn.triforge`), `icon` `media/triforge.svg`, `engines.vscode` `^1.101.0`.
- `.vscodeignore` currently contains a line `bin/**` (excludes the MCP server) — must be removed. `esbuild.mcp.js` / `tsconfig.mcp.json` lines stay (build-time only).
- `media/triforge.png` exists but is untracked; `media/triforge.svg` is referenced only by the manifest `icon` (the M3b removal of the activity-bar container dropped its other use).
- `manifest-contract.test.ts` does **not** assert the `icon` field ⇒ the icon change does not affect tests.
- A `.vsix` is a zip whose payload lives under `extension/` (so files appear as `extension/dist/extension.js`, etc.).

## File structure

- **Modify `.vscodeignore`** — remove the `bin/**` exclusion.
- **Modify `package.json`** — `icon` → `media/triforge.png`.
- **Add `media/triforge.png`** to git.
- **Modify `.gitignore`** — ignore `*.vsix`.
- **Create `scripts/install-macos.sh`** — the installer.

---

## Task 1: Repo packaging fixes

**Files:**
- Modify: `.vscodeignore`
- Modify: `package.json`
- Modify: `.gitignore`
- Add: `media/triforge.png`

- [ ] **Step 1: Un-exclude the MCP server from the package**

In `.vscodeignore`, delete the line:

```
bin/**
```

(Leave every other line unchanged, including `esbuild.mcp.js` and `tsconfig.mcp.json`.)

- [ ] **Step 2: Point the manifest icon at the PNG**

In `package.json`, change:

```json
  "icon": "media/triforge.svg",
```

to:

```json
  "icon": "media/triforge.png",
```

- [ ] **Step 3: Ignore built .vsix artifacts**

Run (idempotent — only appends if missing):

```bash
grep -qxF '*.vsix' .gitignore || printf '\n# Local extension package (built by scripts/install-macos.sh)\n*.vsix\n' >> .gitignore
```

- [ ] **Step 4: Verify the package now contains the MCP server and PNG icon**

Run:

```bash
npm run build && npx --yes @vscode/vsce package --no-dependencies -o /tmp/triforge-check.vsix && unzip -l /tmp/triforge-check.vsix | grep -E 'extension/(bin/triforge-mcp\.js|dist/extension\.js|media/triforge\.png|package\.json)'
```

Expected: the build succeeds, packaging succeeds, and the `grep` prints all four lines (`extension/bin/triforge-mcp.js`, `extension/dist/extension.js`, `extension/media/triforge.png`, `extension/package.json`). Then remove the probe: `rm -f /tmp/triforge-check.vsix`.

(If `npx @vscode/vsce` cannot reach the network in this environment, run just `npm run build` to confirm the build, and note that the `.vsix` content assertion is deferred to a networked machine — the `.vscodeignore`/icon edits are still correct by inspection.)

- [ ] **Step 5: Commit**

```bash
git add .vscodeignore package.json .gitignore media/triforge.png
git commit -m "$(cat <<'EOF'
build(installer): ship bin/triforge-mcp.js and a PNG icon so the extension packages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 2: The installer script

**Files:**
- Create: `scripts/install-macos.sh`

- [ ] **Step 1: Create the script**

Create `scripts/install-macos.sh` with exactly this content:

```bash
#!/usr/bin/env bash
#
# Triforge — local install for macOS.
# Builds the extension, packages a .vsix, and installs it into VS Code.
#
# Usage:
#   bash scripts/install-macos.sh              # build + package + install (macOS)
#   bash scripts/install-macos.sh --package-only   # build the .vsix only (any OS)
#   bash scripts/install-macos.sh --uninstall      # remove the extension
#   bash scripts/install-macos.sh --help
#
set -euo pipefail

# ---------- logging ----------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; RST=$'\033[0m'
else
  BOLD=''; RED=''; GRN=''; YLW=''; BLU=''; RST=''
fi
info() { printf '%s %s\n' "${BLU}==>${RST}" "$*"; }
ok()   { printf '%s %s\n' "${GRN}OK${RST}" "$*"; }
warn() { printf '%s %s\n' "${YLW}! ${RST}" "$*" >&2; }
die()  { printf '%s\n' "${RED}x $*${RST}" >&2; exit 1; }

EXT_ID='grnydawn.triforge'
MIN_CODE='1.101.0'

usage() {
  cat <<'EOF'
Triforge local installer (macOS)

Usage:
  bash scripts/install-macos.sh [option]

  (no option)     Build, package, and install the extension into VS Code (macOS).
  --package-only  Build and package the .vsix only; do not install (any OS).
  --uninstall     Uninstall the Triforge extension from VS Code.
  --help, -h      Show this help.
EOF
}

MODE='install'
case "${1:-}" in
  '')             MODE='install' ;;
  --package-only) MODE='package' ;;
  --uninstall)    MODE='uninstall' ;;
  --help|-h)      usage; exit 0 ;;
  *)              usage; die "Unknown option: $1" ;;
esac

# ---------- locate repo root ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---------- helpers ----------
find_code() {
  local c
  for c in code code-insiders codium; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
  done
  local candidates=(
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
    "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
    "$HOME/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
    "/Applications/VSCodium.app/Contents/Resources/app/bin/codium"
    "$HOME/Applications/VSCodium.app/Contents/Resources/app/bin/codium"
  )
  for c in "${candidates[@]}"; do
    if [ -x "$c" ]; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

version_ge() {  # version_ge A B -> 0 if A >= B (numeric dotted)
  local ai bi i; local IFS=.
  local -a av=($1) bv=($2)
  for i in 0 1 2; do
    ai="${av[i]:-0}"; bi="${bv[i]:-0}"
    ai="${ai//[!0-9]/}"; bi="${bi//[!0-9]/}"
    ai="${ai:-0}"; bi="${bi:-0}"
    if [ "$ai" -gt "$bi" ]; then return 0; fi
    if [ "$ai" -lt "$bi" ]; then return 1; fi
  done
  return 0
}

# ---------- repo sanity (all modes) ----------
APP_NAME="$(node -p "require('./package.json').name" 2>/dev/null || true)"
[ "$APP_NAME" = 'triforge' ] || die "Run this from the triforge repo (package.json name is '${APP_NAME:-unknown}')."

# ---------- uninstall ----------
if [ "$MODE" = 'uninstall' ]; then
  CODE="$(find_code)" || die "VS Code not found. Install it from https://code.visualstudio.com/"
  info "Uninstalling ${EXT_ID} ..."
  "$CODE" --uninstall-extension "$EXT_ID" || die "Uninstall failed (was it installed?)."
  ok "Uninstalled ${EXT_ID}."
  exit 0
fi

# ---------- macOS gate (full install only) ----------
if [ "$MODE" = 'install' ] && [ "$(uname -s)" != 'Darwin' ]; then
  die "The full install flow targets macOS (found $(uname -s)). On other OSes run with --package-only and install the .vsix from your editor."
fi

# ---------- toolchain (build is needed for install + package) ----------
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node 20+ (brew install node, https://nodejs.org/, or nvm)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || die "Node $(node -v) is too old; Triforge needs Node 20+. Upgrade via brew/nvm/nodejs.org."
ok "Node $(node -v)"
command -v npm >/dev/null 2>&1 || die "npm is not installed (it ships with Node.js). Re-install Node."
ok "npm $(npm -v)"

# ---------- locate VS Code (install only) ----------
CODE=''
if [ "$MODE" = 'install' ]; then
  CODE="$(find_code)" || die "VS Code not found. Install it from https://code.visualstudio.com/ (or build only with --package-only)."
  CODE_VER="$("$CODE" --version 2>/dev/null | head -n1 || true)"
  ok "VS Code: $CODE (v${CODE_VER:-unknown})"
  if [ -n "${CODE_VER:-}" ] && ! version_ge "$CODE_VER" "$MIN_CODE"; then
    warn "VS Code $CODE_VER is older than the required $MIN_CODE; the extension may not activate."
    if [ -t 0 ]; then
      printf 'Proceed anyway? [y/N] '; read -r ans
    else
      ans='N'
    fi
    case "$ans" in y|Y) ;; *) die "Aborted. Update VS Code to ${MIN_CODE}+ and re-run." ;; esac
  fi
fi

# ---------- dependencies ----------
if [ ! -d node_modules ]; then
  info 'Installing dependencies (npm ci) ...'
  npm ci || npm install || die "Dependency install failed. Check your network/proxy and retry."
  ok 'Dependencies installed.'
fi

# ---------- build ----------
info 'Building the extension (npm run build) ...'
npm run build || die "Build failed. Run 'npm run build' directly to see the error."
ok 'Build complete.'

# ---------- package ----------
VER="$(node -p "require('./package.json').version")"
VSIX="triforge-${VER}.vsix"
info "Packaging ${VSIX} ..."
npx --yes @vscode/vsce package --no-dependencies -o "$VSIX" \
  || die "Packaging failed. The first run needs network access for 'npx @vscode/vsce'. See the output above."
[ -f "$VSIX" ] || die "Expected ${VSIX} was not produced."
ok "Packaged ${VSIX}"

if [ "$MODE" = 'package' ]; then
  ok "Done. The .vsix is at: ${REPO_ROOT}/${VSIX}"
  info "Install it with:  code --install-extension \"${VSIX}\" --force"
  exit 0
fi

# ---------- install + verify ----------
info 'Installing into VS Code ...'
"$CODE" --install-extension "$VSIX" --force || die "Install failed. See the output above."
if "$CODE" --list-extensions --show-versions 2>/dev/null | grep -q "^${EXT_ID}@"; then
  ok "Installed: $("$CODE" --list-extensions --show-versions | grep "^${EXT_ID}@")"
else
  die "Install did not register ${EXT_ID}. Restart VS Code and re-run."
fi

printf '\n%s\n' "${GRN}${BOLD}Triforge installed.${RST}"
cat <<EOF
Next steps:
  1. Reload VS Code (Command Palette > 'Developer: Reload Window').
  2. Open a Triton project folder (File > Open Folder...), or run
     Command Palette > 'Triforge: Open Project Folder'.
  3. For a Triton folder, the 'Triton Project' section appears in the Explorer.
  4. To wire AI tools:  Command Palette > 'Connect AI Tools'.

Uninstall later with:  bash scripts/install-macos.sh --uninstall
EOF
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/install-macos.sh
```

- [ ] **Step 3: Syntax-check the script**

Run: `bash -n scripts/install-macos.sh`
Expected: no output, exit 0 (no syntax errors). If `shellcheck` is installed, also run `shellcheck scripts/install-macos.sh` and confirm no errors.

- [ ] **Step 4: Check the help path works**

Run: `bash scripts/install-macos.sh --help`
Expected: prints the usage block and exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-macos.sh
git commit -m "$(cat <<'EOF'
feat(installer): macOS one-command build/package/install script for VS Code

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 3: End-to-end packaging verification

**Files:** none (verification only)

- [ ] **Step 1: Run the script's package path end-to-end**

Run: `bash scripts/install-macos.sh --package-only`
Expected: prints the Node/npm checks, builds, packages, and reports `Packaged triforge-0.1.0.vsix` with the `.vsix` at the repo root. (`--package-only` skips the macOS gate, so this runs off-macOS too. If `npx @vscode/vsce` cannot reach the network here, the script will `die` with the network message — in that case run `npm run build` to confirm the build and defer the packaging assertion to a networked machine.)

- [ ] **Step 2: Inspect the produced .vsix**

Run: `unzip -l triforge-0.1.0.vsix | grep -E 'extension/(bin/triforge-mcp\.js|dist/extension\.js|media/triforge\.png|package\.json)'`
Expected: all four entries listed — confirming the MCP server, the bundled extension, the PNG icon, and the manifest all ship. Then clean up: `rm -f triforge-0.1.0.vsix` (it is git-ignored anyway).

- [ ] **Step 3: Confirm the repo fixes didn't break the suite**

Run: `make verify`
Expected: PASS — typecheck + lint + unit + integration all green (the `.vscodeignore`/icon/`.gitignore` changes touch no source or tests).

- [ ] **Step 4: Confirm a clean working tree**

Run: `git status -sb`
Expected: only the pre-existing untracked `notes.txt` remains (the `media/triforge.png` is now committed; any built `.vsix` is git-ignored).

---

## Self-review verification (against the spec acceptance criteria)

1. `.vscodeignore` no longer excludes `bin/`; `icon` is `media/triforge.png` (committed); `*.vsix` ignored — Task 1.
2. `scripts/install-macos.sh` is executable, `bash -n`-clean, with `--package-only`/`--uninstall`/`--help` flags — Task 2.
3. `npx @vscode/vsce package --no-dependencies` produces a `.vsix` containing `dist/extension.js`, `bin/triforge-mcp.js`, `media/triforge.png`, `package.json` — Task 1 Step 4 + Task 3 Steps 1-2.
4. Every robustness-matrix condition handled with an actionable message — Task 2 Step 1 (macOS gate, repo check, Node/npm checks, `code` discovery + version check, dependency/build/package failure messages, quoting, `--force`, git-ignored artifact).
5. `make verify` green — Task 3 Step 3.
