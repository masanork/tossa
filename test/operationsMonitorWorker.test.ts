import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, {
  runOperationsMonitor,
} from '../scripts/operations-monitor-worker';
import {
  buildFailureProof,
  buildRecoveryProof,
  recoveryProofKey,
} from '../scripts/recovery-proof.mjs';

const checkedAt = '2026-10-08T04:17:00.123Z';
const nowMs = Date.parse(checkedAt);
const queueNames = [
  'tossa-write-queue',
  'tossa-push-queue',
  'tossa-write-deadletter',
  'tossa-push-deadletter',
];
const queueIds = Object.fromEntries(
  queueNames.map((name) => [name, `id-${name}`])
);

function validDrillReport(proofTimestamp = checkedAt) {
  const tables = [
    'categories',
    'disasters',
    'posts',
    'status_updates',
    'post_verifications',
    'users',
    'credentials',
    'system_settings',
    'threads',
    'thread_members',
    'messages',
    'device_sessions',
    'access_logs',
    'device_user_links',
    'push_subscriptions',
    'mutation_receipts',
    'post_reports',
  ];
  return {
    format: 'tossa-production-recovery-report-v1',
    archiveKeySha256: 'a'.repeat(64),
    archiveSha256: 'b'.repeat(64),
    archiveBytes: 35_472,
    archiveTimestamp: new Date(
      Date.parse(proofTimestamp) - 60 * 60_000
    ).toISOString(),
    totalRecords: 0,
    tableCounts: Object.fromEntries(tables.map((table) => [table, 0])),
    valueComparison: 'full',
    checks: {
      v2Archive: 'ok',
      freshness: 'ok',
      restoreBackupValidation: 'ok',
      localTableCounts: 'ok',
      foreignKeyCheck: 'ok',
      quickCheck: 'ok',
    },
    timingsMs: { r2Download: 100, restoreAndVerify: 200, total: 300 },
  };
}

function makeProof(
  timestamp = checkedAt,
  status: 'success' | 'failure' = 'success'
) {
  return status === 'success'
    ? buildRecoveryProof(validDrillReport(timestamp), timestamp)
    : buildFailureProof(timestamp, 'recovery_drill_failed');
}

function toStream(value: string) {
  return new Response(value).body!;
}

function makeBucket(options: {
  objects?: R2Object[];
  bodies?: Record<string, string>;
  listFailure?: boolean;
}) {
  const allObjects = options.objects ?? [];
  const list = vi.fn(async (input: R2ListOptions = {}) => {
    if (options.listFailure) throw new Error('synthetic list failure');
    const prefix = input.prefix ?? '';
    const matching = allObjects
      .filter((object) => object.key.startsWith(prefix))
      .sort((a, b) => a.key.localeCompare(b.key));
    const limit = input.limit ?? 1000;
    const offset = Number(input.cursor ?? 0);
    const objects = matching.slice(offset, offset + limit);
    const truncated = offset + objects.length < matching.length;
    return {
      objects,
      truncated,
      cursor: truncated ? String(offset + objects.length) : undefined,
      delimitedPrefixes: [],
    } as R2Objects;
  });
  const get = vi.fn(async (key: string) => {
    const body = options.bodies?.[key];
    if (body === undefined) return null;
    return {
      key,
      size: new TextEncoder().encode(body).byteLength,
      uploaded: new Date(nowMs),
      body: toStream(body),
      writeHttpMetadata: () => {},
      httpEtag: 'synthetic-etag',
      httpMetadata: {},
      customMetadata: {},
      checksums: {},
      storageClass: 'Standard',
      version: 'synthetic-version',
      etag: 'synthetic-etag',
      ssecKeyMd5: undefined,
      range: undefined,
    } as unknown as R2ObjectBody;
  });
  return { bucket: { list, get } as unknown as R2Bucket, list, get };
}

function makeBackup(
  timestamp = checkedAt,
  metadataTimestamp: string | null = timestamp
): R2Object {
  const keyTime = timestamp.replace(
    /T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u,
    'T$1-$2-$3-$4Z'
  );
  return {
    key: `backups/tossa_backup_${keyTime}_0123456789abcdef0123456789abcdef.json`,
    size: 100,
    uploaded: new Date(Date.parse(timestamp)),
    customMetadata: {
      version: '2',
      ...(metadataTimestamp ? { createdAt: metadataTimestamp } : {}),
    },
    httpEtag: 'synthetic-etag',
    httpMetadata: {},
    checksums: {},
    storageClass: 'Standard',
    version: 'synthetic-version',
    etag: 'synthetic-etag',
    ssecKeyMd5: undefined,
    range: undefined,
    size: 100,
  } as unknown as R2Object;
}

function makeProofObject(
  timestamp: string,
  status: 'success' | 'failure' = 'success',
  id = 'abcdef0123456789abcdef0123456789',
  serialized?: string
) {
  const key = recoveryProofKey(timestamp, id);
  const body = serialized ?? JSON.stringify(makeProof(timestamp, status));
  return {
    object: {
      key,
      size: new TextEncoder().encode(body).byteLength,
      uploaded: new Date(Date.parse(timestamp)),
      customMetadata: {},
      httpEtag: 'proof-etag',
      httpMetadata: {},
      checksums: {},
      storageClass: 'Standard',
      version: 'proof-version',
      etag: 'proof-etag',
      ssecKeyMd5: undefined,
      range: undefined,
    } as unknown as R2Object,
    key,
    body,
  };
}

function makeFetch(
  options: {
    metrics?: Partial<
      Record<(typeof queueNames)[number], Record<string, unknown>>
    >;
    queueNames?: string[];
    queueRecords?: unknown[];
    health?: unknown;
    failQueueList?: boolean;
    queueListStatus?: number;
    queueNetworkFailure?: boolean;
    queueMalformedJson?: boolean;
    queueApiRejected?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const requestOptions: RequestInit[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requestOptions.push(init ?? {});
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      calls.push(url.toString());
      if (url.toString() === 'https://tossa.app/api/health') {
        return Response.json(
          options.health ?? { status: 'ok', app: 'tossa', time: checkedAt }
        );
      }
      if (url.pathname.endsWith('/queues')) {
        if (options.queueNetworkFailure)
          throw new Error('synthetic secret transport failure');
        if (options.queueListStatus !== undefined)
          return new Response('synthetic secret response body', {
            status: options.queueListStatus,
          });
        if (options.queueMalformedJson) return new Response('{');
        if (options.queueApiRejected)
          return Response.json({
            success: true,
            errors: [{ code: 7003, message: 'synthetic secret API detail' }],
            result: [],
          });
        if (options.failQueueList)
          return new Response('unavailable', { status: 503 });
        return Response.json({
          success: true,
          errors: null,
          result:
            options.queueRecords ??
            (options.queueNames ?? queueNames).map((queue_name) => ({
              queue_name,
              queue_id:
                queueIds[queue_name as (typeof queueNames)[number]] ??
                `id-${queue_name}`,
            })),
          result_info: { page: 1, total_pages: 1 },
        });
      }
      if (url.pathname.endsWith('/metrics')) {
        const queueId = decodeURIComponent(url.pathname.split('/').at(-2)!);
        const name = queueNames.find(
          (queueName) => queueIds[queueName] === queueId
        );
        if (!name)
          return Response.json({ success: false, errors: ['unknown'] });
        return Response.json({
          success: true,
          errors: null,
          result: {
            backlog_count: 0,
            backlog_bytes: 0,
            oldest_message_timestamp_ms: 0,
            ...options.metrics?.[name],
          },
        });
      }
      throw new Error('Unexpected external request');
    }
  );
  return { fetchMock, calls, requestOptions };
}

function executeAt(
  env: Parameters<typeof runOperationsMonitor>[0],
  timestamp = nowMs
) {
  return runOperationsMonitor(env, timestamp, timestamp);
}

function makeEnv(
  options: {
    bucket?: R2Bucket;
    alertDryRun?: string;
    recipients?: string;
    sendEmail?: ReturnType<typeof vi.fn>;
    kvFailure?: boolean;
  } = {}
) {
  const values = new Map<string, string>();
  const get = vi.fn(async (key: string) => {
    if (options.kvFailure) throw new Error('synthetic KV error');
    return values.get(key) ?? null;
  });
  const put = vi.fn(async (key: string, value: string) => {
    if (options.kvFailure) throw new Error('synthetic KV error');
    values.set(key, value);
  });
  const emailSend =
    options.sendEmail ??
    vi.fn(async () => ({ messageId: 'synthetic-message-id' }));
  const env = {
    MONITOR_STATE: { get, put } as unknown as KVNamespace,
    BACKUPS_BUCKET:
      options.bucket ??
      makeBucket({
        objects: [
          makeBackup(),
          {
            key: recoveryProofKey(
              checkedAt,
              'abcdef0123456789abcdef0123456789'
            ),
            size: new TextEncoder().encode(JSON.stringify(makeProof()))
              .byteLength,
            uploaded: new Date(nowMs),
            customMetadata: {},
            httpEtag: 'proof-etag',
            httpMetadata: {},
            checksums: {},
            storageClass: 'Standard',
            version: 'proof-version',
            etag: 'proof-etag',
            ssecKeyMd5: undefined,
            range: undefined,
          } as unknown as R2Object,
        ],
        bodies: {
          [recoveryProofKey(checkedAt, 'abcdef0123456789abcdef0123456789')]:
            JSON.stringify(makeProof()),
        },
      }).bucket,
    EMAIL: { send: emailSend } as unknown as SendEmail,
    CLOUDFLARE_ACCOUNT_ID: 'synthetic-account-id',
    HEALTH_URL: 'https://tossa.app/api/health',
    OPERATIONAL_ALERT_FROM: 'noreply@tossa.app',
    OPERATIONAL_ALERT_DRY_RUN: options.alertDryRun ?? 'false',
    MONITOR_QUEUE_API_TOKEN: 'synthetic-queue-token',
    OPERATIONAL_ALERT_RECIPIENTS:
      options.recipients ?? 'ops1@example.test,ops2@example.test',
  } as unknown as Parameters<typeof runOperationsMonitor>[0] & {
    MONITOR_QUEUE_API_TOKEN: string;
    OPERATIONAL_ALERT_RECIPIENTS: string;
  };
  return { env, values, get, put, emailSend };
}

describe('standalone operations monitor Worker', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exposes no public operations and performs read-only healthy checks on schedule', async () => {
    const { bucket, list, get } = makeBucket({
      objects: [
        makeBackup(),
        {
          key: recoveryProofKey(checkedAt, 'abcdef0123456789abcdef0123456789'),
          size: new TextEncoder().encode(JSON.stringify(makeProof()))
            .byteLength,
          uploaded: new Date(nowMs),
          customMetadata: {},
          httpEtag: 'proof-etag',
          httpMetadata: {},
          checksums: {},
          storageClass: 'Standard',
          version: 'proof-version',
          etag: 'proof-etag',
          ssecKeyMd5: undefined,
          range: undefined,
        } as unknown as R2Object,
      ],
      bodies: {
        [recoveryProofKey(checkedAt, 'abcdef0123456789abcdef0123456789')]:
          JSON.stringify(makeProof()),
      },
    });
    const { env, values, put, emailSend } = makeEnv({ bucket });
    const { fetchMock, calls, requestOptions } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(
      (await worker.fetch(new Request('https://monitor.example/'), env)).status
    ).toBe(404);
    expect((await executeAt(env)).status).toBe('healthy');
    expect(
      calls.filter((url) => url === 'https://tossa.app/api/health')
    ).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith('/metrics'))).toHaveLength(4);
    expect(requestOptions).toHaveLength(6);
    expect(
      requestOptions.every(
        (options) =>
          options.cache === 'no-store' &&
          options.redirect === 'manual' &&
          options.method === 'GET' &&
          options.signal !== undefined
      )
    ).toBe(true);
    expect(list.mock.calls.map(([arg]) => arg.prefix)).toEqual([
      'backups/',
      'recovery-checks/',
    ]);
    expect(get).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith('heartbeat', expect.any(String));
    expect(
      log.mock.calls
        .map(([entry]) => JSON.parse(String(entry)))
        .map((entry) => entry.event)
    ).toEqual(['operations-monitor.started', 'operations-monitor.completed']);
    expect(emailSend).not.toHaveBeenCalled();
    expect(values.has('heartbeat')).toBe(true);
    expect(values.has('notifications')).toBe(false);
    expect(log.mock.calls[0]?.[0]).not.toContain('synthetic-queue-token');
  });

  it('alerts on dead-letter and lag conditions and suppresses unchanged incident codes', async () => {
    const { env, values, emailSend } = makeEnv();
    const metrics = {
      'tossa-write-queue': {
        backlog_count: 2,
        backlog_bytes: 200,
        oldest_message_timestamp_ms: nowMs - 6 * 60_000,
      },
      'tossa-write-deadletter': {
        backlog_count: 1,
        backlog_bytes: 100,
        oldest_message_timestamp_ms: nowMs - 30_000,
      },
    } as const;
    const server = makeFetch({ metrics });
    vi.stubGlobal('fetch', server.fetchMock);
    const first = await executeAt(env);
    expect(first).toMatchObject({ status: 'alert', notification: 'sent' });
    expect(first.codes).toContain('queue:tossa-write-queue:lag');
    expect(first.codes).toContain('queue:tossa-write-deadletter:deadletter');
    expect(JSON.parse(values.get('notifications')!).active.fingerprint).toBe(
      first.fingerprint
    );
    expect(emailSend).toHaveBeenCalledOnce();
    const firstAccepted = JSON.parse(values.get('notifications')!).active
      .acceptedAt;

    Object.assign(metrics, {
      'tossa-write-queue': {
        backlog_count: 30,
        backlog_bytes: 3000,
        oldest_message_timestamp_ms: nowMs + 6 * 60_000 - 6 * 60_000,
      },
      'tossa-write-deadletter': {
        backlog_count: 4,
        backlog_bytes: 400,
        oldest_message_timestamp_ms: nowMs + 6 * 60_000 - 30_000,
      },
    });
    const repeated = await executeAt(env, nowMs + 6 * 60_000);
    expect(repeated).toMatchObject({
      status: 'alert',
      notification: 'suppressed',
    });
    expect(repeated.fingerprint).toBe(first.fingerprint);
    expect(emailSend).toHaveBeenCalledOnce();
    expect(JSON.parse(values.get('notifications')!).active.acceptedAt).toBe(
      firstAccepted
    );
  });

  it('sends one recovery notification after a previously accepted incident', async () => {
    const { env, values, emailSend } = makeEnv();
    const incidentServer = makeFetch({
      metrics: {
        'tossa-write-queue': {
          backlog_count: 1,
          backlog_bytes: 100,
          oldest_message_timestamp_ms: nowMs - 6 * 60_000,
        },
      },
    });
    vi.stubGlobal('fetch', incidentServer.fetchMock);
    await executeAt(env);
    expect(emailSend).toHaveBeenCalledOnce();

    const healthyServer = makeFetch();
    vi.stubGlobal('fetch', healthyServer.fetchMock);
    const recovered = await executeAt(env, nowMs + 6 * 60_000);
    expect(recovered).toMatchObject({
      status: 'healthy',
      notification: 'sent',
    });
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(emailSend.mock.calls[1]?.[0]).toMatchObject({
      subject: '[tossa] 運用監視の復旧を確認しました',
      bcc: ['ops1@example.test', 'ops2@example.test'],
    });
    expect(JSON.parse(values.get('notifications')!).active).toBeNull();
    await executeAt(env, nowMs + 12 * 60_000);
    expect(emailSend).toHaveBeenCalledTimes(2);
  });

  it('continues health and R2 checks after the queue API fails closed', async () => {
    const { env, put, emailSend } = makeEnv();
    const { fetchMock, calls } = makeFetch({ failQueueList: true });
    vi.stubGlobal('fetch', fetchMock);
    const report = await executeAt(env);
    expect(report.status).toBe('error');
    expect(report.codes).toContain('queues:list-http-503');
    expect(report.sources).toMatchObject({
      health: 'ok',
      queues: 'failed',
      backups: 'ok',
      recovery: 'ok',
    });
    expect(calls).toContain('https://tossa.app/api/health');
    expect(put.mock.calls.filter(([key]) => key === 'heartbeat')).toHaveLength(
      1
    );
    expect(emailSend).toHaveBeenCalledOnce();
  });

  it.each([
    [401, 'queues:list-http-401'],
    [403, 'queues:list-http-403'],
    [429, 'queues:list-http-429'],
  ])(
    'classifies queue list HTTP %i without exposing the response body',
    async (status, code) => {
      const { env } = makeEnv();
      const { fetchMock } = makeFetch({ queueListStatus: status });
      vi.stubGlobal('fetch', fetchMock);
      const report = await executeAt(env);
      expect(report.codes).toContain(code);
      expect(JSON.stringify(report)).not.toContain(
        'synthetic secret response body'
      );
    }
  );

  it('classifies queue list transport, JSON, and API-envelope failures safely', async () => {
    const cases = [
      {
        options: { queueNetworkFailure: true },
        code: 'queues:list-fetch-failed',
      },
      {
        options: { queueMalformedJson: true },
        code: 'queues:list-invalid-json',
      },
      { options: { queueApiRejected: true }, code: 'queues:list-api-rejected' },
    ] as const;
    for (const item of cases) {
      const { env } = makeEnv();
      const { fetchMock } = makeFetch(item.options);
      vi.stubGlobal('fetch', fetchMock);
      const report = await executeAt(env);
      expect(report.codes).toContain(item.code);
      expect(JSON.stringify(report)).not.toContain(
        'synthetic secret transport failure'
      );
      expect(JSON.stringify(report)).not.toContain(
        'synthetic secret API detail'
      );
    }
  });

  it('ignores valid queues owned by other projects while monitoring the required four', async () => {
    const { env } = makeEnv();
    const { fetchMock, calls } = makeFetch({
      queueNames: [
        ...queueNames,
        'mikaki-write-queue',
        'mikaki-push-queue',
        'tsudoi-write-queue',
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const report = await executeAt(env);
    expect(report.status).toBe('healthy');
    expect(report.sources.queues).toBe('ok');
    expect(report.codes).not.toContain('queues:unknown-or-invalid');
    expect(calls.filter((url) => url.endsWith('/metrics'))).toHaveLength(4);
  });

  it('fails closed when the account queue response contains a malformed record', async () => {
    const { env } = makeEnv();
    const { fetchMock, calls } = makeFetch({
      queueRecords: [
        ...queueNames.map((queue_name) => ({
          queue_name,
          queue_id: queueIds[queue_name],
        })),
        null,
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const report = await executeAt(env);
    expect(report.status).toBe('error');
    expect(report.codes).toContain('queues:unknown-or-invalid');
    expect(calls.filter((url) => url.endsWith('/metrics'))).toHaveLength(4);
  });

  it('separates stale backup, latest recovery failure, and malformed proof conditions', async () => {
    const staleBackupTime = '2026-10-06T00:00:00.000Z';
    const failureTime = checkedAt;
    const failureKey = recoveryProofKey(
      failureTime,
      'abcdef0123456789abcdef0123456789'
    );
    const malformedTime = '2026-10-08T04:18:00.123Z';
    const malformedKey = recoveryProofKey(
      malformedTime,
      'fedcba9876543210fedcba9876543210'
    );
    const { bucket } = makeBucket({
      objects: [
        makeBackup(staleBackupTime),
        {
          key: failureKey,
          size: JSON.stringify(makeProof(failureTime, 'failure')).length,
          uploaded: new Date(nowMs),
          customMetadata: {},
          httpEtag: 'etag1',
          httpMetadata: {},
          checksums: {},
          storageClass: 'Standard',
          version: 'v1',
          etag: 'etag1',
          ssecKeyMd5: undefined,
          range: undefined,
        } as unknown as R2Object,
        {
          key: malformedKey,
          size: JSON.stringify({
            ...makeProof(malformedTime),
            private_data: 'do-not-log',
          }).length,
          uploaded: new Date(nowMs),
          customMetadata: {},
          httpEtag: 'etag2',
          httpMetadata: {},
          checksums: {},
          storageClass: 'Standard',
          version: 'v2',
          etag: 'etag2',
          ssecKeyMd5: undefined,
          range: undefined,
        } as unknown as R2Object,
      ],
      bodies: {
        [failureKey]: JSON.stringify(makeProof(failureTime, 'failure')),
        [malformedKey]: JSON.stringify({
          ...makeProof(malformedTime),
          private_data: 'do-not-log',
        }),
      },
    });
    const { env } = makeEnv({ bucket });
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = await executeAt(env);
    expect(report.codes).toContain('backups:latest-stale');
    expect(report.codes).toContain('recovery:latest-invalid');
    expect(report.codes).not.toContain('recovery:latest-failure');
    expect(log.mock.calls.flat().join(' ')).not.toContain('do-not-log');
  });

  it('does not fetch oversized proof contents and distinguishes missing or stale proofs', async () => {
    const key = recoveryProofKey(checkedAt, 'abcdef0123456789abcdef0123456789');
    const proofObject = {
      key,
      size: 16 * 1024 + 1,
      uploaded: new Date(nowMs),
      customMetadata: {},
      httpEtag: 'etag',
      httpMetadata: {},
      checksums: {},
      storageClass: 'Standard',
      version: 'proof-v1',
      etag: 'etag',
      ssecKeyMd5: undefined,
      range: undefined,
    } as unknown as R2Object;
    const bucketState = makeBucket({ objects: [makeBackup(), proofObject] });
    const { env } = makeEnv({ bucket: bucketState.bucket });
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const report = await executeAt(env);
    expect(report.codes).toContain('recovery:latest-invalid');
    expect(bucketState.get).not.toHaveBeenCalled();

    const missing = makeEnv({
      bucket: makeBucket({ objects: [makeBackup()] }).bucket,
    });
    const missingReport = await executeAt(missing.env);
    expect(missingReport.codes).toContain('recovery:latest-missing');
  });

  it('distinguishes an unsuccessful proof, stale/future proof keys, and R2 list failure', async () => {
    const failure = makeProofObject(checkedAt, 'failure');
    const failureBucket = makeBucket({
      objects: [makeBackup(), failure.object],
      bodies: { [failure.key]: failure.body },
    });
    const failureEnv = makeEnv({ bucket: failureBucket.bucket });
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const failedReport = await executeAt(failureEnv.env);
    expect(failedReport.codes).toContain('recovery:latest-failure');

    const staleTime = new Date(nowMs - 9 * 24 * 60 * 60_000).toISOString();
    const stale = makeProofObject(staleTime);
    const staleBucket = makeBucket({
      objects: [makeBackup(), stale.object],
      bodies: { [stale.key]: stale.body },
    });
    const staleReport = await executeAt(
      makeEnv({ bucket: staleBucket.bucket }).env
    );
    expect(staleReport.codes).toContain('recovery:latest-stale');
    expect(staleBucket.get).not.toHaveBeenCalled();

    const futureTime = new Date(nowMs + 6 * 60_000).toISOString();
    const future = makeProofObject(futureTime);
    const futureBucket = makeBucket({
      objects: [makeBackup(), future.object],
      bodies: { [future.key]: future.body },
    });
    const futureReport = await executeAt(
      makeEnv({ bucket: futureBucket.bucket }).env
    );
    expect(futureReport.codes).toContain('recovery:latest-future');
    expect(futureBucket.get).not.toHaveBeenCalled();

    const unavailableBucket = makeBucket({ listFailure: true });
    const unavailableReport = await executeAt(
      makeEnv({ bucket: unavailableBucket.bucket }).env
    );
    expect(unavailableReport.codes).toContain('backups:list-unavailable');
    expect(unavailableReport.codes).toContain('recovery:list-unavailable');
    expect(unavailableReport.sources.health).toBe('ok');
  });

  it('fails closed when a v2 backup timestamp disagrees with its key and uses the key timestamp when metadata is absent', async () => {
    const keyTimestamp = '2026-10-08T04:16:00.123Z';
    const malformedBackup = makeBackup(
      keyTimestamp,
      '2026-10-08T01:00:00.000Z'
    );
    const proof = makeProofObject(checkedAt);
    const malformedBucket = makeBucket({
      objects: [malformedBackup, proof.object],
      bodies: { [proof.key]: proof.body },
    });
    const envWithMismatch = makeEnv({ bucket: malformedBucket.bucket });
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const invalid = await executeAt(envWithMismatch.env);
    expect(invalid.codes).toContain('backups:latest-invalid');

    const legacyMetadata = makeBackup(keyTimestamp, null);
    const fallback = makeBucket({
      objects: [legacyMetadata, proof.object],
      bodies: { [proof.key]: proof.body },
    });
    const fallbackReport = await executeAt(
      makeEnv({ bucket: fallback.bucket }).env
    );
    expect(fallbackReport.sources.backups).toBe('ok');
  });

  it('uses the native key timestamp to reject stale reuploads and bounds only the latest archive size', async () => {
    const oldTimestamp = '2026-10-06T00:00:00.000Z';
    const reuploadedOld = makeBackup(oldTimestamp);
    reuploadedOld.uploaded = new Date(nowMs);
    const { bucket: reuploadBucket } = makeBucket({
      objects: [reuploadedOld],
    });
    const reuploaded = await executeAt(makeEnv({ bucket: reuploadBucket }).env);
    expect(reuploaded.codes).toContain('backups:latest-stale');

    const reuploadedWithoutCreatedAt = makeBackup(oldTimestamp, null);
    reuploadedWithoutCreatedAt.uploaded = new Date(nowMs);
    const missingTimestampBucket = makeBucket({
      objects: [reuploadedWithoutCreatedAt],
    });
    const reuploadedWithoutTimestamp = await executeAt(
      makeEnv({ bucket: missingTimestampBucket.bucket }).env
    );
    expect(reuploadedWithoutTimestamp.codes).toContain('backups:latest-stale');

    const oversizedHistorical = makeBackup(oldTimestamp);
    oversizedHistorical.size = 100 * 1024 * 1024 + 1;
    const currentProof = makeProofObject(checkedAt);
    const latestHealthy = makeBucket({
      objects: [oversizedHistorical, makeBackup(), currentProof.object],
      bodies: { [currentProof.key]: currentProof.body },
    });
    const healthy = await executeAt(
      makeEnv({ bucket: latestHealthy.bucket }).env
    );
    expect(healthy.sources.backups).toBe('ok');

    const oversizedLatest = makeBackup();
    oversizedLatest.size = 100 * 1024 * 1024 + 1;
    const latestTooLarge = makeBucket({
      objects: [oversizedLatest, currentProof.object],
      bodies: { [currentProof.key]: currentProof.body },
    });
    const tooLarge = await executeAt(
      makeEnv({ bucket: latestTooLarge.bucket }).env
    );
    expect(tooLarge.codes).toContain('backups:archive-too-large');
  });

  it('rejects a noncanonical calendar date encoded in a latest v2 backup key', async () => {
    const valid = makeBackup('2026-03-03T00:00:00.000Z');
    valid.key = valid.key.replace('2026-03-03', '2026-02-31');
    const { bucket } = makeBucket({ objects: [valid] });
    const report = await executeAt(makeEnv({ bucket }).env);
    expect(report.codes).toContain('backups:latest-invalid');
  });

  it('does not acknowledge dry-run or failed email sends, and retries next schedule', async () => {
    const sendEmail = vi
      .fn()
      .mockRejectedValueOnce(new Error('secret transport failure'))
      .mockResolvedValue({ messageId: 'accepted' });
    const { env, values } = makeEnv({ alertDryRun: 'true', sendEmail });
    const { fetchMock } = makeFetch({
      metrics: {
        'tossa-write-queue': {
          backlog_count: 1,
          backlog_bytes: 100,
          oldest_message_timestamp_ms: nowMs - 6 * 60_000,
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const dry = await executeAt(env);
    expect(dry.notification).toBe('dry-run');
    expect(values.has('notifications')).toBe(false);

    (
      env as Parameters<typeof runOperationsMonitor>[0] & {
        OPERATIONAL_ALERT_DRY_RUN: string;
      }
    ).OPERATIONAL_ALERT_DRY_RUN = 'false';
    const failed = await executeAt(env, nowMs + 5 * 60_000);
    expect(failed.notification).toBe('failed');
    expect(values.has('notifications')).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('secret transport failure');

    const retried = await executeAt(env, nowMs + 10 * 60_000);
    expect(retried.notification).toBe('sent');
    expect(values.has('notifications')).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('fails closed when KV state is corrupt or unavailable without leaking state or API secrets', async () => {
    const { env, values } = makeEnv();
    values.set('notifications', '{bad-json');
    const { fetchMock } = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const report = await executeAt(env);
    expect(report.status).toBe('error');
    expect(report.codes).toContain('monitor:notification-state-invalid');
    expect(JSON.stringify(report)).not.toContain('synthetic-queue-token');
    expect(JSON.stringify(report)).not.toContain('ops1@example.test');

    const { env: failedEnv } = makeEnv({ kvFailure: true });
    const failed = await executeAt(failedEnv);
    expect(failed.status).toBe('error');
    expect(failed.codes).toContain('monitor:heartbeat-write-failed');
  });
});
