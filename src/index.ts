// src/index.ts: tossa (咄嗟) Cloudflare Workers Main Entry
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings } from './types';
import { categoriesRoute } from './routes/categories';
import { postsRoute } from './routes/posts';
import { settingsRoute } from './routes/settings';
import { authRoute } from './routes/auth';

const app = new Hono<{ Bindings: Bindings }>();

// ロガー & CORSミドルウェア
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

// APIルーティング
app.route('/api/categories', categoriesRoute);
app.route('/api/posts', postsRoute);
app.route('/api/settings', settingsRoute);
app.route('/api/auth', authRoute);

// ヘルスチェック
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    app: 'tossa',
    version: '0.1.0',
    time: new Date().toISOString(),
  });
});

// 静的アセット（SPA）へのフォールバック
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('tossa API Server. Web assets not configured in this environment.', 404);
});

export default app;
