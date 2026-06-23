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

/** Map a UTM EPSG code to its zone/hemisphere/datum (inverse of deriveCrs's arithmetic), or null. */
export function epsgToUtm(epsg: number): { zone: number; hemisphere: 'N' | 'S'; datum: 'WGS84' | 'NAD83' } | null {
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, hemisphere: 'N', datum: 'WGS84' };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, hemisphere: 'S', datum: 'WGS84' };
  if (epsg >= 26901 && epsg <= 26960) return { zone: epsg - 26900, hemisphere: 'N', datum: 'NAD83' };
  return null;
}

/**
 * Inverse UTM (Snyder series) → geographic lon/lat in degrees, for the WGS84/NAD83
 * UTM families (the only CRSs TRITON uses). Uses the WGS84 ellipsoid (NAD83/GRS80
 * differs by <1 mm, negligible for extent reporting). Throws on a non-UTM EPSG.
 */
export function utmToLonLat(easting: number, northing: number, epsg: number): { lon: number; lat: number } {
  const u = epsgToUtm(epsg);
  if (!u) throw new Error(`utmToLonLat: unsupported EPSG ${epsg} (only WGS84/NAD83 UTM)`);
  const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = easting - 500000;
  const y = u.hemisphere === 'N' ? northing : northing - 10000000;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sp = Math.sin(phi1), cp = Math.cos(phi1), tp = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sp * sp);
  const T1 = tp * tp, C1 = ep2 * cp * cp;
  const R1 = a * (1 - e2) / (1 - e2 * sp * sp) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * tp / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon0 = (u.zone * 6 - 183) * Math.PI / 180;
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / cp;
  return { lon: lon * 180 / Math.PI, lat: lat * 180 / Math.PI };
}
