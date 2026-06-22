import * as assert from 'assert';
import * as vscode from 'vscode';
import { createChatHandler, registerChatParticipant } from '../../vscode/chat-participant';
import { ProjectStateController } from '../../vscode/state';
import { ConfigStore } from '../../vscode/config-store';
import { ParsedManifest } from '../../core/types';
import { suggestFollowups, deriveProjectContext } from '../../core/triton-kb';

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

// ChatRequestTurn / ChatResponseTurn have private constructors, so we build genuine
// class instances via Object.create(...prototype) — this keeps the `turn instanceof
// vscode.ChatRequestTurn` / `... ChatResponseTurn` filtering in mapHistory() exercised
// against the real runtime classes (not a structural fake that would silently bypass it).
function requestTurn(prompt: string): vscode.ChatRequestTurn {
  const turn = Object.create(vscode.ChatRequestTurn.prototype) as { prompt: string };
  turn.prompt = prompt;
  return turn as unknown as vscode.ChatRequestTurn;
}

function responseTurn(...markdown: string[]): vscode.ChatResponseTurn {
  const turn = Object.create(vscode.ChatResponseTurn.prototype) as { response: unknown[] };
  turn.response = markdown.map((m) => new vscode.ChatResponseMarkdownPart(m));
  return turn as unknown as vscode.ChatResponseTurn;
}

function historyCtx(...turns: Array<vscode.ChatRequestTurn | vscode.ChatResponseTurn>): vscode.ChatContext {
  return { history: turns } as unknown as vscode.ChatContext;
}

// Extract the text carried by a LanguageModelChatMessage. On the stable LM API the
// content is normalized to an array of parts (each a text part with a `value`); older
// shapes used a plain string. Concatenate the text either way.
function messageText(msg: vscode.LanguageModelChatMessage): string {
  const content = (msg as unknown as { content: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part as { value?: unknown }).value))
      .filter((v): v is string => typeof v === 'string')
      .join('');
  }
  return String(content ?? '');
}

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

  it('maps prior turns into User/Assistant messages between the system prompt and the final prompt', async () => {
    const { controller, store } = controllers(true);
    let sent: vscode.LanguageModelChatMessage[] = [];
    const model = {
      sendRequest: async (messages: vscode.LanguageModelChatMessage[]) => {
        sent = messages;
        return { text: (async function* () { yield 'ok'; })() };
      },
    } as unknown as vscode.LanguageModelChat;
    const handler = createChatHandler(controller, store, { resolveModel: async () => model });
    const { stream } = fakeStream();

    const ctx = historyCtx(
      requestTurn('what is time_step?'),
      responseTurn('time_step controls ', 'the simulation timestep.'),
    );
    await handler(req('and is mine safe?'), ctx, stream, token);

    // [0] system prompt, [1] mapped User (prior request), [2] mapped Assistant (prior response), [3] final User prompt.
    assert.strictEqual(sent.length, 4);
    assert.ok(messageText(sent[0]).includes('courant'), 'system prompt embeds the KB');
    assert.ok(messageText(sent[1]).includes('what is time_step?'), 'prior request mapped to a User message');
    // ChatResponseMarkdownPart values are concatenated into one Assistant message.
    assert.ok(messageText(sent[2]).includes('time_step controls the simulation timestep.'),
      'prior response markdown parts concatenated into an Assistant message');
    assert.strictEqual(messageText(sent[3]), 'and is mine safe?', 'final user prompt is last');
  });

  it('historyLimit truncates older turns (keeps only the last N)', async () => {
    const { controller, store } = controllers(true);
    let sent: vscode.LanguageModelChatMessage[] = [];
    const model = {
      sendRequest: async (messages: vscode.LanguageModelChatMessage[]) => {
        sent = messages;
        return { text: (async function* () { yield 'ok'; })() };
      },
    } as unknown as vscode.LanguageModelChat;
    const handler = createChatHandler(controller, store, { resolveModel: async () => model, historyLimit: 2 });
    const { stream } = fakeStream();

    // Four prior turns; with historyLimit 2 only the last two (q3 request + its response) survive .slice(-limit).
    const ctx = historyCtx(
      requestTurn('q1-oldest'),
      responseTurn('a1-oldest'),
      requestTurn('q3-newest'),
      responseTurn('a3-newest'),
    );
    await handler(req('final-prompt'), ctx, stream, token);

    const joined = sent.map(messageText).join('\n');
    assert.ok(!joined.includes('q1-oldest'), 'oldest request truncated');
    assert.ok(!joined.includes('a1-oldest'), 'oldest response truncated');
    assert.ok(joined.includes('q3-newest'), 'most recent request retained');
    assert.ok(joined.includes('a3-newest'), 'most recent response retained');
    // system prompt + 2 retained turns + final prompt.
    assert.strictEqual(sent.length, 4);
    assert.strictEqual(messageText(sent[sent.length - 1]), 'final-prompt');
  });

  it('falls back gracefully when no model is available', async () => {
    const { controller, store } = controllers(true);
    const handler = createChatHandler(controller, store, { resolveModel: async () => undefined });
    const { stream, chunks } = fakeStream();
    await handler(req('explain my setup'), chatCtx, stream, token);
    assert.ok(/no language model/i.test(chunks.join('')));
  });

  it('renders graceful degradation guidance when sendRequest rejects with a LanguageModelError', async () => {
    const { controller, store } = controllers(true);
    // A genuine vscode.LanguageModelError instance (via the static factory) so the
    // adapter's `err instanceof vscode.LanguageModelError` branch is exercised against
    // the real runtime class, not a structural fake.
    const lmError = vscode.LanguageModelError.NoPermissions('user has not consented');
    const model = {
      sendRequest: async () => { throw lmError; },
    } as unknown as vscode.LanguageModelChat;
    const handler = createChatHandler(controller, store, { resolveModel: async () => model });
    const { stream, chunks } = fakeStream();
    const result = await handler(req('what is courant?'), chatCtx, stream, token);
    const out = chunks.join('');
    // Graceful note instead of a thrown error: 'could not complete' guidance + the slash-command list.
    assert.ok(/could not complete/i.test(out), 'streams the could-not-complete guidance');
    assert.ok(out.includes(lmError.code || lmError.message), 'surfaces the LM error code/message');
    for (const cmd of ['/config', '/files', '/project', '/defaults']) {
      assert.ok(out.includes(cmd), `points the user at ${cmd}`);
    }
    // Handler still resolves normally (never rethrows for an LM error).
    assert.deepStrictEqual(result, { metadata: { command: 'chat' } });
  });

  it('re-throws when sendRequest rejects with a non-LanguageModelError', async () => {
    const { controller, store } = controllers(true);
    const boom = new Error('network exploded');
    const model = {
      sendRequest: async () => { throw boom; },
    } as unknown as vscode.LanguageModelChat;
    const handler = createChatHandler(controller, store, { resolveModel: async () => model });
    const { stream } = fakeStream();
    await assert.rejects(
      // The handler is async; wrap in Promise.resolve so its broader ProviderResult
      // return type still satisfies assert.rejects' Promise-returning thunk signature.
      async () => { await handler(req('what is courant?'), chatCtx, stream, token); },
      (err: unknown) => err === boom,
      'non-LanguageModelError rejections propagate unchanged',
    );
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

  it('followupProvider extracts result.metadata.command and maps suggestFollowups to {prompt,label}', async () => {
    const { controller, store } = controllers(true);
    const subscriptions: { dispose(): void }[] = [];
    const context = {
      subscriptions,
      extensionUri: vscode.Uri.file('/tmp/ext'),
    } as unknown as vscode.ExtensionContext;
    const participant = registerChatParticipant(context, controller, store);
    if (!participant) {
      // Host without the Chat API (guard returned undefined) — nothing to assert.
      return;
    }
    try {
      const provider = participant.followupProvider;
      assert.ok(provider, 'a followupProvider is wired');

      // Invoke provideFollowups with a fake result carrying metadata.command,
      // mirroring what VS Code passes after a turn completes.
      const result = { metadata: { command: 'config' } } as unknown as vscode.ChatResult;
      const followups = await provider.provideFollowups(
        result,
        chatCtx,
        token,
      );

      // Mapping shape: each entry is { prompt, label } and matches the core output
      // for the same command + live project context. controllers(true) opens a project,
      // so the adapter derives ctx from the same manifest via deriveProjectContext(parsed()).
      const expected = suggestFollowups('config', deriveProjectContext(parsed()));
      assert.ok(Array.isArray(followups), 'returns an array');
      const arr = followups as Array<{ prompt: string; label?: string }>;
      assert.strictEqual(arr.length, expected.length, 'one followup per suggestFollowups entry');
      arr.forEach((f, i) => {
        assert.strictEqual(f.prompt, expected[i], `prompt[${i}] matches suggestFollowups`);
        assert.strictEqual(f.label, expected[i], `label[${i}] equals the prompt`);
      });
    } finally {
      participant.dispose();
    }
  });
});
