// test/deviceCookie.test.ts: Device Cookie & High-Traffic Scalability Tests
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { DEVICE_COOKIE } from '../src/middleware/deviceCookie';

describe('Device Cookie & Access Logs Middleware', () => {
  it('issues a new device cookie on GET without writing to D1 (zero-write read scalability)', async () => {
    const { request, db } = createTestContext();

    const res = await request('/api/posts', {
      headers: {
        'User-Agent': 'TestBrowser/1.0',
        'cf-connecting-ip': '198.51.100.1',
      },
    });

    expect(res.status).toBe(200);

    // Verify Set-Cookie header is issued
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${DEVICE_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    // Extract cookie value
    const match = setCookie!.match(new RegExp(`${DEVICE_COOKIE}=([a-f0-9]+)`));
    expect(match).toBeTruthy();
    const deviceId = match![1];

    // Under read-only traffic, D1 must NOT be written to avoid write bottleneck
    const session = await db
      .prepare('SELECT * FROM device_sessions WHERE id = ?')
      .bind(deviceId)
      .first<{ id: string }>();

    expect(session).toBeNull();
  });

  it('persists device session on state-mutating requests (POST) to satisfy foreign keys', async () => {
    const { request, db } = createTestContext();

    const createRes = await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TestBrowser/1.0',
        'cf-connecting-ip': '198.51.100.1',
      },
      body: JSON.stringify({
        title: 'テスト避難所',
        area: '中央区',
        currentStatus: 'available',
        statusLabel: '受付中',
      }),
    });

    expect(createRes.status).toBe(201);

    const setCookie = createRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const match = setCookie!.match(new RegExp(`${DEVICE_COOKIE}=([a-f0-9]+)`));
    expect(match).toBeTruthy();
    const deviceId = match![1];

    // State-mutating POST should persist session in D1
    const session = await db
      .prepare('SELECT * FROM device_sessions WHERE id = ?')
      .bind(deviceId)
      .first<{ id: string; created_ip: string; created_ua: string }>();

    expect(session).toBeTruthy();
    expect(session!.id).toBe(deviceId);
    expect(session!.created_ip).toBe('198.51.100.1');
  });

  it('reuses existing device cookie without issuing a new one', async () => {
    const { request, db } = createTestContext();

    // Pre-populate an existing session
    const existingDeviceId = 'aabbccddeeff001122334455';
    await db
      .prepare('INSERT INTO device_sessions (id, created_ip) VALUES (?, ?)')
      .bind(existingDeviceId, '127.0.0.1')
      .run();

    const res = await request('/api/posts', {
      headers: {
        Cookie: `${DEVICE_COOKIE}=${existingDeviceId}`,
      },
    });

    expect(res.status).toBe(200);
    // No new cookie should be issued
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
