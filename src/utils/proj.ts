import proj4 from 'proj4';
import type { CrsId } from '../types/cadastral';

// Register Taiwan TWD97 and TWD67 TM2 projections (121° central meridian)
proj4.defs(
  'EPSG:3826',
  '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);
proj4.defs(
  'EPSG:3828',
  '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +a=6378160 +rf=298.25 +towgs84=-752,-358,-179,-0.0000011698,0.0000018398,0.0000009822,0.00002329 +units=m +no_defs'
);

export const CRS_OPTIONS: {
  id: CrsId;
  shortLabel: string;
  fullLabel: string;
  zone: string;
}[] = [
  {
    id: 'EPSG:3826',
    shortLabel: 'TWD97 (121°)',
    fullLabel: 'TWD97 二度分帶 (121° · EPSG:3826)',
    zone: '121°E',
  },
  {
    id: 'EPSG:3828',
    shortLabel: 'TWD67 (121°)',
    fullLabel: 'TWD67 二度分帶 (121° · EPSG:3828)',
    zone: '121°E',
  },
];

/**
 * Convert planar TM2 (North, East) to WGS84 [lat, lng] for Leaflet.
 */
export function tmToWgs84(n: number, e: number, crs: CrsId): [number, number] {
  const [lng, lat] = proj4(crs, 'EPSG:4326', [e, n]);
  return [lat, lng];
}

/**
 * Convert WGS84 (lat, lng) to planar TM2 { n, e }.
 */
export function wgs84ToTm(lat: number, lng: number, crs: CrsId): { n: number; e: number } {
  const [e, n] = proj4('EPSG:4326', crs, [lng, lat]);
  return { n, e };
}

/**
 * Convert between TWD97 (EPSG:3826) and TWD67 (EPSG:3828).
 */
export function convertTm(
  n: number,
  e: number,
  fromCrs: CrsId,
  toCrs: CrsId
): { n: number; e: number } {
  if (fromCrs === toCrs) return { n, e };
  const [outE, outN] = proj4(fromCrs, toCrs, [e, n]);
  return { n: outN, e: outE };
}

/**
 * Build Google Maps external navigation deep link from TM2 coordinate.
 */
export function buildGoogleMapsNavUrl(n: number, e: number, crs: CrsId): string {
  const [lat, lng] = tmToWgs84(n, e, crs);
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(7)},${lng.toFixed(7)}`;
}
