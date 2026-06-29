export type InputFormat = 'ASC' | 'BIN';
export type OutputFormat = 'ASC' | 'BIN' | 'GTIFF';

export const INPUT_FORMATS: readonly string[] = ['ASC', 'BIN'];
export const OUTPUT_FORMATS: readonly string[] = ['ASC', 'BIN', 'GTIFF'];
export const CURRENT_SCHEMA_VERSION = 1;

export interface TriforgeManifest {
  schemaVersion: number;
  project: { name: string; description: string; createdAt: string; modifiedAt: string };
  spatial: {
    crs: string; utmZone: string; datum: string;
    grid?: { ncols: number; nrows: number; cellsize: number; xll: number; yll: number };
  };
  io: { inputFormat: InputFormat; outputFormat: OutputFormat };
  paths: { inputDir: string; outputDir: string; buildDir: string };
}

export type UnknownSections = Record<string, unknown>;

export interface ParsedManifest {
  manifest: TriforgeManifest;
  unknownSections: UnknownSections;
}

export interface ValidationError { field: string; message: string }

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

export type Clock = () => string; // returns an ISO-8601 timestamp
export const systemClock: Clock = () => new Date().toISOString();

export type ProjectStateKind = 'none' | 'needsImport' | 'ready' | 'invalid';

export interface CreationInput {
  name: string;
  description?: string;
  utmZone?: string;
  datum?: string;
  crs?: string;
  inputFormat?: string;
  outputFormat?: string;
}
