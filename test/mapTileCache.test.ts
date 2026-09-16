// test/mapTileCache.test.ts: Unit Tests for Offline Map Tile Calculations & Caching
import { describe, it, expect, vi } from 'vitest';
import {
  lon2tile,
  lat2tile,
  tile2lon,
  tile2lat,
  getTilesForBounds,
  downloadTiles,
  type MapBounds,
} from '../web/src/lib/mapTileCache';

describe('Map Tile Slippy Math', () => {
  it('correctly converts coordinates to tile X and Y at zoom 0', () => {
    // Zoom 0 has exactly 1 tile: (0, 0)
    expect(lon2tile(0, 0)).toBe(0);
    expect(lat2tile(0, 0)).toBe(0);
    expect(lon2tile(139.69, 0)).toBe(0);
    expect(lat2tile(35.68, 0)).toBe(0);
  });

  it('correctly computes tile for Tokyo at zoom 10', () => {
    const tokyoLat = 35.6895;
    const tokyoLng = 139.6917;
    const zoom = 10;

    const tileX = lon2tile(tokyoLng, zoom);
    const tileY = lat2tile(tokyoLat, zoom);

    // Standard OSM tile for Tokyo at z10 is x=909, y=403
    expect(tileX).toBe(909);
    expect(tileY).toBe(403);
  });

  it('clamps coordinates to valid bounds at extreme coordinates', () => {
    const zoom = 5;
    const maxIndex = Math.pow(2, zoom) - 1; // 31

    expect(lon2tile(200, zoom)).toBe(maxIndex);
    expect(lon2tile(-200, zoom)).toBe(0);
    expect(lat2tile(90, zoom)).toBe(0);
    expect(lat2tile(-90, zoom)).toBe(maxIndex);
  });

  it('inverts tile coordinates back to approximate lat/lng', () => {
    const zoom = 12;
    const originalLat = 35.68;
    const originalLng = 139.75;

    const tileX = lon2tile(originalLng, zoom);
    const tileY = lat2tile(originalLat, zoom);

    const reconstructedLng = tile2lon(tileX, zoom);
    const reconstructedLat = tile2lat(tileY, zoom);

    // NW corner of tile should be within 1 tile width/height
    expect(Math.abs(reconstructedLng - originalLng)).toBeLessThan(0.1);
    expect(Math.abs(reconstructedLat - originalLat)).toBeLessThan(0.1);
  });
});

describe('getTilesForBounds', () => {
  it('generates tile list covering bounds and zoom range', () => {
    const bounds: MapBounds = {
      north: 35.7,
      south: 35.65,
      east: 139.75,
      west: 139.7,
    };

    const tiles = getTilesForBounds(bounds, 12, 13);
    expect(tiles.length).toBeGreaterThan(0);

    for (const tile of tiles) {
      expect(tile.z).toBeGreaterThanOrEqual(12);
      expect(tile.z).toBeLessThanOrEqual(13);
      expect(tile.url).toMatch(
        /^https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/
      );
    }
  });

  it('respects maxTiles cap to protect network and storage', () => {
    // Nationwide view bounds
    const wideBounds: MapBounds = {
      north: 45.5,
      south: 24.0,
      east: 153.0,
      west: 122.0,
    };

    const maxLimit = 25;
    const tiles = getTilesForBounds(wideBounds, 5, 12, maxLimit);
    expect(tiles.length).toBe(maxLimit);
  });
});

describe('downloadTiles with Mock Caches', () => {
  it('handles simulated offline or empty download list gracefully', async () => {
    const result = await downloadTiles([]);
    expect(result.total).toBe(0);
    expect(result.downloaded).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('aborts download when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    controller.abort();

    // Mock caches
    const originalCaches = (globalThis as any).caches;
    (globalThis as any).caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      }),
    };

    try {
      const tiles = [
        { x: 1, y: 1, z: 1, url: 'https://a.tile.openstreetmap.org/1/1/1.png' },
      ];
      const result = await downloadTiles(tiles, { signal: controller.signal });
      expect(result.success).toBe(false);
    } finally {
      (globalThis as any).caches = originalCaches;
    }
  });
});
