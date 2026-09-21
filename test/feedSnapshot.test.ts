import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readPublicFeedSnapshot,
  refreshPublicFeedSnapshot,
  scheduleFeedRefresh,
  executionCtxOf,
  FEED_SNAPSHOT_KEY,
} from '../src/services/feedSnapshot';
import type { Bindings } from '../src/types';

// Mock getPosts
vi.mock('../src/db/queries', () => ({
  getPosts: vi.fn().mockResolvedValue({
    posts: [{ id: '1', content: 'mock post' }],
    total: 1,
  }),
}));

function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) || null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: '' })),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) || null,
      metadata: null,
    })),
    __store: store,
  } as unknown as KVNamespace & { __store: Map<string, string> };
}

describe('feedSnapshot service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readPublicFeedSnapshot', () => {
    it('returns null if env.FEED_KV is missing', async () => {
      const env = {} as Bindings;
      const result = await readPublicFeedSnapshot(env);
      expect(result).toBeNull();
    });

    it('returns null if snapshot does not exist in KV', async () => {
      const env = { FEED_KV: createMockKV() } as Bindings;
      const result = await readPublicFeedSnapshot(env);
      expect(result).toBeNull();
    });

    it('returns null and catches error if snapshot is invalid JSON', async () => {
      const kv = createMockKV();
      kv.__store.set(FEED_SNAPSHOT_KEY, 'invalid json');
      const env = { FEED_KV: kv } as Bindings;
      const result = await readPublicFeedSnapshot(env);
      expect(result).toBeNull();
    });

    it('returns parsed snapshot if valid JSON', async () => {
      const kv = createMockKV();
      const mockSnapshot = {
        generatedAt: '2023-01-01T00:00:00.000Z',
        total: 1,
        posts: [],
      };
      kv.__store.set(FEED_SNAPSHOT_KEY, JSON.stringify(mockSnapshot));
      const env = { FEED_KV: kv } as Bindings;

      const result = await readPublicFeedSnapshot(env);
      expect(result).toEqual(mockSnapshot);
    });
  });

  describe('refreshPublicFeedSnapshot', () => {
    it('returns null if env.FEED_KV is missing', async () => {
      const env = {} as Bindings;
      const result = await refreshPublicFeedSnapshot(env);
      expect(result).toBeNull();
    });

    it('returns existing snapshot if it is fresh and force is false', async () => {
      const kv = createMockKV();
      const mockSnapshot = {
        generatedAt: new Date().toISOString(),
        total: 1,
        posts: [],
      };
      kv.__store.set(FEED_SNAPSHOT_KEY, JSON.stringify(mockSnapshot));
      const env = { FEED_KV: kv } as Bindings;

      const result = await refreshPublicFeedSnapshot(env);
      expect(result).toEqual(mockSnapshot);
      // DB shouldn't be called because snapshot was fresh
      const queries = await import('../src/db/queries');
      expect(queries.getPosts).not.toHaveBeenCalled();
    });

    it('refreshes snapshot if it is fresh but force is true', async () => {
      const kv = createMockKV();
      const mockSnapshot = {
        generatedAt: new Date().toISOString(),
        total: 1,
        posts: [],
      };
      kv.__store.set(FEED_SNAPSHOT_KEY, JSON.stringify(mockSnapshot));
      const env = { FEED_KV: kv } as Bindings;

      const result = await refreshPublicFeedSnapshot(env, { force: true });
      expect(result).not.toBeNull();
      expect(result?.posts.length).toBe(1);

      const queries = await import('../src/db/queries');
      expect(queries.getPosts).toHaveBeenCalled();
    });

    it('refreshes snapshot if it is stale', async () => {
      const kv = createMockKV();
      // 1 hour ago
      const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const mockSnapshot = { generatedAt: staleTime, total: 1, posts: [] };
      kv.__store.set(FEED_SNAPSHOT_KEY, JSON.stringify(mockSnapshot));
      const env = { FEED_KV: kv } as Bindings;

      const result = await refreshPublicFeedSnapshot(env);
      expect(result).not.toBeNull();
      expect(result?.posts.length).toBe(1);

      const queries = await import('../src/db/queries');
      expect(queries.getPosts).toHaveBeenCalled();
    });

    it('returns snapshot even if KV put fails', async () => {
      const kv = createMockKV();
      kv.put = vi.fn().mockRejectedValue(new Error('KV put failed'));
      const env = { FEED_KV: kv } as Bindings;

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const result = await refreshPublicFeedSnapshot(env);
      expect(result).not.toBeNull();
      expect(result?.posts.length).toBe(1);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[feedSnapshot] KV put failed:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('executionCtxOf', () => {
    it('returns executionCtx if it exists and is valid', () => {
      const mockCtx = { waitUntil: vi.fn() };
      const c = { executionCtx: mockCtx };
      const result = executionCtxOf(c);
      expect(result).toBe(mockCtx);
    });

    it('returns undefined if accessing executionCtx throws', () => {
      const c = {};
      Object.defineProperty(c, 'executionCtx', {
        get: () => {
          throw new Error('Cannot access');
        },
      });
      const result = executionCtxOf(c as any);
      expect(result).toBeUndefined();
    });
  });

  describe('scheduleFeedRefresh', () => {
    it('calls ctx.waitUntil with the refresh promise if valid ctx is provided', () => {
      const env = { FEED_KV: createMockKV() } as Bindings;
      const mockWaitUntil = vi.fn();
      const c = { executionCtx: { waitUntil: mockWaitUntil } };

      scheduleFeedRefresh(env, c);
      expect(mockWaitUntil).toHaveBeenCalled();
    });

    it('executes fallback logic if executionCtx is unavailable (no waitUntil called)', () => {
      const env = { FEED_KV: createMockKV() } as Bindings;
      const c = {} as any; // Invalid ctx

      expect(() => {
        scheduleFeedRefresh(env, c);
      }).not.toThrow();
    });

    it('catches and logs errors from refreshPublicFeedSnapshot during fallback', async () => {
      const env = { FEED_KV: createMockKV() } as Bindings;
      const c = {} as any;

      // Make refreshPublicFeedSnapshot fail
      const queries = await import('../src/db/queries');
      (queries.getPosts as any).mockRejectedValueOnce(new Error('DB failure'));

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      scheduleFeedRefresh(env, c);

      // Allow fallback promise to resolve/reject
      await new Promise(process.nextTick);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[feedSnapshot] scheduled refresh failed:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
