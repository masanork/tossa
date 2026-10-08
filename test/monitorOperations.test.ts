import { describe, expect, it, vi } from 'vitest';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  heartbeat?: Response;
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
      if (url.pathname.endsWith('/values/heartbeat'))
        return options.heartbeat || jsonResponse(null, 404);
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

async function withStateFile(
  run: (statePath: string, directory: string) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), 'tossa-monitor-test-'));
  try {
    await run(join(directory, 'state.json'), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function emailRequestCount(requests: Array<{ url: URL; init: RequestInit }>) {
  return requests.filter(({ url }) =>
    url.pathname.endsWith('/email/sending/send')
  ).length;
}

describe('external operations monitor', () => {
  const heartbeatEnv = {
    OPERATIONAL_MONITOR_NAMESPACE_ID: '1234567890abcdef1234567890abcdef',
  };
  function heartbeat(completedAt: string | null, status = 'healthy') {
    return {
      version: 1,
      lastAttemptAt: new Date(now).toISOString(),
      lastCompletedAt: completedAt,
      status,
    };
  }

  it('checks the independent monitor heartbeat without exporting its other fields', async () => {
    const { fetchImpl, requests } = mockCloudflareFetch({
      heartbeat: jsonResponse({
        ...heartbeat(new Date(now - 60_000).toISOString()),
        unrelated: 'must-not-be-reported',
      }),
    });
    const report = await monitorOperations(
      configuredEnv(heartbeatEnv),
      fetchImpl,
      now
    );
    expect(report.status).toBe('healthy');
    expect(report.monitor).toMatchObject({ ok: true, ageSeconds: 60 });
    expect(JSON.stringify(report)).not.toContain('must-not-be-reported');
    expect(requests).toHaveLength(7);
    expect(requests.every(({ init }) => init.method === 'GET')).toBe(true);
  });

  it.each([
    ['missing', () => jsonResponse(null, 404)],
    ['never-completed', () => jsonResponse(heartbeat(null))],
    [
      'stale',
      () =>
        jsonResponse(
          heartbeat(new Date(now - 15 * 60_000).toISOString(), 'running')
        ),
    ],
    [
      'checks-failed',
      () =>
        jsonResponse(heartbeat(new Date(now - 60_000).toISOString(), 'error')),
    ],
    [
      'invalid-response',
      () => jsonResponse(heartbeat(new Date(now + 6 * 60_000).toISOString())),
    ],
    [
      'invalid-response',
      () =>
        jsonResponse({
          ...heartbeat(new Date(now).toISOString()),
          padding: 'x'.repeat(16 * 1024),
        }),
    ],
  ])('does not treat a %s heartbeat as healthy', async (reason, response) => {
    const { fetchImpl } = mockCloudflareFetch({ heartbeat: response() });
    const report = await monitorOperations(
      configuredEnv(heartbeatEnv),
      fetchImpl,
      now
    );
    expect(report.status).not.toBe('healthy');
    expect(report.monitor).toMatchObject({ ok: false, reason });
    expect(report.health.ok).toBe(true);
    expect(report.queues).toHaveLength(4);
    expect(report.notification).toBe('dry-run');
  });
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

  it('suppresses the same queue-lag incident despite changing counts and age', async () => {
    await withStateFile(async (statePath, directory) => {
      const firstFetch = mockCloudflareFetch({
        metrics: {
          'tossa-write-queue': {
            backlog_count: 3,
            backlog_bytes: 900,
            oldest_message_timestamp_ms: now - 420_000,
          },
        },
      });
      const first = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        firstFetch.fetchImpl,
        now
      );
      expect(first).toMatchObject({
        status: 'alert',
        notification: 'sent',
        stateChanged: true,
      });
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
      expect(await readdir(directory)).toEqual(['state.json']);

      const secondFetch = mockCloudflareFetch({
        metrics: {
          'tossa-write-queue': {
            backlog_count: 12,
            backlog_bytes: 3600,
            oldest_message_timestamp_ms: now + 5 * 60_000 - 590_000,
          },
        },
      });
      const repeated = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        secondFetch.fetchImpl,
        now + 5 * 60_000
      );
      expect(repeated).toMatchObject({
        status: 'alert',
        notification: 'suppressed',
        stateChanged: false,
      });
      expect(repeated.alerts).toContain(
        'tossa-write-queue oldest message is 590s old'
      );
      expect(emailRequestCount(secondFetch.requests)).toBe(0);

      const reminderFetch = mockCloudflareFetch({
        metrics: {
          'tossa-write-queue': {
            backlog_count: 25,
            backlog_bytes: 7500,
            oldest_message_timestamp_ms: now + 31 * 60_000 - 650_000,
          },
        },
      });
      const reminder = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        reminderFetch.fetchImpl,
        now + 31 * 60_000
      );
      expect(reminder).toMatchObject({
        status: 'alert',
        notification: 'sent',
        stateChanged: true,
      });
      expect(emailRequestCount(reminderFetch.requests)).toBe(1);
    });
  });

  it('sends a changed incident immediately and updates the accepted fingerprint', async () => {
    await withStateFile(async (statePath) => {
      const firstFetch = mockCloudflareFetch({
        metrics: {
          'tossa-push-deadletter': {
            backlog_count: 1,
            backlog_bytes: 100,
            oldest_message_timestamp_ms: now - 30_000,
          },
        },
      });
      await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        firstFetch.fetchImpl,
        now
      );

      const changedFetch = mockCloudflareFetch({
        metrics: {
          'tossa-write-deadletter': {
            backlog_count: 2,
            backlog_bytes: 200,
            oldest_message_timestamp_ms: now - 30_000,
          },
        },
      });
      const changed = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        changedFetch.fetchImpl,
        now + 60_000
      );
      expect(changed).toMatchObject({
        notification: 'sent',
        stateChanged: true,
      });
      expect(emailRequestCount(changedFetch.requests)).toBe(1);
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      expect(state.active.acceptedAt).toBe(
        new Date(now + 60_000).toISOString()
      );
    });
  });

  it('sends recovery once only for an accepted alert', async () => {
    await withStateFile(async (statePath) => {
      const alertFetch = mockCloudflareFetch({
        metrics: {
          'tossa-push-deadletter': {
            backlog_count: 1,
            backlog_bytes: 100,
            oldest_message_timestamp_ms: now - 30_000,
          },
        },
      });
      const alert = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        alertFetch.fetchImpl,
        now
      );
      expect(alert.notification).toBe('sent');

      const recoveryFetch = mockCloudflareFetch({});
      const recovery = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        recoveryFetch.fetchImpl,
        now + 5 * 60_000
      );
      expect(recovery).toMatchObject({
        status: 'healthy',
        notification: 'sent',
        stateChanged: true,
      });
      expect(
        JSON.parse(String(recoveryFetch.requests.at(-1)?.init.body)).subject
      ).toContain('recovered');
      expect(JSON.parse(await readFile(statePath, 'utf8')).active).toBeNull();

      const healthyFetch = mockCloudflareFetch({});
      const healthy = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        healthyFetch.fetchImpl,
        now + 10 * 60_000
      );
      expect(healthy.notification).toBe('not-needed');
      expect(emailRequestCount(healthyFetch.requests)).toBe(0);
    });
  });

  it('does not acknowledge a dry-run incident and lets a later real check send it', async () => {
    await withStateFile(async (statePath) => {
      const metrics = {
        'tossa-push-deadletter': {
          backlog_count: 1,
          backlog_bytes: 100,
          oldest_message_timestamp_ms: now - 30_000,
        },
      };
      const dryFetch = mockCloudflareFetch({ metrics });
      const dry = await monitorOperations(
        configuredEnv({ OPERATIONAL_MONITOR_STATE_FILE: statePath }),
        dryFetch.fetchImpl,
        now
      );
      expect(dry).toMatchObject({
        status: 'alert',
        notification: 'dry-run',
        stateChanged: false,
      });
      await expect(readFile(statePath, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });

      const realFetch = mockCloudflareFetch({ metrics });
      const real = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        realFetch.fetchImpl,
        now + 60_000
      );
      expect(real).toMatchObject({
        notification: 'sent',
        stateChanged: true,
      });
      expect(emailRequestCount(realFetch.requests)).toBe(1);
    });
  });

  it('does not clear accepted incident state for unconfigured or dry-run recovery checks', async () => {
    await withStateFile(async (statePath) => {
      const alertFetch = mockCloudflareFetch({
        metrics: {
          'tossa-push-deadletter': {
            backlog_count: 1,
            backlog_bytes: 100,
            oldest_message_timestamp_ms: now - 30_000,
          },
        },
      });
      await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        alertFetch.fetchImpl,
        now
      );
      const acceptedState = await readFile(statePath, 'utf8');

      const unconfiguredFetch = mockCloudflareFetch({});
      const unconfigured = await monitorOperations(
        configuredEnv({
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
          CLOUDFLARE_EMAIL_API_TOKEN: '',
          OPERATIONAL_ALERT_RECIPIENTS: '',
        }),
        unconfiguredFetch.fetchImpl,
        now + 60_000
      );
      expect(unconfigured).toMatchObject({
        status: 'healthy',
        notification: 'unconfigured',
        stateChanged: false,
      });
      expect(await readFile(statePath, 'utf8')).toBe(acceptedState);

      const dryFetch = mockCloudflareFetch({});
      const dry = await monitorOperations(
        configuredEnv({ OPERATIONAL_MONITOR_STATE_FILE: statePath }),
        dryFetch.fetchImpl,
        now + 120_000
      );
      expect(dry).toMatchObject({
        status: 'healthy',
        notification: 'dry-run',
        stateChanged: false,
      });
      expect(await readFile(statePath, 'utf8')).toBe(acceptedState);

      const realFetch = mockCloudflareFetch({});
      const real = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        realFetch.fetchImpl,
        now + 180_000
      );
      expect(real.notification).toBe('sent');
      expect(
        JSON.parse(String(realFetch.requests.at(-1)?.init.body)).subject
      ).toContain('recovered');
      expect(JSON.parse(await readFile(statePath, 'utf8')).active).toBeNull();
    });
  });

  it('keeps the state unchanged after an email failure so the next check retries', async () => {
    await withStateFile(async (statePath) => {
      const metrics = {
        'tossa-write-queue': {
          backlog_count: 1,
          backlog_bytes: 300,
          oldest_message_timestamp_ms: now - 420_000,
        },
      };
      const firstFetch = mockCloudflareFetch({ metrics });
      await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        firstFetch.fetchImpl,
        now
      );
      const acceptedState = await readFile(statePath, 'utf8');
      const retryAt = now + 31 * 60_000;

      const failedFetch = mockCloudflareFetch({
        metrics,
        emailResponse: jsonResponse({ success: false, errors: [] }, 503),
      });
      const failed = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        failedFetch.fetchImpl,
        retryAt
      );
      expect(failed).toMatchObject({
        status: 'error',
        notification: 'unavailable',
        stateChanged: false,
      });
      expect(await readFile(statePath, 'utf8')).toBe(acceptedState);

      const retryFetch = mockCloudflareFetch({ metrics });
      const retried = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        retryFetch.fetchImpl,
        retryAt + 60_000
      );
      expect(retried).toMatchObject({
        notification: 'sent',
        stateChanged: true,
      });
      expect(emailRequestCount(retryFetch.requests)).toBe(1);
    });
  });

  it('reports corrupt state but still checks and sends a generic alert without replacing the file', async () => {
    await withStateFile(async (statePath, directory) => {
      const corrupt = '{malformed private monitor state';
      await writeFile(statePath, corrupt, { mode: 0o600 });
      await chmod(directory, 0o700);
      const { fetchImpl, requests } = mockCloudflareFetch({});
      const report = await monitorOperations(
        configuredEnv({
          OPERATIONAL_ALERT_DRY_RUN: 'false',
          OPERATIONAL_MONITOR_STATE_FILE: statePath,
        }),
        fetchImpl,
        now
      );

      expect(report).toMatchObject({
        status: 'error',
        notification: 'sent',
        stateChanged: false,
      });
      expect(report.alerts).toContain(
        'Monitor notification state is invalid; suppression is disabled'
      );
      expect(
        requests.some(({ url }) => url.origin === 'https://tossa.example.test')
      ).toBe(true);
      expect(await readFile(statePath, 'utf8')).toBe(corrupt);
      expect(JSON.stringify(report)).not.toContain(directory);
      expect(JSON.stringify(report)).not.toContain(corrupt);
      const email = JSON.parse(String(requests.at(-1)?.init.body));
      expect(email.text).not.toContain(directory);
      expect(email.text).not.toContain(corrupt);
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    });
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
