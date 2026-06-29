import {
  TriforgeManifest, ValidationError, UnknownSections, Clock, systemClock,
  INPUT_FORMATS, OUTPUT_FORMATS, CURRENT_SCHEMA_VERSION,
} from './types';

export const KNOWN_TOP_KEYS = ['schemaVersion', 'project', 'spatial', 'io', 'paths'];

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function applyDefaults(input: any, now: Clock = systemClock): TriforgeManifest {
  const i = input ?? {};
  const p = i.project ?? {};
  const s = i.spatial ?? {};
  const io = i.io ?? {};
  const paths = i.paths ?? {};
  const ts = now();
  const sg = s.grid ?? {};
  const gridComplete = ['ncols', 'nrows', 'cellsize', 'xll', 'yll']
    .every((k) => typeof sg[k] === 'number' && Number.isFinite(sg[k]));
  const grid = gridComplete
    ? { ncols: sg.ncols, nrows: sg.nrows, cellsize: sg.cellsize, xll: sg.xll, yll: sg.yll }
    : undefined;
  return {
    schemaVersion: typeof i.schemaVersion === 'number' ? i.schemaVersion : CURRENT_SCHEMA_VERSION,
    project: {
      name: str(p.name, ''),
      description: str(p.description, ''),
      createdAt: str(p.createdAt, ts),
      modifiedAt: str(p.modifiedAt, ts),
    },
    spatial: { crs: str(s.crs, ''), utmZone: str(s.utmZone, ''), datum: str(s.datum, ''), ...(grid ? { grid } : {}) },
    io: {
      inputFormat: str(io.inputFormat, 'BIN') as TriforgeManifest['io']['inputFormat'],
      outputFormat: str(io.outputFormat, 'ASC') as TriforgeManifest['io']['outputFormat'],
    },
    paths: {
      inputDir: str(paths.inputDir, 'input'),
      outputDir: str(paths.outputDir, 'output'),
      buildDir: str(paths.buildDir, 'build'),
    },
  };
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export function validate(m: TriforgeManifest): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof m.schemaVersion !== 'number') {
    errors.push({ field: 'schemaVersion', message: 'schemaVersion must be a number.' });
  }
  if (!m.project || !m.project.name || !m.project.name.trim()) {
    errors.push({ field: 'project.name', message: 'project.name is required and must be non-empty.' });
  }
  if (!INPUT_FORMATS.includes(m.io.inputFormat)) {
    errors.push({ field: 'io.inputFormat', message: `io.inputFormat must be one of ${INPUT_FORMATS.join(', ')}.` });
  }
  if (!OUTPUT_FORMATS.includes(m.io.outputFormat)) {
    errors.push({ field: 'io.outputFormat', message: `io.outputFormat must be one of ${OUTPUT_FORMATS.join(', ')}.` });
  }
  for (const key of ['inputDir', 'outputDir', 'buildDir'] as const) {
    const v = m.paths[key];
    if (isAbsolutePath(v)) {
      errors.push({ field: `paths.${key}`, message: `paths.${key} must be a relative path (got "${v}").` });
    }
  }
  if (m.spatial.crs && !/^EPSG:\d+$/.test(m.spatial.crs)) {
    errors.push({ field: 'spatial.crs', message: `spatial.crs must look like "EPSG:32616" (got "${m.spatial.crs}").` });
  }
  if (m.spatial.grid) {
    const g = m.spatial.grid;
    if (!Number.isInteger(g.ncols) || !Number.isInteger(g.nrows) || g.ncols <= 0 || g.nrows <= 0) {
      errors.push({ field: 'spatial.grid', message: 'spatial.grid ncols/nrows must be positive integers.' });
    }
    if (!(g.cellsize > 0)) {
      errors.push({ field: 'spatial.grid.cellsize', message: 'spatial.grid.cellsize must be > 0.' });
    }
  }
  return errors;
}

export function splitUnknown(raw: Record<string, unknown>): UnknownSections {
  const out: UnknownSections = {};
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_KEYS.includes(key)) out[key] = raw[key];
  }
  return out;
}
