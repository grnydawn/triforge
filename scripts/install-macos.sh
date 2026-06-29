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
