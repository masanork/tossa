// test/posts.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { DEVICE_COOKIE } from '../src/middleware/deviceCookie';
import { createSessionToken } from '../src/auth/session';

describe('Posts API (Cookie & Passkey Auth)', () => {
  it('allows posting with cookie only (no Passkey required)', async () => {
    const { request, db } = createTestContext();
    const deviceId = 'device_test_post_cookie_1';

    const res = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${deviceId}`,
        'cf-connecting-ip': '203.0.113.50',
      },
      body: JSON.stringify({
        title: '中央小学校 給水所',
        area: '中央区',
        currentStatus: 'available',
        statusLabel: '利用可能',
        note: '9:00〜17:00まで',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.id).toBeTruthy();
    expect(body.hasPasskey).toBe(false);

    // Verify that author_cookie_id was saved to the database
    const post = await db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .bind(body.id)
      .first<{ id: string; author_cookie_id: string; title: string }>();

    expect(post).toBeTruthy();
    expect(post!.author_cookie_id).toBe(deviceId);
    expect(post!.title).toBe('中央小学校 給水所');

    // Verify that post_created was recorded in access_logs
    const log = await db
      .prepare(
        'SELECT * FROM access_logs WHERE event_type = ? AND device_session_id = ?'
      )
      .bind('post_created', deviceId)
      .first<{ ip_address: string; metadata: string }>();

    expect(log).toBeTruthy();
    expect(log!.ip_address).toBe('203.0.113.50');
    expect(log!.metadata).toContain(body.id);
  });

  it('allows posting with title only (no area or status)', async () => {
    const { request, db } = createTestContext();
    const deviceId = 'device_test_post_title_only';

    const res = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${deviceId}`,
        'cf-connecting-ip': '203.0.113.51',
      },
      body: JSON.stringify({
        title: '〇〇カフェ、今日やってます',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    const post = await db
      .prepare(
        'SELECT title, area, current_status, status_label FROM posts WHERE id = ?'
      )
      .bind(body.id)
      .first<{
        title: string;
        area: string;
        current_status: string;
        status_label: string;
      }>();

    expect(post?.title).toBe('〇〇カフェ、今日やってます');
    expect(post?.area).toBe('');
    expect(post?.current_status).toBe('available');
    expect(post?.status_label).toBe('お知らせ');
  });

  it('omits is_owner on public lists so Cookie does not fragment the edge cache', async () => {
    const { request } = createTestContext();
    const myDevice = 'my_phone_device_123';

    const createRes = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${myDevice}`,
      },
      body: JSON.stringify({
        title: '私の投稿',
        area: '北区',
        currentStatus: 'available',
        statusLabel: 'OK',
      }),
    });
    const created = await createRes.json();

    const resPublic = await request('/api/posts', {
      headers: {
        Cookie: `${DEVICE_COOKIE}=${myDevice}`,
      },
    });
    const dataPublic = await resPublic.json();
    const listed = dataPublic.posts.find((p: any) => p.id === created.id);
    expect(listed).toBeTruthy();
    expect(listed.is_owner).toBeUndefined();

    const resMine = await request('/api/posts?mine=true', {
      headers: {
        Cookie: `${DEVICE_COOKIE}=${myDevice}`,
      },
    });
    const dataMine = await resMine.json();
    const minePost = dataMine.posts.find((p: any) => p.id === created.id);
    expect(minePost).toBeTruthy();
    expect(minePost.is_owner).toBe(true);
  });

  it('allows editing by cookie owner, blocks unauthorized users', async () => {
    const { request, db } = createTestContext();
    const ownerDevice = 'owner_device_abc';
    const attackerDevice = 'attacker_device_xyz';

    // Create post
    const createRes = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${ownerDevice}`,
      },
      body: JSON.stringify({
        title: '元のタイトル',
        area: '南区',
        currentStatus: 'available',
        statusLabel: 'OK',
      }),
    });
    const { id: postId } = await createRes.json();

    // Third party attempts to edit (should be 403 Forbidden)
    const attackRes = await request(`/api/posts/${postId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${attackerDevice}`,
      },
      body: JSON.stringify({
        title: '不正な書き換え',
        area: '南区',
        currentStatus: 'closed',
      }),
    });
    expect(attackRes.status).toBe(403);
    const attackBody = await attackRes.json();
    expect(attackBody.success).toBe(false);

    // Edit from author's own device
    const editRes = await request(`/api/posts/${postId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${ownerDevice}`,
        'cf-connecting-ip': '203.0.113.99',
      },
      body: JSON.stringify({
        title: '更新されたタイトル',
        area: '南区',
        currentStatus: 'crowded',
        statusLabel: '混雑',
      }),
    });
    expect(editRes.status).toBe(200);

    // Verify updated content and access log in database
    const updatedPost = await db
      .prepare('SELECT title, current_status FROM posts WHERE id = ?')
      .bind(postId)
      .first<{ title: string; current_status: string }>();
    expect(updatedPost!.title).toBe('更新されたタイトル');
    expect(updatedPost!.current_status).toBe('crowded');

    const updateLog = await db
      .prepare(
        'SELECT * FROM access_logs WHERE event_type = ? AND device_session_id = ?'
      )
      .bind('post_updated', ownerDevice)
      .first<{ ip_address: string }>();
    expect(updateLog).toBeTruthy();
    expect(updateLog!.ip_address).toBe('203.0.113.99');
  });

  it('allows deletion by cookie owner and by admin', async () => {
    const { request, db, env } = createTestContext();
    const ownerDevice = 'owner_del_123';
    const strangerDevice = 'stranger_del_456';

    // Create post
    const createRes = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${ownerDevice}`,
      },
      body: JSON.stringify({
        title: '削除対象の投稿',
        area: '東区',
        currentStatus: 'available',
        statusLabel: 'OK',
      }),
    });
    const { id: postId } = await createRes.json();

    // Unauthorized users cannot delete
    const failDel = await request(`/api/posts/${postId}`, {
      method: 'DELETE',
      headers: {
        Cookie: `${DEVICE_COOKIE}=${strangerDevice}`,
      },
    });
    expect(failDel.status).toBe(403);

    // Register admin user in database
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin_user_id', 'admin', 'Admin User', 'admin')
      .run();

    // Admin can delete any post with their token
    const adminToken = await createSessionToken(
      { userId: 'admin_user_id', username: 'admin', role: 'admin' },
      env.JWT_SECRET
    );

    const adminDel = await request(`/api/posts/${postId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    expect(adminDel.status).toBe(200);

    // Verify deletion from database
    const postAfter = await db
      .prepare('SELECT id FROM posts WHERE id = ?')
      .bind(postId)
      .first();
    expect(postAfter).toBeNull();
  });

  it('filters posts by mine=true and ids list in GET /api/posts', async () => {
    const { request } = createTestContext();
    const myDevice = 'my_device_filter_test';
    const otherDevice = 'other_device_filter_test';

    // Create 2 posts for myDevice
    const res1 = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${myDevice}`,
      },
      body: JSON.stringify({
        title: '自分の投稿 1',
        area: '中央区',
        currentStatus: 'available',
        statusLabel: '利用可能',
      }),
    });
    const post1 = await res1.json();

    const res2 = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${myDevice}`,
      },
      body: JSON.stringify({
        title: '自分の投稿 2',
        area: '東区',
        currentStatus: 'crowded',
        statusLabel: '混雑',
      }),
    });
    const post2 = await res2.json();

    // Create 1 post for otherDevice
    const res3 = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=${otherDevice}`,
      },
      body: JSON.stringify({
        title: '他人の投稿 3',
        area: '西区',
        currentStatus: 'closed',
        statusLabel: '配布終了',
      }),
    });
    const post3 = await res3.json();

    // 1. Test mine=true
    const mineRes = await request('/api/posts?mine=true', {
      headers: {
        Cookie: `${DEVICE_COOKIE}=${myDevice}`,
      },
    });
    const mineData = await mineRes.json();
    expect(mineData.success).toBe(true);
    expect(mineData.posts.length).toBe(2);
    expect(mineData.posts.every((p: any) => p.is_owner === true)).toBe(true);
    const mineIds = mineData.posts.map((p: any) => p.id);
    expect(mineIds).toContain(post1.id);
    expect(mineIds).toContain(post2.id);
    expect(mineIds).not.toContain(post3.id);

    // 2. Test ids=... (favorites / bookmarks filter)
    const idsRes = await request(`/api/posts?ids=${post1.id},${post3.id}`);
    const idsData = await idsRes.json();
    expect(idsData.success).toBe(true);
    expect(idsData.posts.length).toBe(2);
    const queriedIds = idsData.posts.map((p: any) => p.id);
    expect(queriedIds).toContain(post1.id);
    expect(queriedIds).toContain(post3.id);
    expect(queriedIds).not.toContain(post2.id);
  });

  it('allows note-only micro-updates to post status history', async () => {
    const { request } = createTestContext();

    // Create a post
    const createRes = await request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '給水所マイクロアップデートテスト',
        area: '南区',
        currentStatus: 'available',
        statusLabel: '給水中',
      }),
    });
    const { id: postId } = await createRes.json();

    // Post a note-only micro-update (without changing status)
    const updateRes = await request(`/api/posts/${postId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: '現在ポリタンク待ち列なし。スムーズです。',
      }),
    });
    expect(updateRes.status).toBe(200);

    // Verify detail returns the update history and current status was preserved
    const detailRes = await request(`/api/posts/${postId}`);
    const detail = await detailRes.json();
    expect(detail.success).toBe(true);
    expect(detail.post.current_status).toBe('available');
    expect(detail.post.status_label).toBe('給水中');
    expect(detail.history.length).toBeGreaterThanOrEqual(2);
    expect(detail.history[0].note).toBe(
      '現在ポリタンク待ち列なし。スムーズです。'
    );
  });
});
