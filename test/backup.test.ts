// test/backup.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTestContext } from './helpers/testApp';
import {
  performDatabaseBackup,
  listStoredBackups,
} from '../src/services/backup';
import { createSessionToken } from '../src/auth/session';

function createMockR2Bucket() {
  const store = new Map<
    string,
    { body: string; customMetadata?: Record<string, string>; uploaded: Date }
  >();

  const bucket: any = {
    put: vi.fn(async (key: string, body: string, options?: any) => {
      store.set(key, {
        body,
        customMetadata: options?.customMetadata,
        uploaded: new Date(),
      });
      return { key };
    }),
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        text: async () => item.body,
        customMetadata: item.customMetadata,
      };
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const prefix = options?.prefix || '';
      const objects = Array.from(store.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({
          key,
          size: value.body.length,
          uploaded: value.uploaded,
          customMetadata: value.customMetadata,
        }));
      return { objects };
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    _store: store,
  };

  return bucket;
}

describe('D1 Database Automated Backup & R2 Archival', () => {
  it('dumps database tables and saves to R2 with metadata', async () => {
    const { db, env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.IMAGES_BUCKET = r2;

    // Seed some test data
    await db
      .prepare(
        'INSERT INTO posts (id, title, area, current_status, status_label) VALUES (?, ?, ?, ?, ?)'
      )
      .bind('post_1', '給水所開設', '熊本市中央区', 'available', '開設中')
      .run();

    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin_1', 'admin', '管理者', 'admin')
      .run();

    const result = await performDatabaseBackup(env);

    expect(result.success).toBe(true);
    expect(result.backupKey).toBeDefined();
    expect(result.backupKey).toMatch(/^backups\/tossa_backup_/);
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.tableCounts['posts']).toBe(1);
    expect(result.metadata?.tableCounts['users']).toBe(1);
    expect(result.metadata?.totalRecords).toBeGreaterThanOrEqual(2);

    // Verify R2 was called
    expect(r2.put).toHaveBeenCalledTimes(1);
    const stored = r2._store.get(result.backupKey!);
    expect(stored).toBeDefined();

    const parsed = JSON.parse(stored!.body);
    expect(parsed.metadata.version).toBe(1);
    expect(parsed.data.posts.length).toBe(1);
    expect(parsed.data.posts[0].title).toBe('給水所開設');
    expect(parsed.data.users[0].username).toBe('admin');
  });

  it('rotates older backups exceeding retention limits', async () => {
    const { env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.IMAGES_BUCKET = r2;

    // Pre-populate R2 with 5 backups
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const key = `backups/old_backup_${i}.json`;
      r2._store.set(key, {
        body: JSON.stringify({ old: true }),
        uploaded: new Date(now - (10 - i) * 60000), // older
      });
    }

    // Set retention limit to 3
    const result = await performDatabaseBackup(env, { maxRetention: 3 });

    expect(result.success).toBe(true);
    expect(r2.delete).toHaveBeenCalled();
    // 5 existing + 1 new = 6 total. Keeping 3 means 3 deleted.
    expect(result.deletedOldBackups?.length).toBe(3);
    expect(r2._store.size).toBe(3);
  });

  it('handles environment gracefully when R2 is not configured', async () => {
    const { env } = createTestContext();
    env.IMAGES_BUCKET = undefined;

    const result = await performDatabaseBackup(env);
    expect(result.success).toBe(true);
    expect(result.backupKey).toBeUndefined();
    expect(result.metadata).toBeDefined();
  });

  it('lists stored backups via listStoredBackups', async () => {
    const { env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.IMAGES_BUCKET = r2;

    r2._store.set('backups/b1.json', {
      body: '{"test": 1}',
      uploaded: new Date('2026-09-01T00:00:00Z'),
      customMetadata: { totalRecords: '10' },
    });
    r2._store.set('backups/b2.json', {
      body: '{"test": 2}',
      uploaded: new Date('2026-09-02T00:00:00Z'),
      customMetadata: { totalRecords: '20' },
    });

    const list = await listStoredBackups(env);
    expect(list.length).toBe(2);
    // Should be sorted newest first
    expect(list[0].key).toBe('backups/b2.json');
    expect(list[0].totalRecords).toBe(20);
    expect(list[1].key).toBe('backups/b1.json');
  });

  it('requires admin token for POST /api/settings/backup and GET /api/settings/backups', async () => {
    const { request, db, env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.IMAGES_BUCKET = r2;

    // 1. Unauthenticated request -> 401
    const resUnauth = await request('/api/settings/backup', { method: 'POST' });
    expect(resUnauth.status).toBe(401);

    // 2. Regular user -> 403
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('regular_user', 'alice', 'Alice', 'user')
      .run();
    const userToken = await createSessionToken(
      { userId: 'regular_user', username: 'alice', role: 'user' },
      env.JWT_SECRET
    );

    const resForbidden = await request('/api/settings/backup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(resForbidden.status).toBe(403);

    // 3. Admin user -> 200
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('admin_user', 'admin', 'Admin', 'admin')
      .run();
    const adminToken = await createSessionToken(
      { userId: 'admin_user', username: 'admin', role: 'admin' },
      env.JWT_SECRET
    );

    const resAdmin = await request('/api/settings/backup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resAdmin.status).toBe(200);
    const body = (await resAdmin.json()) as any;
    expect(body.success).toBe(true);
    expect(body.backupKey).toBeDefined();

    // 4. List backups as admin -> 200
    const resList = await request('/api/settings/backups', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resList.status).toBe(200);
    const listBody = (await resList.json()) as any;
    expect(listBody.success).toBe(true);
    expect(listBody.backups.length).toBeGreaterThanOrEqual(1);
  });
});
