// src/routes/categories.ts: Category API routes
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { getCategories, getSystemSettings } from '../db/queries';

export const categoriesRoute = new Hono<{ Bindings: Bindings }>();

// GET /api/categories
categoriesRoute.get('/', async (c) => {
  const categories = await getCategories(c.env.DB);

  // 1分間のエッジキャッシュ
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

  return c.json({
    success: true,
    categories,
  });
});
