// test/backup.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTestContext } from './helpers/testApp';
import {
  BACKUP_TABLES,
  performDatabaseBackup,
  listStoredBackups,
} from '../src/services/backup';
import { createSessionToken } from '../src/auth/session';

function createMockR2Bucket() {
  const store = new Map<
    string,
    { body: string; customMetadata?: Record<string, string>; uploaded: Date }
  >();

  const uploads = new Map<
    string,
    { key: string; options?: any; parts: Map<number, Uint8Array> }
  >();
  const bucket: any = {
    createMultipartUpload: vi.fn(async (key: string, options?: any) => {
      const uploadId = crypto.randomUUID();
      const upload = { key, options, parts: new Map<number, Uint8Array>() };
      uploads.set(uploadId, upload);
      return {
        key,
        uploadId,
        uploadPart: vi.fn(async (partNumber: number, value: Uint8Array) => {
          if (bucket.failUploadPart) throw new Error('injected part failure');
          await bucket.onUploadPart?.(partNumber);
          upload.parts.set(partNumber, new Uint8Array(value));
          return { partNumber, etag: `etag-${partNumber}` };
        }),
        complete: vi.fn(async (parts: Array<{ partNumber: number }>) => {
          const ordered = parts.map((part) =>
            upload.parts.get(part.partNumber)!
          );
          const length = ordered.reduce(
            (sum, part) => sum + part.byteLength,
            0
          );
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const part of ordered) {
            bytes.set(part, offset);
            offset += part.byteLength;
          }
          const body = new TextDecoder().decode(bytes);
          store.set(key, {
            body,
            customMetadata: options?.customMetadata,
            uploaded: new Date(),
          });
          uploads.delete(uploadId);
          return { key, size: bytes.byteLength };
        }),
        abort: vi.fn(async () => {
          bucket.abortCount++;
          uploads.delete(uploadId);
        }),
      };
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
          size: new TextEncoder().encode(value.body).byteLength,
          uploaded: value.uploaded,
          customMetadata: value.customMetadata,
        }));
      return { objects };
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    _store: store,
    _uploads: uploads,
    abortCount: 0,
    failUploadPart: false,
    onUploadPart: undefined as
      ((partNumber: number) => Promise<void>) | undefined,
  };

  return bucket;
}

describe('D1 Database Automated Backup & R2 Archival', () => {
  it('dumps database tables and saves to R2 with metadata', async () => {
    const { db, env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.BACKUPS_BUCKET = r2;

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

    // Verify a complete v2 archive was committed through multipart upload.
    expect(r2.createMultipartUpload).toHaveBeenCalledTimes(1);
    const stored = r2._store.get(result.backupKey!);
    expect(stored).toBeDefined();

    const parsed = JSON.parse(stored!.body);
    expect(parsed.metadata.version).toBe(2);
    expect(Object.keys(parsed.data)).toEqual([...BACKUP_TABLES]);
    expect(parsed.data.posts.length).toBe(1);
    expect(parsed.data.posts[0].title).toBe('給水所開設');
    expect(parsed.data.users[0].username).toBe('admin');
    expect(result.sizeBytes).toBe(
      new TextEncoder().encode(stored!.body).byteLength
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(
      Number(stored!.customMetadata?.snapshotDurationMs)
    ).toBeGreaterThanOrEqual(0);
    const list = await listStoredBackups(env);
    expect(list[0].snapshotAt).toBe(stored!.customMetadata?.createdAt);
    expect(list[0].snapshotDurationMs).toBe(
      Number(stored!.customMetadata?.snapshotDurationMs)
    );
  });

  it('rotates older backups exceeding retention limits', async () => {
    const { env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.BACKUPS_BUCKET = r2;

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
    env.BACKUPS_BUCKET = undefined;

    const result = await performDatabaseBackup(env);
    expect(result.success).toBe(false);
    expect(result.error).toContain('BACKUPS_BUCKET');
    expect(result.backupKey).toBeUndefined();
  });

  it('serializes the immutable snapshot as bounded multipart JSON with correct escaping', async () => {
    const { db, env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.BACKUPS_BUCKET = r2;
    const title = `災害\n"${'x'.repeat(20_000)}`;
    await db
      .prepare(
        'INSERT INTO posts (id, title, area, current_status, status_label) VALUES (?, ?, ?, ?, ?)'
      )
      .bind('snapshot-row', title, '熊本市', 'available', '開設中')
      .run();

    const result = await performDatabaseBackup(env);
    expect(result.success).toBe(true);
    const archive = JSON.parse(r2._store.get(result.backupKey!)!.body);
    expect(archive.metadata.version).toBe(2);
    expect(archive.data.posts[0].title).toBe(title);
    expect(result.sizeBytes).toBe(
      new TextEncoder().encode(r2._store.get(result.backupKey!)!.body)
        .byteLength
    );
  });

  it('keeps one consistent row image when source writes continue during multipart upload', async () => {
    const { db, env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.BACKUPS_BUCKET = r2;
    const largeTitle = 'before-' + 'x'.repeat(900_000);
    for (let i = 0; i < 7; i++) {
      await db
        .prepare(
          'INSERT INTO posts (id, title, area, current_status, status_label) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(`snapshot-${i}`, largeTitle, '熊本市', 'available', '開設中')
        .run();
    }
    let changed = false;
    r2.onUploadPart = async () => {
      if (changed) return;
      changed = true;
      await db
        .prepare('UPDATE posts SET title = ? WHERE id = ?')
        .bind('after-backup-started', 'snapshot-0')
        .run();
    };

    const result = await performDatabaseBackup(env);
    expect(result.success).toBe(true);
    expect(changed).toBe(true);
    const archive = JSON.parse(r2._store.get(result.backupKey!)!.body);
    expect(archive.data.posts).toHaveLength(7);
    expect(
      archive.data.posts.find(
        (post: { id: string }) => post.id === 'snapshot-0'
      ).title
    ).toBe(largeTitle);
    const current = await db
      .prepare('SELECT title FROM posts WHERE id = ?')
      .bind('snapshot-0')
      .first<{ title: string }>('title');
    expect(current).toBe('after-backup-started');
  });

  it('aborts incomplete multipart uploads and drops its staged tables on part failure', async () => {
    const { db, env } = createTestContext();
    const r2 = createMockR2Bucket();
    r2.failUploadPart = true;
    env.BACKUPS_BUCKET = r2;
    const largeTitle = 'x'.repeat(900_000);
    for (let i = 0; i < 7; i++) {
      await db
        .prepare(
          'INSERT INTO posts (id, title, area, current_status, status_label) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(`large-row-${i}`, largeTitle, '熊本市', 'available', '開設中')
        .run();
    }

    const result = await performDatabaseBackup(env);
    expect(result.success).toBe(false);
    expect(result.error).toContain('injected part failure');
    expect(r2.abortCount).toBe(1);
    expect(r2._store.size).toBe(0);
    const leftovers = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tossa_backup_snapshot_%'"
      )
      .all<{ name: string }>();
    expect(leftovers.results).toHaveLength(0);
  });

  it('admits only one simultaneous backup and refuses to steal a live lease', async () => {
    const { db, env } = createTestContext();
    env.BACKUPS_BUCKET = createMockR2Bucket();
    const results = await Promise.all([
      performDatabaseBackup(env),
      performDatabaseBackup(env),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)[0]?.error).toContain(
      'already running'
    );
    expect(results.filter((result) => !result.success)[0]?.busy).toBe(true);

    await db
      .prepare(
        'UPDATE tossa_backup_control SET lease_token = ?, lease_until = ?, fence = fence + 1 WHERE id = 1'
      )
      .bind('other-run', Date.now() + 60_000)
      .run();
    const blocked = await performDatabaseBackup(env);
    expect(blocked.success).toBe(false);
    expect(blocked.busy).toBe(true);
    expect(blocked.error).toContain('already running');
  });

  it('cleans only abandoned staging tables whose names match the strict run prefix', async () => {
    const { db, env } = createTestContext();
    env.BACKUPS_BUCKET = createMockR2Bucket();
    const oldRun =
      'tossa_backup_snapshot_20200101T000000Z_0123456789abcdef0123456789abcdef_posts';
    await db.prepare(`CREATE TABLE "${oldRun}" (value TEXT)`).run();
    await db
      .prepare('CREATE TABLE tossa_backup_snapshot_unrecognized (value TEXT)')
      .run();

    const result = await performDatabaseBackup(env);
    expect(result.success).toBe(true);
    const exists = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?)"
      )
      .bind(oldRun, 'tossa_backup_snapshot_unrecognized')
      .all<{ name: string }>();
    expect(exists.results.map((row) => row.name)).toEqual([
      'tossa_backup_snapshot_unrecognized',
    ]);
  });

  it('lists stored backups via listStoredBackups', async () => {
    const { env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.BACKUPS_BUCKET = r2;

    r2._store.set('backups/b1.json', {
      body: '{"test": 1}',
      uploaded: new Date('2026-09-01T00:00:00Z'),
      customMetadata: { totalRecords: '10', snapshotDurationMs: '250' },
    });
    r2._store.set('backups/b2.json', {
      body: '{"test": 2}',
      uploaded: new Date('2026-09-02T00:00:00Z'),
      customMetadata: { totalRecords: '20', snapshotDurationMs: 'invalid' },
    });

    const list = await listStoredBackups(env);
    expect(list.length).toBe(2);
    // Should be sorted newest first
    expect(list[0].key).toBe('backups/b2.json');
    expect(list[0].snapshotAt).toBeUndefined();
    expect(list[0].totalRecords).toBe(20);
    expect(list[1].key).toBe('backups/b1.json');
    expect(list[1].snapshotDurationMs).toBe(250);
    expect(list[0].snapshotDurationMs).toBeUndefined();
  });

  it('requires admin token for POST /api/settings/backup and GET /api/settings/backups', async () => {
    const { request, db, env } = createTestContext();
    const r2 = createMockR2Bucket();
    env.BACKUPS_BUCKET = r2;

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
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);

    // 4. List backups as admin -> 200
    const resList = await request('/api/settings/backups', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resList.status).toBe(200);
    const listBody = (await resList.json()) as any;
    expect(listBody.success).toBe(true);
    expect(listBody.backups.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(Date.parse(listBody.checkedAt))).toBe(true);
    expect(resList.headers.get('cache-control')).toBe('private, no-store');
  });
});
