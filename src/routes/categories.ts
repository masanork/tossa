// src/routes/categories.ts: Category API routes
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { getCategories } from '../db/queries';

export const categoriesRoute = new Hono<{ Bindings: Bindings }>();

// GET /api/categories
categoriesRoute.get('/', async (c) => {
  const categories = await getCategories(c.env.DB);

  // 5-minute CDN edge cache (rarely modified)
  c.header('Cache-Control', 'no-cache');
  c.header(
    'CDN-Cache-Control',
    'public, max-age=300, stale-while-revalidate=600'
  );

  return c.json({
    success: true,
    categories,
  });
});
