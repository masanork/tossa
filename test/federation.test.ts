// test/federation.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';

describe('Federation & Migration API', () => {
  it('exports public GeoJSON-LD feed', async () => {
    const { request, db } = createTestContext();

    // Insert a post
    await db
      .prepare(
        `INSERT INTO posts (id, category_id, title, area, address, lat, lng, current_status, status_label, tags, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'post_fed_1',
        'water',
        'City Water Distribution Point',
        'Kumamoto City',
        '1-1 Chuo-ku',
        32.789,
        130.741,
        'available',
        '給水中',
        JSON.stringify(['water', 'emergency']),
        1
      )
      .run();

    const res = await request('/api/feed.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/geo+json');

    const feed = (await res.json()) as {
      type: string;
      features: Array<{
        id: string;
        type: string;
        geometry: { type: string; coordinates: [number, number] } | null;
        properties: {
          title: string;
          currentStatus: string;
          tags: string[];
        };
      }>;
    };

    expect(feed.type).toBe('FeatureCollection');
    expect(feed.features.length).toBe(1);
    expect(feed.features[0].id).toBe('post_fed_1');
    expect(feed.features[0].geometry?.coordinates).toEqual([130.741, 32.789]);
    expect(feed.features[0].properties.title).toBe(
      'City Water Distribution Point'
    );
    expect(feed.features[0].properties.currentStatus).toBe('available');
    expect(feed.features[0].properties.tags).toEqual(['water', 'emergency']);
  });

  it('exports backup archive with Content-Disposition attachment header', async () => {
    const { request } = createTestContext();

    const res = await request('/api/federation/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain(
      'attachment; filename="tossa-backup-'
    );
  });

  it('restricts import endpoint to admin or moderator role', async () => {
    const { request, db, env } = createTestContext();

    // 1. Unauthenticated request
    const unauthRes = await request('/api/federation/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: [] }),
    });
    expect(unauthRes.status).toBe(401);

    // 2. Regular user request
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_regular', 'dave', 'Dave', 'user')
      .run();

    const regularToken = await createSessionToken(
      { userId: 'user_regular', username: 'dave', role: 'user' },
      env.JWT_SECRET
    );

    const forbiddenRes = await request('/api/federation/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regularToken}`,
      },
      body: JSON.stringify({ features: [] }),
    });
    expect(forbiddenRes.status).toBe(403);
  });

  it('imports federated features successfully', async () => {
    const { request, db, env } = createTestContext();

    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin_user', 'eve', 'Eve', 'admin')
      .run();

    const adminToken = await createSessionToken(
      { userId: 'admin_user', username: 'eve', role: 'admin' },
      env.JWT_SECRET
    );

    const importedFeature = {
      type: 'Feature' as const,
      id: 'federated_post_1',
      geometry: {
        type: 'Point' as const,
        coordinates: [130.75, 32.8] as [number, number],
      },
      properties: {
        title: 'Shelter Alpha',
        area: 'East District',
        address: '2-3 East Ward',
        currentStatus: 'open',
        statusLabel: '開設中',
        note: 'Blankets and dry rations available',
        tags: ['shelter', 'supplies'],
        createdAt: '2026-09-16T12:00:00.000Z',
        updatedAt: '2026-09-16T12:00:00.000Z',
      },
    };

    const importRes = await request('/api/federation/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ features: [importedFeature] }),
    });
    expect(importRes.status).toBe(200);

    const body = (await importRes.json()) as {
      success: boolean;
      stats: { added: number; updated: number; skipped: number };
    };
    expect(body.success).toBe(true);
    expect(body.stats.added).toBe(1);

    // Verify post exists in DB
    const checkRes = await db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .bind('federated_post_1')
      .first<{ title: string; area: string }>();
    expect(checkRes?.title).toBe('Shelter Alpha');
    expect(checkRes?.area).toBe('East District');
  });
});
