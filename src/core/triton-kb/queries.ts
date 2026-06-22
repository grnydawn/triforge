import { ConfigVariable, TritonFileType } from './types';
import { CONFIG_VARIABLES, FILE_TYPES, CONFLICT } from './data';

export function listConfigVariables(): ConfigVariable[] {
  return CONFIG_VARIABLES;
}

export function lookupConfigVariable(name: string): ConfigVariable | undefined {
  const key = (name ?? '').trim().toLowerCase();
  return CONFIG_VARIABLES.find((v) => v.name.toLowerCase() === key);
}

export function getConfigVariablesBySection(section: string): ConfigVariable[] {
  return CONFIG_VARIABLES.filter((v) => v.section === section);
}

/**
 * The template-vs-UI conflicts: variables whose note carries the structured
 * CONFLICT marker (the sibling discriminator to INFERRED). Everything else with
 * a note is the 'inferred / undocumented' family. Derived from the data (C6) —
 * never a hardcoded list, and not coupled to incidental note wording.
 */
export function listConflicts(): ConfigVariable[] {
  return CONFIG_VARIABLES.filter((v) => !!v.note && v.note.includes(CONFLICT));
}

export function listFileTypes(): TritonFileType[] {
  return FILE_TYPES;
}

export function lookupFileType(id: string): TritonFileType | undefined {
  const key = (id ?? '').trim().toLowerCase();
  return FILE_TYPES.find((f) => f.id.toLowerCase() === key);
}

import { ParsedManifest } from '../types';
import { ProjectContext } from './types';
import { deriveCrs } from '../crs';

export function deriveProjectContext(parsed: ParsedManifest): ProjectContext {
  const m = parsed.manifest;
  const derived = deriveCrs(m.spatial.utmZone, m.spatial.datum);
  const ctx: ProjectContext = {
    name: m.project.name,
    description: m.project.description,
    crs: m.spatial.crs,
    utmZone: m.spatial.utmZone,
    datum: m.spatial.datum,
    inputFormat: m.io.inputFormat,
    outputFormat: m.io.outputFormat,
    inputDir: m.paths.inputDir,
    outputDir: m.paths.outputDir,
    buildDir: m.paths.buildDir,
    hasImportedLegacy: Boolean(parsed.unknownSections['_importedFrom']),
  };
  if (derived) ctx.derivedCrs = derived;
  return ctx;
}
