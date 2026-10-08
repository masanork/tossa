import {
  MAX_ARCHIVE_BYTES,
  MAX_PROOF_BYTES,
  PROOF_PREFIX,
  validateProofKey,
  validateRecoveryProof,
} from './recovery-proof.mjs';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const QUEUES = [
  'tossa-write-queue',
  'tossa-push-queue',
  'tossa-write-deadletter',
  'tossa-push-deadletter',
] as const;
const QUEUE_LAG_MS = 5 * 60_000;
const BACKUP_MAX_AGE_MS = 26 * 60 * 60_000;
const RECOVERY_MAX_AGE_MS = 8 * 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const NOTIFICATION_COOLDOWN_MS = 30 * 60_000;
const MAX_R2_PAGES = 20;
const HEARTBEAT_KEY = 'heartbeat';
const NOTIFICATION_KEY = 'notifications';
const BACKUP_KEY_PATTERN =
  /^backups\/tossa_backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_([a-f0-9]{32})\.json$/u;

type StateBinding = OperationsMonitorEnv['MONITOR_STATE'];
type WorkerEnv = OperationsMonitorEnv & {
  MONITOR_QUEUE_API_TOKEN?: string;
  OPERATIONAL_ALERT_RECIPIENTS?: string;
  OPERATIONAL_ALERT_FROM?: string;
  OPERATIONAL_ALERT_DRY_RUN?: string;
};
type QueueName = (typeof QUEUES)[number];
type SourceStatus = 'ok' | 'failed' | 'unknown';
type NotificationStatus =
  'not-needed' | 'sent' | 'suppressed' | 'dry-run' | 'unconfigured' | 'failed';
type MonitorStatus = 'healthy' | 'alert' | 'error' | 'running';

interface NotificationState {
  version: 1;
  active: { fingerprint: string; acceptedAt: string } | null;
}

interface Heartbeat {
  version: 1;
  lastAttemptAt: string;
  lastCompletedAt: string | null;
  status: MonitorStatus;
  sources: {
    health: SourceStatus;
    queues: SourceStatus;
    backups: SourceStatus;
    recovery: SourceStatus;
  };
  notification: NotificationStatus;
  incidentFingerprint: string | null;
}

interface R2ListedObject {
  key: string;
  size: number;
  uploaded?: Date;
  customMetadata?: Record<string, string>;
}

interface R2ListPage {
  objects: R2ListedObject[];
  truncated: boolean;
  cursor?: string;
}

class SafeUpstreamError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

class QueueListError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function validIso(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString() === value ? timestamp : null;
}

function safeCodeSet(codes: string[]): string[] {
  return [...new Set(codes)].sort();
}

async function fingerprint(codes: string[]): Promise<string | null> {
  const normalized = safeCodeSet(codes);
  if (normalized.length === 0) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(normalized))
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function parseRecipients(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    values.length === 0 ||
    values.length > 50 ||
    values.some(
      (email) =>
        email.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/u.test(email)
    )
  )
    return null;
  return [...new Set(values)];
}

function validSender(value: string | undefined): value is string {
  return Boolean(
    value && value.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/u.test(value)
  );
}

async function readState<T>(
  binding: StateBinding,
  key: string,
  validate: (value: unknown) => value is T
): Promise<{ value: T | null; invalid: boolean }> {
  const raw = await binding.get(key);
  if (raw === null) return { value: null, invalid: false };
  if (new TextEncoder().encode(raw).byteLength > 8 * 1024)
    return { value: null, invalid: true };
  try {
    const value: unknown = JSON.parse(raw);
    return validate(value)
      ? { value, invalid: false }
      : { value: null, invalid: true };
  } catch {
    return { value: null, invalid: true };
  }
}

function isNotificationState(
  value: unknown,
  nowMs: number
): value is NotificationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Partial<NotificationState>;
  if (Object.keys(value).sort().join(',') !== 'active,version') return false;
  if (state.version !== 1) return false;
  if (state.active === null) return true;
  if (!state.active || typeof state.active !== 'object') return false;
  const active = state.active as Partial<
    NonNullable<NotificationState['active']>
  >;
  const acceptedAt = validIso(active.acceptedAt);
  return (
    typeof active.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/u.test(active.fingerprint) &&
    acceptedAt !== null &&
    acceptedAt <= nowMs + CLOCK_SKEW_MS
  );
}

function emptyHeartbeat(at: string): Heartbeat {
  return {
    version: 1,
    lastAttemptAt: at,
    lastCompletedAt: null,
    status: 'running',
    sources: {
      health: 'unknown',
      queues: 'unknown',
      backups: 'unknown',
      recovery: 'unknown',
    },
    notification: 'not-needed',
    incidentFingerprint: null,
  };
}

async function fetchJson(url: string, headers?: HeadersInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      // Workers does not implement redirect: 'error'. Manual mode keeps
      // credentials from being forwarded and the ok check below rejects 3xx.
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SafeUpstreamError('fetch-failed');
  }
  if (!response.ok) throw new SafeUpstreamError(`http-${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new SafeUpstreamError('invalid-json');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function observeHealth(
  configuredValue: string,
  now: number
): Promise<{
  status: SourceStatus;
  code?: string;
}> {
  try {
    const healthUrl = new URL(configuredValue);
    if (
      healthUrl.protocol !== 'https:' ||
      healthUrl.origin !== 'https://tossa.app' ||
      healthUrl.username ||
      healthUrl.password ||
      healthUrl.pathname !== '/api/health' ||
      healthUrl.search ||
      healthUrl.hash
    )
      return { status: 'failed', code: 'health:configuration-invalid' };
    const result = await fetchJson(healthUrl.toString());
    if (
      !isRecord(result) ||
      result.status !== 'ok' ||
      result.app !== 'tossa' ||
      typeof result.time !== 'string' ||
      validIso(result.time) === null ||
      validIso(result.time)! > now + CLOCK_SKEW_MS
    )
      return { status: 'failed', code: 'health:invalid-response' };
    return { status: 'ok' };
  } catch {
    return { status: 'failed', code: 'health:unavailable' };
  }
}

function apiSuccess(payload: unknown): payload is Record<string, unknown> {
  return (
    isRecord(payload) &&
    payload.success === true &&
    (payload.errors === undefined ||
      payload.errors === null ||
      (Array.isArray(payload.errors) && payload.errors.length === 0))
  );
}

async function listQueues(
  accountId: string,
  token: string
): Promise<unknown[]> {
  const found: unknown[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(
      `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/queues`
    );
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    const payload = await fetchJson(url.toString(), {
      Authorization: `Bearer ${token}`,
    });
    if (!isRecord(payload)) throw new QueueListError('response-invalid');
    if (!apiSuccess(payload)) throw new QueueListError('api-rejected');
    if (!Array.isArray(payload.result))
      throw new QueueListError('response-invalid');
    found.push(...payload.result);
    const pageInfo = payload.result_info;
    if (pageInfo !== undefined) {
      if (
        !isRecord(pageInfo) ||
        !Number.isInteger(pageInfo.total_pages) ||
        Number(pageInfo.total_pages) < 1
      )
        throw new QueueListError('pagination-invalid');
      if (page >= Number(pageInfo.total_pages)) return found;
    } else if (payload.result.length < 100) {
      return found;
    }
  }
  throw new QueueListError('page-limit');
}

function queueListFailureCode(error: unknown): string {
  if (error instanceof SafeUpstreamError) return `queues:list-${error.code}`;
  if (error instanceof QueueListError) return `queues:list-${error.code}`;
  return 'queues:list-failed';
}

function queueMetricIssue(
  queueName: QueueName,
  payload: unknown,
  now: number
): string[] {
  if (!apiSuccess(payload) || !isRecord(payload.result))
    return [`queue:${queueName}:metrics-invalid`];
  const metrics = payload.result;
  const backlog = metrics.backlog_count;
  const bytes = metrics.backlog_bytes;
  const oldest = metrics.oldest_message_timestamp_ms;
  if (
    typeof backlog !== 'number' ||
    !Number.isFinite(backlog) ||
    backlog < 0 ||
    typeof bytes !== 'number' ||
    !Number.isFinite(bytes) ||
    bytes < 0 ||
    typeof oldest !== 'number' ||
    !Number.isFinite(oldest) ||
    oldest < 0 ||
    (backlog === 0 && bytes > 0)
  )
    return [`queue:${queueName}:metrics-invalid`];
  if (backlog > 0 && (oldest === 0 || oldest > now + CLOCK_SKEW_MS))
    return [`queue:${queueName}:age-unknown`];
  const codes: string[] = [];
  if (queueName.endsWith('-deadletter') && backlog > 0)
    codes.push(`queue:${queueName}:deadletter`);
  if (backlog > 0 && now - oldest >= QUEUE_LAG_MS)
    codes.push(`queue:${queueName}:lag`);
  return codes;
}

async function observeQueues(
  env: WorkerEnv,
  now: number
): Promise<{ status: SourceStatus; codes: string[] }> {
  const token = env.MONITOR_QUEUE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId)
    return { status: 'failed', codes: ['queues:configuration-missing'] };
  let listed: unknown[];
  try {
    listed = await listQueues(accountId, token);
  } catch (error) {
    return { status: 'failed', codes: [queueListFailureCode(error)] };
  }
  const byName = new Map<string, string>();
  let hasUnknown = false;
  for (const item of listed) {
    if (!isRecord(item) || typeof item.queue_name !== 'string') {
      hasUnknown = true;
      continue;
    }
    // This account can host unrelated applications' queues. Ignore valid
    // records outside this monitor's four owned queues.
    if (!QUEUES.includes(item.queue_name as QueueName)) continue;
    if (
      typeof item.queue_id !== 'string' ||
      item.queue_id.length === 0 ||
      byName.has(item.queue_name)
    ) {
      hasUnknown = true;
      continue;
    }
    byName.set(item.queue_name, item.queue_id);
  }
  const codes: string[] = [];
  if (hasUnknown) codes.push('queues:unknown-or-invalid');
  const metricCodes = await Promise.all(
    QUEUES.map(async (name) => {
      const queueId = byName.get(name);
      if (!queueId) return [`queue:${name}:missing`];
      try {
        const url = `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/metrics`;
        const payload = await fetchJson(url, {
          Authorization: `Bearer ${token}`,
        });
        return queueMetricIssue(name, payload, now);
      } catch {
        return [`queue:${name}:metrics-unavailable`];
      }
    })
  );
  codes.push(...metricCodes.flat());
  const failed = codes.some(
    (code) =>
      code === 'queues:unknown-or-invalid' ||
      code.endsWith(':unavailable') ||
      code.endsWith(':invalid') ||
      code.endsWith(':missing') ||
      code.endsWith(':unknown')
  );
  return { status: failed ? 'failed' : 'ok', codes };
}

async function listR2Metadata(
  bucket: R2Bucket,
  prefix: string
): Promise<R2ListedObject[]> {
  const objects: R2ListedObject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_R2_PAGES; page += 1) {
    const result: R2ListPage = await bucket.list({
      prefix,
      cursor,
      limit: 1000,
      ...(prefix === 'backups/' ? { include: ['customMetadata'] } : {}),
    });
    if (!Array.isArray(result.objects) || typeof result.truncated !== 'boolean')
      throw new Error('r2-list-invalid');
    if (
      result.objects.some(
        (object) =>
          !object ||
          typeof object.key !== 'string' ||
          !object.key.startsWith(prefix) ||
          !Number.isSafeInteger(object.size) ||
          object.size < 0 ||
          (object.uploaded !== undefined &&
            (!(object.uploaded instanceof Date) ||
              !Number.isFinite(object.uploaded.getTime()))) ||
          (object.customMetadata !== undefined &&
            (!isRecord(object.customMetadata) ||
              Object.values(object.customMetadata).some(
                (value) => typeof value !== 'string'
              )))
      )
    )
      throw new Error('r2-object-metadata-invalid');
    objects.push(...result.objects);
    if (!result.truncated) return objects;
    if (typeof result.cursor !== 'string' || !result.cursor)
      throw new Error('r2-cursor-missing');
    cursor = result.cursor;
  }
  throw new Error('r2-page-limit');
}

function backupTimestamp(object: R2ListedObject): number | null {
  const keyMatch = BACKUP_KEY_PATTERN.exec(object.key);
  if (!keyMatch) return null;
  const encodedTimestamp = keyMatch[1]!;
  const keyIso = encodedTimestamp.replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u,
    'T$1:$2:$3.$4Z'
  );
  const keyTimestamp = validIso(keyIso);
  if (
    keyTimestamp === null ||
    keyIso.replace(/T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u, 'T$1-$2-$3-$4Z') !==
      encodedTimestamp
  )
    return null;
  const createdAt = object.customMetadata?.createdAt;
  if (createdAt !== undefined) {
    const metadataTimestamp = validIso(createdAt);
    if (metadataTimestamp === null || metadataTimestamp !== keyTimestamp)
      return null;
    return metadataTimestamp;
  }
  return keyTimestamp;
}

async function observeBackups(
  bucket: R2Bucket,
  now: number
): Promise<{ status: SourceStatus; codes: string[] }> {
  let objects: R2ListedObject[];
  try {
    objects = await listR2Metadata(bucket, 'backups/');
  } catch {
    return { status: 'failed', codes: ['backups:list-unavailable'] };
  }
  const v2 = objects.filter((object) => object.customMetadata?.version === '2');
  if (v2.length === 0)
    return { status: 'failed', codes: ['backups:latest-missing'] };
  const newestV2Key = [...v2].sort((a, b) => b.key.localeCompare(a.key))[0]!;
  const latest = backupTimestamp(newestV2Key);
  if (latest === null)
    return { status: 'failed', codes: ['backups:latest-invalid'] };
  if (newestV2Key.size > MAX_ARCHIVE_BYTES)
    return { status: 'failed', codes: ['backups:archive-too-large'] };
  if (latest > now + CLOCK_SKEW_MS)
    return { status: 'failed', codes: ['backups:latest-future'] };
  if (now - latest > BACKUP_MAX_AGE_MS)
    return { status: 'failed', codes: ['backups:latest-stale'] };
  return { status: 'ok', codes: [] };
}

async function readProofBody(bucket: R2Bucket, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (!object || object.size > MAX_PROOF_BYTES || !object.body)
    throw new Error('proof-size-invalid');
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROOF_BYTES) throw new Error('proof-size-invalid');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  return JSON.parse(text) as unknown;
}

async function observeRecovery(
  bucket: R2Bucket,
  now: number
): Promise<{ status: SourceStatus; codes: string[] }> {
  let objects: R2ListedObject[];
  try {
    objects = await listR2Metadata(bucket, PROOF_PREFIX);
  } catch {
    return { status: 'failed', codes: ['recovery:list-unavailable'] };
  }
  if (objects.length === 0)
    return { status: 'failed', codes: ['recovery:latest-missing'] };
  const latest = [...objects].sort((a, b) => b.key.localeCompare(a.key))[0]!;
  const checkedAt = validateProofKey(latest.key) ?? null;
  if (!checkedAt)
    return { status: 'failed', codes: ['recovery:latest-invalid'] };
  const timestamp = Date.parse(checkedAt);
  if (timestamp > now + CLOCK_SKEW_MS)
    return { status: 'failed', codes: ['recovery:latest-future'] };
  if (now - timestamp > RECOVERY_MAX_AGE_MS)
    return { status: 'failed', codes: ['recovery:latest-stale'] };
  if (latest.size > MAX_PROOF_BYTES)
    return { status: 'failed', codes: ['recovery:latest-invalid'] };
  try {
    const proof = await readProofBody(bucket, latest.key);
    validateRecoveryProof(proof, latest.key);
    if (!isRecord(proof))
      return { status: 'failed', codes: ['recovery:latest-invalid'] };
    if ((proof as Record<string, unknown>).status !== 'success')
      return { status: 'failed', codes: ['recovery:latest-failure'] };
    return { status: 'ok', codes: [] };
  } catch {
    return { status: 'failed', codes: ['recovery:latest-invalid'] };
  }
}

async function sendNotification(
  env: WorkerEnv,
  recipients: string[],
  fingerprintValue: string,
  codes: string[],
  mode: 'incident' | 'recovery',
  checkedAt: string
): Promise<boolean> {
  if (!env.EMAIL || !validSender(env.OPERATIONAL_ALERT_FROM)) return false;
  try {
    const response = await env.EMAIL.send({
      bcc: recipients,
      from: { email: env.OPERATIONAL_ALERT_FROM, name: 'tossa 運用監視' },
      subject:
        mode === 'incident'
          ? '[tossa] 運用監視で確認が必要です'
          : '[tossa] 運用監視の復旧を確認しました',
      text: [
        mode === 'incident'
          ? 'tossa の定期運用監視で確認が必要な状態を検出しました。'
          : 'tossa の定期運用監視で正常復帰を確認しました。',
        `確認時刻 (UTC): ${checkedAt}`,
        ...(mode === 'incident'
          ? [`確認コード: ${codes.join(', ')}`]
          : [`確認ID: ${fingerprintValue}`]),
      ].join('\n'),
    });
    return (
      typeof response?.messageId === 'string' && response.messageId.length > 0
    );
  } catch {
    return false;
  }
}

function validateHeartbeat(value: unknown, nowMs: number): value is Heartbeat {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !==
      'incidentFingerprint,lastAttemptAt,lastCompletedAt,notification,sources,status,version' ||
    value.version !== 1
  )
    return false;
  const lastAttemptAt = validIso(value.lastAttemptAt);
  const lastCompletedAt =
    value.lastCompletedAt === null ? null : validIso(value.lastCompletedAt);
  const sources = value.sources;
  if (
    lastAttemptAt === null ||
    lastAttemptAt > nowMs + CLOCK_SKEW_MS ||
    (value.lastCompletedAt !== null &&
      (lastCompletedAt === null || lastCompletedAt > nowMs + CLOCK_SKEW_MS)) ||
    (value.status !== 'running' &&
      (lastCompletedAt === null || lastCompletedAt < lastAttemptAt))
  )
    return false;
  return Boolean(
    isRecord(sources) &&
    Object.keys(sources).sort().join(',') ===
      'backups,health,queues,recovery' &&
    ['healthy', 'alert', 'error', 'running'].includes(String(value.status)) &&
    ['ok', 'failed', 'unknown'].includes(String(sources.health)) &&
    ['ok', 'failed', 'unknown'].includes(String(sources.queues)) &&
    ['ok', 'failed', 'unknown'].includes(String(sources.backups)) &&
    ['ok', 'failed', 'unknown'].includes(String(sources.recovery)) &&
    [
      'not-needed',
      'sent',
      'suppressed',
      'dry-run',
      'unconfigured',
      'failed',
    ].includes(String(value.notification)) &&
    (value.incidentFingerprint === null ||
      (typeof value.incidentFingerprint === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.incidentFingerprint)))
  );
}

async function persistHeartbeat(
  binding: StateBinding,
  heartbeat: Heartbeat
): Promise<boolean> {
  try {
    await binding.put(HEARTBEAT_KEY, JSON.stringify(heartbeat));
    return true;
  } catch {
    return false;
  }
}

export interface MonitorReport {
  status: MonitorStatus;
  checkedAt: string;
  codes: string[];
  fingerprint: string | null;
  notification: NotificationStatus;
  sources: {
    health: SourceStatus;
    queues: SourceStatus;
    backups: SourceStatus;
    recovery: SourceStatus;
  };
}

export async function runOperationsMonitor(
  env: WorkerEnv,
  nowMs = Date.now(),
  completedAtMs?: number
): Promise<MonitorReport> {
  const checkedAt = new Date(nowMs).toISOString();
  const oldHeartbeatResult = await readState(
    env.MONITOR_STATE,
    HEARTBEAT_KEY,
    (value): value is Heartbeat => validateHeartbeat(value, nowMs)
  ).catch(() => ({ value: null, invalid: true }));
  const heartbeat = emptyHeartbeat(checkedAt);
  console.log(
    JSON.stringify({ event: 'operations-monitor.started', checkedAt })
  );

  const previousNotificationResult = await readState(
    env.MONITOR_STATE,
    NOTIFICATION_KEY,
    (value): value is NotificationState => isNotificationState(value, nowMs)
  ).catch(() => ({ value: null, invalid: true }));
  const previousNotification = previousNotificationResult.value;
  const bucket = env.BACKUPS_BUCKET;
  const [health, queues, backups, recovery] = await Promise.all([
    observeHealth(env.HEALTH_URL, nowMs),
    observeQueues(env, nowMs),
    bucket
      ? observeBackups(bucket, nowMs)
      : Promise.resolve({
          status: 'failed' as const,
          codes: ['backups:binding-missing'],
        }),
    bucket
      ? observeRecovery(bucket, nowMs)
      : Promise.resolve({
          status: 'failed' as const,
          codes: ['recovery:binding-missing'],
        }),
  ]);
  const codes = safeCodeSet([
    ...(health.code ? [health.code] : []),
    ...queues.codes,
    ...backups.codes,
    ...recovery.codes,
    ...(oldHeartbeatResult.invalid ? ['monitor:heartbeat-state-invalid'] : []),
    ...(previousNotificationResult.invalid
      ? ['monitor:notification-state-invalid']
      : []),
  ]);
  const sources = {
    health: health.status,
    queues: queues.status,
    backups: backups.status,
    recovery: recovery.status,
  };
  const recipients = parseRecipients(env.OPERATIONAL_ALERT_RECIPIENTS);
  const configured = Boolean(
    env.EMAIL && recipients && validSender(env.OPERATIONAL_ALERT_FROM)
  );
  if (!configured) codes.push('monitor:notification-unconfigured');
  const currentFingerprint = await fingerprint(codes);
  let notification: NotificationStatus = codes.length
    ? 'unconfigured'
    : 'not-needed';
  let stateToPersist: NotificationState | null = null;
  let writeNotificationState = false;
  const dryRun = env.OPERATIONAL_ALERT_DRY_RUN === 'true';

  if (codes.length > 0 && currentFingerprint) {
    if (!configured || !recipients) {
      notification = 'unconfigured';
    } else if (
      previousNotification?.active?.fingerprint === currentFingerprint &&
      nowMs - Date.parse(previousNotification.active.acceptedAt) <
        NOTIFICATION_COOLDOWN_MS
    ) {
      notification = 'suppressed';
    } else if (dryRun) {
      notification = 'dry-run';
    } else {
      const sent = await sendNotification(
        env,
        recipients,
        currentFingerprint,
        codes,
        'incident',
        checkedAt
      );
      if (sent) {
        notification = 'sent';
        stateToPersist = {
          version: 1,
          active: { fingerprint: currentFingerprint, acceptedAt: checkedAt },
        };
        writeNotificationState = true;
      } else {
        notification = 'failed';
        codes.push('monitor:notification-send-failed');
      }
    }
  } else if (previousNotification?.active) {
    if (!configured || !recipients) {
      notification = 'unconfigured';
    } else if (dryRun) {
      notification = 'dry-run';
    } else {
      const sent = await sendNotification(
        env,
        recipients,
        previousNotification.active.fingerprint,
        [],
        'recovery',
        checkedAt
      );
      if (sent) {
        notification = 'sent';
        stateToPersist = { version: 1, active: null };
        writeNotificationState = true;
      } else {
        notification = 'failed';
        codes.push('monitor:notification-send-failed');
      }
    }
  }

  if (writeNotificationState && stateToPersist) {
    try {
      await env.MONITOR_STATE.put(
        NOTIFICATION_KEY,
        JSON.stringify(stateToPersist)
      );
    } catch {
      notification = 'failed';
      codes.push('monitor:notification-state-write-failed');
    }
  }

  const finalCodes = safeCodeSet(codes);
  const finalFingerprint = await fingerprint(finalCodes);
  const status: MonitorStatus =
    finalCodes.length === 0
      ? 'healthy'
      : finalCodes.some(
            (code) =>
              code.startsWith('monitor:') ||
              code.endsWith(':unavailable') ||
              code.endsWith(':invalid') ||
              code.endsWith(':missing') ||
              code.endsWith(':unknown') ||
              code.endsWith(':future')
          ) || Object.values(sources).some((source) => source === 'failed')
        ? 'error'
        : 'alert';
  heartbeat.lastCompletedAt = new Date(
    completedAtMs ?? Date.now()
  ).toISOString();
  heartbeat.status = status;
  heartbeat.sources = sources;
  heartbeat.notification = notification;
  heartbeat.incidentFingerprint = finalFingerprint;
  const heartbeatSaved = await persistHeartbeat(env.MONITOR_STATE, heartbeat);
  if (!heartbeatSaved) {
    finalCodes.push('monitor:heartbeat-write-failed');
  }
  const report: MonitorReport = {
    status: heartbeatSaved ? status : 'error',
    checkedAt,
    codes: safeCodeSet(finalCodes),
    fingerprint: finalFingerprint,
    notification,
    sources,
  };
  console.log(
    JSON.stringify({
      event: 'operations-monitor.completed',
      status: report.status,
      checkedAt: report.checkedAt,
      codes: report.codes,
      fingerprint: report.fingerprint,
      notification: report.notification,
      sources,
    })
  );
  return report;
}

export default {
  async fetch(): Promise<Response> {
    return new Response('Not Found', { status: 404 });
  },
  async scheduled(
    _controller: ScheduledController,
    env: WorkerEnv
  ): Promise<void> {
    await runOperationsMonitor(env);
  },
} satisfies ExportedHandler<OperationsMonitorEnv>;
