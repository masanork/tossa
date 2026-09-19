// test/helpers/testApp.ts
import app from '../../src/index';
import { createMockD1, loadSchemaSql } from './mockD1';
import type { Bindings } from '../../src/types';

export function createTestContext() {
  const schemaSql = loadSchemaSql();
  const db = createMockD1(schemaSql);

  const kvStore = new Map<string, string>();
  const feedKv = {
    get: async (key: string) => kvStore.get(key) ?? null,
    put: async (key: string, value: string) => {
      kvStore.set(key, value);
    },
    delete: async (key: string) => {
      kvStore.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
    getWithMetadata: async (key: string) => ({
      value: kvStore.get(key) ?? null,
      metadata: null,
    }),
  } as unknown as KVNamespace;

  const env: Bindings = {
    DB: db,
    FEED_KV: feedKv,
    JWT_SECRET: 'test-super-secret-jwt-key-for-testing-only-12345',
    RP_NAME: 'tossa',
    RP_ID: 'localhost',
    EXPECTED_ORIGIN: 'http://localhost',
  };

  const request = (path: string, init?: RequestInit) => {
    return app.request(path, init, env);
  };

  return {
    app,
    db,
    env,
    request,
  };
}
