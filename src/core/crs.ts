/**
 * Best-effort canonical-CRS derivation from a UTM zone + datum.
 * Returns an "EPSG:nnnnn" string, or "" when it cannot derive one
 * (empty is non-fatal per the spec — the user can set the CRS manually).
 */
export function deriveCrs(utmZone: string, datum: string): string {
  const m = /^([1-9]|[1-5][0-9]|60)([NS])$/.exec((utmZone ?? '').trim());
  if (!m) return '';
  const zone = parseInt(m[1], 10);
  const hemi = m[2]; // 'N' | 'S'
  const d = (datum ?? '').trim().toUpperCase();
  if (d === 'WGS84') return `EPSG:${(hemi === 'N' ? 32600 : 32700) + zone}`;
  if (d === 'NAD83') return hemi === 'N' ? `EPSG:${26900 + zone}` : '';
  return '';
}
