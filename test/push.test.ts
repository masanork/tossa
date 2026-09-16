// test/push.test.ts: Unit Tests for Web Push service, VAPID key generation, and API endpoints
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, loadSchemaSql } from './helpers/mockD1';
import { createTestContext } from './helpers/testApp';
import { DEVICE_COOKIE } from '../src/middleware/deviceCookie';
import {
  generateVapidKeyPair,
  getOrCreateVapidKeys,
  savePushSubscription,
  removePushSubscription,
  base64urlToBytes,
  bytesToBase64url,
} from '../src/services/push';
import type { Bindings } from '../src/types';

describe('Web Push & VAPID Key Engine', () => {
  let db: D1Database;
  let env: Bindings;

  beforeEach(() => {
    db = createMockD1(loadSchemaSql());
    env = {
      DB: db,
      RP_NAME: 'tossa test',
      RP_ID: 'localhost',
      EXPECTED_ORIGIN: 'http://localhost:8787',
      JWT_SECRET: 'test-jwt-secret-key-1234567890123456',
    };
  });

  describe('base64url conversion helpers', () => {
    it('correctly converts between Uint8Array bytes and base64url string', () => {
      const original = new Uint8Array([1, 2, 3, 255, 254, 128, 0, 42]);
      const encoded = bytesToBase64url(original);
      expect(typeof encoded).toBe('string');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');

      const decoded = base64urlToBytes(encoded);
      expect(Array.from(decoded)).toEqual(Array.from(original));
    });
  });

  describe('generateVapidKeyPair', () => {
    it('generates a valid P-256 ECDSA keypair with 65-byte uncompressed public key', async () => {
      const keypair = await generateVapidKeyPair();

      expect(typeof keypair.publicKey).toBe('string');
      expect(typeof keypair.privateKey).toBe('string');

      const pubBytes = base64urlToBytes(keypair.publicKey);
      // Uncompressed P-256 EC point format: 0x04 prefix + 32-byte X + 32-byte Y = 65 bytes
      expect(pubBytes.length).toBe(65);
      expect(pubBytes[0]).toBe(0x04);

      const privBytes = base64urlToBytes(keypair.privateKey);
      expect(privBytes.length).toBe(32);
    });
  });

  describe('getOrCreateVapidKeys', () => {
    it('auto-generates and persists keys in system_settings if none exist', async () => {
      const vapid1 = await getOrCreateVapidKeys(env);
      expect(vapid1.publicKey).toBeDefined();
      expect(vapid1.privateKey).toBeDefined();
      expect(vapid1.subject).toBe('mailto:admin@tossa.app');

      // Subsequent call should retrieve the exact same keys
      const vapid2 = await getOrCreateVapidKeys(env);
      expect(vapid2.publicKey).toBe(vapid1.publicKey);
      expect(vapid2.privateKey).toBe(vapid1.privateKey);
    });

    it('honors environment variable VAPID keys if provided', async () => {
      const customEnv: Bindings = {
        ...env,
        VAPID_PUBLIC_KEY: 'custom-public-key',
        VAPID_PRIVATE_KEY: 'custom-private-key',
        VAPID_SUBJECT: 'mailto:custom@example.com',
      };
      const vapid = await getOrCreateVapidKeys(customEnv);
      expect(vapid.publicKey).toBe('custom-public-key');
      expect(vapid.privateKey).toBe('custom-private-key');
      expect(vapid.subject).toBe('mailto:custom@example.com');
    });
  });

  describe('savePushSubscription & removePushSubscription', () => {
    it('saves a new subscription and allows removing it', async () => {
      const sub = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-device-1',
        p256dh:
          'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1Xbjhazpgtxitu-5jO3paNI4',
        auth: 'tBHItJI5svbpez7KI4CCXg',
        area: '中央区',
        alertTypes: ['emergency', 'evacuation'],
      };

      const res = await savePushSubscription(db, sub);
      expect(res.success).toBe(true);
      expect(res.id).toContain('sub_');

      const row = await db
        .prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?')
        .bind(sub.endpoint)
        .first<any>();
      expect(row).not.toBeNull();
      expect(row.area).toBe('中央区');
      expect(row.p256dh).toBe(sub.p256dh);

      // Remove subscription
      const removed = await removePushSubscription(db, sub.endpoint);
      expect(removed).toBe(true);

      const after = await db
        .prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?')
        .bind(sub.endpoint)
        .first<any>();
      expect(after).toBeNull();
    });

    it('updates existing subscription on conflict without duplicate key error', async () => {
      const endpoint = 'https://fcm.googleapis.com/fcm/send/test-device-dup';
      await savePushSubscription(db, {
        endpoint,
        p256dh: 'key-1',
        auth: 'auth-1',
        area: '東区',
      });

      // Update same endpoint with new area
      await savePushSubscription(db, {
        endpoint,
        p256dh: 'key-2',
        auth: 'auth-2',
        area: '西区',
      });

      const row = await db
        .prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?')
        .bind(endpoint)
        .first<any>();
      expect(row.area).toBe('西区');
      expect(row.p256dh).toBe('key-2');
    });
  });
});

describe('Web Push HTTP API Routes', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  describe('GET /api/push/vapid-public-key', () => {
    it('returns the public VAPID key successfully', async () => {
      const res = await ctx.request('/api/push/vapid-public-key');
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(typeof data.publicKey).toBe('string');
      expect(data.publicKey.length).toBeGreaterThan(60);
    });
  });

  describe('POST /api/push/subscribe & /api/push/unsubscribe', () => {
    it('registers a browser push subscription and unregisters', async () => {
      const subPayload = {
        subscription: {
          endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test',
          keys: {
            p256dh:
              'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1Xbjhazpgtxitu-5jO3paNI4',
            auth: 'tBHItJI5svbpez7KI4CCXg',
          },
        },
        area: '本町中央地区',
        alertTypes: ['emergency', 'messages'],
      };

      const res = await ctx.request('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${DEVICE_COOKIE}=dev_cookie_123`,
        },
        body: JSON.stringify(subPayload),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.id).toBeDefined();

      // Verify in DB
      const subRow = await ctx.db
        .prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?')
        .bind(subPayload.subscription.endpoint)
        .first<any>();
      expect(subRow).not.toBeNull();
      expect(subRow.device_cookie_id).toBe('dev_cookie_123');
      expect(subRow.area).toBe('本町中央地区');

      // Unsubscribe
      const unsubRes = await ctx.request('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subPayload.subscription.endpoint }),
      });
      expect(unsubRes.status).toBe(200);
      const unsubData = (await unsubRes.json()) as any;
      expect(unsubData.success).toBe(true);

      const deleted = await ctx.db
        .prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?')
        .bind(subPayload.subscription.endpoint)
        .first<any>();
      expect(deleted).toBeNull();
    });

    it('rejects invalid subscription payloads with 400', async () => {
      const res = await ctx.request('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: {} }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/push/broadcast permission checks', () => {
    it('forbids broadcast without admin authorization', async () => {
      const res = await ctx.request('/api/push/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '緊急避難勧告',
          body: '河川氾濫の恐れがあります',
        }),
      });
      expect(res.status).toBe(401);
    });
  });
});
