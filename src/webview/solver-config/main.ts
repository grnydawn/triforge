// Runs inside the sandboxed webview. Talks to the host only via postMessage.
// Imports the model TYPE only (erased by esbuild — no core code enters this bundle).
import type { ConfigFormModel, ConfigFormField } from '../../core/triton-files/config-form';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscodeApi = acquireVsCodeApi();

const root = () => document.getElementById('root') as HTMLDivElement;
const statusEl = () => document.getElementById('status') as HTMLDivElement;
let fieldNames: string[] = [];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function fieldControl(f: ConfigFormField): string {
  const id = `f_${escapeAttr(f.name)}`;
  if (f.valueType === 'enum' && f.allowed) {
    const valueInAllowed = f.allowed.includes(f.value);
    // If the stored value is not in the allowed list, render an explicit option so the
    // browser does not silently coerce it to the first allowed value on collectEdited().
    const outOfRangeOpt = !valueInAllowed
      ? `<option value="${escapeAttr(f.value)}" selected>${escapeHtml(f.value)} (out-of-range)</option>`
      : '';
    const opts = f.allowed
      .map((a) => `<option value="${escapeAttr(a)}"${a === f.value ? ' selected' : ''}>${escapeHtml(a)}</option>`)
      .join('');
    return `<select id="${id}">${outOfRangeOpt}${opts}</select>`;
  }
  const type = f.valueType === 'int' || f.valueType === 'float' ? 'number' : 'text';
  return `<input id="${id}" type="${type}" value="${escapeAttr(f.value)}" />`;
}

function render(model: ConfigFormModel): void {
  fieldNames = [];
  root().innerHTML = model.sections.map((section) => {
    const rows = section.fields.map((f) => {
      fieldNames.push(f.name);
      const unit = f.unit ? `<span class="unit">${escapeHtml(f.unit)}</span>` : '';
      const badge = f.conflictNote ? `<span class="badge" title="${escapeAttr(f.conflictNote)}">⚠ conflict</span>` : '';
      const hint = f.details ? `<div class="hint">${escapeHtml(f.details)}</div>` : '';
      return `<div class="field"><label for="f_${escapeAttr(f.name)}">${escapeHtml(f.name)}${unit} ${badge}</label>${fieldControl(f)}${hint}</div>`;
    }).join('');
    return `<details open><summary>${escapeHtml(section.title)}</summary>${rows}</details>`;
  }).join('');
}

function collectEdited(): Record<string, string> {
  const edited: Record<string, string> = {};
  for (const name of fieldNames) {
    const el = document.getElementById('f_' + name) as HTMLInputElement | HTMLSelectElement | null;
    if (el) edited[name] = el.value;
  }
  return edited;
}

function disableSave(): void {
  (document.getElementById('save') as HTMLButtonElement).disabled = true;
  statusEl().textContent = 'Workspace is untrusted — saving is disabled.';
}

(document.getElementById('save') as HTMLButtonElement).addEventListener('click', () => {
  statusEl().classList.remove('error');
  statusEl().textContent = '';
  vscodeApi.postMessage({ command: 'save', edited: collectEdited() });
});

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.command === 'load') { render(msg.model as ConfigFormModel); if (!msg.trusted) disableSave(); }
  if (msg.command === 'saved') { statusEl().classList.remove('error'); statusEl().textContent = msg.summary ?? 'Saved.'; }
  if (msg.command === 'error') { statusEl().classList.add('error'); statusEl().textContent = msg.message ?? 'Error.'; }
});
