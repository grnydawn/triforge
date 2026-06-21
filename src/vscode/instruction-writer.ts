import * as vscode from 'vscode';
import { ParsedManifest } from '../core/types';
import {
  InstructionTarget, deriveProjectContext, renderKnowledgeBaseMarkdown,
  renderTarget, spliceManagedRegion, KB_REL,
} from '../core/triton-kb';

const TARGET_PATHS: Record<InstructionTarget, string> = {
  agents: 'AGENTS.md',
  claude: 'CLAUDE.md',
  copilot: '.github/copilot-instructions.md',
  gemini: 'GEMINI.md',
  cursor: '.cursor/rules/triton.mdc',
};
const CURSOR_FRONTMATTER = '---\nalwaysApply: true\n---\n';

export interface RegenResult { written: string[]; skipped: string[]; }

export class InstructionWriter {
  constructor(private readonly canWrite: () => boolean = () => vscode.workspace.isTrusted) {}

  async regenerate(folder: vscode.Uri, parsed: ParsedManifest, targets: InstructionTarget[]): Promise<RegenResult> {
    const all = [KB_REL, ...targets.map((t) => TARGET_PATHS[t])];
    if (!this.canWrite()) return { written: [], skipped: all };

    const ctx = deriveProjectContext(parsed);
    const written: string[] = [];
    const skipped: string[] = [];

    // Knowledge base: always, whole-file.
    if (await this.writeIfChanged(folder, KB_REL, renderKnowledgeBaseMarkdown())) written.push(KB_REL);
    else skipped.push(KB_REL);

    for (const t of targets) {
      const rel = TARGET_PATHS[t];
      const block = renderTarget(t, ctx);
      const raw = await this.readRaw(folder, rel);
      let base: string | null = raw && raw.trim().length ? raw : null;
      if (t === 'cursor') base = ensureFrontmatter(base);
      const next = spliceManagedRegion(base, block);
      if (raw === next) { skipped.push(rel); continue; }
      await this.write(folder, rel, next);
      written.push(rel);
    }
    return { written, skipped };
  }

  private async readRaw(folder: vscode.Uri, rel: string): Promise<string | null> {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, rel))).toString('utf8');
    } catch { return null; }
  }

  private async writeIfChanged(folder: vscode.Uri, rel: string, content: string): Promise<boolean> {
    if ((await this.readRaw(folder, rel)) === content) return false;
    await this.write(folder, rel, content);
    return true;
  }

  private async write(folder: vscode.Uri, rel: string, content: string): Promise<void> {
    const slash = rel.lastIndexOf('/');
    if (slash !== -1) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, rel.slice(0, slash)));
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, rel), Buffer.from(content, 'utf8'));
  }
}

function ensureFrontmatter(base: string | null): string {
  if (base == null) return CURSOR_FRONTMATTER;
  if (base.startsWith('---')) return base;
  return `${CURSOR_FRONTMATTER}\n${base}`;
}
