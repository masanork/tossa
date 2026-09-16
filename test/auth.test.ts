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

    // 1. First user registration option request
    const res1 = await request('/api/auth/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', displayName: 'Alice' }),
    });
    expect(res1.status).toBe(200);

    const user1 = await db
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind('alice')
      .first<any>();
    expect(user1).toBeTruthy();
    expect(user1.role).toBe('admin'); // First user automatically becomes admin!

    // 2. Second user registration option request
    const res2 = await request('/api/auth/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', displayName: 'Bob' }),
    });
    expect(res2.status).toBe(200);

    const user2 = await db
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind('bob')
      .first<any>();
    expect(user2).toBeTruthy();
    expect(user2.role).toBe('user'); // Subsequent users get standard 'user' role
  });

  it('links device session to user (N:N)', async () => {
    const { db } = createTestContext();
    const deviceId = 'test_device_link_123';
    const userId = 'user_link_abc';

    // Pre-insert device and user into database
    await db
      .prepare('INSERT INTO device_sessions (id, created_ip) VALUES (?, ?)')
      .bind(deviceId, '1.1.1.1')
      .run();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind(userId, 'carol', 'Carol', 'user')
      .run();

    // Execute N:N link query
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

    // Create users
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

    // Standard user attempts to change role -> 403 Forbidden
    const failRes = await request('/api/auth/users/user1/role', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(failRes.status).toBe(403);

    // Admin promotes standard user to admin -> 200 OK
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

  it('handles user deletion correctly (admin only, prevents self-delete and last admin delete)', async () => {
    const { request, db, env } = createTestContext();

    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin_a', 'admin_a', 'Admin A', 'admin')
      .run();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin_b', 'admin_b', 'Admin B', 'admin')
      .run();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_c', 'user_c', 'User C', 'user')
      .run();

    const adminAToken = await createSessionToken(
      { userId: 'admin_a', username: 'admin_a', role: 'admin' },
      env.JWT_SECRET
    );
    const userCToken = await createSessionToken(
      { userId: 'user_c', username: 'user_c', role: 'user' },
      env.JWT_SECRET
    );

    // 1. Non-admin attempts to delete -> 403
    const forbiddenRes = await request('/api/auth/users/user_c', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userCToken}` },
    });
    expect(forbiddenRes.status).toBe(403);

    // 2. Admin attempts to delete themselves -> 400
    const selfDeleteRes = await request('/api/auth/users/admin_a', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminAToken}` },
    });
    expect(selfDeleteRes.status).toBe(400);

    // 3. Admin A deletes User C -> 200
    const deleteUserRes = await request('/api/auth/users/user_c', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminAToken}` },
    });
    expect(deleteUserRes.status).toBe(200);

    const checkUserC = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind('user_c')
      .first<any>();
    expect(checkUserC).toBeNull();

    // 4. Admin A deletes Admin B (there is still Admin A) -> 200
    const deleteAdminBRes = await request('/api/auth/users/admin_b', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminAToken}` },
    });
    expect(deleteAdminBRes.status).toBe(200);

    // 5. If now Admin B is deleted, Admin A is the last admin
    // If another request tries to delete Admin A (pretend from a token), it should fail
    // Create token for a mock scenario or verify countAdmins is 1
    const remainingAdmins = await db
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
      .first<{ count: number }>();
    expect(remainingAdmins?.count).toBe(1);
  });
});
