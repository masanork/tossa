// src/index.ts: tossa Cloudflare Workers Main Entry
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import type { Bindings } from './types';
import { categoriesRoute } from './routes/categories';
import { postsRoute } from './routes/posts';
import { settingsRoute } from './routes/settings';
import { authRoute } from './routes/auth';
import { federationRoute } from './routes/federation';
import { threadsRoute } from './routes/threads';
import { pushRoute } from './routes/push';
import { mcpRoute } from './routes/mcp';
import { seoRoute } from './routes/seo';
import { deviceCookieMiddleware } from './middleware/deviceCookie';
import { rateLimiter } from './middleware/rateLimit';

const app = new Hono<{ Bindings: Bindings }>();

// 1. HTTP Security Headers (CSP, HSTS, X-Content-Type-Options, Frame protection)
app.use(
  '*',
  secureHeaders({
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https:',
        'https://*.tile.openstreetmap.org',
        'https://cyberjapandata.gsi.go.jp',
      ],
      connectSrc: [
        "'self'",
        'https:',
        'https://msearch.gsi.go.jp',
        'https://*.tile.openstreetmap.org',
      ],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  })
);

// 2. Request Payload Size Limiting (2MB max)
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: (c) => {
      return c.json(
        {
          success: false,
          error:
            'リクエストサイズが上限（2MB）を超えています。 (Payload Too Large)',
        },
        413
      );
    },
  })
);

// Helper for origin validation
function isAllowedOrigin(origin: string, expectedOrigin?: string): boolean {
  if (!origin) return true;
  if (expectedOrigin && origin === expectedOrigin) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      return true;
    if (url.hostname.endsWith('.sorane.dev')) return true;
    if (url.hostname.endsWith('.workers.dev')) return true;
  } catch {
    return false;
  }
  return false;
}

// 3. Logger & Fine-Grained CORS middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const path = new URL(c.req.url).pathname;
      // Public Open Data & MCP endpoints allow broad cross-origin consumption
      if (
        path.startsWith('/mcp') ||
        path.startsWith('/api/mcp') ||
        path === '/llms.txt' ||
        path === '/feed.xml' ||
        path === '/robots.txt' ||
        path === '/sitemap.xml' ||
        (path === '/api/posts' && c.req.method === 'GET') ||
        (path === '/api/categories' && c.req.method === 'GET') ||
        (path === '/api/settings' && c.req.method === 'GET') ||
        path === '/api/health'
      ) {
        return origin || '*';
      }

      // Restrict state-changing or credentialed endpoints
      const expected = (c.env as Bindings)?.EXPECTED_ORIGIN;
      if (origin && isAllowedOrigin(origin, expected)) {
        return origin;
      }
      return expected || null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'x-agent-id',
      'x-device-id',
    ],
    credentials: true,
  })
);

// 4. Rate Limiting Protection
// Micro-updates & post creation rate limits (protect against spam bots)
app.use(
  '/api/posts',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    skip: (req) => req.method === 'GET',
    message:
      '投稿の送信頻度が高すぎます。1分ほど待ってから再送信してください。',
  })
);
app.use(
  '/api/posts/*',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 45,
    skip: (req) => req.method === 'GET',
    message:
      'ステータス更新の頻度が高すぎます。しばらく待ってから再試行してください。',
  })
);
// MCP Agent Rate Limiting (up to 120 calls per minute per client)
app.use(
  '/mcp',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 120,
    message: 'MCP API rate limit exceeded (120 requests/minute).',
  })
);
app.use(
  '/api/mcp',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 120,
    message: 'MCP API rate limit exceeded (120 requests/minute).',
  })
);

// Automatic device cookie issuance (applied to all /api/* routes)
app.use('/api/*', deviceCookieMiddleware);

// API Routes
app.route('/api/categories', categoriesRoute);
app.route('/api/posts', postsRoute);
app.route('/api/settings', settingsRoute);
app.route('/api/auth', authRoute);
app.route('/api/threads', threadsRoute);
app.route('/api/push', pushRoute);
app.route('/api/mcp', mcpRoute);
app.route('/mcp', mcpRoute);
app.route('/api', federationRoute);
app.route('/api/federation', federationRoute);

// SEO, AI Discovery & SSR Routes
app.route('/', seoRoute);

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    app: 'tossa',
    version: '0.1.0',
    time: new Date().toISOString(),
  });
});

// Fallback to static SPA assets
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text(
    'tossa API Server. Web assets not configured in this environment.',
    404
  );
});

export default app;
