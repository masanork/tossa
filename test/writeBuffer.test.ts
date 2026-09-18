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
});
