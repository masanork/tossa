import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';

describe('Email verification', () => {
  it('sends a 6-digit code and confirms it', async () => {
    const { request, db, env, sentEmails } = createTestContext();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_mail', 'mailuser', 'メール太郎', 'user')
      .run();
    const token = await createSessionToken(
      { userId: 'user_mail', username: 'mailuser', role: 'user' },
      env.JWT_SECRET
    );

    const sendRes = await request('/api/auth/email/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: 'mail@example.com' }),
    });
    expect(sendRes.status).toBe(200);
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0]?.to).toBe('mail@example.com');
    const code = sentEmails[0]?.text.match(/確認番号: (\d{6})/)?.[1];
    expect(code).toMatch(/^\d{6}$/);

    const bad = await request('/api/auth/email/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code: '000000' }),
    });
    expect(bad.status).toBe(400);

    const ok = await request('/api/auth/email/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.user.email).toBe('mail@example.com');
    expect(body.user.emailVerified).toBe(true);

    const me = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meBody = await me.json();
    expect(meBody.user.email).toBe('mail@example.com');
  });

  it('confirms via magic-link token', async () => {
    const { request, db, env, sentEmails } = createTestContext();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_link', 'linkuser', 'リンク', 'user')
      .run();
    const token = await createSessionToken(
      { userId: 'user_link', username: 'linkuser', role: 'user' },
      env.JWT_SECRET
    );
    await request('/api/auth/email/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: 'link@example.com' }),
    });
    const verify = sentEmails[0]?.text.match(/verify=([0-9a-f]+)/)?.[1];
    expect(verify).toBeTruthy();

    const ok = await request('/api/auth/email/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token: verify }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.user.email).toBe('link@example.com');
  });

  it('rejects unauthenticated email request', async () => {
    const { request } = createTestContext();
    const res = await request('/api/auth/email/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com' }),
    });
    expect(res.status).toBe(401);
  });
});
