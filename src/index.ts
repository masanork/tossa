// src/index.ts: tossa Cloudflare Workers Main Entry
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
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

const app = new Hono<{ Bindings: Bindings }>();

// Logger & CORS middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => origin || '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
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
