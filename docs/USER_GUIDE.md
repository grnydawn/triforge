# Triforge — User Guide

Triforge is a VS Code extension **and** a standalone MCP (Model Context Protocol) server for working with [Triton](https://github.com/ORNL/TRITON) flood-inundation simulation projects.

It gives you three things:

1. **A single-project workspace** in VS Code — open a folder, and Triforge treats it as one Triton project described by a small `triforge.json` manifest (with a one-time importer for legacy Triton `config.json` projects).
2. **AI assistance** — an `@triton` chat participant, auto-generated AI instruction files (`AGENTS.md`, `CLAUDE.md`, …), and a Triton knowledge base (`docs/triton-knowledge.md`) so coding assistants answer Triton questions accurately.
3. **A Triton-file MCP server** (`triforge-mcp`) that any MCP client (Claude Desktop, Claude Code, Cursor, …) can point at a project folder to **read, analyze, and visualize** the actual Triton files — including server-rendered PNG heatmaps and animated-GIF flood movies.

- **Package:** `grnydawn.triforge` · **Version:** `0.1.0` · **License:** MIT
- **Requires:** VS Code `^1.95.0`; Node.js 18+ (Node 20 LTS recommended) to build from source / run the MCP server.
- **Distribution:** built from source (not yet on the VS Code Marketplace).

---

## Table of contents

1. [Installation](#1-installation)
2. [Getting started](#2-getting-started)
3. [Feature reference](#3-feature-reference)
   - [3.1 The project model & `triforge.json`](#31-the-project-model--triforgejson)
   - [3.2 Commands](#32-commands)
   - [3.3 Settings](#33-settings)
   - [3.4 The Triforge sidebar](#34-the-triforge-sidebar)
   - [3.5 Creating a project](#35-creating-a-project)
   - [3.6 Importing a legacy Triton project](#36-importing-a-legacy-triton-project)
   - [3.7 The `@triton` chat participant](#37-the-triton-chat-participant)
   - [3.8 Generated AI instruction files & knowledge base](#38-generated-ai-instruction-files--knowledge-base)
   - [3.9 The MCP server](#39-the-mcp-server)
4. [Use cases](#4-use-cases)
5. [Troubleshooting](#5-troubleshooting)
6. [Appendix](#6-appendix)

---

## 1. Installation

### 1.1 Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| VS Code | `^1.95.0` | Needed for the extension's chat-participant API. |
| Node.js | 18+ (20 LTS recommended) | To build the extension/MCP server from source and to run the MCP server. |
| npm | bundled with Node | Used by all build scripts. |
| `make` | optional | Only for the convenience `make` targets; everything has an `npm` equivalent. |

> Triforge is **not published to the VS Code Marketplace** yet (it's at `0.1.0`). You build and install it from source, as below.

### 1.2 Build & install the VS Code extension

From the repository root:

```bash
npm install
npm run build          # → dist/extension.js, media/creation.js, bin/triforge-mcp.js
```

Package a VSIX and install it:

```bash
# Produces triforge-0.1.0.vsix (vsce runs the build first via vscode:prepublish)
npx --yes @vscode/vsce package        # or: make package

# Install into VS Code from the command line
code --install-extension triforge-0.1.0.vsix
```

Or install through the UI: open the **Extensions** view → the **`...`** menu → **Install from VSIX…** → pick `triforge-0.1.0.vsix`. The installed extension ID is `grnydawn.triforge`.

**Try it without packaging:** open the repo in VS Code and press **F5** to launch an Extension Development Host with Triforge loaded.

### 1.3 Build the standalone MCP server

The MCP server is a separate artifact (it is intentionally **not** shipped inside the `.vsix`):

```bash
npm install
npm run build:mcp      # → bin/triforge-mcp.js  (a self-contained, executable Node CLI)
```

`npm run build` builds it too. The `package.json` `bin` field maps the command name `triforge-mcp` → `bin/triforge-mcp.js`, and the file has a `#!/usr/bin/env node` shebang, so you can run it directly (`./bin/triforge-mcp.js`), via `node bin/triforge-mcp.js`, or as `triforge-mcp` once it's on your `PATH`. Its runtime dependencies (`@modelcontextprotocol/sdk`, `zod`) must be present in `node_modules`.

### 1.4 Register the MCP server with an MCP client

The server speaks MCP over **stdio**; a client launches it and passes the project folder. It resolves the project root in this precedence order: **(1)** the first CLI argument → **(2)** the `TRITON_PROJECT` environment variable → **(3)** the current working directory.

Example for **Claude Desktop** (`claude_desktop_config.json`), passing the project as the argument:

```json
{
  "mcpServers": {
    "triforge": {
      "command": "node",
      "args": [
        "/ABS/PATH/triforge/bin/triforge-mcp.js",
        "/ABS/PATH/to/your/triton-project"
      ]
    }
  }
}
```

Equivalent using the environment variable instead of the argument:

```json
{
  "mcpServers": {
    "triforge": {
      "command": "node",
      "args": ["/ABS/PATH/triforge/bin/triforge-mcp.js"],
      "env": { "TRITON_PROJECT": "/ABS/PATH/to/your/triton-project" }
    }
  }
}
```

You can also set `"cwd"` to the project folder and pass no argument (lowest precedence), or use `"command": "triforge-mcp"` if the bin is on your `PATH`. After editing the config, restart the client and the Triton tools appear.

### 1.5 Contributor commands (optional)

```bash
npm run check            # type-check (tsconfig.json + tsconfig.mcp.json), or: make check
npm run lint             # ESLint over src, or: make lint
npm run test:unit        # fast unit tests (vitest), or: make test-unit
npm run test:integration # VS Code integration tests, or: make test-integration
make verify              # full gauntlet: check + lint + unit + integration
```

On headless Linux, `make test-integration` wraps the VS Code tests with `xvfb-run -a` automatically.

---

## 2. Getting started

### 2.1 Open or create a project in VS Code

A "Triforge project" is **one folder** containing a `triforge.json` manifest plus the Triton input/output files it references. There is no global project registry — the open workspace folder *is* the project.

1. Click the **Triforge** icon in the Activity Bar to open the **Project** view.
2. What you see depends on the folder's state:
   - **No project** → buttons **Create Project Here** and **Open Project Folder…**
   - **Legacy project detected** (a Triton `config.json` is present, no `triforge.json`) → **Import Legacy Project** and **Create New Project Instead**
   - **Ready** (a valid `triforge.json` exists) → a summary of the project (name, CRS, formats, directories)
   - **Invalid** (`triforge.json` exists but can't be loaded) → **Open Manifest** and **Recreate Project**
3. **Create Project Here** opens a form (project name, optional description, UTM zone / datum or an EPSG CRS, input/output formats). On submit, Triforge writes `triforge.json` and scaffolds the `input/`, `output/`, and `build/` directories.

> Tip: **Open Project Folder…** opens a folder picker and reopens VS Code there; if that folder has no manifest, the creation form opens automatically.

### 2.2 Turn on AI assistance

Once a project is **ready**, Triforge can generate AI instruction files and a Triton knowledge base so any coding assistant (and the `@triton` chat) answers Triton questions from facts, not guesses.

- With the default settings this happens **automatically** when the project opens or `triforge.json` changes.
- To do it manually, run **Triforge: Generate/Refresh AI Instructions** from the Command Palette.
- Run **Triforge: Open Triton Knowledge Base** to read `docs/triton-knowledge.md`.

This writes, by default, `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` (and `docs/triton-knowledge.md`). `GEMINI.md` and `.cursor/rules/triton.mdc` are opt-in (see [Settings](#33-settings)).

### 2.3 Ask `@triton`

In the VS Code **Chat** view, type `@triton` and ask a question, or use a slash command:

- `@triton /config courant` — explain a config variable
- `@triton /files` — list Triton file types
- `@triton /project` — summarize the open project
- `@triton /defaults` — show template defaults and known conflicts
- `@triton Is my time_step safe for this grid?` — free-form Q&A (needs a language model; see §3.7)

### 2.4 Explore with the MCP server

Point your MCP client at the project (§1.4), then ask it to use the Triton tools — for example "give me a project overview", "render the DEM with hillshade", or "animate the H output frames".

---

## 3. Feature reference

### 3.1 The project model & `triforge.json`

Triforge binds to a single workspace folder and describes it with a `triforge.json` manifest (schema version `1`). The manifest fields:

```jsonc
{
  "schemaVersion": 1,
  "project":  { "name": "...", "description": "...", "createdAt": "<ISO>", "modifiedAt": "<ISO>" },
  "spatial":  { "crs": "EPSG:32616", "utmZone": "16N", "datum": "WGS84" },
  "io":       { "inputFormat": "BIN", "outputFormat": "ASC" },
  "paths":    { "inputDir": "input", "outputDir": "output", "buildDir": "build" }
}
```

- **`io.inputFormat`** is one of `ASC | BIN` (default `BIN`). **`io.outputFormat`** is one of `ASC | BIN | GTIFF` (default `ASC`).
- **`paths.*`** must be **relative** to the project folder (absolute paths are rejected). Defaults: `input`, `output`, `build`.
- **`spatial.crs`**, if set, must match `EPSG:<digits>`. If you leave it blank but provide a UTM zone + datum, Triforge derives it (WGS84 → `EPSG:326NN`/`327NN`; NAD83 north → `EPSG:269NN`).
- Unknown top-level keys are **preserved** verbatim (this is how legacy-import data survives — see §3.6).

**Project states.** Triforge classifies the folder as `none`, `needsImport` (a legacy `config.json` is present), `ready`, or `invalid` (manifest present but unparseable). If a `triforge.json` declares a `schemaVersion` newer than this build understands, Triforge opens it **read-only** and warns you, to avoid clobbering newer data.

**Workspace trust.** Creating, importing, or writing files requires VS Code workspace trust. In an untrusted window, read-only features still work but writes are blocked with a clear message.

### 3.2 Commands

All commands are under the **Triforge** category in the Command Palette.

| Command | Title | What it does |
|---|---|---|
| `triforge.openProjectFolder` | Open Project Folder… | Folder picker → reopens VS Code at that folder; auto-opens the creation form if it has no manifest. |
| `triforge.createProject` | Create Project Here | Opens the project-creation form (or offers to open the manifest if one already exists). |
| `triforge.importLegacyProject` | Import Legacy Project | Imports a legacy Triton `config.json` into a `triforge.json` (backs up the original first). |
| `triforge.openConfig` | Open Manifest | Opens `triforge.json` in an editor. *(Toolbar button on the Project view when ready.)* |
| `triforge.revealInExplorer` | Reveal Project in Explorer | Reveals the project folder in the OS/VS Code Explorer. *(Toolbar button when ready.)* |
| `triforge.generateAiInstructions` | Generate/Refresh AI Instructions | Regenerates the AI instruction files + knowledge base for the configured targets. |
| `triforge.openKnowledgeBase` | Open Triton Knowledge Base | Opens `docs/triton-knowledge.md` (regenerating it first if missing). |

### 3.3 Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `triforge.ai.instructionTargets` | `string[]` (enum `agents`, `claude`, `copilot`, `gemini`, `cursor`) | `["agents","claude","copilot"]` | Which AI-assistant instruction files Triforge generates and maintains. `GEMINI.md` and `.cursor/rules/triton.mdc` are opt-in. |
| `triforge.ai.autoRegenerate` | `boolean` | `true` | Automatically refresh the instruction files when a project opens, `triforge.json` changes, or the Triforge AI settings change. Set to `false` to only regenerate via the command. |

### 3.4 The Triforge sidebar

The **Triforge** Activity Bar container holds one view, **Project** (`triforge.status`). When the project is *ready*, the view shows a read-only summary of the manifest:

`Name`, `CRS` (explicit, derived, or "(not set)"), `Input format`, `Output format`, `Input dir`, `Output dir`, `Build dir`.

When the project is not ready, the view shows the welcome buttons described in §2.1. Use VS Code's built-in **Explorer** to browse the project's files.

### 3.5 Creating a project

**Create Project Here** opens a webview form with these fields:

- **Project name** *(required)*
- **Description**
- **UTM zone** (e.g. `16N`) and **Datum** (`WGS84` / `NAD83`) — a live **CRS preview** shows the derived EPSG code
- **…or CRS directly (EPSG)** (e.g. `EPSG:32616`) — overrides the derived value
- **Input format** (`BIN` / `ASC`) and **Output format** (`ASC` / `BIN` / `GTIFF`)

On **Create**, Triforge writes `triforge.json` and creates the `input/`, `output/`, and `build/` directories. Creating fails (with a message) if a manifest already exists or the workspace is untrusted.

### 3.6 Importing a legacy Triton project

If the folder contains a legacy Triton **`config.json`** (recognized by its `settings`/`compsetup` blocks) and no `triforge.json`, run **Import Legacy Project**. Triforge:

1. Reads and validates `config.json`.
2. Maps it into a `triforge.json` manifest — project name/description/dates, UTM zone + datum (and a derived CRS), and input/output formats.
3. **Preserves the legacy data** under unknown sections (`_importedFrom`, plus `inputs`, `outputs`, `computation`, `execution` when present) so nothing is lost.
4. Backs up the original to `config.json.bak` (or `config.json.bak.1`, `.2`, … if a backup already exists) and writes `triforge.json`.

### 3.7 The `@triton` chat participant

`@triton` (id `triforge.triton`, full name "Triton") answers Triton questions in the VS Code Chat view, grounded in the built-in knowledge base and your open project.

**Slash commands** (deterministic — they do **not** call a language model, so they always work):

| Command | Argument | Output |
|---|---|---|
| `/config` | *(none)* | All config variables, grouped by section. |
| `/config <name>` | a variable | Section, type/unit, default, allowed values, details, and any note (e.g. a template-vs-UI conflict). |
| `/files` | *(none)* | All file types, grouped by category. |
| `/files <id>` | a file-type id | Category, extensions, related config, role, format, note. |
| `/project` | *(none)* | A summary of the open project (name, CRS, formats, directories). |
| `/defaults` | *(none)* | Template defaults per section + the known template-vs-UI conflicts. |

**Free-form questions** (no slash command) use a language model (your picked Chat model, or the first available via `vscode.lm` — typically GitHub Copilot or Claude in the Chat view). The request is grounded with a system prompt containing the **entire** Triton knowledge base plus your project context, with up to the last 10 conversation turns for continuity, and the answer streams back. The participant also offers contextual follow-up suggestions.

**Graceful degradation:** if no language model is available, `@triton` answers from the knowledge base where it can (e.g. it recognizes a config-variable or file-type name) and otherwise points you to the deterministic slash commands. If a model errors, it suggests a slash command instead.

### 3.8 Generated AI instruction files & knowledge base

Triforge writes assistant-specific instruction files into the project so **any** coding agent in that folder is oriented toward Triton. Target → file:

| Target | File | Notes |
|---|---|---|
| `agents` | `AGENTS.md` | Carries the project-context block + orientation. |
| `claude` | `CLAUDE.md` | A thin shim that imports `@AGENTS.md`. |
| `copilot` | `.github/copilot-instructions.md` | Plain-text pointer (Copilot ignores `@import`). |
| `gemini` | `GEMINI.md` | Opt-in. |
| `cursor` | `.cursor/rules/triton.mdc` | Opt-in; gets `alwaysApply: true` frontmatter. |

- The **knowledge base** is always written whole to **`docs/triton-knowledge.md`** — file types, configuration variables, and the execution model.
- Each instruction file's Triforge content lives between managed-region markers:

  ```
  <!-- TRIFORGE:BEGIN (generated — edits inside this block are overwritten) -->
  ...generated project context + orientation...
  <!-- TRIFORGE:END -->
  ```

  **Your edits outside the markers are preserved** across regenerations.
- **Auto-regeneration** (when `triforge.ai.autoRegenerate` is `true`) is debounced (~250 ms) and fires on project-state changes, `triforge.json` changes, and `triforge.ai.*` settings changes — only when the project is *ready* and the workspace is trusted. It writes exactly the targets in `triforge.ai.instructionTargets`.

The knowledge base currently documents **38 configuration variables** (across 9 sections such as *Simulation Control*, *Topography*, *Output Control*), **22 file types** (6 categories), and **5 template-vs-UI conflicts** — places where the Triton template default differs from what the reference creation UI used (`time_step`, `print_observation`, `input_format`, `factor_interval_domain_decomposition`, `open_boundaries`). `@triton` is instructed to flag these conflicts (and any value marked "inferred / undocumented") honestly rather than guess.

### 3.9 The MCP server

Run `node bin/triforge-mcp.js [projectDir]` (see §1.4 for client config). The server is **read-only** and **path-confined**: every file access is resolved within the project root, and any path that escapes it (via `..` or a symlink) is refused. It exposes **23 tools**.

A core discipline (the "summaries-first" rule): tools return **metadata + statistics by default** and only return raw cell values or large rasters when you explicitly ask. Concretely:

- `triton_read_grid` returns dimensions + stats unless you pass a `window` (a rectangular block) or a `downsample` stride (capped at 4096 returned cells).
- `triton_read_series` / `triton_read_forcing` return summaries unless you pass a `window` / `raw: true`.
- Image tools downsample to a `maxDim` longest side (default **800** px for stills, **512** px for animations) and cap animations at **200** frames (striding longer runs).

#### Group A — Project & Knowledge base

| Tool | Purpose | Parameters |
|---|---|---|
| `triton_project_overview` | Scan the project: configs, inputs, output frames/series, detected DEM grid. | *(none)* |
| `triton_describe_project` | Structured natural-language overview blending the scan with knowledge-base context. | *(none)* |
| `triton_lookup_config_variable` | Look up a config variable in the knowledge base. | `name` *(required)* |
| `triton_list_file_types` | List the Triton file types from the knowledge base. | *(none)* |
| `triton_list_conflicts` | List the template-vs-UI config conflicts. | *(none)* |

#### Group B — Read

| Tool | Purpose | Parameters |
|---|---|---|
| `triton_read_config` | Parse a `.cfg` into key/value entries + which referenced files exist. | `path` *(required)* |
| `triton_read_grid` | Grid metadata + stats; raw cells only via `window`/`downsample`. | `path` *(required)*, `kind?`, `ncols?`, `nrows?`, `nodata?`, `window?{row,col,height,width}`, `downsample?` |
| `triton_read_points` | Parse a point list (`.src`/`.obs`) into X,Y points. | `path` *(required)* |
| `triton_read_boundaries` | Parse external boundary segments (`.extbc`). | `path` *(required)* |
| `triton_read_forcing` | Summarize a forcing series (`.hyg`/`.roff`); `raw:true` returns the full series. | `path` *(required)*, `raw?` |
| `triton_read_series` | Header + per-point summary of an output time series; raw rows only via `window`. | `path` *(required)*, `window?{start,count}` |
| `triton_read_performance` | Parse `performance.txt` into per-rank timing rows. | `path` *(required)* |

#### Group C — Analyze

| Tool | Purpose | Parameters |
|---|---|---|
| `triton_grid_extent` | Dimensions + native-CRS bounding box of a raster. | `path` *(required)*, `kind?`, `ncols?`, `nrows?` |
| `triton_grid_stats` | Min/max/mean/std, NODATA & wet-cell counts (summary only). | `path` *(required)*, `kind?`, `ncols?`, `nrows?`, `nodata?` |
| `triton_forcing_summary` | Peak / time-of-peak / total / mean per source or zone. | `path` *(required)* |
| `triton_series_summary` | Per-point max and time-of-max of an output series. | `path` *(required)* |
| `triton_max_depth` | Cellwise max across a variable's output frames (default `H`); aggregate stats, optional single frame/window. | `variable?`, `frame?`, `paths?`, `window?{row,col,height,width}` |

#### Group D — Visualize

All visualize tools return **MCP image content** (base64 PNG or GIF) plus a short text caption. Colormaps: `viridis`, `depth`, `terrain`, `grayscale` (NODATA cells render transparent).

| Tool | Purpose | Parameters |
|---|---|---|
| `triton_render_grid` | Render any grid as a PNG heatmap; colormap + optional hillshade. | `path` *(required)*, `kind?`, `ncols?`, `nrows?`, `nodata?`, `colormap?`, `range?[min,max]`, `hillshade?`, `maxDim?` |
| `triton_render_dem` | Render a DEM as a relief-shaded terrain heatmap (PNG). | `path` *(required)*, `colormap?` *(default `terrain`)*, `hillshade?` *(default `true`)*, `maxDim?` |
| `triton_render_max_depth` | Render the cellwise max-depth of a variable as a PNG heatmap. | `variable?`, `frame?`, `paths?`, `colormap?` *(default `depth`)*, `maxDim?` |
| `triton_plot_series` | Plot an output series (Time vs value per point) as a PNG line chart. | `path` *(required)*, `points?`, `maxPoints?` *(default 8)* |
| `triton_plot_forcing` | Plot a forcing series (`.hyg`/`.roff`, time in hours) as a PNG line chart. | `path` *(required)*, `columns?` |
| `triton_animate` | Animate a variable's output frames over time as an animated GIF (consistent global colormap range). | `variable?`, `paths?`, `colormap?` *(default `depth`)*, `fps?` *(default 4)*, `maxDim?`, `range?[min,max]` |

**Grid-format hint (`kind`).** Where present, `kind` is `esri` / `headerless` / `binary`. If omitted, the format is sniffed by extension (`.dem`→ESRI, `.bin`→binary, else headerless). **Headerless** grids (e.g. `.inith`, ASCII `.out`) need dimensions — supply `ncols`/`nrows`, or rely on the project's detected DEM grid.

See the [Appendix](#62-supported-file-formats) for the full list of supported file formats.

---

## 4. Use cases

### Use case 1 — Start a new Triton project in VS Code

1. Create/empty a folder and open it in VS Code (or use **Open Project Folder…**).
2. In the **Triforge** view, click **Create Project Here**.
3. Fill the form: name `Allatoona Dam Break`, UTM zone `16N`, datum `WGS84` (CRS preview shows `EPSG:32616`), input `BIN`, output `ASC`. Click **Create**.
4. Triforge writes `triforge.json` and creates `input/`, `output/`, `build/`.
5. With default settings, it also generates `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/triton-knowledge.md`, so any assistant in this folder now understands the project.

### Use case 2 — Get AI help inside an existing project

1. Open an existing Triton project folder (it already has `triforge.json`).
2. Open the Chat view and ask `@triton /project` to confirm Triforge sees the right CRS, formats, and directories.
3. Ask `@triton /config courant` and `@triton /config time_step` — note the `time_step` **template-vs-UI conflict** Triforge surfaces.
4. Ask a free-form question: `@triton Given output_format=ASC, where will my H output frames be written and how do I read them?` (uses your Chat model, grounded in the KB).
5. If you'd rather not auto-write instruction files, set `triforge.ai.autoRegenerate` to `false` and run **Triforge: Generate/Refresh AI Instructions** only when you want.

### Use case 3 — Import a legacy Triton project

1. Open a folder that has a legacy Triton `config.json` (no `triforge.json`). The Triforge view shows **Import Legacy Project**.
2. Click it (grant workspace trust if prompted). Triforge writes `triforge.json` (preserving the legacy `inputs`/`outputs`/`computation`/`execution` blocks under unknown sections) and backs up the original to `config.json.bak`.
3. The view switches to *ready* and shows the imported project's summary.

### Use case 4 — Learn Triton with the knowledge base

1. `@triton /files` → browse the file-type catalog; `@triton /files esri-ascii-dem` for DEM specifics.
2. `@triton /defaults` → see template defaults per section and the 5 known conflicts.
3. Run **Triforge: Open Triton Knowledge Base** to read the full reference (`docs/triton-knowledge.md`) — handy to commit alongside the project so teammates and CI agents share the same source of truth.

### Use case 5 — Explore a project from Claude Desktop (MCP)

1. Register the server pointing at your project (§1.4) and restart Claude Desktop.
2. Ask: *"Use triton_project_overview to summarize this project."* → configs, inputs, output frames/series, and the detected DEM grid (ncols/nrows/cellsize).
3. *"Read circular_dambreak.cfg and tell me which referenced files are missing."* → `triton_read_config` returns the parsed entries plus an existence check for each referenced path.
4. *"What's the extent and stats of the DEM?"* → `triton_grid_extent` (native-CRS bbox) and `triton_grid_stats` (min/max/mean/std, NODATA & wet-cell counts) — no giant arrays dumped.
5. *"Show the maximum flood depth over all H frames."* → `triton_max_depth` returns aggregate stats (stitching PAR-mode subdomains automatically).

### Use case 6 — Visualize flooding (MCP image tools)

1. *"Render the DEM with hillshade."* → `triton_render_dem` returns an inline PNG (terrain colormap + relief).
2. *"Render the max-depth as a blue depth heatmap."* → `triton_render_max_depth` (colormap `depth`).
3. *"Plot the hydrograph in allatoona.hyg."* → `triton_plot_forcing` returns a PNG line chart (time in hours).
4. *"Plot H at the observation points over time."* → `triton_plot_series` from an `output/series/*.txt`.
5. *"Animate the H frames at 6 fps."* → `triton_animate` returns an animated GIF with a single global color range so frames are comparable.

### Use case 7 — Inspect large grids without flooding the chat

1. `triton_read_grid { "path": "input/big.dem" }` → metadata + stats only.
2. Need actual numbers? Add a **window**: `{ "path": "input/big.dem", "window": { "row": 0, "col": 0, "height": 4, "width": 4 } }` → just that 4×4 block.
3. Want a coarse whole-grid view? Add a **downsample** stride: `{ "path": "input/big.dem", "downsample": 50 }` (rejected if it would still exceed 4096 cells — increase the stride or use a window).

---

## 5. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| The Triforge view shows welcome buttons, not a project summary | The folder has no valid `triforge.json`. Create or import a project (§2.1). |
| "Workspace is untrusted — grant trust to …" | Creating/importing/writing requires VS Code **workspace trust**. Trust the folder, then retry. |
| `triforge.json could not be loaded` (state = invalid) | The manifest is malformed. Use **Open Manifest** to fix it, or **Recreate Project**. |
| Opened read-only with a "newer version" warning | The manifest's `schemaVersion` is newer than this build. Update Triforge (writes are disabled to protect newer data). |
| `@triton` free-form answers say "No language model is available" | No Chat model is enabled (e.g. Copilot/Claude). Slash commands (`/config`, `/files`, `/project`, `/defaults`) still work without a model. |
| AI instruction files aren't updating | Set `triforge.ai.autoRegenerate: true`, ensure the project is *ready* and trusted, or run **Generate/Refresh AI Instructions** manually. |
| MCP client doesn't list Triton tools | Use an **absolute** path to `bin/triforge-mcp.js`, ensure you ran `npm run build:mcp`, and restart the client. |
| MCP tool error "Path escapes project root" | The path left the project folder. All paths must be inside the root passed to the server (§1.4). |
| `headerless grid needs ncols/nrows` | A headerless grid (e.g. `.inith`, ASCII `.out`) was read without dimensions and no DEM was detected. Pass `ncols`/`nrows`. |
| `downsample factor N still yields … cells (cap 4096)` | Increase the `downsample` stride or use a `window`. |

---

## 6. Appendix

### 6.1 Knowledge-base config sections

The 38 configuration variables are grouped into 9 sections: *Simulation Control*, *Surface Roughness (Manning's n)*, *Topography*, *Initial Conditions*, *Hydrologic Forcing*, *External Boundaries*, *Output Control*, *Input and Output Formats*, *Miscellaneous Parameters*. Browse them with `@triton /config` or in `docs/triton-knowledge.md`.

**Known template-vs-UI conflicts** (`@triton /defaults` or `triton_list_conflicts`): `time_step`, `print_observation`, `input_format`, `factor_interval_domain_decomposition`, `open_boundaries`.

### 6.2 Supported file formats

The MCP server and parsers understand these formats (default NODATA is `-9999`):

| Format | Extension(s) | Description |
|---|---|---|
| ESRI ASCII grid (DEM) | `.dem` | 6-line header (`ncols`, `nrows`, `xllcorner`/`xllcenter`, `yllcorner`/`yllcenter`, `cellsize`, `nodata_value`) + row-major floats. |
| Headerless ASCII matrix | `.inith`, `.initqx`, `.initqy`, `.mann`, `.rmap`, ASCII `.out` | Bare row-major floats; dimensions supplied externally (args or the detected DEM). |
| Binary grid | `.bin`, binary `.out` | 16-byte little-endian Float64 header (`nrows`@0, `ncols`@8) + Float64 body. |
| Triton run config | `.cfg` | `#` comments + `key=value` lines (quoted paths stripped); key order preserved. |
| Point list | `.src`, `.obs` | `X,Y` points (projected meters); `%`/`#` comments skipped. |
| External boundary table | `.extbc` | Rows of `Type, X1, Y1, X2, Y2, BC`. |
| Forcing series | `.hyg`, `.roff` | Column 0 = time (hours), columns 1..N per source/zone. |
| Output time series | `output/series/*.txt` | Header row (`Time(s),H_at_Point_N…`) + time + per-point columns. |
| Output frames | `{VAR}_{FRAME}_{SUB}.out` / `.tif` | Per-timestep, per-subdomain rasters; the filename encodes variable / frame / subdomain. |
| Performance log | `performance.txt` | `%`-header CSV with per-rank timing rows. |
| GeoTIFF outputs | `.tif`, `.vrt` | Detected and listed by the project scan (not yet parsed by the MCP server). |

**Output naming:** `{VAR}_{FRAME}_{SUBDOMAIN}.{ext}` — e.g. `H_01_00.out` = variable `H`, frame `01`, subdomain `00`. In sequential (SEQ) runs there's one `_00` file per frame; in parallel (PAR) runs the per-frame subdomains are stitched into the full DEM-sized grid.

### 6.3 Project layout the scanner expects

`triton_project_overview` / `triton_describe_project` classify files by location: `.cfg` outside `output/` are configs; other files outside `output/` are inputs; `output/asc/*.out` and `output/bin/*.out` are ASCII/binary output frames; `output/series/*.txt` are output series; `performance.txt` is the performance log; `.tif`/`.vrt` are GeoTIFF outputs. The DEM grid is detected from the first config's `dem_filename`.

---

*Generated for Triforge `0.1.0`. Some Triton config defaults and units are documented as "inferred / undocumented" in the knowledge base where the upstream Triton spec is ambiguous; `@triton` and the knowledge base flag these explicitly.*
