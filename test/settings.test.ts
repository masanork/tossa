// test/settings.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';

describe('Settings API', () => {
  it('retrieves default system settings', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)')
      .bind('site_title', 'tossa')
      .run();

    const res = await request('/api/settings');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      settings: Record<string, string>;
    };
    expect(body.success).toBe(true);
    expect(body.settings).toBeDefined();
    expect(body.settings.site_title).toBe('tossa');
  });

  it('rejects unauthenticated or unauthorized setting updates', async () => {
    const { request, db, env } = createTestContext();

    // 1. Unauthenticated request
    const unauthRes = await request('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_title: 'Hacked Title' }),
    });
    expect(unauthRes.status).toBe(401);

    // 2. Regular user request
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_regular', 'bob', 'Bob', 'user')
      .run();

    const userToken = await createSessionToken(
      { userId: 'user_regular', username: 'bob', role: 'user' },
      env.JWT_SECRET
    );

    const forbiddenRes = await request('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ site_title: 'Unauthorized Title' }),
    });
    expect(forbiddenRes.status).toBe(403);
  });

  it('allows admin or moderator to update settings', async () => {
    const { request, db, env } = createTestContext();

    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_admin', 'carol', 'Carol', 'admin')
      .run();

    const adminToken = await createSessionToken(
      { userId: 'user_admin', username: 'carol', role: 'admin' },
      env.JWT_SECRET
    );

    const updateRes = await request('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        site_title: 'Kumamoto Disaster Portal',
        emergency_banner: 'Water distribution started at City Hall',
        default_area: 'Kumamoto City',
      }),
    });
    expect(updateRes.status).toBe(200);

    const body = (await updateRes.json()) as {
      success: boolean;
      settings: Record<string, string>;
    };
    expect(body.success).toBe(true);
    expect(body.settings.site_title).toBe('Kumamoto Disaster Portal');
    expect(body.settings.emergency_banner).toBe(
      'Water distribution started at City Hall'
    );
    expect(body.settings.default_area).toBe('Kumamoto City');
  });

  it('imports disaster posts in bulk from CSV/TSV with duplicate handling', async () => {
    const { request, db, env } = createTestContext();

    // Setup admin user
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin_importer', 'admin', 'Admin', 'admin')
      .run();

    const adminToken = await createSessionToken(
      { userId: 'admin_importer', username: 'admin', role: 'admin' },
      env.JWT_SECRET
    );

    // Initial CSV payload
    const csvContent = `避難所名称,市区町村名,施設所在地,開設状況,緯度,経度,備考
桜山小学校,熊本市中央区,中央区桜山1-1,開設中,32.801,130.701,体育館開放中
東部市民センター,熊本市東区,東区東町2-2,混雑,32.812,130.725,毛布残数50枚`;

    const res = await request('/api/settings/import-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rawCsv: csvContent,
        updateDuplicates: true,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      stats: { added: number; updated: number; skipped: number };
    };

    expect(body.success).toBe(true);
    expect(body.stats.added).toBe(2);
    expect(body.stats.updated).toBe(0);

    // Verify posts in DB
    const posts = await db
      .prepare('SELECT * FROM posts ORDER BY title ASC')
      .all<{
        title: string;
        area: string;
        current_status: string;
        is_verified: number;
      }>();

    expect(posts.results.length).toBe(2);
    expect(posts.results[0].title).toBe('東部市民センター');
    expect(posts.results[0].current_status).toBe('crowded');
    expect(posts.results[0].is_verified).toBe(1);
    expect(posts.results[1].title).toBe('桜山小学校');
    expect(posts.results[1].current_status).toBe('available');

    // Second import: 1 update, 1 new
    const updatedCsv = `避難所名称,市区町村名,施設所在地,開設状況,備考
桜山小学校,熊本市中央区,中央区桜山1-1,満員,収容定員超過
南部コミュニティセンター,熊本市南区,南区南町3-3,開設中,新規開設`;

    const updateRes = await request('/api/settings/import-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rawCsv: updatedCsv,
        updateDuplicates: true,
      }),
    });

    const updateBody = (await updateRes.json()) as {
      success: boolean;
      stats: { added: number; updated: number; skipped: number };
    };

    expect(updateBody.success).toBe(true);
    expect(updateBody.stats.added).toBe(1);
    expect(updateBody.stats.updated).toBe(1);

    // Verify updated status
    const updatedSakura = await db
      .prepare('SELECT current_status, status_label FROM posts WHERE title = ?')
      .bind('桜山小学校')
      .first<{ current_status: string; status_label: string }>();

    expect(updatedSakura?.current_status).toBe('closed');
  });
});
