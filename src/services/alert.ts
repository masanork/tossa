// src/services/alert.ts: Real-time Error Notification & Webhook Alerting
import type { Bindings } from '../types';
import { isValidEmail } from './emailVerify';

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const ALERT_RETRY_DELAY_MS = 60 * 1000;
const ALERT_CONTROL_TABLE = 'tossa_alert_control';

export interface ErrorAlertStatus {
  emailConfigured: boolean;
  adminEmailRecipients: number;
  webhookConfigured: boolean;
}

async function adminEmailRecipients(env: Bindings): Promise<string[]> {
  const result = await env.DB.prepare(
    `SELECT DISTINCT lower(trim(email)) AS email FROM users
     WHERE role = 'admin' AND email_verified_at IS NOT NULL
       AND email IS NOT NULL AND trim(email) != ''`
  ).all<{ email: string }>();
  if (!result.success)
    throw new Error('Could not read administrator recipients');
  return result.results.map((row) => row.email).filter(isValidEmail);
}

/** Configuration only; accepting a send does not prove inbox delivery. */
export async function getErrorAlertStatus(
  env: Bindings
): Promise<ErrorAlertStatus> {
  return {
    emailConfigured: Boolean(env.EMAIL),
    adminEmailRecipients: (await adminEmailRecipients(env)).length,
    webhookConfigured: Boolean(env.ALERT_WEBHOOK_URL?.trim()),
  };
}

function alertSource(source: string | undefined): string {
  switch (source) {
    case 'scheduled_backup':
    case 'capacity_maintenance':
    case 'feed_maintenance':
    case 'write_queue':
    case 'push_queue':
      return source;
    case 'tossa-write-queue':
      return 'write_queue';
    case 'tossa-push-queue':
    case 'queues':
      return 'push_queue';
    default:
      return 'http';
  }
}

/** One atomic claim per source across Worker instances. No recipient data is stored. */
async function claimAlert(
  db: D1Database,
  source: string,
  now: number
): Promise<boolean> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${ALERT_CONTROL_TABLE} (
      source TEXT PRIMARY KEY, next_allowed_at INTEGER NOT NULL
    )`
    )
    .run();
  const claim = await db
    .prepare(
      `INSERT INTO ${ALERT_CONTROL_TABLE} (source, next_allowed_at) VALUES (?, ?)
     ON CONFLICT(source) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
     WHERE ${ALERT_CONTROL_TABLE}.next_allowed_at <= ? RETURNING source`
    )
    .bind(source, now + ALERT_COOLDOWN_MS, now)
    .all<{ source: string }>();
  if (!claim.success)
    throw new Error('Could not claim operational notification');
  return claim.results.length > 0;
}

function emailAlertText(source: string, timestamp: string): string {
  const labels: Record<string, string> = {
    http: '画面・APIの処理',
    scheduled_backup: '日次バックアップ',
    capacity_maintenance: '定期保守',
    feed_maintenance: '公開一覧の定期更新',
    write_queue: '投稿・状態更新の送信待ち処理',
    push_queue: '通知の送信待ち処理',
  };
  // Raw errors, request data, credentials and recipient identities stay out of email.
  return [
    'tossaで処理の失敗を検出しました。',
    `発生元: ${labels[source] ?? labels.http}`,
    `検出日時: ${timestamp}`,
    '管理画面と運用ログで影響を確認してください。',
    'https://tossa.app',
    '同じ発生元の通知を5分間抑制します（送信失敗時は短縮します）。',
  ].join('\n');
}

export interface AlertContext {
  source?: string; // 'http' | 'scheduled_backup' | 'write_queue' | 'push_queue'
  method?: string;
  url?: string;
  ip?: string;
  userAgent?: string;
  additionalInfo?: Record<string, unknown>;
}

/**
 * Strips sensitive data (passwords, JWTs, credentials) from text or query URLs.
 */
function sanitizeString(input: string): string {
  if (!input) return '';
  return (
    input
      // Mask Bearer tokens
      .replace(
        /Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi,
        'Bearer [REDACTED_JWT]'
      )
      // Mask private keys or credentials
      .replace(
        /(password|secret|token|key|credential)=([^&\s]+)/gi,
        '$1=[REDACTED]'
      )
  );
}

/**
 * Builds payload suited for Slack or Discord incoming webhooks.
 */
function buildWebhookPayload(
  url: string,
  error: Error,
  context: AlertContext
): Record<string, unknown> {
  const timestamp = new Date().toISOString();
  const source = context.source || 'http';
  const method = context.method || 'GET';
  const reqUrl = sanitizeString(context.url || '(no URL)');
  const errorName = error.name || 'Error';
  const errorMessage = sanitizeString(error.message || 'Unknown error');
  const stack = sanitizeString(error.stack || '(no stack trace)').slice(
    0,
    1000
  );

  const isDiscord =
    url.includes('discord.com') || url.includes('discordapp.com');

  if (isDiscord) {
    return {
      content: `🚨 **[tossa Error Alert]** \`${source.toUpperCase()}\` failure detected`,
      embeds: [
        {
          title: `${errorName}: ${errorMessage}`.slice(0, 256),
          color: 0xe74c3c, // Red
          timestamp,
          fields: [
            { name: 'Source', value: source, inline: true },
            {
              name: 'Request',
              value: `${method} ${reqUrl}`.slice(0, 250),
              inline: true,
            },
            ...(context.ip
              ? [{ name: 'Client IP', value: context.ip, inline: true }]
              : []),
            {
              name: 'Stack Trace',
              value: `\`\`\`\n${stack}\n\`\`\``.slice(0, 1024),
            },
          ],
        },
      ],
    };
  }

  // Slack and generic webhook fallback
  return {
    text: `🚨 *[tossa Error Alert]*: \`${source.toUpperCase()}\` - ${errorName}: ${errorMessage}`,
    attachments: [
      {
        color: '#e74c3c',
        title: `${errorName}: ${errorMessage}`,
        fields: [
          { title: 'Source', value: source, short: true },
          { title: 'Endpoint', value: `${method} ${reqUrl}`, short: true },
          { title: 'Time', value: timestamp, short: true },
          ...(context.ip
            ? [{ title: 'IP', value: context.ip, short: true }]
            : []),
          {
            title: 'Stack Trace',
            value: `\`\`\`\n${stack}\n\`\`\``,
            short: false,
          },
        ],
      },
    ],
  };
}

/**
 * Notifies current administrators with verified email; an optional webhook is additive.
 * Designed to never throw, ensuring it does not crash main worker execution.
 */
export async function sendErrorAlert(
  env: Bindings,
  error: unknown,
  context: AlertContext = {}
): Promise<boolean> {
  const webhookUrl = env?.ALERT_WEBHOOK_URL?.trim();
  let recipients: string[] = [];
  if (env?.EMAIL && env.DB) {
    try {
      recipients = await adminEmailRecipients(env);
    } catch {
      console.warn('[Alert] Could not read administrator email recipients');
    }
  }
  if (!recipients.length && !webhookUrl) return false;

  const source = alertSource(context.source);
  const now = Date.now();
  let claimed = false;
  if (env.DB) {
    try {
      claimed = await claimAlert(env.DB, source, now);
      if (!claimed) return false;
    } catch {
      // An independent webhook can still report a D1 outage. Email cannot safely
      // discover current admin recipients or coordinate a storm while D1 is down.
      console.warn('[Alert] Notification coordination unavailable');
      recipients = [];
    }
  }
  let delivered = false;
  let failedDelivery = false;

  if (env.EMAIL && recipients.length) {
    const text = emailAlertText(source, new Date(now).toISOString());
    for (let offset = 0; offset < recipients.length; offset += 50) {
      try {
        // Bcc keeps administrators' addresses private from each other.
        await env.EMAIL.send({
          bcc: recipients.slice(offset, offset + 50),
          from: { email: 'noreply@tossa.app', name: 'tossa 運用通知' },
          subject: '[tossa] 障害を検出しました',
          text,
          html: `<p>${text.split('\n').join('<br>')}</p>`,
        });
        delivered = true;
      } catch {
        failedDelivery = true;
        // Delivery errors may contain addresses or transport credentials.
        console.warn('[Alert] Administrator email delivery failed');
      }
    }
  }

  const errObj = error instanceof Error ? error : new Error(String(error));

  if (webhookUrl)
    try {
      const payload = buildWebhookPayload(webhookUrl, errObj, context);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        failedDelivery = true;
        console.warn(
          `[Alert] Webhook delivery failed with status ${response.status}`
        );
      } else {
        delivered = true;
      }
      await response.body?.cancel().catch(() => {});
    } catch {
      failedDelivery = true;
      console.warn('[Alert] Webhook delivery failed');
    }
  if (claimed && (!delivered || failedDelivery)) {
    try {
      await env.DB.prepare(
        `UPDATE ${ALERT_CONTROL_TABLE} SET next_allowed_at = ? WHERE source = ? AND next_allowed_at = ?`
      )
        .bind(now + ALERT_RETRY_DELAY_MS, source, now + ALERT_COOLDOWN_MS)
        .run();
    } catch {
      console.warn('[Alert] Could not shorten failed-notification cooldown');
    }
  }
  console.log(
    JSON.stringify({
      event: 'operational_alert',
      source,
      accepted: delivered,
      incomplete: failedDelivery,
    })
  );
  return delivered;
}
