import * as vscode from 'vscode';
import { ProjectStateKind, TriforgeManifest } from './core/types';
import { samePath } from './core/paths';
import { ConfigStore } from './vscode/config-store';
import { ProjectStateController } from './vscode/state';
import { ProjectStatusView } from './vscode/project-view';
import { registerCommands, OPENED_VIA_TRIFORGE_KEY } from './vscode/commands';
import { registerAiInstructions } from './vscode/ai-instructions';
import { registerChatParticipant } from './vscode/chat-participant';

export interface TriforgeApi {
  getState(): ProjectStateKind;
  getManifest(): TriforgeManifest | undefined;
  isReadOnly(): boolean;
  onDidChangeState: vscode.Event<ProjectStateKind>;
}

export async function activate(context: vscode.ExtensionContext): Promise<TriforgeApi> {
  const store = new ConfigStore();
  const controller = new ProjectStateController(store);
  context.subscriptions.push(controller, store);

  const view = new ProjectStatusView(controller);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('triforge.status', view));

  registerCommands(context, controller, store);
  registerAiInstructions(context, controller, store);
  registerChatParticipant(context, controller, store);

  await controller.start();

  // Consume the one-shot "opened via Triforge open-action" flag: if this folder was opened
  // through triforge.openProjectFolder and has no manifest, auto-show the creation page.
  const flagged = context.globalState.get<string>(OPENED_VIA_TRIFORGE_KEY);
  const target = controller.targetFolder;
  if (flagged && target && samePath(flagged, target.fsPath, process.platform)) {
    await context.globalState.update(OPENED_VIA_TRIFORGE_KEY, undefined); // one-shot
    if (controller.state === 'none' || controller.state === 'needsImport') {
      await vscode.commands.executeCommand('triforge.createProject');
    }
  }

  return {
    getState: () => controller.state,
    getManifest: () => controller.manifest,
    isReadOnly: () => controller.isReadOnly,
    onDidChangeState: controller.onDidChangeState,
  };
}

export function deactivate(): void { /* disposables handled by context.subscriptions */ }
