import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';
import { refreshPublicFeedSnapshot } from '../src/services/feedSnapshot';
import { DEVICE_COOKIE } from '../src/middleware/deviceCookie';

describe('Capacity report & public feed snapshot', () => {
  it('returns advice for admins and refreshes the KV snapshot', async () => {
    const { request, env } = createTestContext();
    const adminToken = await createSessionToken(
      {
        userId: 'user_admin_cap',
        username: 'admin',
        role: 'admin',
      },
      env.JWT_SECRET
    );

    await request('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${DEVICE_COOKIE}=device_cap_1`,
      },
      body: JSON.stringify({ title: 'カフェ開店' }),
    });

    await refreshPublicFeedSnapshot(env, { force: true });

    const res = await request('/api/settings/capacity', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.report.kvBound).toBe(true);
    expect(body.report.posts).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.report.advice)).toBe(true);
    expect(body.report.advice.length).toBeGreaterThan(0);
    expect(body.report.snapshotAgeSeconds).not.toBeNull();
  });

  it('rejects capacity report without admin session', async () => {
    const { request } = createTestContext();
    const res = await request('/api/settings/capacity');
    expect(res.status).toBe(401);
  });
});
