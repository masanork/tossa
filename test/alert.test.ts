// test/alert.test.ts: Unit & Integration Tests for Real-time Alerting & Webhook Dispatch
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendErrorAlert, getErrorAlertStatus } from '../src/services/alert';
import type { Bindings } from '../src/types';
import { createTestContext } from './helpers/testApp';

async function emailAdminContext() {
  const context = createTestContext();
  await context.db
    .prepare(
      `INSERT INTO users (id, username, display_name, role, email, email_verified_at) VALUES
      ('admin-a', 'admin-a', 'Admin A', 'admin', 'admin-a@example.com', datetime('now')),
      ('admin-b', 'admin-b', 'Admin B', 'admin', 'ADMIN-B@example.com', datetime('now')),
      ('pending', 'pending', 'Pending', 'admin', 'pending@example.com', NULL),
      ('moderator', 'moderator', 'Moderator', 'moderator', 'mod@example.com', datetime('now')),
      ('user', 'user', 'User', 'user', 'user@example.com', datetime('now'))`
    )
    .run();
  const send = vi
    .spyOn(context.env.EMAIL!, 'send')
    .mockResolvedValue({ messageId: 'alert-test' });
  return { ...context, send };
}

describe('Administrator email error notifications', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports only configuration and eligible recipient count', async () => {
    const { env } = await emailAdminContext();
    expect(await getErrorAlertStatus(env)).toEqual({
      emailConfigured: true,
      adminEmailRecipients: 2,
      webhookConfigured: false,
    });
  });

  it('sends to current verified administrators without exposing raw errors or other addresses', async () => {
    const { env, send } = await emailAdminContext();
    expect(
      await sendErrorAlert(
        env,
        new Error('token=private-token; SQL user@example.com'),
        {
          source: 'scheduled_backup',
          url: 'https://tossa.app/?token=private-token',
        }
      )
    ).toBe(true);
    const message = send.mock.calls[0]![0] as EmailMessageBuilder;
    expect(message.bcc).toEqual(['admin-a@example.com', 'admin-b@example.com']);
    expect(message.to).toBeUndefined();
    expect(message.text).toContain('日次バックアップ');
    expect(message.html).toContain('日次バックアップ');
    expect(message.text).not.toContain('private-token');
    expect(message.text).not.toContain('user@example.com');
    expect(message.text).not.toContain('SQL');
  });

  it('coordinates concurrent alerts across instances and permits a new alert after five minutes', async () => {
    const { env, send } = await emailAdminContext();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sendErrorAlert(env, new Error('Failure')))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 5 * 60 * 1000 - 1);
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(false);
    clock.mockReturnValue(now + 5 * 60 * 1000);
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps independent failure sources and current roles separate', async () => {
    const { env, send, db } = await emailAdminContext();
    await sendErrorAlert(env, new Error('Failure'), {
      source: 'scheduled_backup',
    });
    await db
      .prepare("UPDATE users SET role = 'user' WHERE id = 'admin-b'")
      .run();
    await sendErrorAlert(env, new Error('Failure'), { source: 'write_queue' });
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[1]![0] as EmailMessageBuilder).bcc).toEqual([
      'admin-a@example.com',
    ]);
    expect((await getErrorAlertStatus(env)).adminEmailRecipients).toBe(1);
  });

  it('returns false on delivery failure, keeps sensitive transport errors out of logs, and retries after one minute', async () => {
    const { env, send } = await emailAdminContext();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    send.mockRejectedValueOnce(
      new Error('recipient admin-a@example.com credential=private')
    );
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'admin-a@example.com'
    );
    clock.mockReturnValue(now + 60_000 - 1);
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(false);
    clock.mockReturnValue(now + 60_000);
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('falls back to an independent webhook when the recipient database is unavailable', async () => {
    const { env, send } = await emailAdminContext();
    env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/test';
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('D1 unavailable');
    });
    const fetch = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = fetch;
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('splits blind recipients into batches within the email binding limit', async () => {
    const { env, send, db } = await emailAdminContext();
    for (let i = 0; i < 49; i++) {
      await db
        .prepare(
          "INSERT INTO users (id, username, display_name, role, email, email_verified_at) VALUES (?, ?, 'Admin', 'admin', ?, datetime('now'))"
        )
        .bind(`extra-${i}`, `extra-${i}`, `extra-${i}@example.com`)
        .run();
    }
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const batches = send.mock.calls.map(
      ([message]) => (message as EmailMessageBuilder).bcc as string[]
    );
    expect(batches.map((batch) => batch.length)).toEqual([50, 1]);
    expect(new Set(batches.flat()).size).toBe(51);
  });

  it('allows email retry after one minute when only the optional webhook accepted the alert', async () => {
    const { env, send } = await emailAdminContext();
    env.ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/test';
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(true);
    clock.mockReturnValue(now + 60_000 - 1);
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(false);
    clock.mockReturnValue(now + 60_000);
    expect(await sendErrorAlert(env, new Error('Failure'))).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('Real-time Error Alerting Service (sendErrorAlert)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false and does not call fetch when ALERT_WEBHOOK_URL is not set', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const dummyEnv = {
      RP_NAME: 'tossa',
      RP_ID: 'tossa.app',
      EXPECTED_ORIGIN: 'https://tossa.app',
    } as unknown as Bindings;
    const result = await sendErrorAlert(dummyEnv, new Error('Test error'));

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('formats payload for Slack webhooks and sanitizes sensitive tokens', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts: any) => {
        capturedUrl = url;
        capturedBody = JSON.parse(opts.body);
        return new Response('ok', { status: 200 });
      });

    const dummyEnv = {
      ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T00/B00/X00',
      RP_NAME: 'tossa',
      RP_ID: 'tossa.app',
      EXPECTED_ORIGIN: 'https://tossa.app',
    } as unknown as Bindings;

    const error = new Error(
      'Database connection failed with token=secret123 and Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz'
    );
    const result = await sendErrorAlert(dummyEnv, error, {
      source: 'http',
      method: 'POST',
      url: 'https://tossa.app/api/posts?secret=supersecret',
      ip: '192.0.2.1',
    });

    expect(result).toBe(true);
    expect(capturedUrl).toBe('https://hooks.slack.com/services/T00/B00/X00');
    expect(capturedBody.text).toContain('[tossa Error Alert]');
    expect(capturedBody.attachments[0].fields).toBeDefined();

    // Verification of sanitization
    const serialized = JSON.stringify(capturedBody);
    expect(serialized).not.toContain('supersecret');
    expect(serialized).not.toContain('secret123');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[REDACTED_JWT]');
  });

  it('formats payload for Discord webhooks using embeds', async () => {
    let capturedBody: any = null;

    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (_url: string, opts: any) => {
        capturedBody = JSON.parse(opts.body);
        return new Response('ok', { status: 200 });
      });

    const dummyEnv = {
      ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
      RP_NAME: 'tossa',
      RP_ID: 'tossa.app',
      EXPECTED_ORIGIN: 'https://tossa.app',
    } as unknown as Bindings;

    const error = new TypeError('Cannot read properties of undefined');
    const result = await sendErrorAlert(dummyEnv, error, {
      source: 'write_queue',
      method: 'QUEUE',
    });

    expect(result).toBe(true);
    expect(capturedBody.content).toContain('`WRITE_QUEUE` failure detected');
    expect(capturedBody.embeds).toBeDefined();
    expect(capturedBody.embeds[0].title).toContain(
      'TypeError: Cannot read properties of undefined'
    );
    expect(capturedBody.embeds[0].color).toBe(0xe74c3c);
  });

  it('safely catches network failures and returns false without throwing', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('Network offline or DNS error'));

    const dummyEnv = {
      ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/fail',
      RP_NAME: 'tossa',
      RP_ID: 'tossa.app',
      EXPECTED_ORIGIN: 'https://tossa.app',
    } as unknown as Bindings;

    const result = await sendErrorAlert(dummyEnv, new Error('Fatal'));
    expect(result).toBe(false);
  });
});

import { handleGlobalError } from '../src/index';
import { Hono } from 'hono';

describe('Global Error Handler Integration (handleGlobalError)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies verified admin email in waitUntil without a webhook', async () => {
    const { env, send } = await emailAdminContext();
    const pending: Promise<unknown>[] = [];
    const testApp = new Hono<{ Bindings: Bindings }>();
    testApp.onError(handleGlobalError);
    testApp.get('/api/test-email-alert', () => {
      throw new Error('Simulated error');
    });
    const response = await testApp.fetch(
      new Request('https://tossa.app/api/test-email-alert'),
      env,
      {
        waitUntil: (promise) => {
          pending.push(promise);
        },
        passThroughOnException: () => {},
      } as ExecutionContext
    );
    expect(response.status).toBe(500);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('catches uncaught exceptions and returns standard JSON 500 response', async () => {
    const testApp = new Hono<{ Bindings: Bindings }>();
    testApp.onError(handleGlobalError);

    testApp.get('/api/test-uncaught-error', () => {
      throw new Error('Simulated uncaught boom!');
    });

    const res = await testApp.request(
      '/api/test-uncaught-error',
      {
        method: 'GET',
      },
      {
        RP_NAME: 'tossa',
        RP_ID: 'tossa.app',
        EXPECTED_ORIGIN: 'https://tossa.app',
      }
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toContain(
      'システム内部で予期せぬエラーが発生しました。'
    );
  });

  it('triggers sendErrorAlert with waitUntil when ALERT_WEBHOOK_URL is present', async () => {
    let waitUntilPromise: Promise<any> | null = null;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchMock;

    const testApp = new Hono<{ Bindings: Bindings }>();
    testApp.onError(handleGlobalError);

    testApp.get('/api/test-error-with-alert', () => {
      throw new Error('Crashing route for webhook test');
    });

    const mockCtx = {
      waitUntil: (promise: Promise<any>) => {
        waitUntilPromise = promise;
      },
      passThroughOnException: () => {},
    };

    const res = await testApp.fetch(
      new Request('https://tossa.app/api/test-error-with-alert'),
      {
        RP_NAME: 'tossa',
        RP_ID: 'tossa.app',
        EXPECTED_ORIGIN: 'https://tossa.app',
        ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/test/123',
      } as unknown as Bindings,
      mockCtx as any
    );

    expect(res.status).toBe(500);
    expect(waitUntilPromise).not.toBeNull();
    await waitUntilPromise;
    expect(fetchMock).toHaveBeenCalled();
  });
});
