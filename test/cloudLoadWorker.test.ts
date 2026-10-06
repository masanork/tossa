import { afterEach, describe, expect, it, vi } from 'vitest';
import { timingSafeEqual } from 'node:crypto';
import loadWorker from '../scripts/load-cloudflare-worker';
import { createTestContext } from './helpers/testApp';

afterEach(() => vi.restoreAllMocks());
describe('isolated cloud load access guard', () => {
  function context() {
    const { env } = createTestContext();
    return {
      ...env,
      LOAD_TOKEN: 'synthetic-test-token',
      LOAD_MARKER: 'tossa-load-test',
      LOAD_EXPIRES_AT: String(Date.now() + 60000),
    };
  }
  it.each(['', 'not-a-timestamp', String(Date.now() - 60000)])(
    'rejects an invalid expiry (%s) before accessing storage',
    async (expiry) => {
      const env = context();
      env.LOAD_EXPIRES_AT = expiry;
      const prepare = vi.spyOn(env.DB, 'prepare');
      const response = await loadWorker.fetch(
        new Request('https://load.example/__load/state', {
          headers: { Authorization: 'Bearer synthetic-test-token' },
        }),
        env,
        {} as ExecutionContext
      );
      expect(response.status).toBe(401);
      expect(prepare).not.toHaveBeenCalled();
    }
  );
  it('rejects missing or wrong credentials and exposes counts only with the correct token', async () => {
    Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
      configurable: true,
      value: (a: ArrayBuffer, b: ArrayBuffer) =>
        timingSafeEqual(Buffer.from(a), Buffer.from(b)),
    });
    try {
      const env = context();
      const prepare = vi.spyOn(env.DB, 'prepare');
      for (const authorization of ['', 'Bearer wrong']) {
        const response = await loadWorker.fetch(
          new Request('https://load.example/__load/state', {
            headers: { Authorization: authorization },
          }),
          env,
          {} as ExecutionContext
        );
        expect(response.status).toBe(401);
      }
      expect(prepare).not.toHaveBeenCalled();
      const response = await loadWorker.fetch(
        new Request('https://load.example/__load/state', {
          headers: { Authorization: 'Bearer synthetic-test-token' },
        }),
        env,
        {} as ExecutionContext
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        marker: 'tossa-load-test',
        counts: { total: 0 },
      });
      const denied = await loadWorker.fetch(
        new Request('https://load.example/api/admin', {
          headers: { Authorization: 'Bearer synthetic-test-token' },
        }),
        env,
        {} as ExecutionContext
      );
      expect(denied.status).toBe(404);
    } finally {
      delete (crypto.subtle as any).timingSafeEqual;
    }
  });
});
