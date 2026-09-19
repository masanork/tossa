// test/opendata.test.ts: Tests for open data presets and shelters API
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';

describe('Open Data API', () => {
  it('GET /api/opendata/presets returns all official region presets', async () => {
    const { request } = createTestContext();
    const res = await request('/api/opendata/presets');
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      success: boolean;
      presets: Array<{ id: string; name: string; itemCount: number }>;
    };

    expect(data.success).toBe(true);
    expect(Array.isArray(data.presets)).toBe(true);
    expect(data.presets.length).toBeGreaterThan(0);

    const kumamoto = data.presets.find((p) => p.id === 'kumamoto_city');
    expect(kumamoto).toBeDefined();
    expect(kumamoto?.name).toContain('熊本市');
    expect(kumamoto?.itemCount).toBeGreaterThan(0);
  });

  it('GET /api/opendata/presets/:id returns full dataset for a valid preset', async () => {
    const { request } = createTestContext();
    const res = await request('/api/opendata/presets/kumamoto_city');
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      success: boolean;
      preset: {
        id: string;
        name: string;
        items: Array<{ name: string; lat: number; lng: number }>;
      };
    };

    expect(data.success).toBe(true);
    expect(data.preset.id).toBe('kumamoto_city');
    expect(data.preset.items.length).toBeGreaterThan(0);
    expect(data.preset.items[0].name).toBeDefined();
    expect(data.preset.items[0].lat).toBeGreaterThan(0);
    expect(data.preset.items[0].lng).toBeGreaterThan(0);
  });

  it('GET /api/opendata/presets/:id returns 404 for unknown preset', async () => {
    const { request } = createTestContext();
    const res = await request('/api/opendata/presets/non_existent');
    expect(res.status).toBe(404);

    const data = (await res.json()) as { success: boolean; error: string };
    expect(data.success).toBe(false);
  });

  it('GET /api/opendata/shelters returns all shelters with generated IDs', async () => {
    const { request } = createTestContext();
    const res = await request('/api/opendata/shelters');
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      success: boolean;
      shelters: Array<{
        id: string;
        name: string;
        preset_id: string;
        lat: number;
        lng: number;
      }>;
    };

    expect(data.success).toBe(true);
    expect(Array.isArray(data.shelters)).toBe(true);
    expect(data.shelters.length).toBeGreaterThan(10);
    expect(data.shelters[0].id).toMatch(/^official-/);
    expect(data.shelters[0].preset_id).toBeDefined();
  });

  it('GET /api/opendata/shelters?preset=tokyo_evacuation returns filtered shelters', async () => {
    const { request } = createTestContext();
    const res = await request('/api/opendata/shelters?preset=tokyo_evacuation');
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      success: boolean;
      shelters: Array<{ id: string; preset_id: string }>;
    };

    expect(data.success).toBe(true);
    expect(data.shelters.every((s) => s.preset_id === 'tokyo_evacuation')).toBe(true);
  });
});
