// src/middleware/deviceCookie.ts: Device cookie issuance and access logging
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../types';

export const DEVICE_COOKIE = 'tossa_device';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

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
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Asynchronously logs access events without blocking request pipeline
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
 * Ensures device session record exists in D1 (called only on state-mutating requests).
 */
export async function ensureDeviceSession(
  db: D1Database,
  deviceId: string,
  ip: string,
  ua: string
): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT OR IGNORE INTO device_sessions (id, created_ip, created_ua) VALUES (?, ?, ?)'
      )
      .bind(deviceId, ip, ua.slice(0, 500))
      .run();
  } catch (err) {
    console.error('[device_session] ensure failed:', err);
  }
}

/**
 * Device Cookie Middleware
 * - Issues new cookie if none exists (zero-DB-write on read traffic)
 * - State-mutating requests (POST/PUT/DELETE) ensure DB session existence to satisfy foreign keys
 * - Makes deviceSessionId available to all handlers via c.get('deviceSessionId')
 */
export const deviceCookieMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: { deviceSessionId: string };
}>(async (c, next) => {
  let deviceId = getCookie(c, DEVICE_COOKIE);
  const isHttps = c.req.url.startsWith('https');

  if (!deviceId) {
    deviceId = generateDeviceId();
    setCookie(c, DEVICE_COOKIE, deviceId, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: COOKIE_MAX_AGE,
      secure: isHttps,
    });
  }

  // Zero-DB-write optimization for read traffic (GET/HEAD/OPTIONS).
  // Under disaster traffic spikes, millions of view requests must NEVER write to D1.
  // We only persist device sessions on state-mutating write requests.
  const isStateMutating = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
  if (isStateMutating) {
    const ip = getClientIp(c.req.raw);
    const ua = c.req.header('User-Agent') || '';
    await ensureDeviceSession(c.env.DB, deviceId, ip, ua);
  }

  c.set('deviceSessionId', deviceId);
  await next();
});
