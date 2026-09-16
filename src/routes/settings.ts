// src/routes/settings.ts: System settings & mode toggling
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { getSystemSettings, updateSystemSetting } from '../db/queries';
import { verifySessionToken } from '../auth/session';
import { broadcastPushNotification } from '../services/push';

export const settingsRoute = new Hono<{ Bindings: Bindings }>();

// GET /api/settings
settingsRoute.get('/', async (c) => {
  const settings = await getSystemSettings(c.env.DB);
  c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
  return c.json({
    success: true,
    settings,
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

  return c.json({
    success: true,
    message: 'Settings updated successfully',
    settings: updated,
  });
});
