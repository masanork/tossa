// test/writeBuffer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { processWriteQueueBatch } from '../src/services/writeBuffer';
import type { WriteQueueMessage } from '../src/types';

function createMockQueue() {
  const sentMessages: any[] = [];
  const queue: any = {
    send: vi.fn(async (message: any) => {
      sentMessages.push(message);
    }),
    _sentMessages: sentMessages,
  };
  return queue;
}

describe('Write Buffer & High-Traffic Smoothing Queue', () => {
  it('enqueues post creation to WRITE_QUEUE when bound', async () => {
    const { request, env } = createTestContext();
    const mockQueue = createMockQueue();
    env.WRITE_QUEUE = mockQueue;

    const res = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: '中央区給水所',
        area: '熊本市中央区',
        currentStatus: 'available',
        statusLabel: '給水中',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.buffered).toBe(true);
    expect(body.message).toContain('queued for writing');

    expect(mockQueue.send).toHaveBeenCalledTimes(1);
    const queued = mockQueue._sentMessages[0];
    expect(queued.type).toBe('create_post');
    expect(queued.post.title).toBe('中央区給水所');
    expect(queued.post.area).toBe('熊本市中央区');
  });

  it('returns retryable 503 and never falls back to D1 when the configured write queue rejects a post', async () => {
    const { request, db, env } = createTestContext();
    let queueUnavailable = true;
    const sentMessages: any[] = [];
    const send = vi.fn(async (message: any) => {
      sentMessages.push(message);
      if (queueUnavailable) throw new Error('queue unavailable');
    });
    env.WRITE_QUEUE = { send } as any;
    const body = {
      requestId: 'stable-request-123',
      title: '受付再試行の訓練投稿',
      area: '熊本市中央区',
      currentStatus: 'available',
      statusLabel: '受付中',
    };
    const init = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'tossa_device=stabledeviceid1234567890',
      },
      body: JSON.stringify(body),
    };

    const res = await request('/api/posts', init);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(((await res.json()) as any).retryable).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sentMessages).toHaveLength(1);
    const posts = await db
      .prepare('SELECT id FROM posts WHERE title = ?')
      .bind(body.title)
      .all();
    expect(posts.results).toHaveLength(0);

    // The same operation ID remains safe to retry and is queued once the
    // queue accepts it, still without a synchronous D1 post write.
    queueUnavailable = false;
    const retry = await request('/api/posts', init);
    expect(retry.status).toBe(201);
    expect(((await retry.json()) as any).buffered).toBe(true);
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[1].post.id).toBe(sentMessages[0].post.id);
    expect(sentMessages[1].post.operation).toEqual(
      sentMessages[0].post.operation
    );
    const retryPosts = await db
      .prepare('SELECT id FROM posts WHERE title = ?')
      .bind(body.title)
      .all();
    expect(retryPosts.results).toHaveLength(0);
  });

  it('falls back to synchronous D1 write when DISABLE_WRITE_BUFFER is true even if WRITE_QUEUE is bound', async () => {
    const { request, db, env } = createTestContext();
    const mockQueue = createMockQueue();
    env.WRITE_QUEUE = mockQueue;
    env.DISABLE_WRITE_BUFFER = 'true';

    const res = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'テスト避難所（同期）',
        area: '熊本市中央区',
        currentStatus: 'available',
        statusLabel: '給水中',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.buffered).toBe(false);
    expect(mockQueue.send).not.toHaveBeenCalled();

    // Verify it was directly written to D1
    const { results } = await db
      .prepare('SELECT * FROM posts WHERE title = ?')
      .bind('テスト避難所（同期）')
      .all();
    expect(results.length).toBe(1);
  });

  it('falls back to synchronous D1 write when WRITE_QUEUE is not bound', async () => {
    const { request, db, env } = createTestContext();
    env.WRITE_QUEUE = undefined; // No queue

    const res = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: '東区避難所',
        area: '熊本市東区',
        currentStatus: 'available',
        statusLabel: '開設中',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.buffered).toBe(false);

    // Verify written to D1 directly
    const { results } = await db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .bind(body.id)
      .all();
    expect(results.length).toBe(1);
    expect((results[0] as any).title).toBe('東区避難所');
  });

  it('enqueues status updates to WRITE_QUEUE when bound', async () => {
    const { request, db, env } = createTestContext();
    const mockQueue = createMockQueue();
    env.WRITE_QUEUE = mockQueue;

    // Seed post in D1
    await db
      .prepare(
        'INSERT INTO posts (id, title, area, current_status, status_label) VALUES (?, ?, ?, ?, ?)'
      )
      .bind('post_target', '本町給水所', '八代市', 'available', '給水中')
      .run();

    const res = await request('/api/posts/post_target/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'closed',
        statusLabel: '配布終了',
        note: '本日の配給は完了しました',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.buffered).toBe(true);

    expect(mockQueue.send).toHaveBeenCalledTimes(1);
    const queued = mockQueue._sentMessages[0];
    expect(queued.type).toBe('update_status');
    expect(queued.postId).toBe('post_target');
    expect(queued.status).toBe('closed');
    expect(queued.note).toBe('本日の配給は完了しました');
  });

  it('keeps status unchanged and returns retryable 503 when the configured queue rejects an update', async () => {
    const { request, db, env } = createTestContext();
    env.WRITE_QUEUE = {
      send: vi.fn(async () => {
        throw new Error('queue unavailable');
      }),
    } as any;
    await db
      .prepare(
        'INSERT INTO posts (id, title, area, current_status, status_label) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(
        'post_queue_failure',
        'queue故障確認',
        '熊本市',
        'available',
        '受付中'
      )
      .run();

    const res = await request('/api/posts/post_queue_failure/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'status-retry-123',
        status: 'closed',
        statusLabel: '受付終了',
      }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(((await res.json()) as any).retryable).toBe(true);
    const post = await db
      .prepare('SELECT current_status, status_label FROM posts WHERE id = ?')
      .bind('post_queue_failure')
      .first<any>();
    expect(post).toMatchObject({
      current_status: 'available',
      status_label: '受付中',
    });
  });

  it('drains create_post batch safely to D1 and acks messages', async () => {
    const { db, env } = createTestContext();

    const ackFn = vi.fn();
    const retryFn = vi.fn();

    const batch: any = {
      queue: 'tossa-write-queue',
      messages: [
        {
          id: 'msg-1',
          body: {
            type: 'create_post',
            post: {
              id: 'post_queued_1',
              title: 'バッチ作成投稿1',
              area: '熊本市南区',
              currentStatus: 'available',
              statusLabel: '受入中',
              authorId: null,
              authorCookieId: null,
            },
          } as WriteQueueMessage,
          ack: ackFn,
          retry: retryFn,
        },
        {
          id: 'msg-2',
          body: {
            type: 'create_post',
            post: {
              id: 'post_queued_2',
              title: 'バッチ作成投稿2',
              area: '熊本市北区',
              currentStatus: 'full',
              statusLabel: '満室',
              authorId: null,
              authorCookieId: null,
            },
          } as WriteQueueMessage,
          ack: ackFn,
          retry: retryFn,
        },
      ],
    };

    await processWriteQueueBatch(batch, env);

    expect(ackFn).toHaveBeenCalledTimes(2);
    expect(retryFn).not.toHaveBeenCalled();

    // Verify both posts now exist in D1
    const { results } = await db
      .prepare('SELECT id, title FROM posts WHERE id IN (?, ?)')
      .bind('post_queued_1', 'post_queued_2')
      .all();
    expect(results.length).toBe(2);
  });

  it('drains update_status batch safely to D1 and acks messages', async () => {
    const { db, env } = createTestContext();

    await db
      .prepare(
        'INSERT INTO posts (id, title, area, current_status, status_label) VALUES (?, ?, ?, ?, ?)'
      )
      .bind('post_to_update', 'テスト避難所', '益城町', 'available', '空きあり')
      .run();

    const ackFn = vi.fn();
    const retryFn = vi.fn();

    const batch: any = {
      queue: 'tossa-write-queue',
      messages: [
        {
          id: 'msg-status-1',
          body: {
            type: 'update_status',
            postId: 'post_to_update',
            status: 'crowded',
            statusLabel: '混雑中',
            note: '残りわずかです',
            ipHash: 'abcd1234',
          } as WriteQueueMessage,
          ack: ackFn,
          retry: retryFn,
        },
      ],
    };

    await processWriteQueueBatch(batch, env);

    expect(ackFn).toHaveBeenCalledTimes(1);
    expect(retryFn).not.toHaveBeenCalled();

    // Verify post status was updated in D1
    const { results } = await db
      .prepare('SELECT current_status, status_label FROM posts WHERE id = ?')
      .bind('post_to_update')
      .all();
    expect((results[0] as any).current_status).toBe('crowded');
    expect((results[0] as any).status_label).toBe('混雑中');
  });

  it('retries message when database operation fails', async () => {
    const { env } = createTestContext();
    // Simulate failing DB
    env.DB = {
      prepare: () => {
        throw new Error('D1 Lock Timeout');
      },
    } as any;

    const ackFn = vi.fn();
    const retryFn = vi.fn();

    const batch: any = {
      queue: 'tossa-write-queue',
      messages: [
        {
          id: 'msg-fail',
          body: {
            type: 'create_post',
            post: {
              id: 'failing_post',
              title: 'エラーテスト',
              area: '熊本市',
              currentStatus: 'open',
              statusLabel: '情報',
              authorId: null,
              authorCookieId: null,
            },
          } as WriteQueueMessage,
          ack: ackFn,
          retry: retryFn,
        },
      ],
    };

    await processWriteQueueBatch(batch, env);

    expect(retryFn).toHaveBeenCalledTimes(1);
    expect(ackFn).not.toHaveBeenCalled();
  });

  it('retries each failed message and sends one batch-level alert', async () => {
    const { db, env } = createTestContext();
    await db
      .prepare(
        `INSERT INTO users (id, username, display_name, role, email, email_verified_at)
         VALUES ('queue-admin', 'queue-admin', 'Queue Admin', 'admin', 'queue-admin@example.com', datetime('now'))`
      )
      .run();
    const send = vi.spyOn(env.EMAIL!, 'send');
    env.DB = {
      prepare: (sql: string) => {
        if (sql.includes('INSERT OR IGNORE INTO posts'))
          throw new Error('D1 write failed');
        return db.prepare(sql);
      },
    } as D1Database;

    const ack = vi.fn();
    const retry = vi.fn();
    const batch: any = {
      queue: 'tossa-write-queue',
      messages: ['first', 'second'].map((id) => ({
        id,
        body: {
          type: 'create_post',
          post: {
            id: `failed_${id}`,
            title: 'Queue failure test',
            area: 'Test area',
            currentStatus: 'available',
            statusLabel: 'Open',
            authorId: null,
            authorCookieId: null,
          },
        } as WriteQueueMessage,
        ack,
        retry,
      })),
    };

    await processWriteQueueBatch(batch, env);

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as any).bcc).toEqual([
      'queue-admin@example.com',
    ]);
    expect((send.mock.calls[0]![0] as any).text).toContain(
      '投稿・状態更新の送信待ち処理'
    );
  });
});
