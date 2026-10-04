// src/services/backup.ts: Automated D1 Database Backup, R2 Archival & Retention Rotation
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

export interface BackupPayload {
  metadata: BackupMetadata;
  data: Record<string, any[]>;
}

export interface BackupResult {
  success: boolean;
  backupKey?: string;
  metadata?: BackupMetadata;
  deletedOldBackups?: string[];
  error?: string;
}

/**
 * Dumps all D1 tables, serializes to JSON, saves to R2 (under backups/),
 * and automatically rotates/cleans up backups exceeding retention limits.
 */
export async function performDatabaseBackup(
  env: Bindings,
  options: { maxRetention?: number } = {}
): Promise<BackupResult> {
  const maxRetention = Math.max(1, Math.min(options.maxRetention ?? 30, 365));
  const timestamp = new Date().toISOString();
  const tableCounts: Record<string, number> = {};
  const data: Record<string, any[]> = {};
  let totalRecords = 0;

  try {
    if (!env.BACKUPS_BUCKET)
      throw new Error('Private BACKUPS_BUCKET is not configured');
    // D1 batch is a transaction: all tables come from one consistent snapshot.
    // Any missing table or query failure fails the backup, rather than creating
    // an incomplete archive labelled as successful.
    const dumps = await env.DB.batch(
      BACKUP_TABLES.map((table) => env.DB.prepare(`SELECT * FROM ${table}`))
    );
    for (const [index, table] of BACKUP_TABLES.entries()) {
      const dump = dumps[index];
      if (!dump?.success || !Array.isArray(dump.results))
        throw new Error(`Backup failed for ${table}`);
      const records = dump.results;
      data[table] = records;
      tableCounts[table] = records.length;
      totalRecords += records.length;
    }

    const metadata: BackupMetadata = {
      version: 2,
      timestamp,
      totalRecords,
      tableCounts,
    };

    const payload: BackupPayload = {
      metadata,
      data,
    };

    const jsonString = JSON.stringify(payload);
    const sanitizedTs = timestamp.replace(/[:.]/g, '-');
    const backupKey = `backups/tossa_backup_${sanitizedTs}.json`;

    const deletedOldBackups: string[] = [];

    // 2. Archive to the private R2 bucket.
    if (env.BACKUPS_BUCKET) {
      await env.BACKUPS_BUCKET.put(backupKey, jsonString, {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          createdAt: timestamp,
          totalRecords: String(totalRecords),
          version: '2',
        },
      });

      // 3. Rotation: Keep the newest `maxRetention` backups, delete older ones
      try {
        const objects = await listBackupObjects(env.BACKUPS_BUCKET);
        const listResult = { objects };
        if (
          listResult &&
          listResult.objects &&
          listResult.objects.length > maxRetention
        ) {
          // Sort ascending by uploaded date (oldest first)
          const sorted = [...listResult.objects].sort((a, b) => {
            const timeA = a.uploaded ? new Date(a.uploaded).getTime() : 0;
            const timeB = b.uploaded ? new Date(b.uploaded).getTime() : 0;
            return timeA - timeB;
          });

          const toDelete = sorted.slice(0, sorted.length - maxRetention);
          for (const item of toDelete) {
            await env.BACKUPS_BUCKET.delete(item.key);
            deletedOldBackups.push(item.key);
          }
        }
      } catch (rotErr: any) {
        console.warn('[Backup] Rotation cleanup error:', rotErr?.message);
      }
    }

    return {
      success: true,
      backupKey: env.BACKUPS_BUCKET ? backupKey : undefined,
      metadata,
      deletedOldBackups,
    };
  } catch (error: any) {
    console.error('[Backup] Critical database backup failure:', error);
    return {
      success: false,
      error: error?.message || 'Unknown backup error',
    };
  }
}

/**
 * Lists stored backups in R2.
 */
export async function listStoredBackups(env: Bindings): Promise<
  Array<{
    key: string;
    size: number;
    uploaded?: Date;
    totalRecords?: number;
  }>
> {
  if (!env.BACKUPS_BUCKET) {
    return [];
  }

  const objects = await listBackupObjects(env.BACKUPS_BUCKET);
  const listResult = { objects };
  if (!listResult || !listResult.objects) {
    return [];
  }

  // Sort descending (newest first)
  const sorted = [...listResult.objects].sort((a, b) => {
    const timeA = a.uploaded ? new Date(a.uploaded).getTime() : 0;
    const timeB = b.uploaded ? new Date(b.uploaded).getTime() : 0;
    return timeB - timeA;
  });

  return sorted.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded,
    totalRecords: obj.customMetadata?.totalRecords
      ? parseInt(obj.customMetadata.totalRecords, 10)
      : undefined,
  }));
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
