import { InputFormat, OutputFormat } from '../types';

/** A Triton run-config (triton_execution.cfg) variable. */
export interface ConfigVariable {
  name: string;          // e.g. "courant"
  section: string;       // one of SECTION_ORDER
  details: string;       // meaning; units; behavior
  valueType: 'int' | 'float' | 'enum' | 'path' | 'string';
  defaultValue: string;  // the template's literal value ('' when blank in the template)
  uiValue?: string;      // the reference creation UI's default, when it differs from defaultValue (a template-vs-UI conflict)
  allowed?: string[];    // for enums
  unit?: string;         // e.g. 'seconds', 'm', 'm³/s'
  note?: string;         // conflict-resolution note and/or 'inferred / undocumented'
}

/** A Triton project file type (static descriptive data — no detection code in M2a). */
export interface TritonFileType {
  id: string;            // unique kebab id, e.g. 'esri-ascii-dem'
  label: string;         // human label
  category: 'input raster' | 'forcing table' | 'config' | 'index' | 'metadata' | 'output raster';
  role: string;          // what it is in a Triton project
  format: string;        // header/columns/binary layout (descriptive)
  extensions: string[];  // e.g. ['.asc', '.dem']
  relatedVars: string[]; // config variable names that reference it
  note?: string;         // e.g. 'format undocumented'
}

/** Derived, render-ready project context (the OUTPUT shape — 11 fields). */
export interface ProjectContext {
  name: string;
  description: string;
  crs: string;            // manifest.spatial.crs (authoritative)
  derivedCrs?: string;    // deriveCrs(utmZone, datum), only when non-empty
  utmZone: string;
  datum: string;
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
  inputDir: string;
  outputDir: string;
  buildDir: string;
  hasImportedLegacy: boolean;
}

export type InstructionTarget = 'agents' | 'claude' | 'copilot' | 'gemini' | 'cursor';

/** Canonical render order for config sections (NOT alphabetical). */
export const SECTION_ORDER: readonly string[] = [
  'Simulation Control',
  'Surface Roughness (Manning’s n)',
  'Topography',
  'Initial Conditions',
  'Hydrologic Forcing',
  'External Boundaries',
  'Output Control',
  'Input and Output Formats',
  'Miscellaneous Parameters',
];

/** Canonical render order for file-type categories. */
export const CATEGORY_ORDER: readonly TritonFileType['category'][] = [
  'input raster', 'forcing table', 'config', 'index', 'metadata', 'output raster',
];
