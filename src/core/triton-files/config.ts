import { TritonConfig } from './types';

/** Parse a Triton run config (.cfg): # comments, key=value, surrounding double-quotes stripped. */
export function parseTritonConfig(text: string): TritonConfig {
  const entries: Record<string, string> = {};
  const order: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in entries)) order.push(key);
    entries[key] = value;
  }
  return { entries, order };
}
