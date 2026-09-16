// web/src/lib/geoDistance.ts: Client-Side Haversine Distance, Bearing & Compass Utilities

/**
 * Earth radius in meters (mean radius)
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * Converts degrees to radians
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Converts radians to degrees
 */
function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculates the great-circle distance between two points on Earth using the Haversine formula.
 * Pure client-side computation, 100% offline capable.
 *
 * @param lat1 Latitude of origin in decimal degrees
 * @param lon1 Longitude of origin in decimal degrees
 * @param lat2 Latitude of destination in decimal degrees
 * @param lon2 Longitude of destination in decimal degrees
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_METERS * c);
}

/**
 * Formats a distance in meters to a human-readable localized string.
 * e.g., 45m, 350m, 1.2km, 15km
 */
export function formatDistance(meters: number): string {
  if (meters < 0) return '0m';
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  if (meters < 10000) {
    const km = (meters / 1000).toFixed(1);
    return `${km}km`;
  }
  return `${Math.round(meters / 1000)}km`;
}

/**
 * Calculates the initial bearing (forward azimuth) from point 1 to point 2 in degrees.
 * Returns a value in [0, 360) where 0° is True North, 90° East, 180° South, 270° West.
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);
  const bearing = (toDegrees(θ) + 360) % 360;

  return Math.round(bearing);
}

type CardinalDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

const CARDINAL_NAMES: Record<string, Record<CardinalDirection, string>> = {
  ja: {
    N: '北',
    NE: '北東',
    E: '東',
    SE: '南東',
    S: '南',
    SW: '南西',
    W: '西',
    NW: '北西',
  },
  'ja-easy': {
    N: 'きた',
    NE: 'ほくとう',
    E: 'ひがし',
    SE: 'なんとう',
    S: 'みなみ',
    SW: 'なんせい',
    W: 'にし',
    NW: 'ほくせい',
  },
  en: {
    N: 'N',
    NE: 'NE',
    E: 'E',
    SE: 'SE',
    S: 'S',
    SW: 'SW',
    W: 'W',
    NW: 'NW',
  },
};

/**
 * Returns the 8-point cardinal direction string for a given bearing in degrees.
 */
export function getCardinalDirection(
  bearing: number,
  locale: string = 'ja'
): string {
  const normalized = ((bearing % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  const directions: CardinalDirection[] = [
    'N',
    'NE',
    'E',
    'SE',
    'S',
    'SW',
    'W',
    'NW',
  ];
  const dirKey = directions[index] || 'N';

  const fallback = CARDINAL_NAMES['ja']!;
  const localeMap = CARDINAL_NAMES[locale] ?? fallback;
  return localeMap[dirKey] || dirKey;
}

/**
 * Calculates the relative angle for an orientation compass needle or arrow.
 * If device heading (degrees from North) is provided, calculates angle relative to user facing direction.
 */
export function getRelativeAngle(
  targetBearing: number,
  deviceHeading: number | null
): number {
  if (deviceHeading === null || isNaN(deviceHeading)) {
    return targetBearing;
  }
  return (targetBearing - deviceHeading + 360) % 360;
}
