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
  binding?: RateLimitBindingName;
  ipBinding?: 'WRITE_IP_LIMITER';
}

type RateLimitBindingName =
  | 'POST_CREATE_LIMITER'
  | 'POST_UPDATE_LIMITER'
  | 'THREAD_CREATE_LIMITER'
  | 'THREAD_UPDATE_LIMITER'
  | 'AUTH_LIMITER'
  | 'FEDERATION_LIMITER'
  | 'MCP_LIMITER'
  | 'OTHER_WRITE_LIMITER';

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

  function allowInMemory(key: string, now: number): boolean {
    let record = clientWindows.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 1, resetAt: now + config.windowMs };
      clientWindows.set(key, record);
    } else {
      record.count += 1;
    }
    return record.count <= config.maxRequests;
  }

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

    const windowSec = Math.ceil(config.windowMs / 1000);
    c.header('X-RateLimit-Limit', String(config.maxRequests));

    const limiter = config.binding ? c.env[config.binding] : undefined;
    let allowed: boolean;
    if (limiter) {
      try {
        const outcome = await limiter.limit({ key: `tossa:${clientKey}` });
        allowed = outcome.success;
      } catch (error) {
        console.error(
          '[rateLimit] configured rate limiter unavailable:',
          error
        );
        c.header('Cache-Control', 'no-store');
        c.header('Retry-After', '30');
        return c.json(
          {
            success: false,
            retryable: true,
            error:
              '受付制御を確認できません。30秒ほど待ってから再試行してください。',
          },
          503
        );
      }
    } else {
      allowed = allowInMemory(clientKey, now);
    }

    if (allowed && config.ipBinding) {
      const ip = getClientIp(c.req.raw);
      const ipLimiter = c.env[config.ipBinding];
      // Cloudflare supplies this trusted header in production. Do not aggregate
      // local/dev requests with a missing address into one shared "unknown" key.
      if (ipLimiter && ip !== 'unknown') {
        try {
          allowed = (await ipLimiter.limit({ key: `tossa:ip:${ip}` })).success;
        } catch (error) {
          console.error(
            '[rateLimit] configured IP limiter unavailable:',
            error
          );
          c.header('Cache-Control', 'no-store');
          c.header('Retry-After', '30');
          return c.json(
            {
              success: false,
              retryable: true,
              error:
                '受付制御を確認できません。30秒ほど待ってから再試行してください。',
            },
            503
          );
        }
      }
    }

    if (!allowed) {
      c.header('Retry-After', String(windowSec));
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
