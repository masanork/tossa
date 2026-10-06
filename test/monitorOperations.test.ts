import { describe, expect, it, vi } from 'vitest';
import { monitorOperations } from '../scripts/monitor-operations.mjs';

const now = Date.parse('2026-10-07T03:00:00.000Z');
const names = [
  'tossa-write-queue',
  'tossa-push-queue',
  'tossa-write-deadletter',
  'tossa-push-deadletter',
];

function configuredEnv(overrides: Record<string, string> = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: 'synthetic-account-id',
    CLOUDFLARE_API_TOKEN: 'synthetic-read-token',
    CLOUDFLARE_EMAIL_API_TOKEN: 'synthetic-email-token',
    OPERATIONAL_ALERT_RECIPIENTS: 'admin1@example.test,admin2@example.test',
    OPERATIONAL_ALERT_FROM: 'noreply@example.test',
    OPERATIONAL_ALERT_DRY_RUN: 'true',
    SMOKE_BASE_URL: 'https://tossa.example.test',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockCloudflareFetch(options: {
  metrics?: Record<string, Record<string, number>>;
  queueNames?: string[];
  health?: Response;
  emailResponse?: Response;
}) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const metrics = options.metrics || {};
  const queueNames = options.queueNames || names;
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      requests.push({ url, init });
      if (url.origin === 'https://tossa.example.test')
        return options.health || jsonResponse({ status: 'ok', app: 'tossa' });
      if (url.pathname.endsWith('/email/sending/send'))
        return (
          options.emailResponse ||
          jsonResponse({
            success: true,
            errors: [],
            result: {
              delivered: ['admin1@example.test', 'admin2@example.test'],
              queued: [],
            },
          })
        );
      if (url.pathname.endsWith('/queues'))
        return jsonResponse({
          success: true,
          errors: [],
          result: queueNames.map((queue_name, index) => ({
            queue_name,
            queue_id: `synthetic-queue-${index}`,
          })),
          result_info: { page: 1, total_pages: 1 },
        });
      const match = url.pathname.match(/\/queues\/([^/]+)\/metrics$/);
      if (match) {
        const index = Number(match[1].replace('synthetic-queue-', ''));
        const name = queueNames[index];
        return jsonResponse({
          success: true,
          errors: [],
          result: metrics[name] || {
            backlog_count: 0,
            backlog_bytes: 0,
            oldest_message_timestamp_ms: 0,
          },
        });
      }
      throw new Error('Unexpected mocked URL');
    }
  );
  return { fetchImpl, requests };
}

describe('external operations monitor', () => {
  it('reads all four queue metrics and health without logging credentials or sending email when healthy', async () => {
    const { fetchImpl, requests } = mockCloudflareFetch({});
    const report = await monitorOperations(configuredEnv(), fetchImpl, now);

    expect(report).toMatchObject({
      status: 'healthy',
      checkedAt: '2026-10-07T03:00:00.000Z',
      health: { ok: true, httpStatus: 200 },
      notificationsConfigured: true,
      notification: 'not-needed',
    });
    expect(report.queues.map((queue) => queue.name)).toEqual(names);
    expect(requests).toHaveLength(6);
    expect(requests.every(({ init }) => init.method === 'GET')).toBe(true);
    expect(
      requests
        .slice(0, 5)
        .every(
          ({ init }) =>
            (init.headers as Record<string, string>).Authorization ===
            'Bearer synthetic-read-token'
        )
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('synthetic-');
  });

  it('reports queue lag, DLQ backlog and health failure in dry-run without a send request', async () => {
    const { fetchImpl, requests } = mockCloudflareFetch({
      metrics: {
        'tossa-write-queue': {
          backlog_count: 3,
          backlog_bytes: 900,
          oldest_message_timestamp_ms: now - 420_000,
        },
        'tossa-push-deadletter': {
          backlog_count: 1,
          backlog_bytes: 100,
          oldest_message_timestamp_ms: now - 30_000,
        },
      },
      health: jsonResponse({ status: 'error', app: 'tossa' }, 503),
    });
    const report = await monitorOperations(configuredEnv(), fetchImpl, now);

    expect(report).toMatchObject({
      status: 'alert',
      health: { ok: false, httpStatus: 503 },
      notification: 'dry-run',
    });
    expect(report.alerts).toEqual(
      expect.arrayContaining([
        'tossa-write-queue oldest message is 420s old',
        'tossa-push-deadletter contains 1 dead-letter message(s)',
        'Health endpoint is unexpected-status',
      ])
    );
    expect(requests.every(({ init }) => init.method === 'GET')).toBe(true);
    expect(
      requests.some(({ url }) => url.pathname.endsWith('/email/sending/send'))
    ).toBe(false);
  });

  it('sends alert recipients as BCC only when a real monitor alert occurs', async () => {
    const { fetchImpl, requests } = mockCloudflareFetch({
      metrics: {
        'tossa-push-deadletter': {
          backlog_count: 1,
          backlog_bytes: 100,
          oldest_message_timestamp_ms: now - 30_000,
        },
      },
    });
    const report = await monitorOperations(
      configuredEnv({ OPERATIONAL_ALERT_DRY_RUN: 'false' }),
      fetchImpl,
      now
    );

    expect(report).toMatchObject({ status: 'alert', notification: 'sent' });
    const emailRequest = requests.at(-1)!;
    expect(emailRequest.init.method).toBe('POST');
    expect(emailRequest.url.pathname).toBe(
      '/client/v4/accounts/synthetic-account-id/email/sending/send'
    );
    expect(
      (emailRequest.init.headers as Record<string, string>).Authorization
    ).toBe('Bearer synthetic-email-token');
    const payload = JSON.parse(String(emailRequest.init.body));
    expect(payload.bcc).toEqual(['admin1@example.test', 'admin2@example.test']);
    expect(payload.to).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain('example.test');
  });

  it('keeps a healthy monitor green while reporting missing notification config', async () => {
    const { fetchImpl } = mockCloudflareFetch({});
    const report = await monitorOperations(
      configuredEnv({
        OPERATIONAL_ALERT_RECIPIENTS: '',
        CLOUDFLARE_EMAIL_API_TOKEN: '',
      }),
      fetchImpl,
      now
    );
    expect(report).toMatchObject({
      status: 'healthy',
      notificationsConfigured: false,
      notification: 'unconfigured',
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('fails when monitoring detects an alert but notification config is absent', async () => {
    const { fetchImpl } = mockCloudflareFetch({
      metrics: {
        'tossa-push-deadletter': {
          backlog_count: 1,
          backlog_bytes: 100,
          oldest_message_timestamp_ms: now - 30_000,
        },
      },
    });
    const report = await monitorOperations(
      configuredEnv({
        OPERATIONAL_ALERT_RECIPIENTS: '',
        CLOUDFLARE_EMAIL_API_TOKEN: '',
      }),
      fetchImpl,
      now
    );
    expect(report).toMatchObject({
      status: 'error',
      notificationsConfigured: false,
      notification: 'unavailable',
    });
    expect(report.alerts).toEqual([
      'tossa-push-deadletter contains 1 dead-letter message(s)',
    ]);
  });

  it('treats zero or missing oldest timestamp as an observation error when backlog exists', async () => {
    const { fetchImpl, requests } = mockCloudflareFetch({
      metrics: {
        'tossa-write-queue': {
          backlog_count: 1,
          backlog_bytes: 100,
          oldest_message_timestamp_ms: 0,
        },
      },
    });
    const report = await monitorOperations(configuredEnv(), fetchImpl, now);
    expect(report.status).toBe('error');
    expect(report.alerts).toContain(
      'Queue age is unknown for tossa-write-queue'
    );
    expect(
      requests.some(({ url }) => url.origin === 'https://tossa.example.test')
    ).toBe(true);
  });

  it('reports a missing expected queue as an observation error and still checks health', async () => {
    const { fetchImpl, requests } = mockCloudflareFetch({
      queueNames: names.slice(0, 3),
    });
    const report = await monitorOperations(configuredEnv(), fetchImpl, now);
    expect(report.status).toBe('error');
    expect(report.alerts).toContain(
      'Expected exactly one configured queue named tossa-push-deadletter'
    );
    expect(
      requests.some(({ url }) => url.origin === 'https://tossa.example.test')
    ).toBe(true);
  });

  it('reports queue API errors, still checks health, and emails admins when configured', async () => {
    const { fetchImpl, requests } = mockCloudflareFetch({});
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse({
        success: false,
        errors: [{ message: 'secret api detail' }],
      })
    );
    const report = await monitorOperations(
      configuredEnv({ OPERATIONAL_ALERT_DRY_RUN: 'false' }),
      fetchImpl,
      now
    );
    expect(report).toMatchObject({
      status: 'error',
      notification: 'sent',
      health: { ok: true },
    });
    expect(report.alerts).toContain(
      'Cloudflare queue list response was unsuccessful'
    );
    expect(JSON.stringify(report)).not.toContain('secret api detail');
    expect(
      requests.some(({ url }) => url.origin === 'https://tossa.example.test')
    ).toBe(true);
    expect(
      requests.some(({ url }) => url.pathname.endsWith('/email/sending/send'))
    ).toBe(true);
  });

  it('returns an error report when the email API cannot accept an alert', async () => {
    const { fetchImpl } = mockCloudflareFetch({
      emailResponse: jsonResponse({ success: false, errors: [] }, 503),
    });
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse({ success: false, errors: [{ message: 'hidden detail' }] })
    );
    const report = await monitorOperations(
      configuredEnv({ OPERATIONAL_ALERT_DRY_RUN: 'false' }),
      fetchImpl,
      now
    );
    expect(report).toMatchObject({
      status: 'error',
      notification: 'unavailable',
    });
    expect(report.alerts).toContain(
      'Operational alert email could not be accepted'
    );
  });

  it('accepts Cloudflare success responses with errors set to null', async () => {
    const { fetchImpl } = mockCloudflareFetch({});
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse({
        success: true,
        errors: null,
        result: names.map((queue_name, index) => ({
          queue_name,
          queue_id: `synthetic-queue-${index}`,
        })),
        result_info: { page: 1, total_pages: 1 },
      })
    );

    const report = await monitorOperations(configuredEnv(), fetchImpl, now);
    expect(report.status).toBe('healthy');
  });
});
