# Triforge

A VS Code extension for the **Triton** flood-inundation simulation framework.

Triforge treats **one open folder as one project**: open a folder containing a
`triforge.json` manifest and Triforge activates for it; open a folder without one
through *Triforge: Open Project Folder…* and it offers to create a project.

## M1 (this milestone)

- Single-project model: project = the open workspace folder.
- `triforge.json` manifest (fresh schema) with a one-time importer from legacy
  Triton `config.json` files.
- Files are browsed with VS Code's built-in Explorer.
- No global `~/.triton` registry, no project list.

AI assistance (memory files, `@triton` chat, MCP) and the Leaflet map / input
generator / setup editors arrive in later milestones.

## Develop

```bash
npm install
npm run build           # bundle with esbuild
npm run test:unit       # core unit tests (vitest)
npm run test:integration  # @vscode/test-electron (Linux headless: xvfb-run -a …)
```

Press **F5** in VS Code to launch the Extension Development Host.
