// web/src/lib/mapTileCache.ts: Offline Map Tile Pre-caching & Management for Disaster Resilience

const TILE_CACHE_NAME = 'tossa-tiles-v1';

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface TileCoordinate {
  x: number;
  y: number;
  z: number;
  url: string;
}

export interface TileCacheStats {
  count: number;
  estimatedSizeMB: number;
}

export interface DownloadProgress {
  total: number;
  loaded: number;
  percent: number;
}

export interface DownloadResult {
  total: number;
  downloaded: number;
  skipped: number;
  success: boolean;
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
  delayMs?: number;
}

/**
 * Converts longitude and zoom level to Slippy Map tile X coordinate.
 */
export function lon2tile(lon: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  return Math.max(0, Math.min(n - 1, x));
}

/**
 * Converts latitude and zoom level to Slippy Map tile Y coordinate.
 */
export function lat2tile(lat: number, zoom: number): number {
  // Clamp latitude between -85.0511 and 85.0511 to avoid Mercator projection infinities
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return Math.max(0, Math.min(n - 1, y));
}

/**
 * Converts tile X coordinate and zoom to longitude (north-west corner).
 */
export function tile2lon(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}

/**
 * Converts tile Y coordinate and zoom to latitude (north-west corner).
 */
export function tile2lat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Generates OpenStreetMap tile URL for a given (x, y, z).
 * Cycles through subdomains a, b, c to distribute requests.
 */
function getTileUrl(x: number, y: number, z: number): string {
  const subdomains = ['a', 'b', 'c'];
  const s = subdomains[(x + y) % subdomains.length];
  return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/**
 * Computes all tile coordinates needed to cover a bounding box across zoom levels.
 * Caps maximum generated tiles to safeguard network and device storage.
 */
export function getTilesForBounds(
  bounds: MapBounds,
  minZoom: number,
  maxZoom: number,
  maxTiles = 1500
): TileCoordinate[] {
  const tiles: TileCoordinate[] = [];

  const startZoom = Math.max(0, Math.min(minZoom, maxZoom));
  const endZoom = Math.min(19, Math.max(minZoom, maxZoom));

  for (let z = startZoom; z <= endZoom; z++) {
    const minX = lon2tile(bounds.west, z);
    const maxX = lon2tile(bounds.east, z);
    // Note: in Mercator tile coordinates, north has lower Y and south has higher Y
    const minY = lat2tile(bounds.north, z);
    const maxY = lat2tile(bounds.south, z);

    const xStart = Math.min(minX, maxX);
    const xEnd = Math.max(minX, maxX);
    const yStart = Math.min(minY, maxY);
    const yEnd = Math.max(minY, maxY);

    for (let x = xStart; x <= xEnd; x++) {
      for (let y = yStart; y <= yEnd; y++) {
        tiles.push({
          x,
          y,
          z,
          url: getTileUrl(x, y, z),
        });

        if (tiles.length >= maxTiles) {
          return tiles;
        }
      }
    }
  }

  return tiles;
}

/**
 * Checks if the browser Cache API is available.
 */
function isCacheAvailable(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

/**
 * Retrieves the count and estimated storage size of currently cached map tiles.
 */
export async function getTileCacheStats(): Promise<TileCacheStats> {
  if (!isCacheAvailable()) {
    return { count: 0, estimatedSizeMB: 0 };
  }

  try {
    const cache = await caches.open(TILE_CACHE_NAME);
    const requests = await cache.keys();
    const count = requests.length;
    // Average OSM PNG tile is approximately 15 KB
    const estimatedSizeMB = Math.round((count * 15 * 10) / 1024) / 10;
    return { count, estimatedSizeMB };
  } catch (err) {
    console.warn('Failed to get tile cache stats:', err);
    return { count: 0, estimatedSizeMB: 0 };
  }
}

/**
 * Downloads a list of tiles into the tile cache with concurrency limits and progress reporting.
 */
export async function downloadTiles(
  tiles: TileCoordinate[],
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  if (!isCacheAvailable() || tiles.length === 0) {
    return { total: tiles.length, downloaded: 0, skipped: 0, success: false };
  }

  const { onProgress, signal, concurrency = 4, delayMs = 25 } = options;

  let downloaded = 0;
  let skipped = 0;
  let loaded = 0;
  const total = tiles.length;

  try {
    const cache = await caches.open(TILE_CACHE_NAME);

    // Filter out tiles that are already in the cache
    const toDownload: TileCoordinate[] = [];

    for (const tile of tiles) {
      if (signal?.aborted) {
        return { total, downloaded, skipped, success: false };
      }

      const match = await cache.match(tile.url);
      if (match) {
        skipped++;
        loaded++;
        if (onProgress) {
          onProgress({
            total,
            loaded,
            percent: Math.round((loaded / total) * 100),
          });
        }
      } else {
        toDownload.push(tile);
      }
    }

    // Download remaining tiles with concurrency limit
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < toDownload.length) {
        if (signal?.aborted) return;
        const index = cursor++;
        const tile = toDownload[index];
        if (!tile) break;

        try {
          // Polite delay between batch fetches
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }

          const response = await fetch(tile.url, {
            signal,
            mode: 'cors',
          });

          if (response.ok || response.type === 'opaque') {
            await cache.put(tile.url, response.clone());
            downloaded++;
          }
        } catch (fetchErr) {
          if (signal?.aborted) return;
          console.warn(`Failed to cache tile ${tile.url}:`, fetchErr);
        } finally {
          loaded++;
          if (onProgress) {
            onProgress({
              total,
              loaded,
              percent: Math.round((loaded / total) * 100),
            });
          }
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, toDownload.length) },
      () => worker()
    );
    await Promise.all(workers);

    return {
      total,
      downloaded,
      skipped,
      success: !signal?.aborted,
    };
  } catch (err) {
    console.error('Error downloading tiles:', err);
    return { total, downloaded, skipped, success: false };
  }
}

/**
 * Clears all cached map tiles from storage.
 */
export async function clearTileCache(): Promise<boolean> {
  if (!isCacheAvailable()) return false;
  try {
    await caches.delete(TILE_CACHE_NAME);
    return true;
  } catch (err) {
    console.error('Failed to clear tile cache:', err);
    return false;
  }
}
