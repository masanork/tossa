import { describe, it } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';

describe('Settings Benchmark', () => {
  it('measures performance of setting updates', async () => {
    const { request, db, env } = createTestContext();

    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_admin', 'admin', 'Admin', 'admin')
      .run();

    const adminToken = await createSessionToken(
      { userId: 'user_admin', username: 'admin', role: 'admin' },
      env.JWT_SECRET
    );

    const payload = {};
    for (let i = 0; i < 5000; i++) {
      payload[`key_${i}`] = `value_${i}`;
    }

    const start = performance.now();
    const updateRes = await request('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (updateRes.status !== 200) {
      console.log('Failed', await updateRes.text());
    }

    const end = performance.now();

    console.log(
      `\n\n=== BENCHMARK RESULT ===\nTime taken: ${end - start}ms\n========================\n`
    );
  });
});
