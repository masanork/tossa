import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';

const path = '/api/settings/statistics/preview';

function sample() {
  const observedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return {
    format: 'tossa-statistics-preview-v1',
    source: 'tsudoi',
    visibility: 'public_aggregate',
    generatedAt: new Date().toISOString(),
    records: [
      {
        id: 'occupancy-001',
        revision: 1,
        entity: { kind: 'shelter', id: 'shelter-001', label: '訓練避難所' },
        metric: 'current_occupancy',
        status: 'reported',
        value: 43,
        observedAt,
        sourceUrl: 'https://example.org/shelters/001',
      },
      {
        id: 'capacity-001',
        revision: 1,
        entity: { kind: 'shelter', id: 'shelter-001', label: '訓練避難所' },
        metric: 'capacity',
        status: 'reported',
        value: 100,
        observedAt,
        sourceUrl: 'https://example.org/shelters/001',
      },
    ],
  };
}

async function context(role: 'admin' | 'moderator' | 'user' = 'admin') {
  const ctx = createTestContext();
  await ctx.db
    .prepare(
      'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
    )
    .bind('statistics-admin', 'statistics-admin', '担当者', role)
    .run();
  const token = await createSessionToken(
    { userId: 'statistics-admin', username: 'statistics-admin', role },
    ctx.env.JWT_SECRET
  );
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  return {
    ...ctx,
    headers,
    token,
    send: (body: unknown) =>
      ctx.request(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
  };
}

describe('Administrator statistics preview', () => {
  it('requires a current admin before parsing a malformed feed', async () => {
    const anonymous = createTestContext();
    expect(
      (await anonymous.request(path, { method: 'POST', body: '{' })).status
    ).toBe(401);
    for (const role of ['moderator', 'user'] as const) {
      const ctx = await context(role);
      expect((await ctx.send({ feed: sample() })).status).toBe(403);
    }
    const ctx = await context();
    await ctx.db
      .prepare("UPDATE users SET role = 'user' WHERE id = ?")
      .bind('statistics-admin')
      .run();
    expect((await ctx.send({ feed: sample() })).status).toBe(403);
    await ctx.db
      .prepare('DELETE FROM users WHERE id = ?')
      .bind('statistics-admin')
      .run();
    expect((await ctx.send({ feed: sample() })).status).toBe(403);
  });

  it('validates and maps a public statistic without changing any post or publishing data', async () => {
    const ctx = await context();
    await ctx.db
      .prepare(
        'INSERT INTO posts (id, title, current_status, status_label, observed_at, is_verified, attributes) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        'post-001',
        '現地からの訓練報告',
        'available',
        '開設中',
        '2026-01-01T00:00:00Z',
        0,
        '{"supplies":["water"]}'
      )
      .run();
    const before = await ctx.db.prepare('SELECT * FROM posts').all();
    const response = await ctx.send({
      feed: sample(),
      mappings: [
        { kind: 'shelter', externalId: 'shelter-001', postId: 'post-001' },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await response.json()) as {
      success: boolean;
      preview: {
        checkedAt: string;
        recordCount: number;
        entityCount: number;
        unmappedEntityCount: number;
        warnings: string[];
        records: { value: number; targetPost: { id: string; title: string } }[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.preview.recordCount).toBe(2);
    expect(body.preview.entityCount).toBe(1);
    expect(body.preview.unmappedEntityCount).toBe(0);
    expect(body.preview.warnings).toEqual([]);
    expect(body.preview.records.map((r) => r.value)).toEqual([43, 100]);
    expect(body.preview.records[0]!.targetPost).toEqual({
      id: 'post-001',
      title: '現地からの訓練報告',
    });
    expect(await ctx.db.prepare('SELECT * FROM posts').all()).toEqual(before);
    expect(
      (
        await ctx.db
          .prepare('SELECT count(*) AS n FROM status_updates')
          .first<{ n: number }>()
      )?.n
    ).toBe(0);
    expect(ctx.sentEmails).toEqual([]);
    expect(
      (
        await ctx.db
          .prepare('SELECT count(*) AS n FROM device_sessions')
          .first<{ n: number }>()
      )?.n
    ).toBe(0);
    expect(
      (
        await ctx.db
          .prepare('SELECT count(*) AS n FROM access_logs')
          .first<{ n: number }>()
      )?.n
    ).toBe(0);
  });

  it('keeps unmatched entities explicit and preserves zero versus missing or withheld values', async () => {
    const ctx = await context();
    const feed = sample();
    feed.records[0]!.value = 0;
    const response = await ctx.send({ feed });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      preview: {
        unmappedEntityCount: number;
        warnings: string[];
        records: { value: number; targetPost: null }[];
      };
    };
    expect(body.preview.unmappedEntityCount).toBe(1);
    expect(body.preview.records[0]!.value).toBe(0);
    expect(body.preview.records[0]!.targetPost).toBeNull();
    expect(body.preview.warnings).toHaveLength(1);
  });

  it('rejects unknown targets, unused mappings, duplicate mappings, invalid types and unexpected fields', async () => {
    const ctx = await context();
    await ctx.db
      .prepare(
        'INSERT INTO posts (id, title, current_status, status_label) VALUES (?, ?, ?, ?)'
      )
      .bind('post-001', '訓練投稿', 'available', '開設中')
      .run();
    const good = {
      kind: 'shelter',
      externalId: 'shelter-001',
      postId: 'post-001',
    };
    const invalidMappings = [
      [{ ...good, postId: 'unknown' }],
      [{ ...good, externalId: 'absent' }],
      [good, good],
      [{ ...good, kind: ['shelter'] }],
      [{ ...good, kind: 'facility' }],
      [{ ...good, extra: 'private' }],
      Array.from({ length: 101 }, () => good),
      null,
    ];
    for (const mappings of invalidMappings) {
      expect((await ctx.send({ feed: sample(), mappings })).status).toBe(400);
    }
    expect(
      (await ctx.send({ feed: sample(), credentials: 'sensitive' })).status
    ).toBe(400);
    expect(
      (await ctx.send({ feed: { ...sample(), attendees: ['private name'] } }))
        .status
    ).toBe(400);
  });

  it('rejects malformed JSON, invalid UTF-8 and oversized bodies independent of claimed length', async () => {
    const ctx = await context();
    const malformed = await ctx.request(path, {
      method: 'POST',
      headers: ctx.headers,
      body: '{"token":"secret-input"',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain('secret-input');
    const utf8 = await ctx.request(path, {
      method: 'POST',
      headers: ctx.headers,
      body: new Uint8Array([0xff, 0xfe]),
    });
    expect(utf8.status).toBe(400);
    const oversized = ' '.repeat(1024 * 1024 + 1);
    for (const length of [undefined, '1', String(oversized.length)]) {
      const headers = length
        ? { ...ctx.headers, 'Content-Length': length }
        : ctx.headers;
      expect(
        (await ctx.request(path, { method: 'POST', headers, body: oversized }))
          .status
      ).toBe(413);
    }
    expect(
      (
        await ctx.request(path, {
          method: 'POST',
          headers: {
            Authorization: ctx.headers.Authorization,
            'Content-Type': 'text/plain',
          },
          body: '{}',
        })
      ).status
    ).toBe(415);
  });
});
