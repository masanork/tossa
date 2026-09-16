// test/helpers/testApp.ts
import app from '../../src/index';
import { createMockD1, loadSchemaSql } from './mockD1';
import type { Bindings } from '../../src/types';

export function createTestContext() {
  const schemaSql = loadSchemaSql();
  const db = createMockD1(schemaSql);

  const env: Bindings = {
    DB: db,
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
