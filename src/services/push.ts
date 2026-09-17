// src/services/push.ts: Web Push Notification & VAPID Delivery Service for Cloudflare Workers
import {
  buildPushPayload,
  type PushSubscription as WebPushSub,
  type VapidKeys,
} from '@block65/webcrypto-web-push';
import type {
  Bindings,
  PushNotificationPayload,
  PushSubscriptionRecord,
  PushQueueMessage,
} from '../types';

/**
 * Converts a Base64URL string to a Uint8Array byte buffer.
 */
export function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts a Uint8Array byte buffer to a Base64URL string.
 */
export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates a fresh, valid VAPID P-256 keypair in Base64URL format using standard Web Crypto API.
 */
export async function generateVapidKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const pubJwk = (await crypto.subtle.exportKey(
    'jwk',
    keyPair.publicKey
  )) as JsonWebKey;
  const privJwk = (await crypto.subtle.exportKey(
    'jwk',
    keyPair.privateKey
  )) as JsonWebKey;

  if (!pubJwk.x || !pubJwk.y || !privJwk.d) {
    throw new Error('Failed to export ECDSA P-256 JWK parameters');
  }

  const xBytes = base64urlToBytes(pubJwk.x);
  const yBytes = base64urlToBytes(pubJwk.y);

  // Uncompressed EC point format: 0x04 || X (32 bytes) || Y (32 bytes) -> 65 bytes
  const rawPub = new Uint8Array(65);
  rawPub[0] = 0x04;
  rawPub.set(xBytes, 1);
  rawPub.set(yBytes, 33);

  return {
    publicKey: bytesToBase64url(rawPub),
    privateKey: privJwk.d,
  };
}

/**
 * Retrieves existing VAPID keys from environment variables or D1 system_settings,
 * or automatically generates and provisions a persistent keypair on first run.
 */
export async function getOrCreateVapidKeys(env: Bindings): Promise<{
  publicKey: string;
  privateKey: string;
  subject: string;
}> {
  const subject = env.VAPID_SUBJECT || 'mailto:admin@tossa.app';

  // 1. Check environment variables
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject,
    };
  }

  // 2. Check D1 system_settings
  const pubRow = await env.DB.prepare(
    'SELECT value FROM system_settings WHERE key = ?'
  )
    .bind('vapid_public_key')
    .first<{ value: string }>();

  const privRow = await env.DB.prepare(
    'SELECT value FROM system_settings WHERE key = ?'
  )
    .bind('vapid_private_key')
    .first<{ value: string }>();

  if (pubRow?.value && privRow?.value) {
    return {
      publicKey: pubRow.value,
      privateKey: privRow.value,
      subject,
    };
  }

  // 3. Auto-generate and persist into system_settings
  const generated = await generateVapidKeyPair();

  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR REPLACE INTO system_settings (key, value, description, updated_at) VALUES ('vapid_public_key', ?, 'Web Push VAPID Public Key', datetime('now'))"
    ).bind(generated.publicKey),
    env.DB.prepare(
      "INSERT OR REPLACE INTO system_settings (key, value, description, updated_at) VALUES ('vapid_private_key', ?, 'Web Push VAPID Private Key', datetime('now'))"
    ).bind(generated.privateKey),
    env.DB.prepare(
      "INSERT OR IGNORE INTO system_settings (key, value, description, updated_at) VALUES ('vapid_subject', ?, 'Web Push VAPID Subject', datetime('now'))"
    ).bind(subject),
  ]);

  return {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
  };
}

/**
 * Saves or updates a Web Push subscription in Cloudflare D1.
 */
export async function savePushSubscription(
  db: D1Database,
  data: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userId?: string | null;
    deviceCookieId?: string | null;
    area?: string | null;
    alertTypes?: string[];
  }
): Promise<{ success: boolean; id: string }> {
  const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const alertTypesJson = JSON.stringify(
    data.alertTypes || ['emergency', 'evacuation', 'messages']
  );

  await db
    .prepare(
      `INSERT INTO push_subscriptions (
        id, endpoint, p256dh, auth, user_id, device_cookie_id, area, alert_types, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(endpoint) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_id = coalesce(excluded.user_id, push_subscriptions.user_id),
        device_cookie_id = coalesce(excluded.device_cookie_id, push_subscriptions.device_cookie_id),
        area = excluded.area,
        alert_types = excluded.alert_types,
        updated_at = datetime('now')`
    )
    .bind(
      subId,
      data.endpoint,
      data.p256dh,
      data.auth,
      data.userId || null,
      data.deviceCookieId || null,
      data.area || null,
      alertTypesJson
    )
    .run();

  return { success: true, id: subId };
}

/**
 * Deletes a Web Push subscription by its endpoint.
 */
export async function removePushSubscription(
  db: D1Database,
  endpoint: string
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
    .bind(endpoint)
    .run();
  return res.success;
}

/**
 * Sends an encrypted Web Push notification to a single client subscription.
 */
export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushNotificationPayload,
  vapid: { publicKey: string; privateKey: string; subject: string }
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  try {
    const webPushSub: WebPushSub = {
      endpoint: subscription.endpoint,
      expirationTime: null,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    };

    const vapidKeys: VapidKeys = {
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    };

    const pushPayload = await buildPushPayload(
      {
        data: JSON.stringify(payload),
        options: {
          ttl: 86400, // 24 hours
          urgency: 'high',
        },
      },
      webPushSub,
      vapidKeys
    );

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: pushPayload.headers,
      body: pushPayload.body as any,
    });

    if (res.status >= 200 && res.status < 300) {
      return { success: true, statusCode: res.status };
    }

    return {
      success: false,
      statusCode: res.status,
      error: `Push service rejected notification: ${res.statusText}`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Push transmission error',
    };
  }
}

/**
 * Broadcasts an emergency push alert to all subscribers (or subscribers filtered by area / alertType).
 */
export async function broadcastPushNotification(
  env: Bindings,
  options: {
    title: string;
    body: string;
    url?: string;
    area?: string;
    alertType?: 'emergency' | 'evacuation' | 'status' | 'messages';
    excludeUserId?: string;
  }
): Promise<{
  sent: number;
  failed: number;
  cleaned: number;
  queued?: boolean;
}> {
  const vapid = await getOrCreateVapidKeys(env);

  // Query matching subscriptions
  let query = 'SELECT * FROM push_subscriptions WHERE 1=1';
  const params: any[] = [];

  if (options.excludeUserId) {
    query += ' AND (user_id IS NULL OR user_id != ?)';
    params.push(options.excludeUserId);
  }

  const { results: rawSubs } = await env.DB.prepare(query)
    .bind(...params)
    .all<PushSubscriptionRecord>();

  if (!rawSubs || rawSubs.length === 0) {
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  // Filter subscriptions in memory if area specific (all match if area is not specified or subscriber chose all)
  const targetSubs = rawSubs.filter((sub) => {
    if (options.area && sub.area && sub.area !== options.area) {
      return false;
    }
    if (options.alertType && sub.alert_types) {
      try {
        const types = JSON.parse(sub.alert_types) as string[];
        if (Array.isArray(types) && !types.includes(options.alertType)) {
          return false;
        }
      } catch {
        // Default allow
      }
    }
    return true;
  });

  const payload: PushNotificationPayload = {
    title: options.title,
    body: options.body,
    url: options.url || '/',
    tag: `tossa-${options.alertType || 'alert'}-${Date.now()}`,
    data: {
      url: options.url || '/',
      area: options.area,
    },
  };

  // If Cloudflare Queues is bound (production high-traffic mode), offload delivery
  // to avoid HTTP request timeouts with 10k+ subscribers!
  if (env.PUSH_QUEUE) {
    const queueMessages: MessageSendRequest<PushQueueMessage>[] =
      targetSubs.map((sub) => ({
        body: {
          subscription: {
            endpoint: sub.endpoint,
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
          payload,
        },
      }));

    for (let i = 0; i < queueMessages.length; i += 100) {
      await env.PUSH_QUEUE.sendBatch(queueMessages.slice(i, i + 100));
    }

    return {
      sent: targetSubs.length,
      failed: 0,
      cleaned: 0,
      queued: true,
    };
  }

  let sent = 0;
  let failed = 0;
  let cleaned = 0;
  const expiredEndpoints: string[] = [];
  const PUSH_BATCH_SIZE = 25;

  // Process push delivery in chunks to respect Cloudflare Workers subrequest limits (max 50 concurrent)
  for (let i = 0; i < targetSubs.length; i += PUSH_BATCH_SIZE) {
    const chunk = targetSubs.slice(i, i + PUSH_BATCH_SIZE);
    await Promise.allSettled(
      chunk.map(async (sub) => {
        const res = await sendPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
          vapid
        );

        if (res.success) {
          sent++;
        } else {
          failed++;
          // If push endpoint is expired / unsubscribed (404 or 410 Gone)
          if (res.statusCode === 404 || res.statusCode === 410) {
            expiredEndpoints.push(sub.endpoint);
          }
        }
      })
    );
  }

  // Clean up expired subscriptions from D1 in batches
  if (expiredEndpoints.length > 0) {
    for (let i = 0; i < expiredEndpoints.length; i += 50) {
      const chunk = expiredEndpoints.slice(i, i + 50);
      try {
        await env.DB.batch(
          chunk.map((ep) =>
            env.DB.prepare(
              'DELETE FROM push_subscriptions WHERE endpoint = ?'
            ).bind(ep)
          )
        );
        cleaned += chunk.length;
      } catch (e) {
        console.error('Failed to clean expired push subscriptions batch:', e);
      }
    }
  }

  return { sent, failed, cleaned };
}

/**
 * Processes a batch of push notification messages from Cloudflare Queues.
 */
export async function processPushQueueBatch(
  batch: MessageBatch<PushQueueMessage>,
  env: Bindings
): Promise<void> {
  const vapid = await getOrCreateVapidKeys(env);
  const expiredEndpoints: string[] = [];

  await Promise.allSettled(
    batch.messages.map(async (msg) => {
      try {
        const res = await sendPushNotification(
          msg.body.subscription,
          msg.body.payload,
          vapid
        );
        if (!res.success) {
          if (res.statusCode === 404 || res.statusCode === 410) {
            expiredEndpoints.push(msg.body.subscription.endpoint);
          }
        }
        msg.ack();
      } catch (err) {
        console.error('[queue] Failed to deliver push message:', err);
        msg.retry();
      }
    })
  );

  if (expiredEndpoints.length > 0) {
    for (let i = 0; i < expiredEndpoints.length; i += 50) {
      const chunk = expiredEndpoints.slice(i, i + 50);
      try {
        await env.DB.batch(
          chunk.map((ep) =>
            env.DB.prepare(
              'DELETE FROM push_subscriptions WHERE endpoint = ?'
            ).bind(ep)
          )
        );
      } catch (e) {
        console.error(
          '[queue] Failed to cleanup expired push subscriptions:',
          e
        );
      }
    }
  }
}

/**
 * Dispatches an encrypted messaging notification to other members of a thread.
 * Privacy-preserving: message content is NOT included in the push payload.
 */
export async function notifyThreadMembers(
  env: Bindings,
  threadId: string,
  senderId: string,
  threadTitle: string
): Promise<{ sent: number; failed: number }> {
  const vapid = await getOrCreateVapidKeys(env);

  // Find other members' push subscriptions
  const { results: subs } = await env.DB.prepare(
    `SELECT ps.endpoint, ps.p256dh, ps.auth, ps.alert_types
     FROM thread_members tm
     JOIN push_subscriptions ps ON tm.user_id = ps.user_id
     WHERE tm.thread_id = ? AND tm.user_id != ?`
  )
    .bind(threadId, senderId)
    .all<{
      endpoint: string;
      p256dh: string;
      auth: string;
      alert_types: string;
    }>();

  if (!subs || subs.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const payload: PushNotificationPayload = {
    title: `新着メッセージ: ${threadTitle}`,
    body: '暗号化メッセージが届きました。タップして開きます。',
    url: `/?thread=${threadId}`,
    tag: `tossa-msg-${threadId}`,
    data: {
      url: `/?thread=${threadId}`,
      threadId,
    },
  };

  let sent = 0;
  let failed = 0;
  const PUSH_BATCH_SIZE = 25;
  for (let i = 0; i < subs.length; i += PUSH_BATCH_SIZE) {
    const chunk = subs.slice(i, i + PUSH_BATCH_SIZE);
    await Promise.allSettled(
      chunk.map(async (sub) => {
        if (sub.alert_types) {
          try {
            const types = JSON.parse(sub.alert_types) as string[];
            if (Array.isArray(types) && !types.includes('messages')) {
              return;
            }
          } catch {
            // Default allow
          }
        }
        const res = await sendPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
          vapid
        );
        if (res.success) {
          sent++;
        } else {
          failed++;
          if (res.statusCode === 404 || res.statusCode === 410) {
            await removePushSubscription(env.DB, sub.endpoint).catch(() => {});
          }
        }
      })
    );
  }

  return { sent, failed };
}
