# M2b — `@triton` Chat Participant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `@triton` VS Code chat participant — LLM-grounded free-form Q&A plus four deterministic, model-free slash commands — reusing the M2a `vscode`-free Triton knowledge-base core.

**Architecture:** Continue the M1/M2a split. A new pure core module `src/core/triton-kb/chat.ts` (prompt builder + deterministic command renderers + followups + no-model fallback) and one new query `listConflicts()`. A thin adapter `src/vscode/chat-participant.ts` wires `vscode.chat` + `vscode.lm` via a separately-exported, DI-tested `createChatHandler` (mirroring M2a's `wireAutoRegeneration`).

**Tech Stack:** TypeScript, VS Code Chat API (`vscode.chat`) + Language Model API (`vscode.lm`), esbuild bundle, vitest (pure-core unit), `@vscode/test-electron` + mocha `ui: 'bdd'` (integration). Engine `^1.95.0`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-21-triforge-m2b-chat-participant-design.md`

**Task order (dependencies):** 1 → 2 → 3 → 4 → 5. Task 3 (chat.ts) needs Task 2 (`listConflicts`); Task 4 (adapter) needs Task 3; Task 5 (wiring) needs Task 4.

---

## Task 1: Engine bump + `chatParticipants` contribution

**Files:**
- Modify: `package.json` (engine, `@types/vscode`, `contributes.chatParticipants`)

- [ ] **Step 1: Bump the engine**

In `package.json`, change:
```json
  "engines": { "vscode": "^1.90.0" },
```
to:
```json
  "engines": { "vscode": "^1.95.0" },
```

- [ ] **Step 2: Bump `@types/vscode`**

In `package.json` `devDependencies`, change:
```json
    "@types/vscode": "^1.90.0",
```
to:
```json
    "@types/vscode": "^1.95.0",
```

- [ ] **Step 3: Add the `chatParticipants` contribution**

In `package.json`, inside `"contributes"`, add a new key (sibling of `"configuration"`):
```json
    "chatParticipants": [
      {
        "id": "triforge.triton",
        "name": "triton",
        "fullName": "Triton",
        "description": "Ask about Triton config variables, file types, and your project",
        "isSticky": true,
        "commands": [
          { "command": "config",   "name": "config",   "description": "Explain a Triton config variable" },
          { "command": "files",    "name": "files",    "description": "List or explain Triton file types" },
          { "command": "project",  "name": "project",  "description": "Summarize the open Triton project" },
          { "command": "defaults", "name": "defaults", "description": "Show template defaults and known conflicts" }
        ]
      }
    ]
```
(The `chatParticipants[].commands[].name` is the canonical field; `command` is included as a tolerated alias for older tooling. If `npm run check`/packaging warns about an unknown `command` field, drop it and keep only `name` + `description`.)

- [ ] **Step 4: Install the updated typings**

Run: `npm install`
Expected: updates `@types/vscode` to a `1.95.x` and refreshes `package-lock.json`. (If the environment is offline and the install fails, STOP and report BLOCKED — the type-check needs the 1.95 typings.)

- [ ] **Step 5: Verify check + lint still pass (no code yet)**

Run: `npm run check && npm run lint`
Expected: both clean (no source changes yet, only manifest + typings).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(m2b): bump engine to ^1.95 and contribute the @triton chat participant"
```

---

## Task 2: Core query `listConflicts()`

**Files:**
- Modify: `src/core/triton-kb/queries.ts`
- Test: `src/core/triton-kb/queries.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/core/triton-kb/queries.test.ts` (merge the `listConflicts` import into the existing `./queries` import line; the file already imports `describe/it/expect` from vitest):
```ts
import { listConflicts } from './queries';

describe('listConflicts', () => {
  it('returns exactly the 5 documented template-vs-UI conflicts', () => {
    const names = listConflicts().map((v) => v.name).sort();
    expect(names).toEqual(
      ['factor_interval_domain_decomposition', 'input_format', 'open_boundaries', 'print_observation', 'time_step'].sort(),
    );
  });

  it('every returned variable has a note that mentions the reference UI', () => {
    for (const v of listConflicts()) {
      expect(Boolean(v.note && /reference\b.*\bui\b/i.test(v.note))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- queries`
Expected: FAIL — `listConflicts is not exported` / `is not a function`.

- [ ] **Step 3: Implement `listConflicts`**

In `src/core/triton-kb/queries.ts`, add (after `getConfigVariablesBySection`):
```ts
/**
 * The template-vs-UI conflicts: variables whose note references the reference
 * creation UI. Everything else with a note is the 'inferred / undocumented'
 * family. Derived from the data (C6) — never a hardcoded list.
 */
export function listConflicts(): ConfigVariable[] {
  return CONFIG_VARIABLES.filter((v) => !!v.note && /reference\b.*\bui\b/i.test(v.note));
}
```
(`ConfigVariable` and `CONFIG_VARIABLES` are already imported at the top of `queries.ts`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- queries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-kb/queries.ts src/core/triton-kb/queries.test.ts
git commit -m "feat(m2b): add listConflicts() query deriving the 5 template-vs-UI conflicts"
```

---

## Task 3: Core `chat.ts` — prompt builder, command renderers, followups, fallback

**Files:**
- Create: `src/core/triton-kb/chat.ts`
- Create: `src/core/triton-kb/chat.test.ts`
- Modify: `src/core/triton-kb/index.ts` (barrel re-export)

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-kb/chat.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt, renderConfigCommand, renderFilesCommand,
  renderProjectCommand, renderDefaultsCommand, suggestFollowups, deterministicFallback,
} from './chat';
import { ProjectContext } from './types';

const ctx: ProjectContext = {
  name: 'DemoFlood', description: 'demo', crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84',
  inputFormat: 'BIN', outputFormat: 'ASC', inputDir: 'input', outputDir: 'output', buildDir: 'build',
  hasImportedLegacy: false,
};

describe('buildSystemPrompt', () => {
  it('always embeds the knowledge base', () => {
    expect(buildSystemPrompt()).toContain('courant');
    expect(buildSystemPrompt(ctx)).toContain('courant');
  });
  it('includes the project name only when a project context is given', () => {
    expect(buildSystemPrompt(ctx)).toContain('DemoFlood');
    expect(buildSystemPrompt()).not.toContain('DemoFlood');
  });
  it('states no project is open only when context is absent', () => {
    expect(buildSystemPrompt()).toMatch(/no triton project is currently open/i);
    expect(buildSystemPrompt(ctx)).not.toMatch(/no triton project is currently open/i);
  });
});

describe('renderConfigCommand', () => {
  it('renders full detail for a known variable', () => {
    const md = renderConfigCommand('courant');
    expect(md).toContain('courant');
    expect(md).toContain('0.5');
    expect(md).toMatch(/Miscellaneous Parameters/);
  });
  it('is case-insensitive', () => {
    expect(renderConfigCommand('COURANT')).toContain('courant');
  });
  it('lists all 9 sections when no argument is given', () => {
    const md = renderConfigCommand('');
    expect(md).toContain('Simulation Control');
    expect(md).toContain('Miscellaneous Parameters');
    expect(md).toContain('Surface Roughness');
  });
  it('reports unknown variables with the full list', () => {
    const md = renderConfigCommand('nope');
    expect(md).toMatch(/unknown config variable/i);
    expect(md).toContain('courant');
  });
});

describe('renderFilesCommand', () => {
  it('groups file types by category when no argument is given', () => {
    const md = renderFilesCommand('');
    expect(md).toContain('input raster');
    expect(md).toContain('output raster');
    expect(md).toContain('esri-ascii-dem');
  });
  it('renders one file type by id', () => {
    const md = renderFilesCommand('esri-ascii-dem');
    expect(md).toContain('ESRI ASCII');
    expect(md).toContain('dem_filename');
  });
  it('reports unknown ids with the full list', () => {
    const md = renderFilesCommand('nope');
    expect(md).toMatch(/unknown file type/i);
    expect(md).toContain('esri-ascii-dem');
  });
});

describe('renderProjectCommand', () => {
  it('renders the project block when context is present', () => {
    expect(renderProjectCommand(ctx)).toContain('DemoFlood');
  });
  it('reports no project when context is absent', () => {
    expect(renderProjectCommand()).toMatch(/no triton project is open/i);
  });
});

describe('renderDefaultsCommand', () => {
  it('lists template defaults and the 5 conflicts', () => {
    const md = renderDefaultsCommand();
    expect(md).toMatch(/template-vs-ui conflicts/i);
    for (const name of ['time_step', 'print_observation', 'input_format', 'factor_interval_domain_decomposition', 'open_boundaries']) {
      expect(md).toContain(name);
    }
  });
});

describe('suggestFollowups', () => {
  it('returns a small non-empty set that varies with project presence', () => {
    expect(suggestFollowups(undefined).length).toBeGreaterThan(0);
    expect(suggestFollowups(undefined).length).toBeLessThanOrEqual(4);
    expect(suggestFollowups(undefined, ctx)).not.toEqual(suggestFollowups(undefined));
  });
});

describe('deterministicFallback', () => {
  it('renders a known variable entry', () => {
    expect(deterministicFallback('courant')).toContain('courant');
  });
  it('points at slash commands when nothing matches', () => {
    const md = deterministicFallback('how do I run a flood sim');
    expect(md).toMatch(/\/config/);
    expect(md).toMatch(/no language model/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- chat`
Expected: FAIL — cannot resolve `./chat`.

- [ ] **Step 3: Implement `chat.ts`**

Create `src/core/triton-kb/chat.ts`:
```ts
import { ProjectContext, SECTION_ORDER, CATEGORY_ORDER } from './types';
import { renderKnowledgeBaseMarkdown, renderProjectContextBlock } from './render';
import {
  lookupConfigVariable, listConfigVariables, getConfigVariablesBySection,
  listFileTypes, lookupFileType, listConflicts,
} from './queries';

const NO_PROJECT_MARKER = 'No Triton project is currently open';

/** System prompt for the default (free-form) handler: KB + optional project grounding. */
export function buildSystemPrompt(ctx?: ProjectContext): string {
  const out: string[] = [
    'You are @triton, an expert assistant for the Triton flood-inundation simulator.',
    'Answer ONLY from the Triton knowledge base provided below. Be precise about',
    'defaults, units, and allowed values. Call out template-vs-UI conflicts and any',
    'value documented as "inferred / undocumented" honestly rather than guessing.',
  ];
  if (ctx) {
    out.push('A Triton project is currently open; use its context for project-specific questions.');
  } else {
    out.push(
      `${NO_PROJECT_MARKER}. Answer general Triton questions, but state that`,
      'project-specific details are unavailable until the user opens a Triton project.',
    );
  }
  out.push('', '---', '', renderKnowledgeBaseMarkdown());
  if (ctx) out.push('', '---', '', renderProjectContextBlock(ctx));
  return out.join('\n');
}

/** `/config` — explain a config variable, or list every variable by section. */
export function renderConfigCommand(arg: string): string {
  const q = (arg ?? '').trim();
  if (!q) {
    const out: string[] = ['# Triton configuration variables', ''];
    for (const section of SECTION_ORDER) {
      const names = getConfigVariablesBySection(section).map((v) => v.name).sort((a, b) => a.localeCompare(b));
      out.push(`**${section}** — ${names.join(', ')}`);
    }
    out.push('', 'Ask `/config <name>` for details on one variable.');
    return out.join('\n');
  }
  const v = lookupConfigVariable(q);
  if (!v) {
    const all = listConfigVariables().map((c) => c.name).sort((a, b) => a.localeCompare(b));
    return `Unknown config variable \`${q}\`.\n\nKnown variables: ${all.join(', ')}.`;
  }
  const lines: string[] = [`## \`${v.name}\``, ''];
  lines.push(`- **Section:** ${v.section}`);
  lines.push(`- **Type:** ${v.valueType}${v.unit ? ` (${v.unit})` : ''}`);
  lines.push(`- **Default:** ${v.defaultValue === '' ? '_empty_' : `\`${v.defaultValue}\``}`);
  if (v.allowed) lines.push(`- **Allowed:** ${v.allowed.join(', ')}`);
  lines.push('', v.details);
  if (v.note) lines.push('', `_Note: ${v.note}_`);
  return lines.join('\n');
}

/** `/files` — list every file type by category, or explain one by id. */
export function renderFilesCommand(arg: string): string {
  const q = (arg ?? '').trim();
  if (!q) {
    const out: string[] = ['# Triton file types', ''];
    for (const cat of CATEGORY_ORDER) {
      const items = listFileTypes().filter((f) => f.category === cat).sort((a, b) => a.id.localeCompare(b.id));
      if (!items.length) continue;
      out.push(`### ${cat}`);
      for (const f of items) out.push(`- \`${f.id}\` — ${f.label}`);
      out.push('');
    }
    out.push('Ask `/files <id>` for details on one file type.');
    return out.join('\n');
  }
  const f = lookupFileType(q);
  if (!f) {
    const all = listFileTypes().map((x) => x.id).sort((a, b) => a.localeCompare(b));
    return `Unknown file type \`${q}\`.\n\nKnown file types: ${all.join(', ')}.`;
  }
  const lines: string[] = [`## ${f.label} (\`${f.id}\`)`, ''];
  lines.push(`- **Category:** ${f.category}`);
  if (f.extensions.length) lines.push(`- **Extensions:** ${f.extensions.join(', ')}`);
  if (f.relatedVars.length) lines.push(`- **Related config:** ${f.relatedVars.join(', ')}`);
  lines.push('', `**Role:** ${f.role}`, '', `**Format:** ${f.format}`);
  if (f.note) lines.push('', `_Note: ${f.note}_`);
  return lines.join('\n');
}

/** `/project` — summarize the open project, or report that none is open. */
export function renderProjectCommand(ctx?: ProjectContext): string {
  if (!ctx) return 'No Triton project is open in this folder. Open or create one to use `/project`.';
  return renderProjectContextBlock(ctx);
}

/** `/defaults` — template defaults reference + the template-vs-UI conflicts. */
export function renderDefaultsCommand(): string {
  const out: string[] = ['# Triton template defaults', ''];
  for (const section of SECTION_ORDER) {
    const items = getConfigVariablesBySection(section).sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) continue;
    out.push(`### ${section}`);
    for (const v of items) {
      out.push(`- \`${v.name}\` = ${v.defaultValue === '' ? '_empty_' : `\`${v.defaultValue}\``}`);
    }
    out.push('');
  }
  out.push('## Template-vs-UI conflicts', '');
  for (const v of listConflicts()) {
    out.push(`- \`${v.name}\` — template default \`${v.defaultValue || '(empty)'}\`. ${v.note}`);
  }
  return out.join('\n');
}

/** Deterministic follow-up prompt suggestions (≤ 4). */
export function suggestFollowups(command: string | undefined, ctx?: ProjectContext): string[] {
  if (command === 'config') return ['/config courant', '/defaults', '/files'];
  if (command === 'files') return ['/files esri-ascii-dem', '/config dem_filename', '/project'];
  if (ctx) return ['/project', '/defaults', 'Is my time_step setting safe?'];
  return ['/files', '/config courant', 'What inputs does a Triton run need?'];
}

/** No-model fallback: a best-effort KB answer, else a pointer to slash commands. */
export function deterministicFallback(prompt: string, ctx?: ProjectContext): string {
  const q = (prompt ?? '').trim();
  if (q && lookupConfigVariable(q)) {
    return `No language model is available, but here is the knowledge-base entry:\n\n${renderConfigCommand(q)}`;
  }
  if (q && lookupFileType(q)) {
    return `No language model is available, but here is the knowledge-base entry:\n\n${renderFilesCommand(q)}`;
  }
  const tip = ctx ? '' : ' (No project is open, so project-specific answers are unavailable.)';
  return `No language model is available for free-form answers.${tip}\n\n` +
    'Try a deterministic command: `/config <name>`, `/files [id]`, `/project`, or `/defaults`.';
}
```

- [ ] **Step 4: Add the barrel re-export**

In `src/core/triton-kb/index.ts`, add a line:
```ts
export * from './chat';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit -- chat`
Expected: PASS (all `chat` describe blocks).

- [ ] **Step 6: Confirm purity + full unit suite**

Run: `npm run test:unit`
Expected: PASS, including `purity.test.ts` (it scans the whole `triton-kb` directory; `chat.ts` imports no `vscode`).

- [ ] **Step 7: Commit**

```bash
git add src/core/triton-kb/chat.ts src/core/triton-kb/chat.test.ts src/core/triton-kb/index.ts
git commit -m "feat(m2b): add vscode-free chat core (prompt builder, slash renderers, followups, fallback)"
```

---

## Task 4: Adapter `chat-participant.ts`

**Files:**
- Create: `src/vscode/chat-participant.ts`
- Test: `src/test/integration/chat-participant.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `src/test/integration/chat-participant.test.ts`:
```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { createChatHandler, registerChatParticipant } from '../../vscode/chat-participant';
import { ProjectStateController } from '../../vscode/state';
import { ConfigStore } from '../../vscode/config-store';
import { ParsedManifest } from '../../core/types';

function parsed(): ParsedManifest {
  return {
    manifest: {
      schemaVersion: 1,
      project: { name: 'DemoFlood', description: '', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' },
      spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' },
      io: { inputFormat: 'BIN', outputFormat: 'ASC' },
      paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
    },
    unknownSections: {},
  };
}

const token = new vscode.CancellationTokenSource().token;

function fakeStream() {
  const chunks: string[] = [];
  const stream = {
    markdown: (v: string | vscode.MarkdownString) => { chunks.push(typeof v === 'string' ? v : v.value); },
    progress: () => undefined, button: () => undefined, anchor: () => undefined,
    reference: () => undefined, filetree: () => undefined, push: () => undefined,
  } as unknown as vscode.ChatResponseStream;
  return { stream, chunks };
}

function req(prompt: string, command?: string): vscode.ChatRequest {
  return { prompt, command, references: [], toolReferences: [] } as unknown as vscode.ChatRequest;
}

const chatCtx = { history: [] } as unknown as vscode.ChatContext;

function controllers(ready: boolean) {
  const controller = {
    state: ready ? 'ready' : 'none',
    targetFolder: ready ? vscode.Uri.file('/tmp/x') : undefined,
  } as unknown as ProjectStateController;
  const store = { current: ready ? parsed() : undefined } as unknown as ConfigStore;
  return { controller, store };
}

describe('@triton chat handler', () => {
  it('/config renders deterministically without resolving a model', async () => {
    const { controller, store } = controllers(true);
    let modelResolved = false;
    const handler = createChatHandler(controller, store, {
      resolveModel: async () => { modelResolved = true; return undefined; },
    });
    const { stream, chunks } = fakeStream();
    await handler(req('courant', 'config'), chatCtx, stream, token);
    assert.ok(chunks.join('').includes('courant'));
    assert.strictEqual(modelResolved, false);
  });

  it('default path forwards model fragments and grounds the prompt in the KB', async () => {
    const { controller, store } = controllers(true);
    let sent: vscode.LanguageModelChatMessage[] = [];
    const model = {
      sendRequest: async (messages: vscode.LanguageModelChatMessage[]) => {
        sent = messages;
        return { text: (async function* () { yield 'Hello '; yield 'world'; })() };
      },
    } as unknown as vscode.LanguageModelChat;
    const handler = createChatHandler(controller, store, { resolveModel: async () => model });
    const { stream, chunks } = fakeStream();
    await handler(req('what is courant?'), chatCtx, stream, token);
    assert.strictEqual(chunks.join(''), 'Hello world');
    const firstContent = (sent[0] as unknown as { content: unknown }).content;
    const firstText = typeof firstContent === 'string' ? firstContent : JSON.stringify(firstContent);
    assert.ok(firstText.includes('courant'));
  });

  it('falls back gracefully when no model is available', async () => {
    const { controller, store } = controllers(true);
    const handler = createChatHandler(controller, store, { resolveModel: async () => undefined });
    const { stream, chunks } = fakeStream();
    await handler(req('explain my setup'), chatCtx, stream, token);
    assert.ok(/no language model/i.test(chunks.join('')));
  });

  it('/project reports no project when none is open', async () => {
    const { controller, store } = controllers(false);
    const handler = createChatHandler(controller, store, { resolveModel: async () => undefined });
    const { stream, chunks } = fakeStream();
    await handler(req('', 'project'), chatCtx, stream, token);
    assert.ok(/no triton project is open/i.test(chunks.join('')));
  });
});

describe('registerChatParticipant', () => {
  it('wires against a fake extension context without throwing', () => {
    const { controller, store } = controllers(true);
    const subscriptions: { dispose(): void }[] = [];
    const context = {
      subscriptions,
      extensionUri: vscode.Uri.file('/tmp/ext'),
    } as unknown as vscode.ExtensionContext;
    const participant = registerChatParticipant(context, controller, store);
    if (participant) {
      assert.ok(subscriptions.length >= 1);
      participant.dispose();
    }
  });
});
```

- [ ] **Step 2: Build + compile tests to verify failure**

Run: `npm run build && npm run compile:tests`
Expected: FAIL — cannot find module `../../vscode/chat-participant`.

- [ ] **Step 3: Implement `chat-participant.ts`**

Create `src/vscode/chat-participant.ts`:
```ts
import * as vscode from 'vscode';
import { ProjectStateController } from './state';
import { ConfigStore } from './config-store';
import {
  ProjectContext, deriveProjectContext,
  buildSystemPrompt, renderConfigCommand, renderFilesCommand,
  renderProjectCommand, renderDefaultsCommand, suggestFollowups, deterministicFallback,
} from '../core/triton-kb';

const PARTICIPANT_ID = 'triforge.triton';

export interface ChatDeps {
  /** Resolve the model to use. Default prefers the user's picked model
   *  (request.model) and falls back to vscode.lm.selectChatModels(). */
  resolveModel?: (request: vscode.ChatRequest) => Thenable<vscode.LanguageModelChat | undefined>;
  /** Max history turns to include in the model request. Default 10. */
  historyLimit?: number;
}

function currentContext(controller: ProjectStateController, store: ConfigStore): ProjectContext | undefined {
  if (controller.state === 'ready' && store.current) return deriveProjectContext(store.current);
  return undefined;
}

function mapHistory(
  history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>,
  limit: number,
): vscode.LanguageModelChatMessage[] {
  const msgs: vscode.LanguageModelChatMessage[] = [];
  for (const turn of history.slice(-limit)) {
    if (turn instanceof vscode.ChatRequestTurn) {
      msgs.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .map((p) => (p instanceof vscode.ChatResponseMarkdownPart ? p.value.value : ''))
        .join('');
      if (text) msgs.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  }
  return msgs;
}

const defaultResolveModel = async (request: vscode.ChatRequest): Promise<vscode.LanguageModelChat | undefined> => {
  // Prefer the model the user selected in the Chat view; fall back to any available chat model.
  const picked = (request as { model?: vscode.LanguageModelChat }).model;
  if (picked) return picked;
  const [model] = await vscode.lm.selectChatModels();
  return model;
};

export function createChatHandler(
  controller: ProjectStateController,
  store: ConfigStore,
  deps: ChatDeps = {},
): vscode.ChatRequestHandler {
  const resolveModel = deps.resolveModel ?? defaultResolveModel;
  const historyLimit = deps.historyLimit ?? 10;

  return async (request, chatContext, stream, token): Promise<vscode.ChatResult> => {
    const ctx = currentContext(controller, store);

    switch (request.command) {
      case 'config': stream.markdown(renderConfigCommand(request.prompt)); return { metadata: { command: 'config' } };
      case 'files': stream.markdown(renderFilesCommand(request.prompt)); return { metadata: { command: 'files' } };
      case 'project': stream.markdown(renderProjectCommand(ctx)); return { metadata: { command: 'project' } };
      case 'defaults': stream.markdown(renderDefaultsCommand()); return { metadata: { command: 'defaults' } };
    }

    const model = await resolveModel(request);
    if (!model) {
      stream.markdown(deterministicFallback(request.prompt, ctx));
      return { metadata: { command: 'chat' } };
    }

    const messages = [
      vscode.LanguageModelChatMessage.User(buildSystemPrompt(ctx)),
      ...mapHistory(chatContext.history, historyLimit),
      vscode.LanguageModelChatMessage.User(request.prompt),
    ];

    try {
      const response = await model.sendRequest(messages, {}, token);
      for await (const fragment of response.text) {
        if (token.isCancellationRequested) break;
        stream.markdown(fragment);
      }
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        stream.markdown(
          `\n\n_The language model could not complete this request (${err.code || err.message}). ` +
          'Try a slash command: `/config`, `/files`, `/project`, `/defaults`._',
        );
      } else {
        throw err;
      }
    }
    return { metadata: { command: 'chat' } };
  };
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  controller: ProjectStateController,
  store: ConfigStore,
  deps: ChatDeps = {},
): vscode.ChatParticipant | undefined {
  if (!vscode.chat?.createChatParticipant) return undefined;
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, createChatHandler(controller, store, deps));
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'triforge.svg');
  participant.followupProvider = {
    provideFollowups: (result) => {
      const command = (result.metadata as { command?: string } | undefined)?.command;
      return suggestFollowups(command, currentContext(controller, store)).map((prompt) => ({ prompt, label: prompt }));
    },
  };
  context.subscriptions.push(participant);
  return participant;
}
```

- [ ] **Step 4: Build, compile, type-check, lint**

Run: `npm run build && npm run compile:tests && npm run check && npm run lint`
Expected: all clean. (If `npm run check` reports `Property 'model' does not exist on type 'ChatRequest'`, the cast in `defaultResolveModel` already guards it — no error. If any *other* Chat/LM type is missing on `^1.95`, STOP and report BLOCKED with the exact `tsc` message.)

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `npm run test:integration` (on headless Linux use `make test-integration` for xvfb)
Expected: PASS — both `@triton chat handler` and `registerChatParticipant` describe blocks.

- [ ] **Step 6: Commit**

```bash
git add src/vscode/chat-participant.ts src/test/integration/chat-participant.test.ts
git commit -m "feat(m2b): add @triton chat participant adapter (createChatHandler + registerChatParticipant)"
```

---

## Task 5: Wire into activation + manual E2E + final verification

**Files:**
- Modify: `src/extension.ts`
- Modify: `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md` (append manual scenarios)

- [ ] **Step 1: Import and call `registerChatParticipant`**

In `src/extension.ts`, add the import beside the others:
```ts
import { registerChatParticipant } from './vscode/chat-participant';
```
and call it in `activate`, right after the `registerAiInstructions(...)` line:
```ts
  registerAiInstructions(context, controller, store);
  registerChatParticipant(context, controller, store);
```

- [ ] **Step 2: Append manual E2E scenarios**

Append to `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md`:
```markdown

## M2b — @triton chat participant (manual)

- **M2B-CHAT-01** Open a trusted Triton project; in Chat ask `@triton what does courant control and is mine safe?` → a grounded conversational answer (requires a language model / Copilot).
- **M2B-CHAT-02** `@triton /config courant`, `/config`, `/files`, `/files esri-ascii-dem`, `/project`, `/defaults` → correct deterministic markdown, no model needed.
- **M2B-CHAT-03** In a folder with no Triton project: `@triton /config courant` works; `@triton /project` reports no project; a free-form question answers generally and notes project-specifics are unavailable.
- **M2B-CHAT-04** With no language model installed/consented: a free-form `@triton` question returns the friendly fallback; slash commands still work.
- **M2B-CHAT-05** Follow-up suggestions appear and are relevant; clicking one re-asks `@triton`.
```

- [ ] **Step 3: Run the full gauntlet**

Run: `make verify` (or `npm run check && npm run lint && npm run test:unit && npm run test:integration`)
Expected: check clean, lint clean, all unit tests pass, all integration tests pass (M1 activation still green — proving `registerChatParticipant` wires during `activate` without throwing).

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md
git commit -m "feat(m2b): register @triton during activation; document manual E2E scenarios"
```

---

## Acceptance criteria (from the spec — verify at the end)

1. `@triton <q>` (no slash) answers via the user's model, grounded in KB + project context. *(manual M2B-CHAT-01)*
2. `/config`, `/files`, `/project`, `/defaults` answer deterministically with no model. *(Task 3 + Task 4 tests; manual M2B-CHAT-02)*
3. No project open → general KB + `/config`/`/files`/`/defaults` still work; `/project` and project-specific questions note no project. *(Task 3/4 tests; manual M2B-CHAT-03)*
4. No language model → friendly fallback, slash commands still work, no crash. *(Task 4 test; manual M2B-CHAT-04)*
5. `src/core/triton-kb/chat.ts` imports no `vscode` (purity test green). *(Task 3 Step 6)*
6. `engines.vscode` and `@types/vscode` are `^1.95.0`; zero new runtime deps. *(Task 1)*
7. Streaming output + cancellation token honored. *(Task 4 default-path test + code review)*
8. `listConflicts()` returns exactly the 5 documented conflicts. *(Task 2 test)*
9. Full gauntlet green. *(Task 5 Step 3)*
10. `chatParticipants` contribution present and well-formed. *(Task 1)*

## Self-review notes
- **Spec coverage:** every spec §5–§11 item maps to a task (buildSystemPrompt/renderers/followups/fallback → Task 3; listConflicts → Task 2; adapter + DI + tests → Task 4; contribution + engine → Task 1; wiring + manual E2E → Task 5).
- **Type consistency:** `ChatDeps`, `createChatHandler`, `registerChatParticipant`, `currentContext`, `mapHistory`, `defaultResolveModel` names are consistent between the adapter and its test. Core function names match between `chat.ts`, `chat.test.ts`, and the adapter import.
- **No placeholders:** every code step shows complete code; every run step shows the command and expected result.
```
