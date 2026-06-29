# Triforge — cross-platform developer & manual-E2E commands.
#
# Works on macOS, Linux, and Windows. On Windows, run from Git Bash, MSYS2, or WSL
# (a POSIX shell + `make`); the recipes themselves use node/npm so they behave the same
# on every OS. Run `make` or `make help` to list targets.

UNAME_S := $(shell uname -s 2>/dev/null || echo Unknown)
XVFB    := $(shell command -v xvfb-run 2>/dev/null)
CODE    ?= code
E2E_DIR ?=

.DEFAULT_GOAL := help
.PHONY: help install build watch check lint test-unit test-integration test e2e fixtures package clean verify

help: ## Show this help
	@node -e "const fs=require('fs');for(const l of fs.readFileSync('Makefile','utf8').split('\n')){const m=l.match(/^([a-zA-Z0-9_-]+):.*##\s?(.*)$$/);if(m)console.log('  '+m[1].padEnd(18)+m[2]);}"

install: ## Install dependencies (npm ci-style)
	npm install

build: ## Bundle the extension host + webview with esbuild
	npm run build

watch: ## Rebuild on change (esbuild watch mode)
	node esbuild.js --watch

check: ## Type-check (tsc --noEmit)
	npm run check

lint: ## Lint src with ESLint
	npm run lint

test-unit: ## Run pure-core unit tests (vitest, no editor)
	npm run test:unit

test-integration: ## Run @vscode/test-electron integration tests (headless on Linux via xvfb when available)
ifeq ($(UNAME_S),Linux)
ifeq ($(XVFB),)
	npm run test:integration
else
	xvfb-run -a npm run test:integration
endif
else
	npm run test:integration
endif

test: test-unit test-integration ## Run unit + integration tests

verify: check lint test ## Full gauntlet: check + lint + unit + integration

fixtures: ## Create manual-fixtures/{empty,ready,legacy} for manual E2E
	node scripts/make-fixtures.js

e2e: build fixtures ## Launch the Extension Development Host for manual E2E. Optional: make e2e E2E_DIR=manual-fixtures/ready
	$(CODE) --extensionDevelopmentPath="$(CURDIR)" $(E2E_DIR)

package: ## Build a .vsix (publishing; note: pre-publish PNG icon follow-up still open)
	npx --yes @vscode/vsce package

clean: ## Remove build/test artifacts and manual fixtures
	node -e "for (const p of ['dist','out','.vscode-test','media/creation.js','media/creation.js.map','media/solver-config.js','media/solver-config.js.map','manual-fixtures']) require('fs').rmSync(p,{recursive:true,force:true})"
