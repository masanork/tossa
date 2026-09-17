// src/middleware/rateLimit.ts: In-memory sliding window rate limiter for Cloudflare Workers
import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../types';
import { getClientIp } from './deviceCookie';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests allowed within the window
  message?: string;
  skip?: (req: Request) => boolean;
  keyGenerator?: (c: any) => string;
}

interface WindowRecord {
  count: number;
  resetAt: number;
}

/**
 * Creates an in-memory sliding rate limiter per client (Device ID or IP).
 * Protects edge workers against rapid-fire spam and DoS attacks,
 * while preventing collateral throttling of users sharing public shelter Wi-Fi (CGNAT).
 */
export function rateLimiter(config: RateLimitConfig) {
  const clientWindows = new Map<string, WindowRecord>();
  let lastCleanup = Date.now();

  function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < 60_000) return; // Cleanup at most once per minute
    lastCleanup = now;
    for (const [key, record] of clientWindows.entries()) {
      if (now > record.resetAt) {
        clientWindows.delete(key);
      }
    }
  }

  return createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
    if (config.skip && config.skip(c.req.raw)) {
      return await next();
    }

    cleanup();

    const now = Date.now();
    const deviceId = (c as any).get?.('deviceSessionId');
    const ip = getClientIp(c.req.raw);
    const clientKey = config.keyGenerator
      ? config.keyGenerator(c)
      : deviceId
        ? `dev_${deviceId}`
        : `ip_${ip}`;

    let record = clientWindows.get(clientKey);

    if (!record || now > record.resetAt) {
      record = {
        count: 1,
        resetAt: now + config.windowMs,
      };
      clientWindows.set(clientKey, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, config.maxRequests - record.count);
    const resetSec = Math.ceil((record.resetAt - now) / 1000);

    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSec));

    if (record.count > config.maxRequests) {
      c.header('Retry-After', String(resetSec));
      return c.json(
        {
          success: false,
          error:
            config.message ||
            'リクエスト回数が上限を超えました。しばらく待ってから再試行してください。 (Too Many Requests)',
        },
        429
      );
    }

    await next();
  });
}
