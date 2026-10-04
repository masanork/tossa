const origin = process.env.SMOKE_BASE_URL || 'https://tossa.app';
const adminTokens = [
  process.env.SMOKE_ADMIN_TOKEN?.trim(),
  process.env.SMOKE_ALT_ADMIN_TOKEN?.trim(),
];
const moderatorToken = process.env.SMOKE_MODERATOR_TOKEN?.trim();

function usage() {
  console.error(
    'Usage: SMOKE_ADMIN_TOKEN=… SMOKE_ALT_ADMIN_TOKEN=… [SMOKE_MODERATOR_TOKEN=…] node scripts/smoke-admin.mjs'
  );
  console.error('Optional: SMOKE_BASE_URL (defaults to https://tossa.app)');
}

if (adminTokens.some((token) => !token)) {
  usage();
  process.exitCode = 2;
} else {
  const now = Date.now();
  const clockToleranceMs = 5 * 60 * 1000;

  async function get(path, token) {
    const response = await fetch(new URL(path, origin), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    return response;
  }

  async function json(response, label) {
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error(`${label}: response was not valid JSON`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label}: response shape was unexpected`);
    }
    return value;
  }

  function requireStatus(response, expected, label) {
    if (response.status !== expected) {
      throw new Error(
        `${label}: expected HTTP ${expected}, got ${response.status}`
      );
    }
  }

  function parseClock(
    value,
    label,
    { futureLimit = now + clockToleranceMs } = {}
  ) {
    if (typeof value !== 'string')
      throw new Error(`${label}: timestamp missing`);
    const time = Date.parse(value);
    if (!Number.isFinite(time) || time > futureLimit) {
      throw new Error(
        `${label}: timestamp invalid or unexpectedly in the future`
      );
    }
    return time;
  }

  async function verifyIdentity(token, expectedRole, label) {
    const response = await get('/api/auth/me', token);
    requireStatus(response, 200, `${label} session`);
    const body = await json(response, `${label} session`);
    if (
      body.success !== true ||
      body.authenticated !== true ||
      !body.user ||
      typeof body.user.id !== 'string' ||
      body.user.role !== expectedRole
    ) {
      throw new Error(
        `${label}: session role or response shape was unexpected`
      );
    }
    return body.user.id;
  }

  async function verifyAdmin(token, label) {
    const userId = await verifyIdentity(token, 'admin', label);
    const reportsResponse = await get(
      '/api/posts/reports/moderation?offset=0',
      token
    );
    requireStatus(reportsResponse, 200, `${label} moderation access`);
    const reports = await json(reportsResponse, `${label} moderation access`);
    if (
      reports.success !== true ||
      !Array.isArray(reports.reports) ||
      !Number.isInteger(reports.total) ||
      reports.total < reports.reports.length
    ) {
      throw new Error(`${label}: moderation response shape was unexpected`);
    }

    const backupResponse = await get('/api/settings/backups', token);
    requireStatus(backupResponse, 200, `${label} backup access`);
    const backups = await json(backupResponse, `${label} backup access`);
    if (
      backups.success !== true ||
      !Array.isArray(backups.backups) ||
      !backups.notifications ||
      typeof backups.notifications.emailConfigured !== 'boolean' ||
      !Number.isInteger(backups.notifications.adminEmailRecipients) ||
      backups.notifications.adminEmailRecipients < 0 ||
      typeof backups.notifications.webhookConfigured !== 'boolean'
    ) {
      throw new Error(`${label}: backup response shape was unexpected`);
    }
    const checkedAt = parseClock(
      backups.checkedAt,
      `${label} backup checkedAt`
    );
    if (now - checkedAt > 15 * 60 * 1000) {
      throw new Error(
        `${label}: backup listing timestamp is unexpectedly stale`
      );
    }
    if (backups.backups.length === 0) {
      throw new Error(`${label}: no stored backups were found`);
    }
    for (const [index, backup] of backups.backups.entries()) {
      if (
        !backup ||
        typeof backup !== 'object' ||
        typeof backup.key !== 'string' ||
        !backup.key.startsWith('backups/tossa_backup_') ||
        !Number.isFinite(backup.size) ||
        backup.size <= 0
      ) {
        throw new Error(`${label}: backup metadata shape was unexpected`);
      }
      const uploadedAt = parseClock(
        backup.uploaded,
        `${label} backup ${index + 1} uploaded`
      );
      const snapshotAt = parseClock(
        backup.snapshotAt ?? backup.uploaded,
        `${label} backup ${index + 1} snapshotAt/uploaded`
      );
      if (
        snapshotAt > checkedAt + clockToleranceMs ||
        uploadedAt > checkedAt + clockToleranceMs
      ) {
        throw new Error(`${label}: backup timestamps are later than checkedAt`);
      }
      if (uploadedAt < snapshotAt) {
        throw new Error(`${label}: backup upload predates its snapshot`);
      }
      if (index === 0 && checkedAt - snapshotAt >= 26 * 60 * 60 * 1000) {
        throw new Error(`${label}: latest backup is 26 hours old or older`);
      }
    }
    const notificationsReady =
      (backups.notifications.emailConfigured &&
        backups.notifications.adminEmailRecipients > 0) ||
      backups.notifications.webhookConfigured;
    return {
      userId,
      notificationsReady,
      adminEmailRecipients: backups.notifications.adminEmailRecipients,
      webhookConfigured: backups.notifications.webhookConfigured,
    };
  }

  async function verifyModerator(token) {
    await verifyIdentity(token, 'moderator', 'Moderator');
    const reportsResponse = await get(
      '/api/posts/reports/moderation?offset=0',
      token
    );
    requireStatus(reportsResponse, 200, 'Moderator moderation access');
    const reports = await json(reportsResponse, 'Moderator moderation access');
    if (
      reports.success !== true ||
      !Array.isArray(reports.reports) ||
      !Number.isInteger(reports.total) ||
      reports.total < reports.reports.length
    ) {
      throw new Error('Moderator: moderation response shape was unexpected');
    }
    const backupsResponse = await get('/api/settings/backups', token);
    requireStatus(backupsResponse, 403, 'Moderator backup restriction');
  }

  try {
    const base = new URL(origin);
    const localHttpHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (
      base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && localHttpHosts.has(base.hostname))
    ) {
      throw new Error(
        'SMOKE_BASE_URL must use HTTPS (HTTP is allowed only for localhost)'
      );
    }
    const primary = await verifyAdmin(adminTokens[0], 'Primary admin');
    const alternate = await verifyAdmin(adminTokens[1], 'Alternate admin');
    if (primary.userId === alternate.userId) {
      throw new Error(
        'Primary and alternate admin sessions belong to the same user'
      );
    }
    if (moderatorToken) await verifyModerator(moderatorToken);
    if (!primary.notificationsReady || !alternate.notificationsReady) {
      throw new Error(
        'No verified admin email recipients or webhook are configured for error alerts'
      );
    }
    console.log(
      `Admin smoke check passed: ${base.origin} (2 distinct admins, backup and moderation access, error alerts configured: ${primary.adminEmailRecipients} verified admin email recipient(s), webhook ${primary.webhookConfigured ? 'enabled' : 'disabled'}${moderatorToken ? ', moderator restriction' : ''})`
    );
  } catch (error) {
    console.error(
      `Admin smoke check failed: ${error instanceof Error ? error.message : 'unexpected error'}`
    );
    process.exitCode = 1;
  }
}
