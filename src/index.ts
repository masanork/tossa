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
import { imagesRoute } from './routes/images';
import { opendataRoute } from './routes/opendata';
import { deviceCookieMiddleware } from './middleware/deviceCookie';
import { rateLimiter } from './middleware/rateLimit';
import { processPushQueueBatch } from './services/push';
import { processWriteQueueBatch } from './services/writeBuffer';
import { performDatabaseBackup } from './services/backup';
import { sendErrorAlert } from './services/alert';
import { renderOgpSvg } from './ogp';
import { getPostById } from './db/queries';

const app = new Hono<{ Bindings: Bindings }>();

// Global Error Handler & Webhook Alerting
export async function handleGlobalError(err: Error, c: any) {
  console.error('[Unhandled Error]', err);

  if (c.env?.ALERT_WEBHOOK_URL && c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(
      sendErrorAlert(c.env, err, {
        source: 'http',
        method: c.req.method,
        url: c.req.url,
        ip:
          c.req.header('cf-connecting-ip') ||
          c.req.header('x-forwarded-for') ||
          undefined,
        userAgent: c.req.header('user-agent') || undefined,
      })
    );
  }

  return c.json(
    {
      success: false,
      error: 'Internal Server Error',
      message: 'システム内部で予期せぬエラーが発生しました。',
    },
    500
  );
}

app.onError(handleGlobalError);

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

// 4. Automatic device cookie issuance (applied to all /api/* routes, before rate limiting)
app.use('/api/*', deviceCookieMiddleware);

// 5. Rate Limiting Protection (per-device or per-IP to avoid shelter NAT blocking)
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
// Messaging rate limits (protect threads from message flood)
app.use(
  '/api/threads',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    skip: (req) => req.method === 'GET',
    message:
      'メッセージ送信の頻度が高すぎます。しばらく待ってから再送信してください。',
  })
);
app.use(
  '/api/threads/*',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 45,
    skip: (req) => req.method === 'GET',
    message:
      'メッセージ送信の頻度が高すぎます。しばらく待ってから再送信してください。',
  })
);
// Auth rate limits (protect WebAuthn endpoints against brute-force / flood)
app.use(
  '/api/auth/*',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
    skip: (req) => req.method === 'GET',
    message: '認証試行回数が多すぎます。1分ほど待ってから再試行してください。',
  })
);
// Federation import rate limit
app.use(
  '/api/federation/import',
  rateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
    message: '外部データ同期の頻度が高すぎます。',
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
app.route('/api/images', imagesRoute);
app.route('/api/opendata', opendataRoute);

// Direct OGP banner endpoint (/ogp/:id or /ogp/:id.svg)
app.get('/ogp/:id', async (c) => {
  const rawId = c.req.param('id');
  const id = rawId.endsWith('.svg') ? rawId.slice(0, -4) : rawId;
  const post = await getPostById(c.env.DB, id);
  if (!post) {
    return c.text('Not found', 404);
  }
  const origin = c.env.EXPECTED_ORIGIN || new URL(c.req.url).origin;
  const svg = await renderOgpSvg(post, origin);
  c.header('Content-Type', 'image/svg+xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300');
  return c.body(svg);
});

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

// Attach Cloudflare Queues consumer for asynchronous Web Push & Write Buffer, and Cron scheduled triggers
const worker = Object.assign(app, {
  async queue(batch: MessageBatch<any>, env: Bindings): Promise<void> {
    try {
      const firstMsg = batch.messages[0]?.body;
      if (
        (batch as any).queue === 'tossa-write-queue' ||
        firstMsg?.type === 'create_post' ||
        firstMsg?.type === 'update_status'
      ) {
        await processWriteQueueBatch(batch, env);
      } else {
        await processPushQueueBatch(batch, env);
      }
    } catch (queueErr) {
      console.error('[Worker Queue Error]', queueErr);
      if (env?.ALERT_WEBHOOK_URL) {
        await sendErrorAlert(env, queueErr, {
          source: (batch as any).queue || 'queues',
          additionalInfo: { messageCount: batch.messages?.length },
        });
      }
      throw queueErr;
    }
  },
  async scheduled(
    event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      performDatabaseBackup(env)
        .then(async (result) => {
          if (!result.success && env?.ALERT_WEBHOOK_URL) {
            await sendErrorAlert(
              env,
              new Error(result.error || 'Scheduled D1 backup failed'),
              {
                source: 'scheduled_backup',
              }
            );
          }
        })
        .catch(async (backupErr) => {
          console.error('[Worker Scheduled Backup Error]', backupErr);
          if (env?.ALERT_WEBHOOK_URL) {
            await sendErrorAlert(env, backupErr, {
              source: 'scheduled_backup',
            });
          }
        })
    );
  },
});

export { app };
export default worker;
