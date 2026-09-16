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

    // DB に author_cookie_id が保存されたか検証
    const post = await db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .bind(body.id)
      .first<{ id: string; author_cookie_id: string; title: string }>();

    expect(post).toBeTruthy();
    expect(post!.author_cookie_id).toBe(deviceId);
    expect(post!.title).toBe('中央小学校 給水所');

    // access_logs に post_created が記録されたか検証
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

  it('correctly sets is_owner based on device cookie in GET /api/posts', async () => {
    const { request } = createTestContext();
    const myDevice = 'my_phone_device_123';
    const otherDevice = 'stranger_device_456';

    // 自分の端末から投稿作成
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

    // 自分の端末で一覧取得
    const resMy = await request('/api/posts', {
      headers: {
        Cookie: `${DEVICE_COOKIE}=${myDevice}`,
      },
    });
    const dataMy = await resMy.json();
    const myPost = dataMy.posts.find((p: any) => p.id === created.id);
    expect(myPost).toBeTruthy();
    expect(myPost.is_owner).toBe(true);

    // 他人の端末で一覧取得
    const resOther = await request('/api/posts', {
      headers: {
        Cookie: `${DEVICE_COOKIE}=${otherDevice}`,
      },
    });
    const dataOther = await resOther.json();
    const otherPost = dataOther.posts.find((p: any) => p.id === created.id);
    expect(otherPost).toBeTruthy();
    expect(otherPost.is_owner).toBe(false);
  });

  it('allows editing by cookie owner, blocks unauthorized users', async () => {
    const { request, db } = createTestContext();
    const ownerDevice = 'owner_device_abc';
    const attackerDevice = 'attacker_device_xyz';

    // 投稿作成
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

    // 第三者が編集を試みる（403 Forbidden になるべき）
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

    // 本人の端末から編集
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

    // DBで更新内容とアクセスログを確認
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

    // 投稿作成
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

    // 他人は削除できない
    const failDel = await request(`/api/posts/${postId}`, {
      method: 'DELETE',
      headers: {
        Cookie: `${DEVICE_COOKIE}=${strangerDevice}`,
      },
    });
    expect(failDel.status).toBe(403);

    // 管理者ユーザーをDBに登録
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin_user_id', 'admin', '管理者', 'admin')
      .run();

    // 管理者はトークンで他人の投稿を削除できる
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

    // DBから削除されていることを確認
    const postAfter = await db
      .prepare('SELECT id FROM posts WHERE id = ?')
      .bind(postId)
      .first();
    expect(postAfter).toBeNull();
  });
});
