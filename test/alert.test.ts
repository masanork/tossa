// test/alert.test.ts: Unit & Integration Tests for Real-time Alerting & Webhook Dispatch
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendErrorAlert } from '../src/services/alert';
import type { Bindings } from '../src/types';

describe('Real-time Error Alerting Service (sendErrorAlert)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false and does not call fetch when ALERT_WEBHOOK_URL is not set', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const dummyEnv = {
      RP_NAME: 'tossa',
      RP_ID: 'tossa.sorane.dev',
      EXPECTED_ORIGIN: 'https://tossa.sorane.dev',
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
      RP_ID: 'tossa.sorane.dev',
      EXPECTED_ORIGIN: 'https://tossa.sorane.dev',
    } as unknown as Bindings;

    const error = new Error(
      'Database connection failed with token=secret123 and Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz'
    );
    const result = await sendErrorAlert(dummyEnv, error, {
      source: 'http',
      method: 'POST',
      url: 'https://tossa.sorane.dev/api/posts?secret=supersecret',
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
      RP_ID: 'tossa.sorane.dev',
      EXPECTED_ORIGIN: 'https://tossa.sorane.dev',
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
      RP_ID: 'tossa.sorane.dev',
      EXPECTED_ORIGIN: 'https://tossa.sorane.dev',
    } as unknown as Bindings;

    const result = await sendErrorAlert(dummyEnv, new Error('Fatal'));
    expect(result).toBe(false);
  });
});

import { handleGlobalError } from '../src/index';
import { Hono } from 'hono';

describe('Global Error Handler Integration (handleGlobalError)', () => {
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
        RP_ID: 'tossa.sorane.dev',
        EXPECTED_ORIGIN: 'https://tossa.sorane.dev',
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
      new Request('https://tossa.sorane.dev/api/test-error-with-alert'),
      {
        RP_NAME: 'tossa',
        RP_ID: 'tossa.sorane.dev',
        EXPECTED_ORIGIN: 'https://tossa.sorane.dev',
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
