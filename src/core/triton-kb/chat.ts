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
    out.push(`- \`${v.name}\` — template default \`${v.defaultValue || '(empty)'}\`, reference UI default \`${v.uiValue ?? '(unknown)'}\`. ${v.note}`);
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
