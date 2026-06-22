# Triforge M2b — `@triton` Chat Participant (Design)

**Status:** approved (design) · **Date:** 2026-06-21 · **Branch:** `triforge-m2b-chat`

## 1. Goal

Ship a `@triton` VS Code **chat participant** that answers Triton questions
conversationally — using the user's own language model, grounded in the Triton
knowledge base (the M2a core) and the open project's context — plus four
deterministic, model-free **slash commands** for instant lookups.

This is milestone **M2b** in the M2 decomposition. M2a built the shared,
`vscode`-free Triton knowledge-base core and the AI instruction files. M2b
consumes that exact core through the Chat + Language Model APIs. M2c (an MCP
server) remains a separate, later spec.

This directly serves notes.txt #5: *"create an AI assistance memory of TRITON
file types so that AI assistance tools can professionally answer to user's
question."* M2a created the memory on disk; M2b makes `@triton` itself a
professional answerer inside the editor.

## 2. Scope

### In scope
- A `@triton` chat participant (`id: triforge.triton`).
- Default (no-slash) handler: free-form Q&A via the user's language model,
  grounded in a system prompt that embeds the full KB + current project context.
- Four deterministic slash commands — `/config`, `/files`, `/project`,
  `/defaults` — that render from the KB with **no** language model.
- Graceful behavior when no language model is available and when no project is
  open (general KB always answerable; project-specifics noted as unavailable).
- A new `vscode`-free core module (`src/core/triton-kb/chat.ts`) + one new query
  (`listConflicts`) + a thin `src/vscode/chat-participant.ts` adapter.
- Engine bump `^1.90.0 → ^1.95.0` (and `@types/vscode` to match).

### Non-goals (deferred)
- Language Model **Tools** (`vscode.lm.registerTool` + `languageModelTools`
  contribution). A natural later slice; not required for a useful chat.
- The **MCP server** (M2c).
- A per-model-family preference setting; chat telemetry / `onDidReceiveFeedback`.
- Content-based file detection (still deferred; M2b reads no Triton bytes — only
  the manifest, via the existing controller/store).
- Any new **runtime** dependency. The participant is hand-rolled against the
  stable Chat + Language Model APIs.

## 3. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| C1 | Grounding strategy | **LLM + KB context, with deterministic slash commands and graceful fallback.** Default handler calls the user's language model with the KB + project context in the system prompt; slash commands are model-free. |
| C2 | Slash command surface | Ship **all four**: `/config`, `/files`, `/project`, `/defaults`. The default free-form LLM handler is always present. |
| C3 | No project / untrusted | **Answer general KB anyway.** `@triton` always answers project-independent questions and runs `/config` `/files` `/defaults`, even with no open project or in an untrusted workspace (it only *reads* static knowledge). `/project` and project-specific questions note that no project is open. |
| C4 | Engine & deps | Bump `engines.vscode` and `@types/vscode` to `^1.95.0`. **No new runtime dependency** — hand-rolled `vscode.chat` + `vscode.lm`. |
| C5 | Architecture | Continue the M1/M2a split: pure `vscode`-free core (prompt building + deterministic rendering) + thin DI'd `src/vscode` adapter. |
| C6 | Conflict source for `/defaults` | Derive the template-vs-UI conflict set **from the KB data** via a `listConflicts()` query, not a duplicated hardcoded list. *(As built: implemented with an explicit `CONFLICT` marker constant in `data.ts` — a structured sibling to `INFERRED` — rather than the regex sketched in §6; see the §6 note.)* |
| C7 | Testability | The chat handler is a separately-exported wireable factory (`createChatHandler`) driven directly in integration tests with a fake request/stream + injected fake model — the same rationale as M2a's `wireAutoRegeneration`. |

## 4. Architecture

```
src/core/triton-kb/                 (pure; no vscode; covered by purity.test.ts)
  chat.ts        NEW  prompt builder + deterministic command renderers + followups + fallback
  queries.ts     EDIT add listConflicts()
  index.ts       EDIT re-export chat.ts (barrel)

src/vscode/
  chat-participant.ts  NEW  createChatHandler() + registerChatParticipant()
  extension.ts         EDIT call registerChatParticipant() in activate()

package.json     EDIT  + chatParticipants contribution; bump engine + @types/vscode

src/core/triton-kb/chat.test.ts            NEW  vitest unit tests
src/test/integration/chat-participant.test.ts  NEW  @vscode/test-electron (BDD)
```

Data flow:

1. User types `@triton <prompt>` (optionally with a slash command) in the Chat view.
2. VS Code invokes the handler `(request, chatContext, stream, token)`.
3. Adapter derives the current `ProjectContext` live: `controller.state === 'ready' && store.current` → `deriveProjectContext(store.current)`, else `undefined`.
4. **Slash command** (`request.command`) → the matching core renderer → `stream.markdown(...)`. No model touched.
5. **Default** → core `buildSystemPrompt(ctx)` → adapter resolves a model → sends `[User(system), …capped history, User(prompt)]` → streams `response.text` fragments to `stream.markdown(...)`, honoring `token`.
6. **No model available** → `stream.markdown(...)` of a friendly note plus `deterministicFallback(prompt, ctx)` (best-effort KB answer). Never throws.
7. Followups: the participant's `followupProvider` returns `suggestFollowups(command, ctx)` wrapped as `ChatFollowup[]`.

## 5. Core: `src/core/triton-kb/chat.ts` (pure)

All functions are pure and `vscode`-free. They reuse M2a renderers/queries.

### 5.1 `buildSystemPrompt(ctx?: ProjectContext): string`
Composes, in order:
- A role + instruction preamble: `@triton` is an expert assistant for the Triton
  flood-inundation simulator; answer **only** from the provided knowledge base;
  be exact about defaults, units, and allowed values; call out template-vs-UI
  conflicts and `inferred / undocumented` items honestly; if a project is open,
  ground project-specific answers in its context; **if no project is open, still
  answer general questions and state that project-specific details are
  unavailable until a Triton project is opened.**
- The full KB: `renderKnowledgeBaseMarkdown()`.
- When `ctx` is provided: a "Current project" section = `renderProjectContextBlock(ctx)`.
- When `ctx` is absent: a one-line "No Triton project is currently open." marker.

Acceptance: output contains a known KB token (e.g. `courant`) always; contains
the project name only when `ctx` is provided; contains the no-project marker only
when `ctx` is absent.

### 5.2 `renderConfigCommand(arg: string): string`
- Empty/blank `arg` → a header plus, for each `SECTION_ORDER` section, the section
  name and its variable names (from `getConfigVariablesBySection`).
- Non-empty `arg` → `lookupConfigVariable(arg.trim())`:
  - hit → full detail: name, section, type, unit (if any), default (`empty` when
    blank), allowed values (if any), `details`, and `note` (if any).
  - miss → "Unknown config variable `<arg>`." plus the full variable-name list.

### 5.3 `renderFilesCommand(arg: string): string`
- Empty/blank `arg` → the 22 file types grouped by `CATEGORY_ORDER` (id + label per
  entry), matching the KB's grouping.
- Non-empty `arg` → `lookupFileType(arg.trim())`:
  - hit → label, category, role, format, extensions, related config vars, note.
  - miss → "Unknown file type `<arg>`." plus the full id list.

### 5.4 `renderProjectCommand(ctx?: ProjectContext): string`
- `ctx` present → `renderProjectContextBlock(ctx)`.
- `ctx` absent → "No Triton project is open in this folder. Open or create one to
  use `/project`." (per C3).

### 5.5 `renderDefaultsCommand(): string`
- A "Template defaults" reference: every variable's `defaultValue` (`empty` when
  blank), grouped by `SECTION_ORDER`.
- A "Template-vs-UI conflicts" subsection driven by `listConflicts()` (the 5 vars):
  for each, the template default and its `note` (which explains what the reference
  creation UI used). Per C6 — no hardcoded conflict list.

### 5.6 `suggestFollowups(command: string | undefined, ctx?: ProjectContext): string[]`
A small, relevant set of follow-up prompt strings (≤ 4). Examples:
- no project → `['/files', '/config courant', 'What inputs does a Triton run need?']`
- project open → `['/project', '/defaults', 'Is my time_step setting safe?']`
Deterministic; no model.

### 5.7 `deterministicFallback(prompt: string, ctx?: ProjectContext): string`
For the no-model path. If `lookupConfigVariable(prompt.trim())` or
`lookupFileType(prompt.trim())` hits, render that entry; otherwise return a short
"no language model available — here's what I can answer deterministically"
message pointing at the four slash commands.

## 6. Core query: `listConflicts()` (in `queries.ts`)

**As built.** Rather than regex-parsing free-text notes, `data.ts` exports a
`CONFLICT = 'template-vs-UI conflict'` marker constant (an explicit sibling to
the existing `INFERRED` marker) prepended to the note of each of the 5 conflict
variables, and `listConflicts()` filters on that marker:

```ts
// data.ts — structured marker, kept in the note so it renders inline with the
// conflict explanation (consistent with how INFERRED renders today).
export const CONFLICT = 'template-vs-UI conflict';
// e.g. note: `${CONFLICT}: reference creation UI defaulted to 0.01`

// queries.ts
export function listConflicts(): ConfigVariable[] {
  return CONFIG_VARIABLES.filter((v) => !!v.note && v.note.includes(CONFLICT));
}
```

This is a strict improvement over the originally-sketched regex
(`/reference\b.*\bui\b/i`): a structured discriminator can't silently widen if a
note is edited, and it still honors C6 (derived from the data, never hardcoded).
The only visible effect on M2a output is that the 5 conflict variables now render
their note as `_(template-vs-UI conflict: …)_` in the knowledge base — stylistically
identical to how `inferred / undocumented` notes already render. `render.ts` is
unchanged; all M2a data/markers/render/parity tests stay green.

Acceptance: returns **exactly** the 5 known conflicts — `time_step`,
`print_observation`, `input_format`, `factor_interval_domain_decomposition`,
`open_boundaries` — and no `inferred / undocumented`-only variable.

## 7. Adapter: `src/vscode/chat-participant.ts`

### 7.1 Dependency injection
```ts
export interface ChatDeps {
  /** Resolve the model to use. Default prefers the user's picked model
   *  (request.model) and falls back to vscode.lm.selectChatModels(). */
  resolveModel?: (request: vscode.ChatRequest) => Thenable<vscode.LanguageModelChat | undefined>;
  /** History turns to include (cap). Default 10. */
  historyLimit?: number;
}
```

### 7.2 `createChatHandler(controller, store, deps?): vscode.ChatRequestHandler`
Returns the handler. Pure-ish: reads `controller`/`store` live; uses `deps`.
- Derive `ctx` (per §4 step 3).
- `switch (request.command)`:
  - `'config'` → `stream.markdown(renderConfigCommand(request.prompt))`
  - `'files'` → `stream.markdown(renderFilesCommand(request.prompt))`
  - `'project'` → `stream.markdown(renderProjectCommand(ctx))`
  - `'defaults'` → `stream.markdown(renderDefaultsCommand())`
  - default → LLM path:
    - `model = await resolveModel(request)`.
    - If no model → `stream.markdown(deterministicFallback(request.prompt, ctx))`; return.
    - Build messages: `[User(buildSystemPrompt(ctx)), ...mapHistory(chatContext.history, historyLimit), User(request.prompt)]`. The stable LM API has no System role; instructions ride the leading `User` message.
    - `const resp = await model.sendRequest(messages, {}, token); for await (const frag of resp.text) { if (token.isCancellationRequested) break; stream.markdown(frag); }`
    - Wrap the LLM call in try/catch: on `vscode.LanguageModelError` (off / no consent / quota / cancelled) → `stream.markdown(...)` a friendly message. Never rethrow.
- Return `{ metadata: { command: request.command ?? 'chat' } }`.

`mapHistory` (adapter-local; touches vscode chat types): map `ChatRequestTurn`
→ `User(turn.prompt)` and `ChatResponseTurn` → `Assistant(<concatenated markdown
parts>)`, keep the last `historyLimit` turns.

`resolveModel` default:
```ts
async (request) => request.model ?? (await vscode.lm.selectChatModels())[0];
```
(If `@types/vscode@^1.95` does not expose `ChatRequest.model`, drop to
`(await vscode.lm.selectChatModels())[0]` — `npm run check` will surface this.)

### 7.3 `registerChatParticipant(context, controller, store, deps?): void`
- Guard: if `!vscode.chat?.createChatParticipant`, return (defensive; engine
  guarantees it on `^1.95`, but activation must never throw on an odd host).
- `const participant = vscode.chat.createChatParticipant('triforge.triton', createChatHandler(controller, store, deps));`
- `participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'triforge.svg');`
- `participant.followupProvider = { provideFollowups: (result, _ctx, _token) => suggestFollowups(result.metadata?.command, currentCtx()).map((prompt) => ({ prompt, label: prompt })) };`
  (where `currentCtx()` re-derives ctx live).
- `context.subscriptions.push(participant);`

### 7.4 `src/extension.ts`
Add `import { registerChatParticipant } from './vscode/chat-participant';` and
call `registerChatParticipant(context, controller, store);` in `activate` (after
`registerAiInstructions`). Registration order vs `controller.start()` is
immaterial — the handler reads `controller`/`store` lazily at chat time.

## 8. `package.json` changes
- `engines.vscode`: `^1.95.0`; devDependency `@types/vscode`: `^1.95.0`.
- Add the contribution:
```json
"chatParticipants": [
  {
    "id": "triforge.triton",
    "name": "triton",
    "fullName": "Triton",
    "description": "Ask about Triton config variables, file types, and your project",
    "isSticky": true,
    "commands": [
      { "name": "config",   "description": "Explain a Triton config variable" },
      { "name": "files",    "description": "List or explain Triton file types" },
      { "name": "project",  "description": "Summarize the open Triton project" },
      { "name": "defaults", "description": "Show template defaults and known conflicts" }
    ]
  }
]
```
No new runtime deps. `.vscodeignore` unaffected.

## 9. Error handling
- **No language model** → friendly note + `deterministicFallback`. No throw.
- **`LanguageModelError`** mid-request → caught; friendly markdown. No rethrow.
- **Cancellation** honored in the streaming loop.
- **Unknown slash arg** → deterministic "unknown … / here's the list".
- **Missing Chat API** on host → `registerChatParticipant` no-ops via guard.
- The participant only ever reads; it never writes files and is therefore safe in
  untrusted workspaces (C3).

## 10. Testing

### 10.1 Unit — `src/core/triton-kb/chat.test.ts` (vitest)
- `buildSystemPrompt`: contains a KB token always; contains project name iff `ctx`;
  contains the no-project marker iff `!ctx`.
- `renderConfigCommand`: known var full detail; unknown → not-found + list; empty
  arg → all 9 sections present.
- `renderFilesCommand`: grouped list (6 categories); single id; unknown id.
- `renderProjectCommand`: with `ctx` → block; without → no-project message.
- `renderDefaultsCommand`: includes the 5 conflict names; includes a defaults
  reference.
- `suggestFollowups`: non-empty, ≤ 4, varies with project presence.
- `deterministicFallback`: known var → detail; unknown → slash-command pointer.
- `listConflicts` (in an existing/new queries test): returns exactly the 5.
- `purity.test.ts` (existing) keeps `chat.ts` `vscode`-free — no change needed; it
  scans the whole directory.

### 10.2 Integration — `src/test/integration/chat-participant.test.ts` (@vscode/test-electron, BDD `describe`/`it`)
Drive `createChatHandler` directly with fakes (mirrors `ai-instructions.test.ts`):
- A fake `ChatResponseStream` capturing `markdown` calls.
- A fake `LanguageModelChat` whose `sendRequest` returns a fixed async-iterable `text`.
- A fake controller/store (`state: 'ready'`, `current: parsed()`), and a second
  pair with no project.

Assertions:
- `/config courant` streams the variable detail and **does not** call the model.
- Default prompt with a fake model: the model receives a leading message
  containing the KB; streamed fragments are forwarded to `stream.markdown`;
  handler resolves without throwing.
- `resolveModel` returning `undefined` → fallback note streamed; model never called.
- No-project controller + `/project` → no-project message.
- A smoke `it` that `registerChatParticipant` wires against a fake
  `ExtensionContext` without throwing (and no-ops if `vscode.chat` is absent).

No public API enumerates participants, and `vscode.lm` has no headless provider,
so the DI'd handler carries the real coverage — same constraint and approach as
M2a.

## 11. Acceptance criteria
1. `@triton <q>` (no slash) answers via the user's model, grounded in KB + project context.
2. `/config`, `/files`, `/project`, `/defaults` each answer deterministically with **no** model.
3. No project open → general KB + `/config`/`/files`/`/defaults` still work; `/project` and project-specific questions note no project (C3).
4. No language model available → friendly fallback, slash commands still work, no crash.
5. `src/core/triton-kb/chat.ts` imports no `vscode` (purity test green).
6. `engines.vscode` and `@types/vscode` are `^1.95.0`; zero new runtime dependencies.
7. Streaming output and the cancellation token are honored.
8. `listConflicts()` returns exactly the 5 documented template-vs-UI conflicts.
9. Full gauntlet green: `check`, `lint`, unit (vitest), integration (@vscode/test-electron).
10. The `chatParticipants` contribution is present and well-formed (`id: triforge.triton`, four commands).

## 12. Manual E2E (added to the M1/M2 manual plan)
- **M2B-CHAT-01** Open a trusted project; `@triton what does courant control and is mine safe?` → grounded conversational answer (requires a language model / Copilot).
- **M2B-CHAT-02** `@triton /config courant`, `/files`, `/files esri-ascii-dem`, `/project`, `/defaults` → correct deterministic markdown, no model needed.
- **M2B-CHAT-03** In a folder with no Triton project: `@triton /config courant` works; `@triton /project` reports no project; a free-form question answers generally and notes project-specifics unavailable.
- **M2B-CHAT-04** With no language model installed/consented: a free-form `@triton` question returns the friendly fallback; slash commands still work.
- **M2B-CHAT-05** Follow-up suggestions appear and are relevant; clicking one re-asks `@triton`.
```
