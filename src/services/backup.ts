// D1 snapshot staging and bounded R2 archival. The v2 JSON shape remains the
// restore contract; rows are serialized one at a time from immutable shadows.
import type { Bindings } from '../types';

export const BACKUP_TABLES = [
  'categories',
  'disasters',
  'posts',
  'status_updates',
  'post_verifications',
  'users',
  'credentials',
  'system_settings',
  'threads',
  'thread_members',
  'messages',
  'device_sessions',
  'access_logs',
  'device_user_links',
  'push_subscriptions',
  'mutation_receipts',
  'post_reports',
] as const;

export interface BackupMetadata {
  version: number;
  timestamp: string;
  totalRecords: number;
  tableCounts: Record<string, number>;
}

export interface BackupResult {
  success: boolean;
  busy?: boolean;
  backupKey?: string;
  metadata?: BackupMetadata;
  deletedOldBackups?: string[];
  error?: string;
  sizeBytes?: number;
  durationMs?: number;
}

const SNAPSHOT_PREFIX = 'tossa_backup_snapshot_';
const LEASE_TTL_MS = 20 * 60 * 1000;
const LEASE_TABLE = 'tossa_backup_control';
const PAGE_CANDIDATES = 128;
const PAGE_RAW_BYTES = 256 * 1024;
const MAX_RAW_ROW_BYTES = 2_000_000;
// Leaves D1/R2 subrequest headroom for leases, staging, cleanup and rotation.
export const BACKUP_MAX_PAGES = 200;
const R2_MIN_PART_BYTES = 5 * 1024 * 1024;
const MAX_R2_PARTS = 10_000;
const ABANDONED_SNAPSHOT_CLEANUP_LIMIT = 100;
const MAX_ROTATION_DELETES = 100;

interface Lease {
  token: string;
  fence: number;
}

class BackupAlreadyRunningError extends Error {
  constructor() {
    super('Another database backup is already running');
    this.name = 'BackupAlreadyRunningError';
  }
}

interface TableSnapshot {
  source: (typeof BACKUP_TABLES)[number];
  shadow: string;
  columns: string[];
  count: number;
}

/**
 * Copies all source tables in one D1 batch, then streams immutable snapshots
 * into an R2 multipart upload. Only one complete v2 archive is retained.
 */
export async function performDatabaseBackup(
  env: Bindings,
  options: { maxRetention?: number } = {}
): Promise<BackupResult> {
  const startedAt = performance.now();
  const maxRetention = Math.max(1, Math.min(options.maxRetention ?? 30, 365));
  const timestamp = new Date().toISOString();
  const runId = `${timestamp.slice(0, 19).replace(/[-:]/g, '')}Z_${crypto.randomUUID().replace(/-/g, '')}`;
  const backupKey = `backups/tossa_backup_${timestamp.replace(/[:.]/g, '-')}_${runId.split('_').at(-1)}.json`;
  const staged: string[] = [];
  let lease: Lease | undefined;
  let multipart: R2MultipartUpload | undefined;
  let completed = false;

  try {
    if (!env.BACKUPS_BUCKET)
      throw new Error('Private BACKUPS_BUCKET is not configured');

    lease = await acquireLease(env.DB);
    await cleanupAbandonedSnapshots(env.DB, runId);

    const snapshotPrefix = `${SNAPSHOT_PREFIX}${runId}_`;
    for (const table of BACKUP_TABLES) staged.push(`${snapshotPrefix}${table}`);
    await renewLease(env.DB, lease);

    // D1 batch is transactional. The source is read only by these CTAS
    // statements; every later page is read from a frozen shadow table.
    const snapshotStartedAt = performance.now();
    const createResults = await env.DB.batch(
      BACKUP_TABLES.map((table, index) =>
        env.DB.prepare(
          `CREATE TABLE ${quoteIdentifier(staged[index]!)} AS SELECT * FROM ${quoteIdentifier(table)}`
        )
      )
    );
    if (
      createResults.length !== BACKUP_TABLES.length ||
      createResults.some((r) => !r.success)
    )
      throw new Error('Could not create a complete database snapshot');

    const snapshots = await readSnapshotMetadata(env.DB, staged);
    const tableCounts: Record<string, number> = {};
    let totalRecords = 0;
    for (const snapshot of snapshots) {
      tableCounts[snapshot.source] = snapshot.count;
      totalRecords += snapshot.count;
    }
    const metadata: BackupMetadata = {
      version: 2,
      timestamp,
      totalRecords,
      tableCounts,
    };
    const snapshotDurationMs = Math.round(
      performance.now() - snapshotStartedAt
    );

    multipart = await env.BACKUPS_BUCKET.createMultipartUpload(backupKey, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        createdAt: timestamp,
        totalRecords: String(totalRecords),
        version: '2',
        snapshotDurationMs: String(snapshotDurationMs),
      },
    });

    const parts: R2UploadedPart[] = [];
    const writer = new MultipartJsonWriter(async (bytes) => {
      if (parts.length >= MAX_R2_PARTS)
        throw new Error(
          `Backup exceeds the R2 multipart limit of ${MAX_R2_PARTS} parts`
        );
      const number = parts.length + 1;
      parts.push(await multipart!.uploadPart(number, bytes));
    });

    await writer.write(`{"metadata":${JSON.stringify(metadata)},"data":{`);
    let pages = 0;
    for (const [tableIndex, snapshot] of snapshots.entries()) {
      if (tableIndex > 0) await writer.write(',');
      await writer.write(`${JSON.stringify(snapshot.source)}:[`);
      let afterRowid = 0;
      let firstRow = true;
      let serializedCount = 0;
      while (true) {
        await renewLease(env.DB, lease);
        const page = await readBoundedPage(env.DB, snapshot, afterRowid);
        if (page.rows.length === 0) break;
        if (++pages > BACKUP_MAX_PAGES)
          throw new Error(
            `Backup exceeded the ${BACKUP_MAX_PAGES}-page safety limit`
          );
        for (const row of page.rows) {
          const record: Record<string, unknown> = {};
          for (const column of snapshot.columns) record[column] = row[column];
          if (!firstRow) await writer.write(',');
          await writer.write(JSON.stringify(record));
          firstRow = false;
          serializedCount++;
        }
        afterRowid = page.lastRowid;
      }
      if (serializedCount !== snapshot.count)
        throw new Error(
          `Snapshot row count changed while serializing ${snapshot.source}`
        );
      await writer.write(']');
    }
    await writer.write('}}');
    await writer.finish();

    await renewLease(env.DB, lease);
    const stored = await multipart.complete(parts);
    completed = true;
    multipart = undefined;
    try {
      await renewLease(env.DB, lease);
    } catch (leaseError) {
      try {
        await env.BACKUPS_BUCKET.delete(backupKey);
      } catch (deleteError) {
        console.warn(
          '[Backup] Could not remove archive completed after lease loss:',
          errorMessage(deleteError)
        );
      }
      throw leaseError;
    }

    // The archive is now durable. Cleanup and retention failures are warnings
    // and cannot turn a complete archive into a reported failure.
    try {
      await cleanupSnapshots(env.DB, staged);
    } catch (cleanupError) {
      console.warn(
        '[Backup] Snapshot cleanup failed after archive completion:',
        errorMessage(cleanupError)
      );
    } finally {
      staged.length = 0;
    }
    let deletedOldBackups: string[] = [];
    try {
      await renewLease(env.DB, lease);
      deletedOldBackups = await rotateBackups(
        env.BACKUPS_BUCKET,
        maxRetention,
        backupKey,
        () => renewLease(env.DB, lease!)
      );
    } catch (rotationError) {
      console.warn(
        '[Backup] Rotation cleanup error:',
        errorMessage(rotationError)
      );
    }

    return {
      success: true,
      backupKey,
      metadata,
      deletedOldBackups,
      sizeBytes: stored.size,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    console.error('[Backup] Critical database backup failure:', error);
    if (multipart && !completed) {
      try {
        await multipart.abort();
      } catch (abortError) {
        console.warn(
          '[Backup] Multipart abort failed:',
          errorMessage(abortError)
        );
      }
    }
    if (staged.length > 0) {
      try {
        await cleanupSnapshots(env.DB, staged);
      } catch (cleanupError) {
        console.warn(
          '[Backup] Snapshot cleanup failed:',
          errorMessage(cleanupError)
        );
      }
    }
    return {
      success: false,
      busy: error instanceof BackupAlreadyRunningError,
      error: errorMessage(error),
      durationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    if (lease) {
      try {
        await releaseLease(env.DB, lease);
      } catch (releaseError) {
        console.warn(
          '[Backup] Lease release failed:',
          errorMessage(releaseError)
        );
      }
    }
  }
}

class MultipartJsonWriter {
  private readonly buffer = new Uint8Array(R2_MIN_PART_BYTES);
  private usedBytes = 0;
  private partCount = 0;

  constructor(private readonly upload: (bytes: Uint8Array) => Promise<void>) {}

  async write(value: string): Promise<void> {
    const encoded = new TextEncoder().encode(value);
    let offset = 0;
    while (offset < encoded.byteLength) {
      const count = Math.min(
        this.buffer.byteLength - this.usedBytes,
        encoded.byteLength - offset
      );
      this.buffer.set(encoded.subarray(offset, offset + count), this.usedBytes);
      this.usedBytes += count;
      offset += count;
      if (this.usedBytes === this.buffer.byteLength) {
        await this.upload(this.buffer.slice());
        this.usedBytes = 0;
        this.partCount++;
      }
    }
  }

  async finish(): Promise<void> {
    if (this.usedBytes > 0 || this.partCount === 0)
      await this.upload(this.buffer.slice(0, this.usedBytes));
    this.usedBytes = 0;
  }
}

async function acquireLease(db: D1Database): Promise<Lease> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${LEASE_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lease_token TEXT,
      lease_until INTEGER,
      fence INTEGER NOT NULL DEFAULT 0
    )`
    )
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO ${LEASE_TABLE} (id, lease_token, lease_until, fence) VALUES (1, NULL, 0, 0)`
    )
    .run();

  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE ${LEASE_TABLE}
       SET lease_token = ?, lease_until = ?, fence = fence + 1
     WHERE id = 1 AND (lease_until IS NULL OR lease_until <= ?)
     RETURNING fence`
    )
    .bind(token, now + LEASE_TTL_MS, now)
    .all<{ fence: number }>();
  const acquired = result.results?.[0];
  if (!result.success || !acquired) throw new BackupAlreadyRunningError();
  return { token, fence: Number(acquired.fence) };
}

async function renewLease(db: D1Database, lease: Lease): Promise<void> {
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE ${LEASE_TABLE} SET lease_until = ?
     WHERE id = 1 AND lease_token = ? AND fence = ? AND lease_until > ?
     RETURNING id`
    )
    .bind(now + LEASE_TTL_MS, lease.token, lease.fence, now)
    .all<{ id: number }>();
  if (!result.success || !result.results?.length)
    throw new Error('Database backup lease expired or was taken over');
}

async function releaseLease(db: D1Database, lease: Lease): Promise<void> {
  await db
    .prepare(
      `UPDATE ${LEASE_TABLE} SET lease_token = NULL, lease_until = 0
     WHERE id = 1 AND lease_token = ? AND fence = ?`
    )
    .bind(lease.token, lease.fence)
    .run();
}

async function readSnapshotMetadata(
  db: D1Database,
  shadows: string[]
): Promise<TableSnapshot[]> {
  const results = await db.batch<{ count: number }>(
    shadows.map((shadow) =>
      db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(shadow)}`)
    )
  );
  const snapshots: TableSnapshot[] = [];
  for (let index = 0; index < shadows.length; index++) {
    const table = BACKUP_TABLES[index]!;
    const shadow = shadows[index]!;
    const result = results[index];
    if (!result?.success || !result.results?.[0])
      throw new Error(`Could not count snapshot rows for ${table}`);
    const schema = await db
      .prepare(`PRAGMA table_info(${quoteIdentifier(shadow)})`)
      .all<{
        name: string;
      }>();
    if (!schema.success || !Array.isArray(schema.results))
      throw new Error(`Could not inspect snapshot columns for ${table}`);
    snapshots.push({
      source: table,
      shadow,
      columns: schema.results.map((column) => column.name),
      count: Number(result.results[0].count),
    });
  }
  return snapshots;
}

interface SnapshotPage {
  rows: Record<string, unknown>[];
  lastRowid: number;
}

async function readBoundedPage(
  db: D1Database,
  snapshot: TableSnapshot,
  afterRowid: number
): Promise<SnapshotPage> {
  const shadow = quoteIdentifier(snapshot.shadow);
  const byteExpr = snapshot.columns.length
    ? snapshot.columns
        .map(
          (column) =>
            `COALESCE(length(CAST(${quoteIdentifier(column)} AS BLOB)), 0)`
        )
        .join(' + ')
    : '0';
  const candidates = await db
    .prepare(
      `SELECT rowid AS __backup_rowid, (${byteExpr}) AS __backup_bytes
       FROM ${shadow} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE_CANDIDATES}`
    )
    .bind(afterRowid)
    .all<{ __backup_rowid: number; __backup_bytes: number }>();
  if (!candidates.success || !Array.isArray(candidates.results))
    throw new Error(`Could not inspect snapshot page for ${snapshot.source}`);
  if (!candidates.results.length) return { rows: [], lastRowid: afterRowid };

  let rawBytes = 0;
  let selectedRows = 0;
  let lastRowid = afterRowid;
  for (const candidate of candidates.results) {
    const rowBytes = Number(candidate.__backup_bytes);
    if (
      !Number.isFinite(rowBytes) ||
      rowBytes < 0 ||
      rowBytes > MAX_RAW_ROW_BYTES
    )
      throw new Error(
        `Snapshot row in ${snapshot.source} exceeds the 2 MB row safety limit`
      );
    if (selectedRows > 0 && rawBytes + rowBytes > PAGE_RAW_BYTES) break;
    rawBytes += rowBytes;
    selectedRows++;
    lastRowid = Number(candidate.__backup_rowid);
    if (rawBytes >= PAGE_RAW_BYTES) break;
  }
  if (lastRowid === afterRowid) {
    const first = candidates.results[0]!;
    lastRowid = Number(first.__backup_rowid);
  }
  const rows = await db
    .prepare(
      `SELECT * FROM ${shadow} WHERE rowid > ? AND rowid <= ? ORDER BY rowid`
    )
    .bind(afterRowid, lastRowid)
    .all<Record<string, unknown>>();
  if (!rows.success || !Array.isArray(rows.results))
    throw new Error(`Could not read snapshot rows for ${snapshot.source}`);
  return { rows: rows.results, lastRowid };
}

async function cleanupSnapshots(
  db: D1Database,
  tableNames: string[]
): Promise<void> {
  for (const name of tableNames) {
    if (!isSnapshotName(name)) continue;
    await db.prepare(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`).run();
  }
}

async function cleanupAbandonedSnapshots(
  db: D1Database,
  activeRunId: string
): Promise<void> {
  const result = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`
    )
    .bind(`${SNAPSHOT_PREFIX}%`)
    .all<{ name: string }>();
  if (!result.success || !Array.isArray(result.results))
    throw new Error('Could not inspect abandoned backup snapshots');
  const abandonedNames = result.results
    .map((row) => row.name)
    .filter(
      (name) =>
        isSnapshotName(name) &&
        !name.startsWith(`${SNAPSHOT_PREFIX}${activeRunId}_`)
    );
  const toClean = abandonedNames.slice(0, ABANDONED_SNAPSHOT_CLEANUP_LIMIT);
  await cleanupSnapshots(db, toClean);
  if (abandonedNames.length > ABANDONED_SNAPSHOT_CLEANUP_LIMIT)
    throw new Error(
      `Removed ${toClean.length} abandoned snapshot tables; retry backup to continue cleanup`
    );
}

function isSnapshotName(name: string): boolean {
  return new RegExp(
    `^${SNAPSHOT_PREFIX}\\d{8}T\\d{6}Z_[a-f0-9]{32}_(?:${BACKUP_TABLES.join('|')})$`
  ).test(name);
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier))
    throw new Error(`Invalid SQLite identifier: ${identifier}`);
  return `"${identifier}"`;
}

async function rotateBackups(
  bucket: R2Bucket,
  maxRetention: number,
  keepKey: string,
  verifyLease: () => Promise<void>
): Promise<string[]> {
  const objects = await listBackupObjects(bucket);
  if (objects.length <= maxRetention) return [];
  const sorted = [...objects].sort(
    (a, b) => backupCreatedAt(a) - backupCreatedAt(b)
  );
  const deletable = sorted.filter((object) => object.key !== keepKey);
  const excess = Math.max(0, objects.length - maxRetention);
  const deleted: string[] = [];
  const toDelete = deletable.slice(0, Math.min(excess, MAX_ROTATION_DELETES));
  for (const object of toDelete) {
    await verifyLease();
    await bucket.delete(object.key);
    deleted.push(object.key);
  }
  if (toDelete.length < excess)
    console.warn(
      `[Backup] Rotation deferred ${excess - toDelete.length} deletions to keep cleanup bounded`
    );
  return deleted;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown backup error';
}

/** Lists stored backups in R2. */
export async function listStoredBackups(env: Bindings): Promise<
  Array<{
    key: string;
    size: number;
    uploaded?: Date;
    snapshotAt?: string;
    totalRecords?: number;
    snapshotDurationMs?: number;
  }>
> {
  if (!env.BACKUPS_BUCKET) return [];
  const objects = await listBackupObjects(env.BACKUPS_BUCKET);
  const sorted = [...objects].sort((a, b) => {
    return backupCreatedAt(b) - backupCreatedAt(a);
  });
  return sorted.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded,
    snapshotAt: validIsoDate(obj.customMetadata?.createdAt),
    totalRecords: nonnegativeNumber(obj.customMetadata?.totalRecords),
    snapshotDurationMs: nonnegativeNumber(
      obj.customMetadata?.snapshotDurationMs
    ),
  }));
}

function validIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function backupCreatedAt(object: R2Object): number {
  const created = Date.parse(object.customMetadata?.createdAt ?? '');
  return Number.isFinite(created)
    ? created
    : object.uploaded
      ? new Date(object.uploaded).getTime()
      : 0;
}

function nonnegativeNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

async function listBackupObjects(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: 'backups/',
      cursor,
      include: ['customMetadata'],
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}
