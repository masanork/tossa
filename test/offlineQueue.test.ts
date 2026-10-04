import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const LEGACY_KEY = 'tossa_offline_outbox';
let storage: Map<string, string>;
let outbox: typeof import('../web/src/lib/offlineQueue');

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  outbox = await import('../web/src/lib/offlineQueue');
});

describe('IndexedDB offline outbox', () => {
  it('migrates the legacy queue, preserves operation IDs, and removes the source after commit', async () => {
    const legacy = [
      {
        id: 'stable-old-id',
        type: 'create_post',
        createdAt: '2025-01-01T00:00:00.000Z',
        data: { title: '旧形式の投稿' },
      },
    ];
    storage.set(LEGACY_KEY, JSON.stringify(legacy));

    expect(await outbox.getOfflineQueue()).toEqual(legacy);
    expect(await outbox.getPendingQueueCount()).toBe(1);
    expect(storage.has(LEGACY_KEY)).toBe(false);
    const duplicate = await outbox.enqueueStatusUpdate({
      requestId: 'stable-update-id',
      postId: 'p1',
      status: 'available',
      statusLabel: '受付中',
    });
    expect(duplicate.id).toBe('stable-update-id');
    expect((await outbox.getOfflineQueue()).map((item) => item.id)).toEqual([
      'stable-old-id',
      'stable-update-id',
    ]);
  });

  it('keeps the original legacy bytes when the migration transaction aborts', async () => {
    const raw = JSON.stringify([
      {
        id: 'keep-source',
        type: 'create_post',
        createdAt: '2025-01-01T00:00:00.000Z',
        data: { title: 'must remain in localStorage until commit' },
      },
    ]);
    storage.set(LEGACY_KEY, raw);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'items')
        throw new DOMException('disk full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });

    await expect(outbox.getOfflineQueue()).rejects.toThrow();
    expect(storage.get(LEGACY_KEY)).toBe(raw);
    vi.restoreAllMocks();
    outbox = await import('../web/src/lib/offlineQueue');
  });

  it('serializes concurrent IDB additions without losing either item', async () => {
    const [first, second] = await Promise.all([
      outbox.enqueuePost({ title: '一' }),
      outbox.enqueuePost({ title: '二' }),
    ]);
    expect(
      (await outbox.getOfflineQueue()).map((item) => item.id).sort()
    ).toEqual([first.id, second.id].sort());
  });

  it('preserves a large image when localStorage cannot accept another write', async () => {
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('localStorage full', 'QuotaExceededError');
    });
    const imageUrl = `data:image/jpeg;base64,${'A'.repeat(6 * 1024 * 1024)}`;
    const item = await outbox.enqueuePost({
      title: '写真付きの未送信投稿',
      imageUrl,
    });
    const saved = await outbox.getOfflineQueue();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(item);
    expect(saved[0]?.type === 'create_post' && saved[0].data.imageUrl).toBe(
      imageUrl
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('allows concurrent tabs to complete one legacy migration without losing IDs', async () => {
    const legacy = {
      id: 'legacy-during-race',
      type: 'create_post',
      createdAt: '2025-01-01T00:00:00.000Z',
      data: { title: 'migrate once' },
    };
    storage.set(LEGACY_KEY, JSON.stringify([legacy]));
    const [first, second] = await Promise.all([
      outbox.enqueuePost({ title: 'first new tab' }),
      outbox.enqueuePost({ title: 'second new tab' }),
    ]);
    expect(storage.has(LEGACY_KEY)).toBe(false);
    expect((await outbox.getOfflineQueue()).map((item) => item.id)).toEqual(
      expect.arrayContaining([legacy.id, first.id, second.id])
    );
  });

  it('atomically removes acknowledged entries and prevents the same ID from returning', async () => {
    await outbox.enqueueStatusUpdate({
      requestId: 'acked-id',
      postId: 'p1',
      status: 'closed',
      statusLabel: '終了',
    });
    await outbox.removeQueuedItem('acked-id');
    await outbox.enqueueStatusUpdate({
      requestId: 'acked-id',
      postId: 'p1',
      status: 'closed',
      statusLabel: '終了',
    });
    expect(await outbox.getOfflineQueue()).toEqual([]);
  });

  it('does not overwrite malformed legacy data and supports explicit partial recovery', async () => {
    const valid = {
      id: 'recover-me',
      type: 'create_post',
      createdAt: '2025-01-01T00:00:00.000Z',
      data: { title: '回復' },
    };
    const raw = JSON.stringify([
      valid,
      { id: 'broken', type: 'create_post', data: null },
    ]);
    storage.set(LEGACY_KEY, raw);
    await expect(outbox.getOfflineQueue()).rejects.toThrow('読み取れません');
    expect(await outbox.getOfflineQueueExportRaw()).toBe(raw);
    await expect(outbox.recoverOfflineQueue(`${raw} `)).rejects.toThrow(
      '別タブ'
    );
    expect(storage.get(LEGACY_KEY)).toBe(raw);
    await expect(outbox.recoverOfflineQueue(raw)).resolves.toMatchObject({
      recovered: 1,
      discarded: 1,
      unparseable: false,
    });
    expect(await outbox.getOfflineQueue()).toEqual([valid]);
  });

  it('preserves unparseable legacy bytes until explicit recovery and then reopens the outbox', async () => {
    const raw = '[broken json';
    storage.set(LEGACY_KEY, raw);
    await expect(outbox.getOfflineQueue()).rejects.toThrow();
    expect(await outbox.getOfflineQueueExportRaw()).toBe(raw);
    await expect(outbox.recoverOfflineQueue(raw)).resolves.toMatchObject({
      recovered: 0,
      discarded: 0,
      unparseable: true,
    });
    expect(await outbox.getOfflineQueue()).toEqual([]);
    expect(storage.has(LEGACY_KEY)).toBe(false);
  });

  it('removes corrupt IDB rows by their primary key, even when the row ID is not a string', async () => {
    const valid = await outbox.enqueuePost({ title: 'preserve valid item' });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tossa-offline-outbox', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').put({ id: 42, type: 'corrupt', data: null });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    await expect(outbox.getOfflineQueue()).rejects.toThrow('読み取れません');
    const raw = await outbox.getOfflineQueueExportRaw();
    expect(raw).toContain('"id":42');
    await expect(outbox.recoverOfflineQueue(raw!)).resolves.toMatchObject({
      discarded: 1,
      preservedExisting: 1,
    });
    expect((await outbox.getOfflineQueue()).map((item) => item.id)).toEqual([
      valid.id,
    ]);
  });

  it('pauses after a legacy bundle mutates the migrated source instead of merging stale data', async () => {
    await outbox.enqueuePost({ title: 'new bundle' });
    storage.set(
      LEGACY_KEY,
      JSON.stringify([
        {
          id: 'old-write',
          type: 'create_post',
          createdAt: '2025-01-01T00:00:00.000Z',
          data: { title: 'old tab item' },
        },
      ])
    );
    await expect(outbox.getOfflineQueue()).rejects.toThrow('古い画面');
    const raw = storage.get(LEGACY_KEY)!;
    expect(await outbox.getOfflineQueueExportRaw()).toBe(raw);
    await expect(outbox.getOfflineQueue()).rejects.toThrow('古い画面');
    await expect(outbox.recoverOfflineQueue(raw)).resolves.toMatchObject({
      recovered: 1,
      preservedExisting: 1,
    });
    expect((await outbox.getOfflineQueue()).map((item) => item.id)).toEqual(
      expect.arrayContaining(['old-write'])
    );
  });

  it('discards only queue entries, not tombstones, when clearing', async () => {
    const item = await outbox.enqueuePost({ title: 'discard' });
    await outbox.clearOfflineQueue();
    await outbox.enqueuePost({ title: 'another item' });
    await outbox.enqueueStatusUpdate({
      requestId: item.id,
      postId: 'p1',
      status: 'available',
      statusLabel: '受付中',
    });
    expect(
      (await outbox.getOfflineQueue()).map((entry) => entry.id)
    ).not.toContain(item.id);
  });
});
