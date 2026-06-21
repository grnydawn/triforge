import { Result, ParsedManifest, UnknownSections, Clock, systemClock, INPUT_FORMATS, OUTPUT_FORMATS } from './types';
import { deriveCrs } from './crs';
import { applyDefaults, validate } from './schema';

export function isLegacyConfig(parsed: unknown): boolean {
  return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && ('settings' in (parsed as object) || 'compsetup' in (parsed as object));
}

function toIso(v: unknown, fallback: string): string {
  if (typeof v === 'number' && isFinite(v)) return new Date(v).toISOString();
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
}

function normFormat(v: unknown, allowed: readonly string[], fallback: string): string {
  const s = String(v ?? '').toUpperCase();
  return allowed.includes(s) ? s : fallback;
}

export function importLegacy(parsed: any, now: Clock = systemClock): Result<ParsedManifest> {
  if (!isLegacyConfig(parsed)) {
    return { ok: false, errors: [{ field: '<file>', message: 'Not a recognizable legacy Triton config.json (no "settings"/"compsetup").' }] };
  }
  const s = parsed.settings ?? {};
  const name = String(s.name ?? '').trim();
  if (!name) {
    return { ok: false, errors: [{ field: 'settings.name', message: 'Legacy config has no project name; cannot import. Set settings.name and retry.' }] };
  }
  const ts = now();
  const utmZone = String(s.utmZone ?? '').trim();
  const datum = String(s.datum ?? '').trim();
  const manifest = applyDefaults({
    project: { name, description: '', createdAt: toIso(s.createdAt, ts), modifiedAt: toIso(s.lastModified, ts) },
    spatial: { crs: deriveCrs(utmZone, datum), utmZone, datum },
    io: { inputFormat: normFormat(s.input_format, INPUT_FORMATS, 'BIN'), outputFormat: normFormat(s.output_format, OUTPUT_FORMATS, 'ASC') },
  }, now);

  const errors = validate(manifest);
  if (errors.length) return { ok: false, errors };

  const unknownSections: UnknownSections = { _importedFrom: 'config.json (legacy Triton v1.0.0)' };
  if ('input' in parsed) unknownSections.inputs = parsed.input;
  if ('output' in parsed) unknownSections.outputs = parsed.output;
  if ('compsetup' in parsed) unknownSections.computation = parsed.compsetup;
  if ('execution' in parsed) unknownSections.execution = parsed.execution;

  return { ok: true, value: { manifest, unknownSections } };
}
