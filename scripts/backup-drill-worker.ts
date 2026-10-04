import { BACKUP_TABLES, performDatabaseBackup } from '../src/services/backup';
import type { Bindings } from '../src/types';

interface DrillEnv {
  DB_SOURCE: D1Database;
  DB_DEST: D1Database;
  BACKUPS_BUCKET: R2Bucket;
}

const POST_COUNT = 150;
const FIXTURE_PREFIX = 'backup-drill-';
let multipartMetrics:
  | {
      partCount: number;
      completedPartCount: number;
      partBytes: number;
      partSizes: number[];
    }
  | undefined;

export default {
  async fetch(request: Request, env: DrillEnv): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return Response.json({ ready: true });
      if (request.method === 'POST' && url.pathname === '/seed')
        return Response.json(await seedFixture(env.DB_SOURCE));
      if (request.method === 'POST' && url.pathname === '/backup') {
        multipartMetrics = undefined;
        const result = await performDatabaseBackup({
          DB: env.DB_SOURCE,
          BACKUPS_BUCKET: instrumentR2Bucket(env.BACKUPS_BUCKET),
        } as Bindings);
        return Response.json(
          { ...result, multipart: multipartMetrics },
          { status: result.success ? 200 : 500 }
        );
      }
      if (request.method === 'GET' && url.pathname === '/object') {
        const key = url.searchParams.get('key');
        if (
          !key ||
          !/^backups\/tossa_backup_[0-9TZ-]+_[a-f0-9]{32}\.json$/.test(key)
        )
          return Response.json(
            { error: 'Invalid drill backup key' },
            { status: 400 }
          );
        const object = await env.BACKUPS_BUCKET.get(key);
        if (!object)
          return Response.json({ error: 'Backup not found' }, { status: 404 });
        return new Response(object.body, {
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          },
        });
      }
      if (request.method === 'POST' && url.pathname === '/verify') {
        const input = (await request.json()) as {
          expectedCounts?: Record<string, number>;
          key?: string;
        };
        return Response.json(await verifyDrill(env, input));
      }
      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'Drill worker failed',
        },
        { status: 500 }
      );
    }
  },
};

async function seedFixture(db: D1Database): Promise<{
  fixturePosts: number;
  titleBytes: { min: number; max: number; total: number };
}> {
  const unusualText = '災害情報 "復旧" / NUL:\u0000 / 終了';
  const filler = 'x'.repeat(40_000);
  const titles = Array.from(
    { length: POST_COUNT },
    (_, index) =>
      FIXTURE_PREFIX +
      'post-' +
      index +
      ':' +
      unusualText +
      ':' +
      (index === 0 ? 'large-value:' + 'y'.repeat(150_000) + ':' : '') +
      filler
  );
  const statements = [
    db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'user',
        FIXTURE_PREFIX + 'user',
        '避難所 "管理者"\u0000',
        'admin'
      ),
    db
      .prepare('INSERT INTO device_sessions (id, created_ua) VALUES (?, ?)')
      .bind(FIXTURE_PREFIX + 'device', 'backup-drill/日本語\u0000'),
    db
      .prepare(
        'INSERT INTO categories (id, name, icon, color, scope, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'category',
        '災害時の支援',
        '💧',
        '#2563eb',
        'both',
        0
      ),
    db
      .prepare(
        'INSERT INTO disasters (id, name, disaster_type, status, areas, note) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'disaster',
        '令和のテスト災害',
        'earthquake',
        'active',
        '["熊本市"]',
        unusualText
      ),
  ];
  for (let index = 0; index < POST_COUNT; index++) {
    statements.push(
      db
        .prepare(
          'INSERT INTO posts (id, category_id, title, area, address, current_status, status_label, note, author_id, author_cookie_id, disaster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          FIXTURE_PREFIX + 'post-' + index,
          FIXTURE_PREFIX + 'category',
          titles[index],
          '熊本市中央区',
          index === 0 ? null : '施設 ' + index + ' "受付"',
          'available',
          '開設中',
          index === 0 ? null : unusualText,
          FIXTURE_PREFIX + 'user',
          FIXTURE_PREFIX + 'device',
          FIXTURE_PREFIX + 'disaster'
        )
    );
  }
  statements.push(
    db
      .prepare(
        'INSERT INTO credentials (id, user_id, public_key, counter) VALUES (?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'credential',
        FIXTURE_PREFIX + 'user',
        'public-key-fixture',
        0
      ),
    db
      .prepare(
        'INSERT INTO system_settings (key, value, description) VALUES (?, ?, ?)'
      )
      .bind(FIXTURE_PREFIX + 'setting', unusualText, null),
    db
      .prepare(
        'INSERT INTO threads (id, title, type, post_id, created_by) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'thread',
        '復旧連絡 "試験"',
        'inquiry',
        FIXTURE_PREFIX + 'post-0',
        FIXTURE_PREFIX + 'user'
      ),
    db
      .prepare(
        'INSERT INTO thread_members (id, thread_id, user_id, encrypted_thread_key, ephemeral_public_key, role) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'member',
        FIXTURE_PREFIX + 'thread',
        FIXTURE_PREFIX + 'user',
        'encrypted-key',
        'ephemeral-key',
        'owner'
      ),
    db
      .prepare(
        'INSERT INTO messages (id, thread_id, sender_id, ciphertext, iv) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'message',
        FIXTURE_PREFIX + 'thread',
        FIXTURE_PREFIX + 'user',
        'ciphertext',
        'initialization-vector'
      ),
    db
      .prepare(
        'INSERT INTO status_updates (id, post_id, status, status_label, note) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'status',
        FIXTURE_PREFIX + 'post-0',
        'available',
        '開設中',
        unusualText
      ),
    db
      .prepare(
        'INSERT INTO post_verifications (id, post_id, reporter_ip_hash) VALUES (?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'verification',
        FIXTURE_PREFIX + 'post-0',
        'fixture-hash'
      ),
    db
      .prepare(
        'INSERT INTO access_logs (event_type, device_session_id, user_id, metadata) VALUES (?, ?, ?, ?)'
      )
      .bind(
        'post_created',
        FIXTURE_PREFIX + 'device',
        FIXTURE_PREFIX + 'user',
        JSON.stringify({ title: unusualText })
      ),
    db
      .prepare(
        'INSERT INTO device_user_links (device_session_id, user_id) VALUES (?, ?)'
      )
      .bind(FIXTURE_PREFIX + 'device', FIXTURE_PREFIX + 'user'),
    db
      .prepare(
        'INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_id, device_cookie_id, area) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'push',
        'https://example.invalid/backup-drill',
        'p256dh-fixture',
        'auth-fixture',
        FIXTURE_PREFIX + 'user',
        FIXTURE_PREFIX + 'device',
        null
      ),
    db
      .prepare(
        'INSERT INTO mutation_receipts (id, post_id, payload_hash) VALUES (?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'receipt',
        FIXTURE_PREFIX + 'post-0',
        'fixture-payload-hash'
      ),
    db
      .prepare(
        'INSERT INTO post_reports (id, post_id, post_title, device_cookie_id, reason, note) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(
        FIXTURE_PREFIX + 'report',
        FIXTURE_PREFIX + 'post-0',
        unusualText,
        FIXTURE_PREFIX + 'device',
        'outdated',
        ''
      )
  );

  await runBatch(db, statements.slice(0, 4));
  const posts = statements.slice(4, 4 + POST_COUNT);
  for (let offset = 0; offset < posts.length; offset += 50)
    await runBatch(db, posts.slice(offset, offset + 50));
  await runBatch(db, statements.slice(4 + POST_COUNT));
  const titleLengths = titles.map(
    (title) => new TextEncoder().encode(title).byteLength
  );
  return {
    fixturePosts: POST_COUNT,
    titleBytes: summarizeLengths(titleLengths),
  };
}

async function runBatch(
  db: D1Database,
  statements: D1PreparedStatement[]
): Promise<void> {
  const result = await db.batch(statements);
  if (
    result.length !== statements.length ||
    result.some((entry) => !entry.success)
  )
    throw new Error('Could not seed all synthetic backup-drill fixtures');
}

async function verifyDrill(
  env: DrillEnv,
  input: { expectedCounts?: Record<string, number>; key?: string }
) {
  if (!input.expectedCounts || !input.key)
    throw new Error('Expected backup metadata and key are required');
  const sourceCounts = await tableCounts(env.DB_SOURCE);
  const destinationCounts = await tableCounts(env.DB_DEST);
  const mismatches: string[] = [];
  for (const table of BACKUP_TABLES) {
    const expected = input.expectedCounts[table];
    if (expected !== sourceCounts[table]) mismatches.push('source:' + table);
    if (expected !== destinationCounts[table])
      mismatches.push('destination:' + table);
  }

  const sourcePosts = await env.DB_SOURCE.prepare(
    'SELECT id, title, address, note FROM posts WHERE id LIKE ? ORDER BY id'
  )
    .bind(FIXTURE_PREFIX + '%')
    .all<DrillPost>();
  const destinationPosts = await env.DB_DEST.prepare(
    'SELECT id, title, address, note FROM posts WHERE id LIKE ? ORDER BY id'
  )
    .bind(FIXTURE_PREFIX + '%')
    .all<DrillPost>();
  let stringBytesEqual =
    sourcePosts.results.length === destinationPosts.results.length;
  for (let index = 0; index < sourcePosts.results.length; index++) {
    const source = sourcePosts.results[index]!;
    const destination = destinationPosts.results[index];
    if (
      !destination ||
      source.id !== destination.id ||
      !sameUtf8Bytes(source.title, destination.title) ||
      !sameNullableString(source.address, destination.address) ||
      !sameNullableString(source.note, destination.note)
    )
      stringBytesEqual = false;
  }

  const sourceForeignKeys = await env.DB_SOURCE.prepare(
    'PRAGMA foreign_key_check'
  ).all();
  const destinationForeignKeys = await env.DB_DEST.prepare(
    'PRAGMA foreign_key_check'
  ).all();
  const sourceQuickCheck =
    await env.DB_SOURCE.prepare('PRAGMA quick_check').all<
      Record<string, string>
    >();
  const destinationQuickCheck =
    await env.DB_DEST.prepare('PRAGMA quick_check').all<
      Record<string, string>
    >();
  const sourceLease = await env.DB_SOURCE.prepare(
    'SELECT lease_token, lease_until FROM tossa_backup_control WHERE id = 1'
  ).first<{ lease_token: string | null; lease_until: number }>();
  const staged = await env.DB_SOURCE.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'tossa_backup_snapshot_%'"
  ).all<{ name: string }>();
  const backup = await env.BACKUPS_BUCKET.get(input.key);

  return {
    ok:
      mismatches.length === 0 &&
      stringBytesEqual &&
      sourceForeignKeys.results.length === 0 &&
      destinationForeignKeys.results.length === 0 &&
      quickCheckOk(sourceQuickCheck.results) &&
      quickCheckOk(destinationQuickCheck.results) &&
      sourceLease?.lease_token === null &&
      sourceLease.lease_until === 0 &&
      staged.results.length === 0 &&
      Boolean(backup),
    tableCount: BACKUP_TABLES.length,
    sourceCounts,
    destinationCounts,
    countMismatches: mismatches,
    stringBytesEqual,
    sourcePostCount: sourcePosts.results.length,
    sourceTitleByteLengths: summarizeLengths(
      sourcePosts.results.map(
        (post) => new TextEncoder().encode(post.title).byteLength
      )
    ),
    nullValuesEqual: sourcePosts.results.every((post, index) => {
      const restored = destinationPosts.results[index];
      return (
        restored &&
        post.address === restored.address &&
        post.note === restored.note
      );
    }),
    sourceForeignKeyViolations: sourceForeignKeys.results.length,
    destinationForeignKeyViolations: destinationForeignKeys.results.length,
    sourceQuickCheck: sourceQuickCheck.results,
    destinationQuickCheck: destinationQuickCheck.results,
    leaseReleased:
      sourceLease?.lease_token === null && sourceLease.lease_until === 0,
    leftoverSnapshotTables: staged.results.map((row) => row.name),
    backupObjectFound: Boolean(backup),
    backupObjectSize: backup?.size,
  };
}

interface DrillPost {
  id: string;
  title: string;
  address: string | null;
  note: string | null;
}

async function tableCounts(db: D1Database): Promise<Record<string, number>> {
  const results = await db.batch<{ count: number }>(
    BACKUP_TABLES.map((table) =>
      db.prepare('SELECT COUNT(*) AS count FROM "' + table + '"')
    )
  );
  return Object.fromEntries(
    BACKUP_TABLES.map((table, index) => [
      table,
      Number(results[index]?.results?.[0]?.count ?? -1),
    ])
  );
}

function sameUtf8Bytes(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index++)
    if (a[index] !== b[index]) return false;
  return true;
}

function sameNullableString(
  left: string | null,
  right: string | null
): boolean {
  return left === null
    ? right === null
    : right !== null && sameUtf8Bytes(left, right);
}

function quickCheckOk(results: Array<Record<string, string>>): boolean {
  return results.length === 1 && Object.values(results[0] ?? {})[0] === 'ok';
}

function summarizeLengths(lengths: number[]): {
  min: number;
  max: number;
  total: number;
} {
  return {
    min: Math.min(...lengths),
    max: Math.max(...lengths),
    total: lengths.reduce((sum, length) => sum + length, 0),
  };
}

function instrumentR2Bucket(bucket: R2Bucket): R2Bucket {
  return new Proxy(bucket, {
    get(target, property) {
      if (property === 'createMultipartUpload') {
        return async (key: string, options?: R2MultipartOptions) => {
          const upload = await target.createMultipartUpload(key, options);
          const partSizes: number[] = [];
          return {
            key: upload.key,
            uploadId: upload.uploadId,
            uploadPart: async (
              partNumber: number,
              value:
                ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
              partOptions?: R2UploadPartOptions
            ) => {
              const size = multipartPartSize(value);
              const part = await upload.uploadPart(
                partNumber,
                value,
                partOptions
              );
              partSizes.push(size);
              return part;
            },
            complete: async (parts: R2UploadedPart[]) => {
              const completed = await upload.complete(parts);
              multipartMetrics = {
                partCount: partSizes.length,
                completedPartCount: parts.length,
                partBytes: partSizes.reduce((sum, size) => sum + size, 0),
                partSizes: [...partSizes],
              };
              return completed;
            },
            abort: () => upload.abort(),
          } satisfies R2MultipartUpload;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function multipartPartSize(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob
): number {
  if (typeof value === 'string')
    return new TextEncoder().encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Blob) return value.size;
  throw new Error('The backup drill cannot measure a streaming multipart body');
}
