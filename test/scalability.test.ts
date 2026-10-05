import { describe, expect, it, vi } from 'vitest';
import { createTestContext } from './helpers/testApp';
import {
  broadcastPushNotification,
  processPushQueueBatch,
} from '../src/services/push';
import {
  FEED_SNAPSHOT_KEY,
  requestPublicFeedRefresh,
} from '../src/services/feedSnapshot';
import { processWriteQueueBatch } from '../src/services/writeBuffer';
import worker from '../src/index';

function pushQueue() {
  const jobs: any[] = [];
  const deliveries: any[][] = [];
  return {
    jobs,
    deliveries,
    send: vi.fn(async (body: any) => {
      jobs.push(body);
    }),
    sendBatch: vi.fn(async (messages: any[]) => {
      deliveries.push(messages);
    }),
  };
}
async function seedSubscriptions(db: D1Database, count: number) {
  await db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${count})
    INSERT INTO push_subscriptions (id,endpoint,p256dh,auth,area,alert_types)
    SELECT printf('sub_%06d',i), 'https://push.example.test/' || i, 'key', 'auth', 'A', '["emergency"]' FROM n`);
}
async function consumePush(body: any, env: any) {
  const message = { body, ack: vi.fn(), retry: vi.fn() };
  await processPushQueueBatch({ messages: [message] } as any, env);
  return message;
}

describe('bounded push fanout', () => {
  it('pages 201 recipients, shares a tag, and excludes subscriptions above the captured upper ID', async () => {
    const { db, env } = createTestContext();
    await seedSubscriptions(db, 201);
    const queue = pushQueue();
    env.PUSH_QUEUE = queue as any;
    await broadcastPushNotification(env, { title: 'Alert', body: 'Test' });
    expect(queue.deliveries).toHaveLength(0);
    await db
      .prepare(
        "INSERT INTO push_subscriptions (id,endpoint,p256dh,auth) VALUES ('sub_999999','https://push.example.test/new','key','auth')"
      )
      .run();
    let pages = 0;
    while (queue.jobs.length) {
      const message = await consumePush(queue.jobs.shift(), env);
      expect(message.ack).toHaveBeenCalledOnce();
      expect(message.retry).not.toHaveBeenCalled();
      if (++pages > 4) throw new Error('Fanout did not terminate');
    }
    expect(queue.deliveries.map((page) => page.length)).toEqual([100, 100, 1]);
    const deliveries = queue.deliveries.flat().map((job) => job.body);
    expect(
      new Set(deliveries.map((job) => job.subscription.endpoint)).size
    ).toBe(201);
    expect(new Set(deliveries.map((job) => job.payload.tag)).size).toBe(1);
    expect(
      deliveries.some((job) => job.subscription.endpoint.endsWith('/new'))
    ).toBe(false);
  });

  it('applies area, alert type and excluded user filters in SQL with legacy malformed JSON behavior', async () => {
    const { db, env } = createTestContext();
    await seedSubscriptions(db, 7);
    await db.exec(`INSERT INTO users (id,username,display_name,role) VALUES ('sender','sender','Sender','user');
      UPDATE push_subscriptions SET area='B' WHERE id='sub_000001';
      UPDATE push_subscriptions SET alert_types='["messages"]' WHERE id='sub_000002';
      UPDATE push_subscriptions SET alert_types='[]' WHERE id='sub_000003';
      UPDATE push_subscriptions SET user_id='sender' WHERE id='sub_000004';
      UPDATE push_subscriptions SET area=NULL,alert_types='invalid' WHERE id='sub_000005';
      UPDATE push_subscriptions SET area='',alert_types='{}' WHERE id='sub_000006';`);
    const queue = pushQueue();
    env.PUSH_QUEUE = queue as any;
    await broadcastPushNotification(env, {
      title: 'Alert',
      body: 'Test',
      area: 'A',
      alertType: 'emergency',
      excludeUserId: 'sender',
    });
    const message = await consumePush(queue.jobs.shift(), env);
    expect(message.retry).not.toHaveBeenCalled();
    expect(
      queue.deliveries.flat().map((job) => job.body.subscription.endpoint)
    ).toEqual([
      'https://push.example.test/5',
      'https://push.example.test/6',
      'https://push.example.test/7',
    ]);
  });

  it('retries a failed continuation without changing the notification tag', async () => {
    const { db, env } = createTestContext();
    await seedSubscriptions(db, 101);
    const queue = pushQueue();
    env.PUSH_QUEUE = queue as any;
    await broadcastPushNotification(env, { title: 'Alert', body: 'Test' });
    const body = queue.jobs.shift();
    queue.send.mockRejectedValueOnce(
      new Error('Queue temporarily unavailable')
    );
    const first = await consumePush(body, env);
    expect(first.ack).not.toHaveBeenCalled();
    expect(first.retry).toHaveBeenCalledOnce();
    const second = await consumePush(body, env);
    expect(second.ack).toHaveBeenCalledOnce();
    expect(queue.jobs[0].afterId).toBe('sub_000100');
    expect(queue.deliveries[0][0].body.payload.tag).toBe(
      queue.deliveries[1][0].body.payload.tag
    );
  });
});

describe('serialized public feed publication', () => {
  it('enqueues refreshes without publishing and propagates enqueue failures without racing a direct KV writer', async () => {
    const { env } = createTestContext();
    const send = vi.fn().mockResolvedValue(undefined);
    env.WRITE_QUEUE = { send } as any;
    const put = vi.spyOn(env.FEED_KV!, 'put');
    expect(await requestPublicFeedRefresh(env, { force: true })).toEqual({
      queued: true,
    });
    expect(send).toHaveBeenCalledWith({
      type: 'refresh_public_feed',
      force: true,
    });
    send.mockRejectedValueOnce(new Error('Queue unavailable'));
    await expect(requestPublicFeedRefresh(env)).rejects.toThrow(
      'Queue unavailable'
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('publishes one snapshot for multiple jobs and retries all jobs when persistence fails', async () => {
    const { env } = createTestContext();
    const messages = Array.from({ length: 3 }, () => ({
      body: { type: 'refresh_public_feed', force: true },
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    const put = vi
      .spyOn(env.FEED_KV!, 'put')
      .mockRejectedValueOnce(new Error('KV throttled'));
    await processWriteQueueBatch({ messages } as any, env);
    for (const message of messages) {
      expect(message.ack).not.toHaveBeenCalled();
      expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 5 });
    }
    await processWriteQueueBatch({ messages } as any, env);
    expect(put).toHaveBeenCalledTimes(2);
    for (const message of messages) expect(message.ack).toHaveBeenCalledOnce();
  });

  it('preserves a trailing refresh when a recent snapshot would hide a committed mutation', async () => {
    const { env, db } = createTestContext();
    await env.FEED_KV!.put(
      FEED_SNAPSHOT_KEY,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        total: 0,
        posts: [],
      })
    );
    const send = vi.fn().mockResolvedValue(undefined);
    env.WRITE_QUEUE = { send } as any;
    const ack = vi.fn();
    await processWriteQueueBatch(
      {
        messages: [
          {
            id: 'mutation',
            body: {
              type: 'create_post',
              post: {
                id: 'new-post',
                title: 'New',
                area: 'A',
                currentStatus: 'available',
                statusLabel: 'Open',
                authorId: null,
                authorCookieId: null,
              },
            },
            ack,
            retry: vi.fn(),
          },
        ],
      } as any,
      env
    );
    expect(ack).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      { type: 'refresh_public_feed', force: true },
      { delaySeconds: 3 }
    );
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM posts').first()
    ).toEqual({ count: 1 });
    await processWriteQueueBatch(
      {
        messages: [
          { body: send.mock.calls[0][0], ack: vi.fn(), retry: vi.fn() },
        ],
      } as any,
      env
    );
    const snapshot = JSON.parse((await env.FEED_KV!.get(FEED_SNAPSHOT_KEY))!);
    expect(snapshot.posts[0].id).toBe('new-post');
  });

  it('uses a 90-second-old snapshot but rejects future snapshots and never enqueues refreshes from cold production reads', async () => {
    const { env, request } = createTestContext();
    const send = vi.fn();
    env.WRITE_QUEUE = { send } as any;
    for (const [age, source] of [
      [90_000, 'kv'],
      [-30_000, 'd1'],
      [130_000, 'd1'],
    ] as const) {
      await env.FEED_KV!.put(
        FEED_SNAPSHOT_KEY,
        JSON.stringify({
          generatedAt: new Date(Date.now() - age).toISOString(),
          total: 0,
          posts: [],
        })
      );
      const response = await request('/api/posts');
      expect(response.headers.get('X-Feed-Source')).toBe(source);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('requests a refresh each minute through the existing write queue', async () => {
    const { env } = createTestContext();
    const send = vi.fn().mockResolvedValue(undefined);
    env.WRITE_QUEUE = { send } as any;
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({ cron: '* * * * *' } as any, env, {
      waitUntil: (task: Promise<unknown>) => pending.push(task),
    } as any);
    await Promise.all(pending);
    expect(send).toHaveBeenCalledWith({
      type: 'refresh_public_feed',
      force: true,
    });
  });
});
