import { describe, it, expect, vi } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken, createApiToken } from '../src/auth/session';
import { processWriteQueueBatch } from '../src/services/writeBuffer';
import { performDatabaseBackup, BACKUP_TABLES } from '../src/services/backup';
import { informationAge } from '../web/src/lib/informationAge';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const jsonHeaders = {
  'Content-Type': 'application/json',
  Cookie: 'tossa_device=reliability-device',
};

async function user(db: D1Database, id: string, role = 'user') {
  await db
    .prepare(
      'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
    )
    .bind(id, id, id, role)
    .run();
}

describe('Account and information trust boundaries', () => {
  it('requires a fresh owner session for adding keys, including accounts with no credentials', async () => {
    const { request, db, env } = createTestContext();
    await user(db, 'owner', 'admin');
    await user(db, 'other');
    const submit = (token?: string) =>
      request('/api/auth/register-options', {
        method: 'POST',
        headers: {
          ...jsonHeaders,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ username: 'owner' }),
      });
    expect((await submit()).status).toBe(403);
    const other = await createSessionToken(
      { userId: 'other', username: 'other', role: 'user' },
      env.JWT_SECRET
    );
    expect((await submit(other)).status).toBe(403);
    const old = await createSessionToken(
      {
        userId: 'owner',
        username: 'owner',
        role: 'admin',
        issuedAt: Math.floor(Date.now() / 1000) - 301,
      },
      env.JWT_SECRET
    );
    expect((await submit(old)).status).toBe(403);
    const pat = await createApiToken(
      { id: 'owner', username: 'owner', role: 'admin' },
      env.JWT_SECRET
    );
    expect((await submit(pat.token)).status).toBe(403);
    const owner = await createSessionToken(
      { userId: 'owner', username: 'owner', role: 'admin' },
      env.JWT_SECRET
    );
    expect((await submit(owner)).status).toBe(200);
  });

  it('rejects verification without an account-bound signed registration ticket', async () => {
    const { request, db } = createTestContext();
    await user(db, 'victim', 'admin');
    const res = await request('/api/auth/verify-registration', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        username: 'victim',
        response: { id: 'attacker-key' },
      }),
    });
    expect(res.status).toBe(403);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS count FROM credentials')
          .first<{ count: number }>()
      )?.count
    ).toBe(0);
  });

  it('does not grant official verification for ordinary authenticated posting, and uses current roles', async () => {
    const { request, db, env } = createTestContext();
    await user(db, 'member');
    const token = await createSessionToken(
      { userId: 'member', username: 'member', role: 'admin' },
      env.JWT_SECRET
    );
    const headers = { ...jsonHeaders, Authorization: `Bearer ${token}` };
    const create = await request('/api/posts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Member post' }),
    });
    const { id } = await create.json();
    const post = await db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .bind(id)
      .first<any>();
    expect(post.is_verified).toBe(0);
    const confirm = () =>
      request(`/api/posts/${id}/official-verification`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expectedUpdatedAt: post.updated_at }),
      });
    expect((await confirm()).status).toBe(403);
    expect(
      (await request('/api/settings/backup', { method: 'POST', headers }))
        .status
    ).toBe(403);
    await db
      .prepare("UPDATE users SET role = 'moderator' WHERE id = 'member'")
      .run();
    expect((await confirm()).status).toBe(200);
    const detail = await (await request(`/api/posts/${id}`)).json();
    expect(detail.post.is_verified).toBe(1);
    expect(detail.post.author_cookie_id).toBeUndefined();
    expect(
      (await request(`/api/posts/${id}`)).headers.get('Cache-Control')
    ).toContain('private');
    const list = await (await request('/api/posts')).json();
    expect(list.posts[0].author_cookie_id).toBeUndefined();
  });

  it('never reads backups, encoded paths or non-raster objects through the image API', async () => {
    const { request, env } = createTestContext();
    const get = vi.fn();
    env.IMAGES_BUCKET = { get } as unknown as R2Bucket;
    for (const key of [
      'backups%2Fexample.json',
      'backups%252Fexample.json',
      'img_payload.html',
      'img_photo.svg',
    ]) {
      expect((await request(`/api/images/${key}`)).status).toBe(404);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps reports private, deduplicates submissions, and records moderator resolution', async () => {
    const { request, db, env } = createTestContext();
    const created = await (
      await request('/api/posts', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: 'Review target' }),
      })
    ).json();
    const report = () =>
      request(`/api/posts/${created.id}/report`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ reason: 'outdated', note: 'It has closed' }),
      });
    expect((await report()).status).toBe(201);
    expect((await report()).status).toBe(201);
    expect((await request('/api/posts/reports/moderation')).status).toBe(403);
    await user(db, 'reviewer', 'moderator');
    const token = await createSessionToken(
      { userId: 'reviewer', username: 'reviewer', role: 'moderator' },
      env.JWT_SECRET
    );
    const headers = { ...jsonHeaders, Authorization: `Bearer ${token}` };
    const list = await (
      await request('/api/posts/reports/moderation', { headers })
    ).json();
    expect(list.total).toBe(1);
    expect(list.reports[0].device_cookie_id).toBeUndefined();
    const resolve = () =>
      request(`/api/posts/reports/${list.reports[0].id}/resolve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          resolution: 'Called the operator and corrected the status',
        }),
      });
    expect((await resolve()).status).toBe(200);
    expect((await resolve()).status).toBe(409);
    const resolved = await db
      .prepare('SELECT * FROM post_reports WHERE id=?')
      .bind(list.reports[0].id)
      .first<any>();
    expect(resolved.resolved_by).toBe('reviewer');
    expect(resolved.resolution).toContain('corrected');
    expect(
      (
        await db
          .prepare(
            'SELECT COUNT(*) AS count FROM access_logs WHERE event_type=?'
          )
          .bind('report_resolved')
          .first<{ count: number }>()
      )?.count
    ).toBe(1);
  });
});

describe('Retry, ordering and pagination', () => {
  it('replays a lost create response exactly once and rejects changed payloads', async () => {
    const { request, db } = createTestContext();
    const payload = { title: 'Once', requestId: 'repeat-request-123' };
    const create = (data = payload) =>
      request('/api/posts', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(data),
      });
    const first = await (await create()).json();
    const second = await (await create()).json();
    expect(first.id).toBe(second.id);
    expect(second.duplicate).toBe(true);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS count FROM posts')
          .first<{ count: number }>()
      )?.count
    ).toBe(1);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS count FROM status_updates')
          .first<{ count: number }>()
      )?.count
    ).toBe(1);
    expect((await create({ ...payload, title: 'Changed' })).status).toBe(409);
  });

  it('keeps one status history entry across retries and refuses stale offline versions', async () => {
    const { request, db } = createTestContext();
    const created = await (
      await request('/api/posts', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: 'Shelter' }),
      })
    ).json();
    const post = await db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .bind(created.id)
      .first<any>();
    const payload = {
      status: 'closed',
      statusLabel: 'Closed',
      requestId: 'status-retry-123',
      expectedUpdatedAt: post.updated_at,
      observedAt: new Date().toISOString(),
    };
    const update = (data: unknown) =>
      request(`/api/posts/${created.id}/status`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(data),
      });
    expect((await update(payload)).status).toBe(200);
    expect((await update(payload)).status).toBe(200);
    const stale = await update({
      ...payload,
      requestId: 'status-stale-123',
      status: 'available',
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).conflict).toBe(true);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS count FROM status_updates')
          .first<{ count: number }>()
      )?.count
    ).toBe(2);
    expect(
      (
        await db
          .prepare('SELECT current_status FROM posts WHERE id = ?')
          .bind(created.id)
          .first<any>()
      )?.current_status
    ).toBe('closed');
  });

  it('acks redelivered queue messages without duplicating history or reverting newer status', async () => {
    const { db, env } = createTestContext();
    await db
      .prepare(
        "INSERT INTO posts (id,title,current_status,status_label) VALUES ('queued','Queued','available','Open')"
      )
      .run();
    const ack = vi.fn(),
      retry = vi.fn();
    const message = {
      id: 'stable-message-id',
      body: {
        type: 'update_status',
        postId: 'queued',
        status: 'closed',
        statusLabel: 'Closed',
        note: null,
        ipHash: 'test',
        observedAt: '2026-10-01T00:00:00Z',
      },
      ack,
      retry,
    };
    const batch = {
      queue: 'tossa-write-queue',
      messages: [message],
    } as unknown as MessageBatch<any>;
    await processWriteQueueBatch(batch, env);
    await processWriteQueueBatch(batch, env);
    expect(ack).toHaveBeenCalledTimes(2);
    message.id = 'older-message';
    message.body.status = 'available';
    message.body.observedAt = '2026-09-30T00:00:00Z';
    await processWriteQueueBatch(batch, env);
    expect(ack).toHaveBeenCalledTimes(3);
    expect(
      (
        await db
          .prepare("SELECT current_status FROM posts WHERE id = 'queued'")
          .first()
      )?.current_status
    ).toBe('closed');
    expect(retry).not.toHaveBeenCalled();
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS count FROM status_updates')
          .first<{ count: number }>()
      )?.count
    ).toBe(1);
  });

  it('finds nearby posts outside the newest 50 and paginates consistently, including dateline bounds', async () => {
    const { request, db } = createTestContext();
    for (let i = 0; i < 61; i++)
      await db
        .prepare(
          'INSERT INTO posts (id,title,current_status,status_label,lat,lng,updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .bind(
          `p${i.toString().padStart(3, '0')}`,
          `Post ${i}`,
          'available',
          'Open',
          i === 0 ? 35 : 36,
          i === 0 ? 139 : 140,
          i === 0 ? '2020-01-01' : '2026-10-01'
        )
        .run();
    const near = await (await request('/api/posts?lat=35&lng=139')).json();
    expect(near.posts[0].id).toBe('p000');
    const first = await (await request('/api/posts?limit=50')).json();
    const second = await (
      await request('/api/posts?limit=50&offset=50')
    ).json();
    expect(first.total).toBe(61);
    expect(second.posts).toHaveLength(11);
    expect(
      new Set([...first.posts, ...second.posts].map((p) => p.id)).size
    ).toBe(61);
    const bounds = await (
      await request('/api/posts?bbox=138,34,139.5,35.5')
    ).json();
    expect(bounds.posts.map((p: any) => p.id)).toEqual(['p000']);
    for (const query of [
      'limit=-1',
      'limit=101',
      'offset=NaN',
      'lat=91&lng=0',
      'bbox=0,10,5,0',
    ])
      expect((await request(`/api/posts?${query}`)).status).toBe(400);
  });
});

describe('Backup recovery and observation freshness', () => {
  it('downloads private archives only for a current administrator and never caches the response', async () => {
    const { db, env, request } = createTestContext();
    await user(db, 'backup-admin', 'admin');
    await user(db, 'backup-moderator', 'moderator');
    const get = vi.fn(async () => ({
      body: new Response('{"private":true}').body,
    }));
    env.BACKUPS_BUCKET = { get } as unknown as R2Bucket;
    const path =
      '/api/settings/backup-download?key=backups%2Ftossa_backup_2026-10-04T00-00-00-000Z.json';
    expect((await request(path)).status).toBe(401);
    const moderator = await createSessionToken(
      {
        userId: 'backup-moderator',
        username: 'backup-moderator',
        role: 'moderator',
      },
      env.JWT_SECRET
    );
    expect(
      (
        await request(path, {
          headers: { Authorization: `Bearer ${moderator}` },
        })
      ).status
    ).toBe(403);
    const admin = await createSessionToken(
      { userId: 'backup-admin', username: 'backup-admin', role: 'admin' },
      env.JWT_SECRET
    );
    const headers = { Authorization: `Bearer ${admin}` };
    const response = await request(path, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ private: true });
    expect(
      (
        await request(
          '/api/settings/backup-download?key=backups%2Ftossa_backup_2026-10-04T00-00-00-000Z_12345678-1234-1234-1234-123456789abc.json',
          { headers }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await request(
          '/api/settings/backup-download?key=backups%2Ftossa_backup_2026-10-04T00-00-00-000Z_12345678123412341234123456789abc.json',
          { headers }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await request('/api/settings/backup-download?key=img_private.png', {
          headers,
        })
      ).status
    ).toBe(400);
    await db
      .prepare("UPDATE users SET role='user' WHERE id='backup-admin'")
      .run();
    expect((await request(path, { headers })).status).toBe(403);
    expect(get).toHaveBeenCalledTimes(3);
  });
  it('migrates existing records without losing history or authenticated administrator access', () => {
    const db = new DatabaseSync(':memory:');
    const oldSchema = readFileSync('schema.sql', 'utf8').replace(
      /^.*observed_at TEXT.*\n/m,
      ''
    );
    db.exec(oldSchema);
    db.exec(`
      INSERT INTO users (id,username,display_name,role) VALUES
        ('admin','admin','Administrator','admin'), ('incomplete','incomplete','Incomplete','admin');
      INSERT INTO credentials (id,user_id,public_key,counter) VALUES ('key','admin','public-key',0);
      INSERT INTO posts (id,title,current_status,status_label,is_verified,updated_at)
        VALUES ('existing','既存の投稿','available','Open',1,'2026-10-01 12:00:00');
      INSERT INTO status_updates (id,post_id,status,status_label,note)
        VALUES ('history','existing','available','Open','履歴');
    `);
    db.exec(readFileSync('scripts/migrate-reliability.sql', 'utf8'));
    expect(
      db.prepare('SELECT role FROM users WHERE id = ?').get('admin')?.role
    ).toBe('admin');
    expect(
      db.prepare('SELECT role FROM users WHERE id = ?').get('incomplete')?.role
    ).toBe('user');
    expect(
      db.prepare('SELECT title,is_verified,observed_at FROM posts').get()
    ).toMatchObject({
      title: '既存の投稿',
      is_verified: 0,
      observed_at: '2026-10-01 12:00:00',
    });
    expect(db.prepare('SELECT note FROM status_updates').get()?.note).toBe(
      '履歴'
    );
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
  it('fails the entire backup when a required table is missing', async () => {
    const { db, env } = createTestContext();
    const put = vi.fn();
    env.BACKUPS_BUCKET = { put } as unknown as R2Bucket;
    await db.prepare('DROP TABLE mutation_receipts').run();
    const result = await performDatabaseBackup(env);
    expect(result.success).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it('restores a complete archive into an isolated database with foreign keys, and rejects incomplete archives', async () => {
    const { db, env } = createTestContext();
    let archive = '';
    env.BACKUPS_BUCKET = {
      createMultipartUpload: async (key: string) => {
        const parts: Uint8Array[] = [];
        return {
          uploadPart: async (partNumber: number, body: Uint8Array) => {
            parts[partNumber - 1] = body.slice();
            return { partNumber, etag: String(partNumber) };
          },
          complete: async () => {
            archive = Buffer.concat(parts).toString('utf8');
            return { key, size: Buffer.byteLength(archive) };
          },
          abort: vi.fn(),
        };
      },
      list: async () => ({ objects: [], truncated: false }),
    } as unknown as R2Bucket;
    await user(db, 'recovery-admin', 'admin');
    await db
      .prepare(
        "INSERT INTO disasters (id,name,disaster_type) VALUES ('disaster','Test flood','flood')"
      )
      .run();
    await db
      .prepare(
        'INSERT INTO posts (id,title,current_status,status_label,author_id,disaster_id,note) VALUES (?,?,?,?,?,?,?)'
      )
      .bind(
        'recovery-post',
        "O'Brien",
        'available',
        'Open',
        'recovery-admin',
        'disaster',
        '日本語の末尾'
      )
      .run();
    expect((await performDatabaseBackup(env)).success).toBe(true);
    const complete = JSON.parse(archive);
    expect(complete.data.posts[0].note).toBe('日本語の末尾');
    // Node 22's SQLite text reader truncates at NUL. Inject the edge case
    // into the archive and verify stored bytes rather than its text reader.
    // Include large primary and ordinary text values. The multibyte sequence
    // crosses a staging chunk boundary, and the NUL verifies byte-exact BLOB
    // concatenation rather than SQLite text concatenation semantics.
    const largePostId = `post-${'鍵'.repeat(30_000)}`;
    const largeTitle = `title-${'x'.repeat(90_000)}`;
    const mediumArea = 'a'.repeat(22_000);
    const mediumAddress = 'b'.repeat(22_000);
    const mediumUrl = 'c'.repeat(22_000);
    const chunkBoundaryPrefix = 'a'.repeat(24 * 1024 - 1);
    const largeNote = `${chunkBoundaryPrefix}🗾\u0000${'末'.repeat(30_000)}`;
    complete.data.posts[0].id = largePostId;
    complete.data.posts[0].title = largeTitle;
    complete.data.posts[0].area = mediumArea;
    complete.data.posts[0].address = mediumAddress;
    complete.data.posts[0].url = mediumUrl;
    complete.data.posts[0].note = largeNote;
    archive = JSON.stringify(complete);
    const dir = mkdtempSync(join(tmpdir(), 'tossa-recovery-'));
    const input = join(dir, 'backup.json'),
      output = join(dir, 'recovered.sql');
    writeFileSync(input, archive, { mode: 0o600 });
    execFileSync(process.execPath, [
      'scripts/restore-backup.mjs',
      input,
      output,
    ]);
    const recovered = new DatabaseSync(':memory:');
    recovered.exec('PRAGMA foreign_keys = ON');
    const recoverySql = readFileSync(output, 'utf8');
    expect(
      recoverySql
        .split(';')
        .every((statement) => Buffer.byteLength(statement, 'utf8') <= 64 * 1024)
    ).toBe(true);
    recovered.exec(recoverySql);
    expect(
      recovered.prepare('SELECT hex(note) AS note FROM posts').get()?.note
    ).toBe(Buffer.from(largeNote).toString('hex').toUpperCase());
    expect(recovered.prepare('SELECT hex(id) AS id FROM posts').get()?.id).toBe(
      Buffer.from(largePostId).toString('hex').toUpperCase()
    );
    expect(
      recovered.prepare('SELECT hex(title) AS title FROM posts').get()?.title
    ).toBe(Buffer.from(largeTitle).toString('hex').toUpperCase());
    expect(
      recovered.prepare('SELECT area,address,url FROM posts').get()
    ).toEqual({
      area: mediumArea,
      address: mediumAddress,
      url: mediumUrl,
    });
    expect(
      recovered
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = '__tossa_restore_text_stage'"
        )
        .get()
    ).toBeUndefined();
    expect(
      recovered.prepare('SELECT COUNT(*) AS count FROM disasters').get()?.count
    ).toBe(1);
    expect(recovered.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    for (const table of BACKUP_TABLES)
      expect(
        recovered.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count
      ).toBe(JSON.parse(archive).metadata.tableCounts[table]);
    recovered.close();
    const incomplete = JSON.parse(archive);
    delete incomplete.data.disasters;
    writeFileSync(input, JSON.stringify(incomplete));
    const rejected = join(dir, 'rejected.sql');
    expect(() =>
      execFileSync(
        process.execPath,
        ['scripts/restore-backup.mjs', input, rejected],
        { stdio: 'pipe' }
      )
    ).toThrow();
    expect(existsSync(rejected)).toBe(false);
  });

  it('uses UTC observation and confirmation time rather than upload time to flag stale information', () => {
    const now = Date.parse('2026-10-04T01:00:00Z');
    expect(informationAge('2026-10-04 00:30:00', null, now).needsRecheck).toBe(
      false
    );
    expect(informationAge('2026-10-03T22:00:00Z', null, now).needsRecheck).toBe(
      true
    );
    expect(
      informationAge('2026-10-03T22:00:00Z', '2026-10-04 00:30:00', now)
        .needsRecheck
    ).toBe(false);
    expect(informationAge('invalid', null, now).needsRecheck).toBe(true);
  });
});
