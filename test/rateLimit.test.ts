import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createTestContext } from './helpers/testApp';
import {
  deviceCookieMiddleware,
  persistDeviceSessionMiddleware,
} from '../src/middleware/deviceCookie';
import { rateLimiter } from '../src/middleware/rateLimit';
import type { Bindings } from '../src/types';

function createRateLimitedApp() {
  const app = new Hono<{
    Bindings: Bindings;
    Variables: { deviceSessionId: string };
  }>();
  app.use('*', deviceCookieMiddleware);
  app.use(
    '/limited',
    rateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
      binding: 'AUTH_LIMITER',
      ipBinding: 'WRITE_IP_LIMITER',
    })
  );
  app.use('/limited', persistDeviceSessionMiddleware);
  app.post('/limited', (c) => c.text('accepted'));
  return app;
}

describe('distributed rate limiting and device persistence order', () => {
  it('uses device and trusted-IP binding keys before persisting a rejected request', async () => {
    const { db, env } = createTestContext();
    const deviceLimit = vi.fn(async () => ({ success: false }));
    const ipLimit = vi.fn(async () => ({ success: true }));
    env.AUTH_LIMITER = { limit: deviceLimit } as any;
    env.WRITE_IP_LIMITER = { limit: ipLimit } as any;

    const response = await createRateLimitedApp().request(
      '/limited',
      {
        method: 'POST',
        headers: {
          Cookie: 'tossa_device=rate-limit-device-id-123',
          'cf-connecting-ip': '198.51.100.27',
        },
      },
      env
    );

    expect(response.status).toBe(429);
    expect(deviceLimit).toHaveBeenCalledWith({
      key: 'tossa:dev_rate-limit-device-id-123',
    });
    expect(ipLimit).not.toHaveBeenCalled();
    const { results } = await db
      .prepare('SELECT id FROM device_sessions')
      .all();
    expect(results).toHaveLength(0);
  });

  it('fails closed with retry guidance if configured limiter is unavailable', async () => {
    const { db, env } = createTestContext();
    env.AUTH_LIMITER = {
      limit: vi.fn(async () => {
        throw new Error('binding unavailable');
      }),
    } as any;

    const response = await createRateLimitedApp().request(
      '/limited',
      {
        method: 'POST',
        headers: { Cookie: 'tossa_device=rate-limit-device-id-456' },
      },
      env
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(((await response.json()) as any).retryable).toBe(true);
    const { results } = await db
      .prepare('SELECT id FROM device_sessions')
      .all();
    expect(results).toHaveLength(0);
  });

  it('persists a session after both binding limits pass', async () => {
    const { db, env } = createTestContext();
    const deviceLimit = vi.fn(async () => ({ success: true }));
    const ipLimit = vi.fn(async () => ({ success: true }));
    env.AUTH_LIMITER = { limit: deviceLimit } as any;
    env.WRITE_IP_LIMITER = { limit: ipLimit } as any;

    const response = await createRateLimitedApp().request(
      '/limited',
      {
        method: 'POST',
        headers: {
          Cookie: 'tossa_device=rate-limit-device-id-789',
          'cf-connecting-ip': '198.51.100.28',
        },
      },
      env
    );

    expect(response.status).toBe(200);
    expect(ipLimit).toHaveBeenCalledWith({ key: 'tossa:ip:198.51.100.28' });
    const session = await db
      .prepare('SELECT id FROM device_sessions WHERE id = ?')
      .bind('rate-limit-device-id-789')
      .first<{ id: string }>();
    expect(session?.id).toBe('rate-limit-device-id-789');
  });

  it('does not double-count paths covered by a dedicated limiter', async () => {
    const { request, env } = createTestContext();
    const postLimiter = vi.fn(async () => ({ success: true }));
    const otherLimiter = vi.fn(async () => ({ success: false }));
    const ipLimiter = vi.fn(async () => ({ success: true }));
    env.POST_CREATE_LIMITER = { limit: postLimiter } as any;
    env.OTHER_WRITE_LIMITER = { limit: otherLimiter } as any;
    env.WRITE_IP_LIMITER = { limit: ipLimiter } as any;

    const response = await request('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '個別limiter対象',
        area: '熊本市',
        currentStatus: 'available',
        statusLabel: '受付中',
      }),
    });

    expect(response.status).toBe(201);
    expect(postLimiter).toHaveBeenCalledTimes(1);
    expect(otherLimiter).not.toHaveBeenCalled();
  });
  it.each(['/api/mcp/unknown', '/api/federation/import/unknown', '/api/auth'])(
    'limits unmatched mutation %s before persisting a device',
    async (path) => {
      const { request, env, db } = createTestContext();
      env.OTHER_WRITE_LIMITER = {
        limit: vi.fn(async () => ({ success: false })),
      } as any;
      const response = await request(path, { method: 'POST' });
      expect(response.status).toBe(429);
      expect(
        (await db.prepare('SELECT id FROM device_sessions').all()).results
      ).toHaveLength(0);
    }
  );
  it.each(['/api/import', '/api/federation/import'])(
    'applies the dedicated import limit to %s',
    async (path) => {
      const { request, env, db } = createTestContext();
      const limit = vi.fn(async () => ({ success: false }));
      env.FEDERATION_LIMITER = { limit } as any;
      env.OTHER_WRITE_LIMITER = {
        limit: vi.fn(async () => ({ success: true })),
      } as any;
      const response = await request(path, { method: 'POST' });
      expect(response.status).toBe(429);
      expect(limit).toHaveBeenCalledOnce();
      expect(env.OTHER_WRITE_LIMITER.limit).not.toHaveBeenCalled();
      expect(
        (await db.prepare('SELECT id FROM device_sessions').all()).results
      ).toHaveLength(0);
    }
  );
});
