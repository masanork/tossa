// src/routes/push.ts: Web Push API endpoints (Subscription management, VAPID key distribution, test & broadcast)
import { Hono } from 'hono';
import type { Bindings, PushNotificationPayload } from '../types';
import {
  getOrCreateVapidKeys,
  savePushSubscription,
  removePushSubscription,
  sendPushNotification,
  broadcastPushNotification,
} from '../services/push';
import { verifySessionToken } from '../auth/session';
import { DEVICE_COOKIE } from '../middleware/deviceCookie';
import { getCookie } from 'hono/cookie';

export const pushRoute = new Hono<{
  Bindings: Bindings;
  Variables: { deviceSessionId: string };
}>();

// Helper to extract device cookie ID from request
function getDeviceCookieId(c: any): string | null {
  return c.get('deviceSessionId') || getCookie(c, DEVICE_COOKIE) || null;
}

// GET /api/push/vapid-public-key: Returns public VAPID key for PushManager subscribe
pushRoute.get('/vapid-public-key', async (c) => {
  try {
    const vapid = await getOrCreateVapidKeys(c.env);
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({
      success: true,
      publicKey: vapid.publicKey,
    });
  } catch (err: any) {
    return c.json(
      { success: false, error: err.message || 'Failed to retrieve VAPID key' },
      500
    );
  }
});

// POST /api/push/subscribe: Stores browser PushSubscription
pushRoute.post('/subscribe', async (c) => {
  try {
    const body = await c.req.json<{
      subscription: {
        endpoint: string;
        keys: {
          p256dh: string;
          auth: string;
        };
      };
      area?: string;
      alertTypes?: string[];
    }>();

    if (
      !body?.subscription?.endpoint ||
      !body?.subscription?.keys?.p256dh ||
      !body?.subscription?.keys?.auth
    ) {
      return c.json(
        { success: false, error: 'Invalid PushSubscription payload' },
        400
      );
    }

    // Optional user authentication via Bearer token
    let userId: string | null = null;
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const session = await verifySessionToken(token, c.env.JWT_SECRET);
      if (session) {
        userId = session.userId;
      }
    }

    const deviceCookieId = getDeviceCookieId(c);

    const res = await savePushSubscription(c.env.DB, {
      endpoint: body.subscription.endpoint,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      userId,
      deviceCookieId,
      area: body.area,
      alertTypes: body.alertTypes,
    });

    return c.json({
      success: true,
      id: res.id,
      message: 'Subscribed to push notifications successfully',
    });
  } catch (err: any) {
    return c.json(
      { success: false, error: err.message || 'Failed to save subscription' },
      500
    );
  }
});

// POST /api/push/unsubscribe: Removes browser PushSubscription
pushRoute.post('/unsubscribe', async (c) => {
  try {
    const body = await c.req.json<{ endpoint: string }>();
    if (!body?.endpoint) {
      return c.json({ success: false, error: 'Endpoint is required' }, 400);
    }

    await removePushSubscription(c.env.DB, body.endpoint);
    return c.json({
      success: true,
      message: 'Unsubscribed successfully',
    });
  } catch (err: any) {
    return c.json(
      { success: false, error: err.message || 'Failed to unsubscribe' },
      500
    );
  }
});

// POST /api/push/test: Sends test push notification to verify delivery
pushRoute.post('/test', async (c) => {
  try {
    let body: {
      endpoint?: string;
      p256dh?: string;
      auth?: string;
    } = {};
    try {
      body = (await c.req.json()) || {};
    } catch {
      body = {};
    }

    const vapid = await getOrCreateVapidKeys(c.env);

    const testPayload: PushNotificationPayload = {
      title: 'とっさ 通知テスト',
      body: '通知の準備ができました。',
      url: '/',
      tag: 'tossa-test-push',
    };

    // 1. Direct subscription provided in body
    if (body.endpoint && body.p256dh && body.auth) {
      const res = await sendPushNotification(
        { endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth },
        testPayload,
        vapid
      );
      return c.json({
        success: res.success,
        statusCode: res.statusCode,
        error: res.error,
      });
    }

    // 2. Otherwise send to current user/device active subscriptions
    const deviceCookieId = getDeviceCookieId(c);
    let userId: string | null = null;
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const session = await verifySessionToken(token, c.env.JWT_SECRET);
      if (session) userId = session.userId;
    }

    let query = 'SELECT * FROM push_subscriptions WHERE 1=1';
    const params: any[] = [];

    if (userId) {
      query += ' AND (user_id = ? OR device_cookie_id = ?)';
      params.push(userId, deviceCookieId);
    } else if (deviceCookieId) {
      query += ' AND device_cookie_id = ?';
      params.push(deviceCookieId);
    } else {
      return c.json(
        {
          success: false,
          error: 'No active device session or subscription endpoint specified',
        },
        400
      );
    }

    const { results: subs } = await c.env.DB.prepare(query)
      .bind(...params)
      .all<any>();

    if (!subs || subs.length === 0) {
      return c.json(
        {
          success: false,
          error: 'No push subscriptions found for this device',
        },
        404
      );
    }

    let sent = 0;
    for (const sub of subs) {
      const res = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        testPayload,
        vapid
      );
      if (res.success) sent++;
    }

    return c.json({
      success: true,
      sent,
      total: subs.length,
    });
  } catch (err: any) {
    return c.json(
      { success: false, error: err.message || 'Failed to send test push' },
      500
    );
  }
});

// POST /api/push/broadcast: Administrator manual push broadcast
pushRoute.post('/broadcast', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || session.role !== 'admin') {
    return c.json(
      { success: false, error: 'Forbidden: Admin access required' },
      403
    );
  }

  const body = await c.req.json<{
    title: string;
    body: string;
    url?: string;
    area?: string;
    alertType?: 'emergency' | 'evacuation' | 'status' | 'messages';
  }>();

  if (!body?.title || !body?.body) {
    return c.json(
      { success: false, error: 'Title and body are required' },
      400
    );
  }

  const result = await broadcastPushNotification(c.env, {
    title: body.title,
    body: body.body,
    url: body.url,
    area: body.area,
    alertType: body.alertType || 'emergency',
  });

  return c.json({
    success: true,
    result,
  });
});
