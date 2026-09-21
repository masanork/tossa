import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';

describe('bulk history logic', () => {
  it('tests bulk logic', async () => {
    const { db } = createTestContext();
    await db
      .prepare(
        "INSERT INTO posts (id, category_id, title, area, lat, lng, current_status, status_label) VALUES ('p1', 'gen', 't', 'a', 0, 0, 's', 'l')"
      )
      .run();
    await db
      .prepare(
        "INSERT INTO posts (id, category_id, title, area, lat, lng, current_status, status_label) VALUES ('p2', 'gen', 't', 'a', 0, 0, 's', 'l')"
      )
      .run();

    await db
      .prepare(
        "INSERT INTO status_updates (id, post_id, status, status_label, created_at) VALUES ('h1', 'p1', 's', 'l', '2024-01-01T00:00:00Z')"
      )
      .run();

    const incoming = [
      {
        postId: 'p1',
        status: 's',
        statusLabel: 'l',
        createdAt: '2024-01-01T00:00:00Z',
      }, // exists
      {
        postId: 'p1',
        status: 's',
        statusLabel: 'l',
        createdAt: '2024-01-02T00:00:00Z',
      }, // new
      {
        postId: 'p2',
        status: 's',
        statusLabel: 'l',
        createdAt: '2024-01-01T00:00:00Z',
      }, // new
    ];

    const postIds = [...new Set(incoming.map((i) => i.postId))];
    const placeholders = postIds.map(() => '?').join(',');

    const existing = await db
      .prepare(
        `SELECT post_id, created_at FROM status_updates WHERE post_id IN (${placeholders})`
      )
      .bind(...postIds)
      .all<{ post_id: string; created_at: string }>();

    const existingSet = new Set(
      existing.results.map((r) => `${r.post_id}|${r.created_at}`)
    );

    const toInsert = incoming.filter(
      (i) => !existingSet.has(`${i.postId}|${i.createdAt}`)
    );

    expect(toInsert.length).toBe(2);
    expect(toInsert[0].createdAt).toBe('2024-01-02T00:00:00Z');
    expect(toInsert[1].postId).toBe('p2');
  });
});
