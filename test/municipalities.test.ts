// test/municipalities.test.ts: Tests for municipality lookup and GSI shelter fetch API
import { describe, it, expect, vi } from 'vitest';
import {
  searchMunicipalities,
  latLngToTileZ10,
} from '../src/municipalities';
import { createTestContext } from './helpers/testApp';

describe('Municipalities & GSI Shelters', () => {
  describe('searchMunicipalities', () => {
    it('searches municipality by Japanese name', async () => {
      const results = await searchMunicipalities('輪島市');
      expect(results.length).toBeGreaterThan(0);
      const wajima = results.find((m) => m.name === '輪島市');
      expect(wajima).toBeDefined();
      expect(wajima?.code).toMatch(/^17204/);
      expect(wajima?.pref).toBe('石川県');
      expect(wajima?.lat).toBeCloseTo(37.39, 1);
      expect(wajima?.lng).toBeCloseTo(136.89, 1);
    });

    it('searches municipality by city code', async () => {
      const results = await searchMunicipalities('17204');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.name).toBe('輪島市');
    });

    it('searches municipality by partial query (Kumamoto)', async () => {
      const results = await searchMunicipalities('熊本');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((m) => m.name.includes('熊本'))).toBe(true);
    });

    it('returns empty array on blank query', async () => {
      const results = await searchMunicipalities('');
      expect(results).toEqual([]);
    });
  });

  describe('latLngToTileZ10', () => {
    it('calculates zoom 10 tile coordinates correctly', () => {
      // Tokyo ~ (35.68, 139.69)
      const tile = latLngToTileZ10(35.6895, 139.6917);
      expect(tile.z).toBe(10);
      expect(tile.x).toBeGreaterThan(0);
      expect(tile.y).toBeGreaterThan(0);
      // z=10 tiles for Tokyo are x: 909, y: 403
      expect(tile.x).toBe(909);
      expect(tile.y).toBe(403);
    });
  });

  describe('API Endpoints', () => {
    it('GET /api/opendata/municipalities returns matches', async () => {
      const { request } = createTestContext();
      const res = await request('/api/opendata/municipalities?q=輪島');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; municipalities: any[] };
      expect(body.success).toBe(true);
      expect(body.municipalities.length).toBeGreaterThan(0);
      expect(body.municipalities[0].name).toBe('輪島市');
    });

    it('POST /api/opendata/disaster-areas/fetch handles empty request', async () => {
      const { request } = createTestContext();
      const res = await request('/api/opendata/disaster-areas/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areas: [] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; shelters: any[] };
      expect(body.success).toBe(true);
      expect(body.shelters).toEqual([]);
    });

    it('POST /api/opendata/disaster-areas/fetch retrieves shelters from curated presets or GSI', async () => {
      const { request } = createTestContext();
      const res = await request('/api/opendata/disaster-areas/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          areas: [
            {
              code: '43100',
              name: '熊本市',
              pref: '熊本県',
              fullName: '熊本県熊本市',
              lat: 32.8031,
              lng: 130.7079,
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        count: number;
        shelters: Array<{ name: string; area: string }>;
      };
      expect(body.success).toBe(true);
      expect(body.count).toBeGreaterThan(0);
      expect(body.shelters.some((s) => s.name.includes('桜山小学校'))).toBe(true);
    });
  });
});
