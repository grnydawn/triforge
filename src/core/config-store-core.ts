import { Result, ParsedManifest, TriforgeManifest, UnknownSections, Clock, systemClock } from './types';
import { applyDefaults, validate, splitUnknown } from './schema';

export function parse(raw: string, now: Clock = systemClock): Result<ParsedManifest> {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [{ field: '<file>', message: `triforge.json is not valid JSON: ${(e as Error).message}` }] };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { ok: false, errors: [{ field: '<root>', message: 'triforge.json must contain a JSON object.' }] };
  }
  const record = obj as Record<string, unknown>;
  const unknownSections = splitUnknown(record);
  const manifest = applyDefaults(record, now);
  const errors = validate(manifest);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { manifest, unknownSections } };
}

export function serialize(manifest: TriforgeManifest, unknownSections: UnknownSections = {}): string {
  const ordered: Record<string, unknown> = {
    schemaVersion: manifest.schemaVersion,
    project: manifest.project,
    spatial: manifest.spatial,
    io: manifest.io,
    paths: manifest.paths,
    ...unknownSections,
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

export function touchModified(parsed: ParsedManifest, now: Clock = systemClock): ParsedManifest {
  return {
    manifest: { ...parsed.manifest, project: { ...parsed.manifest.project, modifiedAt: now() } },
    unknownSections: parsed.unknownSections,
  };
}
