// src/services/backup.ts: Automated D1 Database Backup, R2 Archival & Retention Rotation
import type { Bindings } from '../types';

export const BACKUP_TABLES = [
  'categories',
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
  const maxRetention = options.maxRetention ?? 30;
  const timestamp = new Date().toISOString();
  const tableCounts: Record<string, number> = {};
  const data: Record<string, any[]> = {};
  let totalRecords = 0;

  try {
    // 1. Sequentially dump each whitelisted table
    for (const table of BACKUP_TABLES) {
      try {
        const query = `SELECT * FROM ${table}`;
        const stmt = env.DB.prepare(query);
        const { results } = await stmt.all();
        const records = Array.isArray(results) ? results : [];
        data[table] = records;
        tableCounts[table] = records.length;
        totalRecords += records.length;
      } catch (err: any) {
        // Handle case where table might not exist in an older migration
        console.warn(
          `[Backup] Table ${table} dump skipped or failed:`,
          err?.message
        );
        data[table] = [];
        tableCounts[table] = 0;
      }
    }

    const metadata: BackupMetadata = {
      version: 1,
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

    // 2. Archive to R2 if IMAGES_BUCKET is bound
    if (env.IMAGES_BUCKET) {
      await env.IMAGES_BUCKET.put(backupKey, jsonString, {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          createdAt: timestamp,
          totalRecords: String(totalRecords),
          version: '1',
        },
      });

      // 3. Rotation: Keep the newest `maxRetention` backups, delete older ones
      try {
        const listResult = await env.IMAGES_BUCKET.list({ prefix: 'backups/' });
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
            await env.IMAGES_BUCKET.delete(item.key);
            deletedOldBackups.push(item.key);
          }
        }
      } catch (rotErr: any) {
        console.warn('[Backup] Rotation cleanup error:', rotErr?.message);
      }
    } else {
      console.info(
        '[Backup] IMAGES_BUCKET not bound. Backup generated in memory only.'
      );
    }

    return {
      success: true,
      backupKey: env.IMAGES_BUCKET ? backupKey : undefined,
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
  if (!env.IMAGES_BUCKET) {
    return [];
  }

  const listResult = await env.IMAGES_BUCKET.list({ prefix: 'backups/' });
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
