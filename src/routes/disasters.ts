// src/routes/disasters.ts: Disaster Events Management API
import { Hono } from 'hono';
import type {
  Bindings,
  DisasterType,
  DisasterStatus,
  DisasterArea,
} from '../types';
import {
  getDisasters,
  getDisasterById,
  createDisaster,
  updateDisaster,
  deleteDisaster,
} from '../db/queries';
import { verifySessionToken } from '../auth/session';

export const disastersRoute = new Hono<{ Bindings: Bindings }>();

// GET /api/disasters - List disaster events (optionally filter by ?status=active|archived)
disastersRoute.get('/', async (c) => {
  const statusParam = c.req.query('status') as DisasterStatus | undefined;
  const disasters = await getDisasters(c.env.DB, statusParam);
  c.header('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
  return c.json({
    success: true,
    disasters,
    count: disasters.length,
    active_count: disasters.filter((d) => d.status === 'active').length,
  });
});

// GET /api/disasters/:id - Get disaster event detail
disastersRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const disaster = await getDisasterById(c.env.DB, id);
  if (!disaster) {
    return c.json({ success: false, error: 'Disaster event not found' }, 404);
  }
  return c.json({
    success: true,
    disaster,
  });
});

// Helper: Require Admin/Moderator Authentication
async function requireAdminAuth(c: any) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return { error: 'Unauthorized', status: 401 };
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return { error: 'Forbidden', status: 403 };
  }

  return { session };
}

// POST /api/disasters - Register a new disaster event (発災)
disastersRoute.post('/', async (c) => {
  const auth = await requireAdminAuth(c);
  if ('error' in auth) {
    return c.json({ success: false, error: auth.error }, auth.status as any);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    disaster_type?: DisasterType;
    status?: DisasterStatus;
    designated_at?: string;
    areas?: DisasterArea[];
    banner_message?: string;
    note?: string;
  };

  if (!body.name || !body.name.trim()) {
    return c.json({ success: false, error: '災害名を入力してください' }, 400);
  }
  if (!body.disaster_type) {
    return c.json({ success: false, error: '災害種別を選択してください' }, 400);
  }

  const disaster = await createDisaster(c.env.DB, {
    name: body.name.trim(),
    disaster_type: body.disaster_type,
    status: body.status || 'active',
    designated_at: body.designated_at,
    areas: body.areas || [],
    banner_message: body.banner_message?.trim() || null,
    note: body.note?.trim() || null,
  });

  return c.json(
    {
      success: true,
      disaster,
      message: `「${disaster.name}」を登録しました（発災モード）`,
    },
    201
  );
});

// PATCH /api/disasters/:id - Update disaster event
disastersRoute.patch('/:id', async (c) => {
  const auth = await requireAdminAuth(c);
  if ('error' in auth) {
    return c.json({ success: false, error: auth.error }, auth.status as any);
  }

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const updated = await updateDisaster(c.env.DB, id, body);

  if (!updated) {
    return c.json({ success: false, error: 'Disaster event not found' }, 404);
  }

  return c.json({
    success: true,
    disaster: updated,
    message: `「${updated.name}」を更新しました`,
  });
});

// POST /api/disasters/:id/archive - Quick archive / resolve disaster event (収束処理)
disastersRoute.post('/:id/archive', async (c) => {
  const auth = await requireAdminAuth(c);
  if ('error' in auth) {
    return c.json({ success: false, error: auth.error }, auth.status as any);
  }

  const id = c.req.param('id');
  const updated = await updateDisaster(c.env.DB, id, { status: 'archived' });

  if (!updated) {
    return c.json({ success: false, error: 'Disaster event not found' }, 404);
  }

  return c.json({
    success: true,
    disaster: updated,
    message: `「${updated.name}」を収束（アーカイブ）しました`,
  });
});

// POST /api/disasters/:id/activate - Re-activate archived disaster event (再開)
disastersRoute.post('/:id/activate', async (c) => {
  const auth = await requireAdminAuth(c);
  if ('error' in auth) {
    return c.json({ success: false, error: auth.error }, auth.status as any);
  }

  const id = c.req.param('id');
  const updated = await updateDisaster(c.env.DB, id, { status: 'active' });

  if (!updated) {
    return c.json({ success: false, error: 'Disaster event not found' }, 404);
  }

  return c.json({
    success: true,
    disaster: updated,
    message: `「${updated.name}」を再開（発災モード）しました`,
  });
});

// DELETE /api/disasters/:id - Delete disaster event
disastersRoute.delete('/:id', async (c) => {
  const auth = await requireAdminAuth(c);
  if ('error' in auth) {
    return c.json({ success: false, error: auth.error }, auth.status as any);
  }

  const id = c.req.param('id');
  const deleted = await deleteDisaster(c.env.DB, id);

  return c.json({
    success: deleted,
    message: deleted ? '災害事象を削除しました' : '削除に失敗しました',
  });
});
