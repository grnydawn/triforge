export type InputFormat = 'ASC' | 'BIN';
export type OutputFormat = 'ASC' | 'BIN' | 'GTIFF';

export const INPUT_FORMATS: readonly string[] = ['ASC', 'BIN'];
export const OUTPUT_FORMATS: readonly string[] = ['ASC', 'BIN', 'GTIFF'];
export const CURRENT_SCHEMA_VERSION = 2;

export const RUN_MODES = ['local', 'slurm'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface LocalConfig { numProcs: number; }            // mpirun -n N

export interface SlurmConfig {
  partition?: string;
  nodes?: number;
  ntasksPerNode?: number;
  gpusPerNode?: number;
  time?: string;                                              // walltime, e.g. '01:00:00'
  account?: string;
  extraDirectives?: string[];                                 // free-form #SBATCH lines
}

export interface ExecutionConfig {
  runMode: RunMode;                                           // default 'local'
  sourceDir?: string;                                         // TRITON git repo (for CMake Tools); may be absolute
  solverPath?: string;                                        // built triton binary (unset → M4j-4 derives <buildDir>/triton)
  configFile?: string;                                        // the run .cfg
  local?: LocalConfig;
  slurm?: SlurmConfig;
}

export interface TriforgeManifest {
  schemaVersion: number;
  project: { name: string; description: string; createdAt: string; modifiedAt: string };
  spatial: {
    crs: string; utmZone: string; datum: string;
    grid?: { ncols: number; nrows: number; cellsize: number; xll: number; yll: number };
  };
  io: { inputFormat: InputFormat; outputFormat: OutputFormat };
  paths: { inputDir: string; outputDir: string; buildDir: string };
  execution?: ExecutionConfig;
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
