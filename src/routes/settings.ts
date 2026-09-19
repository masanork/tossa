// src/routes/settings.ts: System settings & mode toggling
import { Hono } from 'hono';
import type { Bindings, DisasterEvent, DisasterArea } from '../types';
import {
  getSystemSettings,
  updateSystemSetting,
  getActiveDisasters,
} from '../db/queries';
import { verifySessionToken } from '../auth/session';
import { broadcastPushNotification } from '../services/push';
import { performDatabaseBackup, listStoredBackups } from '../services/backup';
import {
  buildCapacityReport,
  runCapacityMaintenance,
} from '../services/capacity';
import { refreshPublicFeedSnapshot } from '../services/feedSnapshot';

export const settingsRoute = new Hono<{ Bindings: Bindings }>();

// GET /api/settings
settingsRoute.get('/', async (c) => {
  const settings = await getSystemSettings(c.env.DB);
  let activeDisasters: DisasterEvent[] = [];
  try {
    activeDisasters = await getActiveDisasters(c.env.DB);
  } catch {
    // Graceful fallback
  }

  // Automatic Disaster Mode Determination:
  // If there is >= 1 active disaster, system automatically operates in disaster mode!
  if (activeDisasters.length > 0) {
    settings.operation_mode = 'disaster';

    // Aggregate all areas across active disasters without duplicate codes
    const allAreas: DisasterArea[] = [];
    const seenCodes = new Set<string>();
    for (const d of activeDisasters) {
      for (const a of d.areas || []) {
        if (!seenCodes.has(a.code)) {
          seenCodes.add(a.code);
          allAreas.push(a);
        }
      }
    }
    settings.disaster_areas = JSON.stringify(allAreas);

    // If no explicit emergency banner is set, create one from active disasters
    if (!settings.emergency_banner) {
      settings.emergency_banner = activeDisasters
        .map((d) => d.banner_message || d.name)
        .filter(Boolean)
        .join(' / ');
    }
  } else if (
    !settings.operation_mode ||
    (settings.operation_mode === 'disaster' &&
      (!settings.disaster_areas || settings.disaster_areas === '[]'))
  ) {
    settings.operation_mode = 'normal';
  }

  c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
  return c.json({
    success: true,
    settings,
    active_disasters: activeDisasters,
  });
});

// POST /api/settings - Admin system settings update (dual-use mode toggle, area, banner, etc.)
settingsRoute.post('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<Record<string, string>>();

  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      await updateSystemSetting(c.env.DB, key, value);
    }
  }

  // Trigger emergency push broadcast if emergency banner was updated with content
  if (body.emergency_banner && body.emergency_banner.trim().length > 0) {
    broadcastPushNotification(c.env, {
      title: '【緊急通知】重要なお知らせ',
      body: body.emergency_banner.trim(),
      url: '/',
      alertType: 'emergency',
    }).catch((err) =>
      console.error('[push] settings emergency broadcast error:', err)
    );
  }

  const updated = await getSystemSettings(c.env.DB);
  let activeDisasters: DisasterEvent[] = [];
  try {
    activeDisasters = await getActiveDisasters(c.env.DB);
  } catch {
    // Graceful fallback
  }
  if (activeDisasters.length > 0) {
    updated.operation_mode = 'disaster';
    const allAreas: DisasterArea[] = [];
    const seenCodes = new Set<string>();
    for (const d of activeDisasters) {
      for (const a of d.areas || []) {
        if (!seenCodes.has(a.code)) {
          seenCodes.add(a.code);
          allAreas.push(a);
        }
      }
    }
    updated.disaster_areas = JSON.stringify(allAreas);
    if (!updated.emergency_banner) {
      updated.emergency_banner = activeDisasters
        .map((d) => d.banner_message || d.name)
        .filter(Boolean)
        .join(' / ');
    }
  } else if (
    !updated.operation_mode ||
    (updated.operation_mode === 'disaster' &&
      (!updated.disaster_areas || updated.disaster_areas === '[]'))
  ) {
    updated.operation_mode = 'normal';
  }

  return c.json({
    success: true,
    message: 'Settings updated successfully',
    settings: updated,
    active_disasters: activeDisasters,
  });
});

// POST /api/settings/backup - Trigger manual D1 backup to R2 (Admin only)
settingsRoute.post('/backup', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const result = await performDatabaseBackup(c.env);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 500);
  }

  return c.json({
    success: true,
    message: 'Database backup completed successfully',
    backupKey: result.backupKey,
    metadata: result.metadata,
    deletedOldBackups: result.deletedOldBackups,
  });
});

// GET /api/settings/backups - List backups stored in R2 (Admin only)
settingsRoute.get('/backups', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const backups = await listStoredBackups(c.env);
  return c.json({
    success: true,
    backups,
  });
});

async function requireAdmin(c: {
  req: { header: (name: string) => string | undefined };
  env: Bindings;
  json: (body: unknown, status?: number) => Response;
}): Promise<{ userId: string; role: string } | Response> {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  return session;
}

settingsRoute.get('/capacity', async (c) => {
  const auth = await requireAdmin(c);
  if (!('userId' in auth)) return auth;
  const report = await buildCapacityReport(c.env);
  return c.json({ success: true, report });
});

settingsRoute.post('/capacity/refresh', async (c) => {
  const auth = await requireAdmin(c);
  if (!('userId' in auth)) return auth;
  await refreshPublicFeedSnapshot(c.env, { force: true });
  const report = await buildCapacityReport(c.env);
  return c.json({ success: true, report });
});

settingsRoute.post('/capacity/maintain', async (c) => {
  const auth = await requireAdmin(c);
  if (!('userId' in auth)) return auth;
  await runCapacityMaintenance(c.env);
  await refreshPublicFeedSnapshot(c.env, { force: true });
  const report = await buildCapacityReport(c.env);
  return c.json({ success: true, report });
});

// POST /api/settings/import-csv - Batch import posts from CSV (Admin & Moderator)
settingsRoute.post('/import-csv', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{
    posts?: import('../db/queries').CsvImportPostInput[];
    rawCsv?: string;
    updateDuplicates?: boolean;
    defaultCategoryId?: string;
  }>();

  let postsToImport: import('../db/queries').CsvImportPostInput[];

  if (body.posts && Array.isArray(body.posts)) {
    postsToImport = body.posts;
  } else if (body.rawCsv && typeof body.rawCsv === 'string') {
    const { parseCsv, inferColumnMapping, normalizeRows } =
      await import('../utils/csv');
    const parsed = parseCsv(body.rawCsv);
    if (parsed.rows.length === 0) {
      return c.json(
        { success: false, error: 'CSVデータに有効な行が含まれていません' },
        400
      );
    }
    const mapping = inferColumnMapping(parsed.headers);
    const normalized = normalizeRows(parsed.rows, mapping);
    postsToImport = normalized.valid;
  } else {
    return c.json(
      { success: false, error: 'posts配列またはrawCsvテキストが必要です' },
      400
    );
  }

  if (postsToImport.length === 0) {
    return c.json(
      { success: false, error: 'インポート可能な有効データがありません' },
      400
    );
  }

  const { importCsvPosts } = await import('../db/queries');
  const stats = await importCsvPosts(c.env.DB, postsToImport, {
    updateDuplicates: body.updateDuplicates ?? true,
    defaultCategoryId: body.defaultCategoryId,
    authorId: session.userId,
  });

  return c.json({
    success: true,
    message: `${stats.added}件を追加、${stats.updated}件を更新しました（${stats.skipped}件スキップ）`,
    stats,
  });
});
