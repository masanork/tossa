import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const QUEUE_NAMES = [
  'tossa-write-queue',
  'tossa-push-queue',
  'tossa-write-deadletter',
  'tossa-push-deadletter',
];
const QUEUE_LAG_THRESHOLD_SECONDS = 300;
const INCIDENT_REPEAT_INTERVAL_MS = 30 * 60 * 1000;
const STATE_MAX_BYTES = 16 * 1024;
const STATE_CLOCK_SKEW_MS = 5 * 60 * 1000;

function safeError(message) {
  return new Error(message);
}

function parseEmailAddresses(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const recipients = raw
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (
    recipients.length === 0 ||
    recipients.length > 50 ||
    recipients.some(
      (address) =>
        address.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(address)
    )
  )
    throw safeError('Operational alert recipient configuration is invalid');
  return [...new Set(recipients)];
}

function configFrom(env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const queueToken =
    env.CLOUDFLARE_API_TOKEN?.trim() || env.CF_API_TOKEN?.trim();
  const emailToken = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() || '';
  const sender = env.OPERATIONAL_ALERT_FROM?.trim() || '';
  let recipients;
  try {
    recipients = parseEmailAddresses(env.OPERATIONAL_ALERT_RECIPIENTS);
  } catch {
    recipients = [];
  }
  const dryRun = env.OPERATIONAL_ALERT_DRY_RUN === 'true';

  if (!accountId || !queueToken)
    throw safeError('Cloudflare queue monitoring credentials are missing');
  const notificationsConfigured = Boolean(
    emailToken &&
    sender.length <= 254 &&
    /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(sender) &&
    recipients.length > 0
  );

  return {
    accountId,
    queueToken,
    emailToken,
    sender,
    recipients,
    dryRun,
    notificationsConfigured,
  };
}

function hasNotificationConfiguration(env) {
  try {
    const sender = env.OPERATIONAL_ALERT_FROM?.trim() || '';
    return Boolean(
      env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() &&
      /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(sender) &&
      parseEmailAddresses(env.OPERATIONAL_ALERT_RECIPIENTS).length > 0
    );
  } catch {
    return false;
  }
}

async function readJson(
  fetchImpl,
  url,
  { token, label, method = 'GET', body }
) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw safeError(`${label} request failed`);
  }

  if (!response.ok)
    throw safeError(`${label} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw safeError(`${label} returned invalid JSON`);
  }
}

function requireCloudflareResult(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.success !== true ||
    (value.errors != null &&
      (!Array.isArray(value.errors) || value.errors.length > 0))
  )
    throw safeError(`${label} response was unsuccessful`);
  return value;
}

async function listQueues(fetchImpl, accountId, token) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const url = new URL(
      `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/queues`
    );
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    const data = requireCloudflareResult(
      await readJson(fetchImpl, url, {
        token,
        label: 'Cloudflare queue list',
      }),
      'Cloudflare queue list'
    );
    if (!Array.isArray(data.result))
      throw safeError('Cloudflare queue list response was unexpected');
    all.push(...data.result);

    const totalPages = data.result_info?.total_pages;
    if (Number.isInteger(totalPages) && totalPages >= 1) {
      if (page >= totalPages) return all;
    } else if (data.result.length < 100) {
      return all;
    }
  }
  throw safeError('Cloudflare queue list exceeded the page safety limit');
}

function metricSummary(queue, nowMs) {
  const metrics = queue.metrics;
  if (
    !metrics ||
    typeof metrics.backlog_count !== 'number' ||
    !Number.isFinite(metrics.backlog_count) ||
    metrics.backlog_count < 0 ||
    typeof metrics.backlog_bytes !== 'number' ||
    !Number.isFinite(metrics.backlog_bytes) ||
    metrics.backlog_bytes < 0 ||
    typeof metrics.oldest_message_timestamp_ms !== 'number' ||
    !Number.isFinite(metrics.oldest_message_timestamp_ms) ||
    metrics.oldest_message_timestamp_ms < 0
  )
    throw safeError(`Queue metrics response was invalid for ${queue.name}`);

  let oldestMessageAgeSeconds = null;
  if (metrics.backlog_count > 0) {
    const oldest = metrics.oldest_message_timestamp_ms;
    if (oldest === 0 || oldest > nowMs + 120_000)
      throw safeError(`Queue age is unknown for ${queue.name}`);
    oldestMessageAgeSeconds = Math.max(0, Math.floor((nowMs - oldest) / 1000));
  }
  if (metrics.backlog_count === 0 && metrics.backlog_bytes > 0)
    throw safeError(`Queue metrics are inconsistent for ${queue.name}`);

  return {
    name: queue.name,
    backlogCount: metrics.backlog_count,
    backlogBytes: metrics.backlog_bytes,
    oldestMessageAgeSeconds,
  };
}

function evaluateQueue(summary) {
  const findings = [];
  if (summary.name.endsWith('-deadletter') && summary.backlogCount > 0)
    findings.push({
      code: `queue:${summary.name}:deadletter`,
      message: `${summary.name} contains ${summary.backlogCount} dead-letter message(s)`,
    });
  if (
    summary.backlogCount > 0 &&
    summary.oldestMessageAgeSeconds !== null &&
    summary.oldestMessageAgeSeconds >= QUEUE_LAG_THRESHOLD_SECONDS
  )
    findings.push({
      code: `queue:${summary.name}:lag`,
      message: `${summary.name} oldest message is ${summary.oldestMessageAgeSeconds}s old`,
    });
  return findings;
}

function incidentFingerprint(codes) {
  const normalized = [...new Set(codes)].sort();
  if (normalized.length === 0) return null;
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function validateMonitorState(value, nowMs) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'active,version' ||
    value.version !== 1
  )
    throw safeError('Monitor state is invalid');
  if (value.active === null) return { version: 1, active: null };
  const active = value.active;
  if (
    !active ||
    typeof active !== 'object' ||
    Array.isArray(active) ||
    Object.keys(active).sort().join(',') !== 'acceptedAt,fingerprint' ||
    typeof active.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(active.fingerprint) ||
    typeof active.acceptedAt !== 'string'
  )
    throw safeError('Monitor state is invalid');
  const acceptedAt = Date.parse(active.acceptedAt);
  if (
    !Number.isFinite(acceptedAt) ||
    new Date(acceptedAt).toISOString() !== active.acceptedAt ||
    acceptedAt > nowMs + STATE_CLOCK_SKEW_MS
  )
    throw safeError('Monitor state is invalid');
  return {
    version: 1,
    active: { fingerprint: active.fingerprint, acceptedAt: active.acceptedAt },
  };
}

async function readMonitorState(rawPath, nowMs) {
  if (!rawPath?.trim())
    return {
      configured: false,
      exists: false,
      state: { version: 1, active: null },
    };
  if (!isAbsolute(rawPath)) throw safeError('Monitor state is invalid');
  const path = resolve(rawPath);
  const parent = dirname(path);
  try {
    const directory = await lstat(parent);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (directory.mode & 0o077) !== 0
    )
      throw safeError('Monitor state is invalid');
  } catch (error) {
    if (error?.code === 'ENOENT')
      return {
        configured: true,
        exists: false,
        path,
        state: { version: 1, active: null },
      };
    throw safeError('Monitor state is invalid');
  }

  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT')
      return {
        configured: true,
        exists: false,
        path,
        state: { version: 1, active: null },
      };
    throw safeError('Monitor state is invalid');
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size > STATE_MAX_BYTES
  )
    throw safeError('Monitor state is invalid');

  let handle;
  try {
    const noFollow = fsConstants.O_NOFOLLOW || 0;
    handle = await open(path, fsConstants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.size > STATE_MAX_BYTES ||
      (opened.mode & 0o077) !== 0
    )
      throw safeError('Monitor state is invalid');
    const raw = await handle.readFile('utf8');
    return {
      configured: true,
      exists: true,
      path,
      state: validateMonitorState(JSON.parse(raw), nowMs),
    };
  } catch {
    throw safeError('Monitor state is invalid');
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw safeError('Monitor state is invalid');
}

async function writeMonitorState(stateInfo, state) {
  if (!stateInfo.configured || !stateInfo.path) return false;
  const path = stateInfo.path;
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  try {
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink())
      throw safeError('Monitor state is invalid');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw safeError('Monitor state is invalid');
  }
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    return true;
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function checkHealth(fetchImpl, origin) {
  const url = new URL('/api/health', origin);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, httpStatus: null, reason: 'request-failed' };
  }
  if (response.status !== 200)
    return {
      ok: false,
      httpStatus: response.status,
      reason: 'unexpected-status',
    };
  if (
    !response.headers
      .get('Content-Type')
      ?.toLowerCase()
      .includes('application/json')
  )
    return {
      ok: false,
      httpStatus: response.status,
      reason: 'unexpected-content-type',
    };
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, httpStatus: response.status, reason: 'invalid-json' };
  }
  const ok =
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    body.status === 'ok' &&
    body.app === 'tossa';
  return {
    ok: Boolean(ok),
    httpStatus: response.status,
    reason: ok ? null : 'unexpected-response',
  };
}

async function sendAlert(fetchImpl, config, report, kind = 'incident') {
  if (config.dryRun) return 'dry-run';
  const isRecovery = kind === 'recovery';
  const body = {
    // Keep the admin recipient list private, matching the Worker's BCC alerts.
    bcc: config.recipients,
    from: config.sender,
    subject: isRecovery
      ? '[tossa] External operations monitor recovered'
      : '[tossa] Queue / health monitor alert',
    text: [
      isRecovery
        ? 'tossa の外部運用監視で正常復帰を確認しました。'
        : 'tossa の外部運用監視で確認が必要です。',
      `確認時刻 (UTC): ${report.checkedAt}`,
      ...(isRecovery ? [] : report.alerts.map((alert) => `- ${alert}`)),
      `ヘルスチェック: ${report.health.ok ? '正常' : report.health.reason}`,
    ].join('\n'),
  };
  const result = requireCloudflareResult(
    await readJson(
      fetchImpl,
      `${CLOUDFLARE_API}/accounts/${encodeURIComponent(config.accountId)}/email/sending/send`,
      {
        token: config.emailToken,
        method: 'POST',
        body,
        label: 'Operational alert email',
      }
    ),
    'Operational alert email'
  );
  const delivered = result.result?.delivered ?? [];
  const queued = result.result?.queued ?? [];
  if (
    !Array.isArray(delivered) ||
    !Array.isArray(queued) ||
    delivered.length + queued.length !== config.recipients.length ||
    (Array.isArray(result.result?.permanent_bounces) &&
      result.result.permanent_bounces.length > 0) ||
    (Array.isArray(result.result?.suppressed_recipients) &&
      result.result.suppressed_recipients.length > 0)
  )
    throw safeError(
      'Operational alert email was not accepted for every recipient'
    );
  return 'sent';
}

function safeFailureMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

export async function monitorOperations(
  env = process.env,
  fetchImpl = fetch,
  nowMs = Date.now()
) {
  const config = configFrom(env);
  const origin = env.SMOKE_BASE_URL?.trim() || 'https://tossa.app';
  let base;
  try {
    base = new URL(origin);
  } catch {
    throw safeError('SMOKE_BASE_URL is invalid');
  }
  const localHttpHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && localHttpHosts.has(base.hostname))
  )
    throw safeError('SMOKE_BASE_URL must use HTTPS (HTTP is local-only)');

  const alerts = [];
  const summaries = [];
  const incidentCodes = [];
  let observationFailed = false;
  try {
    const queues = await listQueues(
      fetchImpl,
      config.accountId,
      config.queueToken
    );
    for (const name of QUEUE_NAMES) {
      try {
        const matching = queues.filter((queue) => queue?.queue_name === name);
        if (matching.length !== 1 || typeof matching[0]?.queue_id !== 'string')
          throw safeError(
            `Expected exactly one configured queue named ${name}`
          );
        const queue = { name, id: matching[0].queue_id };
        const data = requireCloudflareResult(
          await readJson(
            fetchImpl,
            `${CLOUDFLARE_API}/accounts/${encodeURIComponent(config.accountId)}/queues/${encodeURIComponent(queue.id)}/metrics`,
            { token: config.queueToken, label: `Metrics for ${name}` }
          ),
          `Metrics for ${name}`
        );
        const summary = metricSummary(
          { ...queue, metrics: data.result },
          nowMs
        );
        summaries.push(summary);
        for (const finding of evaluateQueue(summary)) {
          incidentCodes.push(finding.code);
          alerts.push(finding.message);
        }
      } catch (error) {
        observationFailed = true;
        incidentCodes.push(`queue:${name}:observation-failed`);
        alerts.push(safeFailureMessage(error, `Metrics for ${name} failed`));
      }
    }
  } catch (error) {
    observationFailed = true;
    incidentCodes.push('queue-list:observation-failed');
    alerts.push(
      safeFailureMessage(error, 'Cloudflare queue list request failed')
    );
  }

  const health = await checkHealth(fetchImpl, base.origin);
  if (!health.ok) {
    incidentCodes.push(`health:${health.reason}`);
    alerts.push(`Health endpoint is ${health.reason}`);
  }

  let stateInfo;
  let stateInvalid = false;
  try {
    stateInfo = await readMonitorState(
      env.OPERATIONAL_MONITOR_STATE_FILE,
      nowMs
    );
  } catch {
    stateInvalid = true;
    incidentCodes.push('monitor-state-invalid');
    alerts.push(
      'Monitor notification state is invalid; suppression is disabled'
    );
  }
  const fingerprint = incidentFingerprint(incidentCodes);
  const report = {
    status:
      observationFailed || stateInvalid
        ? 'error'
        : incidentCodes.length > 0
          ? 'alert'
          : 'healthy',
    checkedAt: new Date(nowMs).toISOString(),
    health,
    queues: summaries,
    alerts,
    stateChanged: false,
    notificationsConfigured: config.notificationsConfigured,
    notification: 'not-needed',
  };

  if (!stateInvalid) {
    const active = stateInfo.state.active;
    if (fingerprint) {
      const cooldownActive =
        active?.fingerprint === fingerprint &&
        nowMs - Date.parse(active.acceptedAt) < INCIDENT_REPEAT_INTERVAL_MS;
      if (cooldownActive) {
        report.notification = config.notificationsConfigured
          ? 'suppressed'
          : 'unconfigured';
        if (!config.notificationsConfigured) report.status = 'error';
        return report;
      }

      if (!config.notificationsConfigured) {
        report.notification = 'unavailable';
        report.status = 'error';
        return report;
      }
      try {
        report.notification = await sendAlert(fetchImpl, config, report);
      } catch {
        report.notification = 'unavailable';
        report.status = 'error';
        report.alerts.push('Operational alert email could not be accepted');
        return report;
      }
      if (report.notification === 'sent' && stateInfo.configured) {
        try {
          report.stateChanged = await writeMonitorState(stateInfo, {
            version: 1,
            active: { fingerprint, acceptedAt: report.checkedAt },
          });
        } catch {
          report.status = 'error';
          report.alerts.push(
            'Operational notification state could not be saved'
          );
        }
      }
      return report;
    }

    if (active) {
      if (!config.notificationsConfigured) {
        report.notification = 'unconfigured';
        return report;
      }
      try {
        report.notification = await sendAlert(
          fetchImpl,
          config,
          report,
          'recovery'
        );
      } catch {
        report.notification = 'unavailable';
        report.status = 'error';
        report.alerts.push('Operational recovery email could not be accepted');
        return report;
      }
      if (report.notification === 'sent') {
        try {
          report.stateChanged = await writeMonitorState(stateInfo, {
            version: 1,
            active: null,
          });
        } catch {
          report.status = 'error';
          report.alerts.push(
            'Operational notification state could not be saved'
          );
        }
      }
      return report;
    }

    report.notification = config.notificationsConfigured
      ? 'not-needed'
      : 'unconfigured';
  } else {
    // Corrupt state cannot safely suppress or acknowledge anything. Keep the
    // monitor failure visible, try a bounded generic notification, and leave
    // the original file untouched for operator inspection.
    if (!config.notificationsConfigured) {
      report.notification = 'unavailable';
      return report;
    }
    try {
      report.notification = await sendAlert(fetchImpl, config, report);
    } catch {
      report.notification = 'unavailable';
      report.alerts.push('Operational alert email could not be accepted');
    }
  }
  return report;
}

async function main() {
  try {
    const report = await monitorOperations();
    console.log(JSON.stringify(report));
    if (report.status === 'error' || report.status === 'alert')
      process.exitCode = 1;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Operational monitor failed';
    console.log(
      JSON.stringify({
        status: 'error',
        checkedAt: new Date().toISOString(),
        notificationsConfigured: hasNotificationConfiguration(process.env),
        notification: 'unavailable',
        error: message,
      })
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
