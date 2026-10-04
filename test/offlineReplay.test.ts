import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enqueuePost,
  enqueueStatusUpdate,
  flushOfflineQueue,
  getOfflineQueue,
} from '../web/src/lib/offlineQueue';
import { createPost, updatePostStatus } from '../web/src/lib/api';
vi.mock('../web/src/lib/api', () => ({
  createPost: vi.fn(),
  updatePostStatus: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});

describe('Offline persistence and concurrent replay', () => {
  it('reports storage exhaustion without pretending a draft was saved', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    });
    expect(() =>
      enqueuePost({
        title: 'Photo',
        area: '',
        currentStatus: 'available',
        statusLabel: 'Open',
      })
    ).toThrow('保存できません');
  });

  it('preserves items added while syncing and uses the same request ID on every retry', async () => {
    const first = enqueuePost({
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
    const flushing = flushOfflineQueue(null);
    await vi.waitFor(() => expect(createPost).toHaveBeenCalledTimes(1));
    const second = enqueuePost({
      title: 'Second',
      area: '',
      currentStatus: 'available',
      statusLabel: 'Open',
    });
    resolve({ success: true, id: 'first-server-id' });
    expect(await flushing).toEqual({ succeeded: 1, failed: 0 });
    expect(getOfflineQueue().map((item) => item.id)).toEqual([second.id]);
    expect(vi.mocked(createPost).mock.calls[0]?.[0].requestId).toBe(
      first.data.requestId
    );
    vi.mocked(createPost).mockResolvedValueOnce({
      success: false,
      error: 'Busy',
    });
    await flushOfflineQueue(null);
    const requestId = vi.mocked(createPost).mock.calls[1]?.[0].requestId;
    vi.mocked(createPost).mockResolvedValueOnce({
      success: true,
      id: 'second-server-id',
    });
    await flushOfflineQueue(null);
    expect(vi.mocked(createPost).mock.calls[2]?.[0].requestId).toBe(requestId);
    expect(getOfflineQueue()).toEqual([]);
  });

  it('retains a conflicting status report and stops automatic retrying it', async () => {
    enqueueStatusUpdate({
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
    expect(await flushOfflineQueue(null)).toEqual({ succeeded: 0, failed: 1 });
    expect(getOfflineQueue()[0]?.conflict).toBe(true);
    expect(getOfflineQueue()[0]?.lastError).toContain('Newer');
    await flushOfflineQueue(null);
    expect(updatePostStatus).toHaveBeenCalledTimes(1);
  });
});
