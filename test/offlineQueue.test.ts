// test/offlineQueue.test.ts: Unit tests for Offline Queue & Outbox Management
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueuePost,
  enqueueStatusUpdate,
  getPendingQueueCount,
  getOfflineQueue,
  removeQueuedItem,
  clearOfflineQueue,
} from '../web/src/lib/offlineQueue';

describe('offlineQueue Outbox management', () => {
  let storageMock: Record<string, string>;

  beforeEach(() => {
    storageMock = {};
    const mockLocalStorage = {
      getItem: (key: string) => storageMock[key] ?? null,
      setItem: (key: string, val: string) => {
        storageMock[key] = val;
      },
      removeItem: (key: string) => {
        delete storageMock[key];
      },
      clear: () => {
        storageMock = {};
      },
    };
    (globalThis as any).localStorage = mockLocalStorage;
  });

  it('enqueues posts and status updates and returns count', () => {
    expect(getPendingQueueCount()).toBe(0);

    const postItem = enqueuePost({
      title: 'テスト避難所',
      area: '中央区',
      currentStatus: 'available',
      statusLabel: '受付中',
    });

    expect(getPendingQueueCount()).toBe(1);
    expect(postItem.type).toBe('create_post');
    expect(postItem.data.title).toBe('テスト避難所');

    const statusItem = enqueueStatusUpdate({
      postId: 'p123',
      status: 'crowded',
      statusLabel: '混雑中',
      note: '30分待ち',
    });

    expect(getPendingQueueCount()).toBe(2);
    expect(statusItem.type).toBe('update_status');
    expect(statusItem.data.status).toBe('crowded');

    const queue = getOfflineQueue();
    expect(queue.length).toBe(2);
    expect(queue[0].id).toBe(postItem.id);
    expect(queue[1].id).toBe(statusItem.id);
  });

  it('removes individual items from queue', () => {
    const item1 = enqueuePost({
      title: '投稿1',
      area: '東区',
      currentStatus: 'available',
      statusLabel: '受付中',
    });
    const item2 = enqueuePost({
      title: '投稿2',
      area: '西区',
      currentStatus: 'closed',
      statusLabel: '終了',
    });

    expect(getPendingQueueCount()).toBe(2);

    removeQueuedItem(item1.id);
    expect(getPendingQueueCount()).toBe(1);

    const remaining = getOfflineQueue();
    expect(remaining[0].id).toBe(item2.id);
    expect(remaining[0].data.title).toBe('投稿2');
  });

  it('clears all items in queue', () => {
    enqueuePost({
      title: '投稿1',
      area: '東区',
      currentStatus: 'available',
      statusLabel: '受付中',
    });
    enqueueStatusUpdate({
      postId: 'p1',
      status: 'available',
      statusLabel: '利用可能',
    });

    expect(getPendingQueueCount()).toBe(2);
    clearOfflineQueue();
    expect(getPendingQueueCount()).toBe(0);
    expect(getOfflineQueue()).toEqual([]);
  });
});
