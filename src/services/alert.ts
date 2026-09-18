// src/services/alert.ts: Real-time Error Notification & Webhook Alerting
import type { Bindings } from '../types';

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
 * Dispatches an error alert to the configured ALERT_WEBHOOK_URL.
 * Designed to never throw, ensuring it does not crash main worker execution.
 */
export async function sendErrorAlert(
  env: Bindings,
  error: unknown,
  context: AlertContext = {}
): Promise<boolean> {
  const webhookUrl = env?.ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return false;
  }

  const errObj = error instanceof Error ? error : new Error(String(error));

  try {
    const payload = buildWebhookPayload(webhookUrl, errObj, context);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(
        `[Alert] Webhook delivery failed with status ${response.status}: ${await response.text().catch(() => '')}`
      );
      return false;
    }

    return true;
  } catch (deliveryError: any) {
    console.warn(
      '[Alert] Failed to dispatch webhook alert:',
      deliveryError?.message || deliveryError
    );
    return false;
  }
}
