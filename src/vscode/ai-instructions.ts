import * as vscode from 'vscode';
import { ProjectStateController } from './state';
import { ConfigStore } from './config-store';
import { InstructionWriter } from './instruction-writer';
import { InstructionTarget } from '../core/triton-kb';

const ALL_TARGETS: InstructionTarget[] = ['agents', 'claude', 'copilot', 'gemini', 'cursor'];
const KB_REL = 'docs/triton-knowledge.md';

export interface AiConfig { targets: InstructionTarget[]; autoRegenerate: boolean; }

export function readAiConfig(): AiConfig {
  const c = vscode.workspace.getConfiguration('triforge.ai');
  const raw = c.get<string[]>('instructionTargets', ['agents', 'claude', 'copilot']);
  return {
    targets: ALL_TARGETS.filter((t) => raw.includes(t)),
    autoRegenerate: c.get<boolean>('autoRegenerate', true),
  };
}

/** Injectable dependencies — defaults wire the real extension; tests inject fakes. */
export interface AiInstructionsDeps {
  writer?: InstructionWriter;
  readCfg?: () => AiConfig;
  debounceMs?: number;
  /** Subscribe to relevant settings changes. Injectable so the path is deterministically testable. */
  subscribeConfigChange?: (handler: () => void) => vscode.Disposable;
}

/**
 * Wire the debounced auto-regeneration funnel: onDidChangeState, onDidChangeConfig, and the
 * settings-change event ALL feed ONE debounced handler; idempotent skip-if-unchanged is the safety
 * net for the M1 event cascade. Returns disposables. Does NOT register commands, so it is safe to
 * invoke directly in tests without colliding with the activated extension's global command IDs.
 */
export function wireAutoRegeneration(
  controller: ProjectStateController,
  store: ConfigStore,
  deps: AiInstructionsDeps = {},
): vscode.Disposable[] {
  const writer = deps.writer ?? new InstructionWriter();
  const readCfg = deps.readCfg ?? readAiConfig;
  const debounceMs = deps.debounceMs ?? 250;
  const subscribeConfigChange = deps.subscribeConfigChange ??
    ((h: () => void) => vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('triforge.ai')) h(); }));

  let timer: NodeJS.Timeout | undefined;

  const runRegen = async (): Promise<void> => {
    if (controller.state !== 'ready' || !store.current || !controller.targetFolder) return;
    if (!vscode.workspace.isTrusted) return;
    await writer.regenerate(controller.targetFolder, store.current, readCfg().targets);
  };

  const schedule = (): void => {
    if (!readCfg().autoRegenerate) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void runRegen(); }, debounceMs);
  };

  return [
    controller.onDidChangeState(() => schedule()),
    store.onDidChangeConfig(() => schedule()),
    subscribeConfigChange(() => schedule()),
    { dispose: () => { if (timer) clearTimeout(timer); } },
  ];
}

/**
 * Register AI-instruction features: the debounced auto-regeneration funnel (via
 * wireAutoRegeneration) plus the two commands. Call ONCE, BEFORE controller.start(), so the initial
 * 'ready' transition triggers a regen. Commands are registered ONLY here (never inside the funnel),
 * so tests can exercise wireAutoRegeneration directly without "command already exists" errors.
 */
export function registerAiInstructions(
  context: vscode.ExtensionContext,
  controller: ProjectStateController,
  store: ConfigStore,
  deps: AiInstructionsDeps = {},
): void {
  const writer = deps.writer ?? new InstructionWriter();
  const readCfg = deps.readCfg ?? readAiConfig;

  context.subscriptions.push(...wireAutoRegeneration(controller, store, { ...deps, writer, readCfg }));

  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('triforge.generateAiInstructions', async () => {
    if (controller.state !== 'ready' || !store.current || !controller.targetFolder) {
      vscode.window.showWarningMessage('Triforge: open a Triforge project first.');
      return;
    }
    if (!vscode.workspace.isTrusted) {
      vscode.window.showInformationMessage('Triforge: workspace is untrusted — grant trust to write AI instruction files.');
      return;
    }
    const res = await writer.regenerate(controller.targetFolder, store.current, readCfg().targets);
    vscode.window.showInformationMessage(`Triforge: AI instructions — ${res.written.length} written, ${res.skipped.length} unchanged.`);
  });

  reg('triforge.openKnowledgeBase', async () => {
    const folder = controller.targetFolder;
    if (!folder) { vscode.window.showWarningMessage('Triforge: no project folder.'); return; }
    const uri = vscode.Uri.joinPath(folder, KB_REL);
    let present = true;
    try { await vscode.workspace.fs.stat(uri); } catch { present = false; }
    if (!present) {
      if (controller.state === 'ready' && store.current && vscode.workspace.isTrusted) {
        await writer.regenerate(folder, store.current, readCfg().targets);
      } else {
        vscode.window.showInformationMessage('Triforge: the Triton knowledge base is not available yet — open a trusted Triforge project, then try again.');
        return;
      }
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  });
}
