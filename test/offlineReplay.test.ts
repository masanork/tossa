import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createPost, updatePostStatus } from '../web/src/lib/api';
let outbox: typeof import('../web/src/lib/offlineQueue');
vi.mock('../web/src/lib/api', () => ({
  createPost: vi.fn(),
  updatePostStatus: vi.fn(),
}));

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', {});
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  outbox = await import('../web/src/lib/offlineQueue');
});

describe('Offline persistence and concurrent replay', () => {
  it('reports storage exhaustion without pretending a draft was saved', async () => {
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'items')
        throw new DOMException('Storage is full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    await expect(
      outbox.enqueuePost({
        title: 'Photo',
        area: '',
        currentStatus: 'available',
        statusLabel: 'Open',
      })
    ).rejects.toThrow('保存容量が不足');
  });

  it('does not mislabel blocked browser storage as a quota error', async () => {
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'items')
        throw new DOMException('Storage is blocked', 'SecurityError');
      return originalPut.apply(this, args);
    });
    await expect(
      outbox.enqueuePost({
        title: 'Blocked storage',
        area: '',
        currentStatus: 'available',
        statusLabel: 'Open',
      })
    ).rejects.toThrow('ブラウザの保存設定');
  });

  it('preserves items added while syncing and uses the same request ID on every retry', async () => {
    const first = await outbox.enqueuePost({
      title: 'First',
      area: '',
      currentStatus: 'available',
      statusLabel: 'Open',
    });
    let resolve!: (value: { success: boolean; id: string }) => void;
    vi.mocked(createPost).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const flushing = outbox.flushOfflineQueue(null);
    await vi.waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
    const second = await outbox.enqueuePost({
      title: 'Second',
      area: '',
      currentStatus: 'available',
      statusLabel: 'Open',
    });
    resolve({ success: true, id: 'first-server-id' });
    expect(await flushing).toEqual({ succeeded: 1, failed: 0 });
    expect((await outbox.getOfflineQueue()).map((item) => item.id)).toEqual([
      second.id,
    ]);
    expect(vi.mocked(createPost).mock.calls[0]?.[0].requestId).toBe(
      first.data.requestId
    );
    vi.mocked(createPost).mockResolvedValueOnce({
      success: false,
      error: 'Busy',
    });
    await outbox.flushOfflineQueue(null);
    const requestId = vi.mocked(createPost).mock.calls[1]?.[0].requestId;
    vi.mocked(createPost).mockResolvedValueOnce({
      success: true,
      id: 'second-server-id',
    });
    await outbox.flushOfflineQueue(null);
    expect(vi.mocked(createPost).mock.calls[2]?.[0].requestId).toBe(requestId);
    expect(await outbox.getOfflineQueue()).toEqual([]);
  });

  it('retains a conflicting status report and stops automatic retrying it', async () => {
    await outbox.enqueueStatusUpdate({
      postId: 'target',
      status: 'available',
      statusLabel: 'Open',
      expectedUpdatedAt: 'old-version',
    });
    vi.mocked(updatePostStatus).mockResolvedValue({
      success: false,
      conflict: true,
      error: 'Newer information exists',
    });
    expect(await outbox.flushOfflineQueue(null)).toEqual({
      succeeded: 0,
      failed: 1,
    });
    expect((await outbox.getOfflineQueue())[0]?.conflict).toBe(true);
    expect((await outbox.getOfflineQueue())[0]?.lastError).toContain('Newer');
    await outbox.flushOfflineQueue(null);
    expect(updatePostStatus).toHaveBeenCalledTimes(1);
  });
});
