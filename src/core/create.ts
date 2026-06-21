import { CreationInput, Result, ParsedManifest, ValidationError, Clock, systemClock, INPUT_FORMATS, OUTPUT_FORMATS } from './types';
import { deriveCrs } from './crs';
import { applyDefaults, validate } from './schema';

export function buildManifest(input: CreationInput, now: Clock = systemClock): Result<ParsedManifest> {
  const errors: ValidationError[] = [];

  const name = (input.name ?? '').trim();
  if (!name) errors.push({ field: 'project.name', message: 'Project name is required.' });

  let crs = (input.crs ?? '').trim();
  if (crs) {
    if (!/^EPSG:\d+$/.test(crs)) {
      errors.push({ field: 'spatial.crs', message: `CRS must look like "EPSG:32616" (got "${crs}").` });
    }
  } else if ((input.utmZone ?? '').trim() && (input.datum ?? '').trim()) {
    crs = deriveCrs(input.utmZone as string, input.datum as string);
  }

  const inputFormat = (input.inputFormat ?? 'BIN').toUpperCase();
  if (!INPUT_FORMATS.includes(inputFormat)) {
    errors.push({ field: 'io.inputFormat', message: `inputFormat must be one of ${INPUT_FORMATS.join(', ')}.` });
  }
  const outputFormat = (input.outputFormat ?? 'ASC').toUpperCase();
  if (!OUTPUT_FORMATS.includes(outputFormat)) {
    errors.push({ field: 'io.outputFormat', message: `outputFormat must be one of ${OUTPUT_FORMATS.join(', ')}.` });
  }

  if (errors.length) return { ok: false, errors };

  const ts = now();
  const manifest = applyDefaults({
    project: { name, description: input.description ?? '', createdAt: ts, modifiedAt: ts },
    spatial: { crs, utmZone: (input.utmZone ?? '').trim(), datum: (input.datum ?? '').trim() },
    io: { inputFormat, outputFormat },
  }, now);

  const verrs = validate(manifest);
  if (verrs.length) return { ok: false, errors: verrs };
  return { ok: true, value: { manifest, unknownSections: {} } };
}
