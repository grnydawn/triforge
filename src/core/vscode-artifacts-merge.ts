/** Pure zero-dependency merge of triforge's artifacts into existing .vscode JSON(C) files.
 *  No `vscode`, no `fs` — see src/core/purity.test.ts. The adapter handles fs + backup. */
import { VsCodeTask, CMAKE_BUILD_LABEL } from './execution-artifacts';

/** Thrown when an existing tasks.json/settings.json cannot be parsed even after stripping JSONC. */
export class MalformedJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedJsonError';
  }
}

/** Settings keys this command owns (the keys buildCmakeSettings can emit). */
const MANAGED_SETTING_KEYS = ['cmake.sourceDirectory', 'cmake.buildDirectory'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTriforgeOwnedTask(label: unknown): boolean {
  return typeof label === 'string' && (label === CMAKE_BUILD_LABEL || label.startsWith('TRITON:'));
}

/** String/escape-aware removal of // line and block comments and trailing commas,
 *  so a commented VS Code JSONC file parses with JSON.parse. Does not validate JSON. */
export function stripJsonc(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  let inStr = false;

  const dropTrailingCommaBefore = (): void => {
    let j = out.length - 1;
    while (j >= 0 && /\s/.test(out[j])) j--;
    if (j >= 0 && out[j] === ',') out.splice(j, 1);
  };

  while (i < n) {
    const c = text[i];
    if (inStr) {
      out.push(c);
      if (c === '\\' && i + 1 < n) { out.push(text[i + 1]); i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out.push(c); i++; continue; }
    if (c === '/' && text[i + 1] === '/') { i += 2; while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '}' || c === ']') dropTrailingCommaBefore();
    out.push(c);
    i++;
  }
  return out.join('');
}

function parseTolerant(existing: string | undefined, what: string): Record<string, unknown> {
  const trimmed = (existing ?? '').trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(trimmed));
  } catch {
    throw new MalformedJsonError(`existing ${what} is not valid JSON/JSONC`);
  }
  if (!isPlainObject(parsed)) throw new MalformedJsonError(`existing ${what} is not a JSON object`);
  return parsed;
}

/** Merge triforge's tasks into an existing tasks.json string (undefined → fresh). */
export function mergeTasksJson(existing: string | undefined, tasks: VsCodeTask[]): string {
  const root = parseTolerant(existing, 'tasks.json');
  if (typeof root.version !== 'string') root.version = '2.0.0';
  const prior = Array.isArray(root.tasks) ? root.tasks : [];
  const kept = prior.filter((t) => !(isPlainObject(t) && isTriforgeOwnedTask(t.label)));
  root.tasks = [...kept, ...tasks];
  return JSON.stringify(root, null, 2) + '\n';
}

/** Merge cmake.* settings into an existing settings.json string (undefined → fresh). */
export function mergeSettingsJson(existing: string | undefined, settings: Record<string, unknown>): string {
  const root = parseTolerant(existing, 'settings.json');
  for (const k of MANAGED_SETTING_KEYS) delete root[k];
  Object.assign(root, settings);
  return JSON.stringify(root, null, 2) + '\n';
}
