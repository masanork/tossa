// test/auth.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';

describe('Auth API (First-come admin & Role Delegation)', () => {
  it('detects first user status correctly on empty DB', async () => {
    const { request } = createTestContext();

    const res = await request('/api/auth/status');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.totalUsers).toBe(0);
    expect(body.adminCount).toBe(0);
    expect(body.isFirstUserSetup).toBe(true);
  });

  it('assigns admin role to first registered user, user role to subsequent users', async () => {
    const { request, db } = createTestContext();

    // 1人目の登録オプション要求
    const res1 = await request('/api/auth/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', displayName: 'アリス' }),
    });
    expect(res1.status).toBe(200);

    const user1 = await db
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind('alice')
      .first<any>();
    expect(user1).toBeTruthy();
    expect(user1.role).toBe('admin'); // 1人目は自動的に管理者！

    // 2人目の登録オプション要求
    const res2 = await request('/api/auth/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', displayName: 'ボブ' }),
    });
    expect(res2.status).toBe(200);

    const user2 = await db
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind('bob')
      .first<any>();
    expect(user2).toBeTruthy();
    expect(user2.role).toBe('user'); // 2人目以降は一般ユーザー！
  });

  it('links device session to user (N:N)', async () => {
    const { db } = createTestContext();
    const deviceId = 'test_device_link_123';
    const userId = 'user_link_abc';

    // 端末とユーザーをDBに事前登録
    await db
      .prepare('INSERT INTO device_sessions (id, created_ip) VALUES (?, ?)')
      .bind(deviceId, '1.1.1.1')
      .run();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind(userId, 'carol', 'キャロル', 'user')
      .run();

    // N:N 紐付けクエリを実行
    await db
      .prepare(
        'INSERT INTO device_user_links (device_session_id, user_id) VALUES (?, ?)'
      )
      .bind(deviceId, userId)
      .run();

    const link = await db
      .prepare(
        'SELECT * FROM device_user_links WHERE device_session_id = ? AND user_id = ?'
      )
      .bind(deviceId, userId)
      .first<any>();

    expect(link).toBeTruthy();
    expect(link.device_session_id).toBe(deviceId);
    expect(link.user_id).toBe(userId);
  });

  it('allows admin to delegate roles, forbids non-admin from modifying roles', async () => {
    const { request, db, env } = createTestContext();

    // ユーザー作成
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin1', 'admin_user', 'Admin', 'admin')
      .run();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user1', 'normal_user', 'Normal', 'user')
      .run();

    const adminToken = await createSessionToken(
      { userId: 'admin1', username: 'admin_user', role: 'admin' },
      env.JWT_SECRET
    );
    const userToken = await createSessionToken(
      { userId: 'user1', username: 'normal_user', role: 'user' },
      env.JWT_SECRET
    );

    // 一般ユーザーがロール変更を試みる -> 403 Forbidden
    const failRes = await request('/api/auth/users/user1/role', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(failRes.status).toBe(403);

    // 管理者が一般ユーザーを管理者に昇格 -> 200 OK
    const promoteRes = await request('/api/auth/users/user1/role', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(promoteRes.status).toBe(200);

    const promotedUser = await db
      .prepare('SELECT role FROM users WHERE id = ?')
      .bind('user1')
      .first<any>();
    expect(promotedUser.role).toBe('admin');
  });
});
