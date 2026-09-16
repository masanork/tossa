// src/middleware/deviceCookie.ts: Device cookie issuance and access logging
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../types';

export const DEVICE_COOKIE = 'tossa_device';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1年

function generateDeviceId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * アクセスログを非同期記録（失敗してもリクエストを止めない）
 */
export async function logAccess(
  db: D1Database,
  eventType: string,
  deviceSessionId: string | null,
  userId: string | null,
  ip: string,
  ua: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO access_logs
           (event_type, device_session_id, user_id, ip_address, user_agent, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        eventType,
        deviceSessionId,
        userId,
        ip,
        ua.slice(0, 500),
        metadata ? JSON.stringify(metadata) : null
      )
      .run();
  } catch (err) {
    console.error('[access_log] write failed:', err);
  }
}

/**
 * デバイスCookieミドルウェア
 * - Cookieが未発行なら新規発行し device_sessions + access_logs に記録
 * - 発行済みなら DBに存在することを保証し last_seen_at を更新
 * - c.get('deviceSessionId') でどのハンドラからも取得可能
 */
export const deviceCookieMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: { deviceSessionId: string };
}>(async (c, next) => {
  let deviceId = getCookie(c, DEVICE_COOKIE);

  const ip = getClientIp(c.req.raw);
  const ua = c.req.header('User-Agent') || '';

  if (!deviceId) {
    deviceId = generateDeviceId();

    // 新規端末: DB登録 + Cookie発行 + ログ記録
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO device_sessions (id, created_ip, created_ua) VALUES (?, ?, ?)'
    )
      .bind(deviceId, ip, ua.slice(0, 500))
      .run();

    await logAccess(c.env.DB, 'cookie_issued', deviceId, null, ip, ua);

    const isHttps = c.req.url.startsWith('https');
    setCookie(c, DEVICE_COOKIE, deviceId, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: COOKIE_MAX_AGE,
      secure: isHttps,
    });
  } else {
    // 既存端末: device_sessions に存在することを保証しつつ last_seen_at 更新
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO device_sessions (id, created_ip, created_ua) VALUES (?, ?, ?)'
    )
      .bind(deviceId, ip, ua.slice(0, 500))
      .run()
      .then(() => {
        return c.env.DB.prepare(
          "UPDATE device_sessions SET last_seen_at = datetime('now') WHERE id = ?"
        )
          .bind(deviceId)
          .run();
      })
      .catch(() => {});
  }

  c.set('deviceSessionId', deviceId);
  await next();
});
