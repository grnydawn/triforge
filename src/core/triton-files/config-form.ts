/** Pure projection of a parsed TRITON .cfg + the KB into a renderable form model. No I/O. */
import type { TritonConfig } from './types';
import { SECTION_ORDER, getConfigVariablesBySection, lookupConfigVariable, listConflicts } from '../triton-kb';

export type ConfigFieldKind = 'int' | 'float' | 'enum' | 'path' | 'string';

export interface ConfigFormField {
  name: string;            // cfg key, e.g. 'time_step'
  valueType: ConfigFieldKind;
  value: string;           // cfg value if present, else the KB default
  defaultValue: string;    // KB template default
  present: boolean;        // was the key in the parsed cfg?
  isPath: boolean;         // valueType === 'path'
  details: string;         // KB help text
  allowed?: string[];      // enum options
  unit?: string;           // e.g. 'seconds'
  conflictNote?: string;   // KB note for a template-vs-UI conflict var
}

export interface ConfigFormSection { title: string; fields: ConfigFormField[]; }
export interface ConfigFormModel { sections: ConfigFormSection[]; }

const UNKNOWN_SECTION = 'Unknown / custom';

/**
 * Build the full form model: every KB variable, grouped by SECTION_ORDER, each field
 * taking its value from the cfg when present (else the KB default). Cfg keys the KB does
 * not document go into a trailing 'Unknown / custom' section so nothing the user wrote is lost.
 */
export function buildConfigForm(cfg: TritonConfig): ConfigFormModel {
  const conflicts = new Set(listConflicts().map((v) => v.name));
  const sections: ConfigFormSection[] = [];

  for (const title of SECTION_ORDER) {
    const fields: ConfigFormField[] = [];
    for (const v of getConfigVariablesBySection(title)) {
      const present = Object.prototype.hasOwnProperty.call(cfg.entries, v.name);
      const field: ConfigFormField = {
        name: v.name,
        valueType: v.valueType,
        value: present ? cfg.entries[v.name] : v.defaultValue,
        defaultValue: v.defaultValue,
        present,
        isPath: v.valueType === 'path',
        details: v.details,
      };
      if (v.allowed) field.allowed = v.allowed;
      if (v.unit) field.unit = v.unit;
      if (conflicts.has(v.name) && v.note) field.conflictNote = v.note;
      fields.push(field);
    }
    if (fields.length > 0) sections.push({ title, fields });
  }

  const unknown: ConfigFormField[] = [];
  for (const key of cfg.order) {
    if (lookupConfigVariable(key)) continue;
    unknown.push({
      name: key,
      valueType: 'string',
      value: cfg.entries[key] ?? '',
      defaultValue: '',
      present: true,
      isPath: false,
      details: 'Custom key not documented in the knowledge base.',
    });
  }
  if (unknown.length > 0) sections.push({ title: UNKNOWN_SECTION, fields: unknown });

  return { sections };
}

/**
 * Compute the surgical `updates` map for editConfigText from edited field values.
 * Present key: cleared -> null (delete line); changed -> set; unchanged -> omitted.
 * Absent key: set to a non-empty, non-default value -> add; otherwise omitted (keep the file lean).
 * A field missing from `edited` keeps its current model value (no change).
 */
export function diffConfigEdits(model: ConfigFormModel, edited: Record<string, string>): Record<string, string | null> {
  const updates: Record<string, string | null> = {};
  for (const section of model.sections) {
    for (const field of section.fields) {
      const next = Object.prototype.hasOwnProperty.call(edited, field.name) ? edited[field.name] : field.value;
      if (field.present) {
        if (next === '') updates[field.name] = null;
        else if (next !== field.value) updates[field.name] = next;
      } else if (next !== '' && next !== field.defaultValue) {
        updates[field.name] = next;
      }
    }
  }
  return updates;
}
