// test/disasters.test.ts: Multi-disaster management and automatic disaster mode determination tests
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';
import type { DisasterEvent } from '../src/types';

describe('Disasters API & Automatic Mode Switching', () => {
  it('returns empty list of disasters initially and operation_mode is normal', async () => {
    const { request } = createTestContext();

    const res = await request('/api/disasters');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      disasters: DisasterEvent[];
    };
    expect(body.success).toBe(true);
    expect(body.disasters).toEqual([]);

    // Settings check: should be normal
    const settingsRes = await request('/api/settings');
    const settingsBody = (await settingsRes.json()) as any;
    expect(settingsBody.settings.operation_mode).toBe('normal');
    expect(settingsBody.active_disasters).toEqual([]);
  });

  it('enforces authentication and admin/moderator role for creating disasters', async () => {
    const { request, db, env } = createTestContext();

    // 1. Unauthenticated request
    const unauthRes = await request('/api/disasters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '令和8年テスト地震',
        disaster_type: 'earthquake',
      }),
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

    const forbiddenRes = await request('/api/disasters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        name: '令和8年テスト地震',
        disaster_type: 'earthquake',
      }),
    });
    expect(forbiddenRes.status).toBe(403);
  });

  it('allows admin to create multiple disasters and automatically sets operation_mode to disaster', async () => {
    const { request, db, env } = createTestContext();

    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_admin', 'alice', 'Alice', 'admin')
      .run();

    const adminToken = await createSessionToken(
      { userId: 'user_admin', username: 'alice', role: 'admin' },
      env.JWT_SECRET
    );

    // 1. Create Disaster 1: 能登半島地震 (Wajima, Suzu)
    const createRes1 = await request('/api/disasters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: '令和6年能登半島地震',
        disaster_type: 'earthquake',
        designated_at: '2024-01-01T16:10:00.000Z',
        areas: [
          {
            code: '17204',
            name: '輪島市',
            pref: '石川県',
            fullName: '石川県輪島市',
          },
          {
            code: '17205',
            name: '珠洲市',
            pref: '石川県',
            fullName: '石川県珠洲市',
          },
        ],
        banner_message: '能登半島地震 避難所・支援情報ポータル稼働中',
      }),
    });
    expect(createRes1.status).toBe(201);
    const d1Data = (await createRes1.json()) as any;
    expect(d1Data.success).toBe(true);
    expect(d1Data.disaster.id).toBeDefined();
    expect(d1Data.disaster.status).toBe('active');
    expect(d1Data.disaster.areas.length).toBe(2);

    // Check settings: system must automatically be in disaster mode!
    const settingsRes1 = await request('/api/settings');
    const settingsBody1 = (await settingsRes1.json()) as any;
    expect(settingsBody1.settings.operation_mode).toBe('disaster');
    expect(settingsBody1.active_disasters.length).toBe(1);
    const areas1 = JSON.parse(settingsBody1.settings.disaster_areas);
    expect(areas1.length).toBe(2);
    expect(areas1.map((a: any) => a.code)).toContain('17204');

    // 2. Create Disaster 2: 能登豪雨 (Wajima, Noto-cho)
    const createRes2 = await request('/api/disasters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: '令和6年9月奥能登豪雨',
        disaster_type: 'flood',
        designated_at: '2024-09-21T09:00:00.000Z',
        areas: [
          {
            code: '17204',
            name: '輪島市',
            pref: '石川県',
            fullName: '石川県輪島市',
          }, // duplicate municipality code
          {
            code: '17463',
            name: '能登町',
            pref: '石川県',
            fullName: '石川県鳳珠郡能登町',
          },
        ],
      }),
    });
    expect(createRes2.status).toBe(201);
    const d2Data = (await createRes2.json()) as any;
    expect(d2Data.success).toBe(true);

    // Check settings with 2 concurrent active disasters:
    // Areas should be deduplicated (Wajima, Suzu, Noto-cho = 3 areas)
    const settingsRes2 = await request('/api/settings');
    const settingsBody2 = (await settingsRes2.json()) as any;
    expect(settingsBody2.settings.operation_mode).toBe('disaster');
    expect(settingsBody2.active_disasters.length).toBe(2);
    const areas2 = JSON.parse(settingsBody2.settings.disaster_areas);
    expect(areas2.length).toBe(3); // Deduplicated 17204, 17205, 17463
  });

  it('handles archive, reactivation, and automatically reverts to normal mode when all active disasters are resolved', async () => {
    const { request, db, env } = createTestContext();

    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_admin', 'alice', 'Alice', 'admin')
      .run();

    const adminToken = await createSessionToken(
      { userId: 'user_admin', username: 'alice', role: 'admin' },
      env.JWT_SECRET
    );

    // Create 1 disaster
    const createRes = await request('/api/disasters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: '台風10号',
        disaster_type: 'storm',
        areas: [
          {
            code: '43100',
            name: '熊本市',
            pref: '熊本県',
            fullName: '熊本県熊本市',
          },
        ],
      }),
    });
    const { disaster } = (await createRes.json()) as any;

    // Verify it is active
    let settings = (await (await request('/api/settings')).json()) as any;
    expect(settings.settings.operation_mode).toBe('disaster');

    // Archive the disaster
    const archiveRes = await request(`/api/disasters/${disaster.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(archiveRes.status).toBe(200);
    const archiveData = (await archiveRes.json()) as any;
    expect(archiveData.disaster.status).toBe('archived');

    // Now active disasters count is 0 => Operation mode MUST automatically revert to normal!
    settings = (await (await request('/api/settings')).json()) as any;
    expect(settings.settings.operation_mode).toBe('normal');
    expect(settings.active_disasters.length).toBe(0);

    // Reactivate the disaster
    const activateRes = await request(
      `/api/disasters/${disaster.id}/activate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    expect(activateRes.status).toBe(200);
    const activateData = (await activateRes.json()) as any;
    expect(activateData.disaster.status).toBe('active');

    // Should be disaster mode again
    settings = (await (await request('/api/settings')).json()) as any;
    expect(settings.settings.operation_mode).toBe('disaster');
    expect(settings.active_disasters.length).toBe(1);

    // Delete the disaster
    const deleteRes = await request(`/api/disasters/${disaster.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(deleteRes.status).toBe(200);

    // Check list is empty
    const listRes = await request('/api/disasters');
    const listData = (await listRes.json()) as any;
    expect(listData.disasters.length).toBe(0);

    // Should revert to normal mode
    settings = (await (await request('/api/settings')).json()) as any;
    expect(settings.settings.operation_mode).toBe('normal');
  });
});
