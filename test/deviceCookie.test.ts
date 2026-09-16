// test/deviceCookie.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { DEVICE_COOKIE } from '../src/middleware/deviceCookie';

describe('Device Cookie & Access Logs Middleware', () => {
  it('issues a new device cookie when none is provided', async () => {
    const { request, db } = createTestContext();

    const res = await request('/api/posts', {
      headers: {
        'User-Agent': 'TestBrowser/1.0',
        'cf-connecting-ip': '198.51.100.1',
      },
    });

    expect(res.status).toBe(200);

    // Set-Cookie ヘッダーの検証
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${DEVICE_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    // Cookie値を抽出
    const match = setCookie!.match(new RegExp(`${DEVICE_COOKIE}=([a-f0-9]+)`));
    expect(match).toBeTruthy();
    const deviceId = match![1];

    // device_sessions テーブルに登録されたか確認
    const session = await db
      .prepare('SELECT * FROM device_sessions WHERE id = ?')
      .bind(deviceId)
      .first<{ id: string; created_ip: string; created_ua: string }>();

    expect(session).toBeTruthy();
    expect(session!.id).toBe(deviceId);
    expect(session!.created_ip).toBe('198.51.100.1');
    expect(session!.created_ua).toBe('TestBrowser/1.0');

    // access_logs に cookie_issued が記録されたか確認
    const log = await db
      .prepare(
        'SELECT * FROM access_logs WHERE device_session_id = ? AND event_type = ?'
      )
      .bind(deviceId, 'cookie_issued')
      .first<{ event_type: string; ip_address: string; user_agent: string }>();

    expect(log).toBeTruthy();
    expect(log!.event_type).toBe('cookie_issued');
    expect(log!.ip_address).toBe('198.51.100.1');
    expect(log!.user_agent).toBe('TestBrowser/1.0');
  });

  it('reuses existing device cookie without issuing a new one', async () => {
    const { request, db } = createTestContext();

    // 事前にセッションを登録
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
    // 新しいCookieは発行されない
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
