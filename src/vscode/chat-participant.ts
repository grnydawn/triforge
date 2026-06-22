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
