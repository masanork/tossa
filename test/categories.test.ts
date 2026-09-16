// test/categories.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';

describe('Categories API', () => {
  it('returns list of categories with proper headers', async () => {
    const { request, db } = createTestContext();

    // Insert test categories
    await db
      .prepare(
        'INSERT INTO categories (id, name, icon, color, scope, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind('water', 'Water Supply', '💧', '#3b82f6', 'disaster', 1)
      .run();

    await db
      .prepare(
        'INSERT INTO categories (id, name, icon, color, scope, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind('cafe', 'Cafe & Rest', '☕', '#f59e0b', 'normal', 2)
      .run();

    const res = await request('/api/categories');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      categories: Array<{ id: string; name: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.categories.length).toBe(2);
    expect(body.categories[0].id).toBe('water');
    expect(body.categories[1].id).toBe('cafe');
  });
});
