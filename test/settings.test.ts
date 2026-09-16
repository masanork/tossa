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
});
