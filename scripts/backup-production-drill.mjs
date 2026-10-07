#!/usr/bin/env node
// Read and restore one explicitly selected private v2 backup; never contact D1 remotely.
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWranglerEnv } from './d1-export-archive.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const RESTORE = join(ROOT, 'scripts/restore-backup.mjs');
const BUCKET = 'tossa-backups';
const BACKUP_TABLES = [
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
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_AGE_MS = 26 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const GET_TIMEOUT_MS = 10 * 60 * 1000;
const RESTORE_TIMEOUT_MS = 15 * 60 * 1000;
const COMPARE_BUFFER_BYTES = 32 * 1024 * 1024;
const MAX_RESTORE_SQL_BYTES = 512 * 1024 * 1024;

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || Object.hasOwn(result, match[1]))
      throw new Error('Invalid or duplicate CLI option. See --help.');
    result[match[1]] = match[2] ?? true;
  }
  return result;
}

function help() {
  console.log(`Usage:
  CLOUDFLARE_ACCOUNT_ID=<account-id> CLOUDFLARE_API_TOKEN=<token> \\
    node scripts/backup-production-drill.mjs \\
    --key=backups/<v2-backup-key>.json \\
    --confirm-target=<account-id>/tossa-backups/backups/<v2-backup-key>.json \\
    --report=docs/benchmarks/production-recovery.json

Reads one object from private R2 bucket tossa-backups. It does not query,
export, or write to a remote D1 database. The selected v2 archive must be
newer than 26 hours and no larger than 100 MiB. Temporary archive, SQL, and
local D1 files are stored under a private temporary directory and removed.
The per-table full-value comparison is bounded to 32 MiB of Wrangler JSON
output; an archive within the input size cap can still fail that local bound.
`);
}

function validateAccountId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/iu.test(value);
}

export function validateArchiveKey(key) {
  return (
    typeof key === 'string' &&
    /^backups\/tossa_backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[a-f0-9]{32}\.json$/iu.test(
      key
    )
  );
}

export function archiveKeyTimestamp(key) {
  const match =
    /^backups\/tossa_backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_[a-f0-9]{32}\.json$/iu.exec(
      key
    );
  if (!match)
    throw new Error('Backup object key does not contain a valid timestamp.');
  const iso = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u,
    'T$1:$2:$3.$4Z'
  );
  const time = Date.parse(iso);
  if (!Number.isFinite(time))
    throw new Error('Backup object key timestamp is invalid.');
  return new Date(time).toISOString();
}

export function validateArchiveMetadata(archive, now = Date.now()) {
  if (
    archive?.metadata?.version !== 2 ||
    !archive.data ||
    typeof archive.data !== 'object' ||
    Array.isArray(archive.data) ||
    !archive.metadata.tableCounts ||
    typeof archive.metadata.tableCounts !== 'object'
  )
    throw new Error('Selected object is not a complete v2 backup archive.');
  const dataTables = Object.keys(archive.data).sort();
  const expectedTables = [...BACKUP_TABLES].sort();
  if (
    dataTables.length !== expectedTables.length ||
    dataTables.some((table, index) => table !== expectedTables[index])
  )
    throw new Error(
      'Selected archive does not contain exactly the 17 backup tables.'
    );
  const timestamp = Date.parse(archive.metadata.timestamp);
  if (!Number.isFinite(timestamp))
    throw new Error('Backup archive timestamp is missing or invalid.');
  const ageMs = now - timestamp;
  if (ageMs < -MAX_FUTURE_SKEW_MS || ageMs > MAX_ARCHIVE_AGE_MS)
    throw new Error(
      'Selected backup archive is outside the 26-hour freshness window.'
    );
  let total = 0;
  for (const table of BACKUP_TABLES) {
    const rows = archive.data[table];
    const count = archive.metadata.tableCounts[table];
    if (
      !Array.isArray(rows) ||
      !Number.isSafeInteger(count) ||
      count !== rows.length
    )
      throw new Error(
        `Selected backup archive has an invalid row count for ${table}.`
      );
    total += count;
  }
  const countTables = Object.keys(archive.metadata.tableCounts).sort();
  if (
    countTables.length !== expectedTables.length ||
    countTables.some((table, index) => table !== expectedTables[index])
  )
    throw new Error(
      'Backup metadata does not contain exactly the 17 table counts.'
    );
  if (
    !Number.isSafeInteger(archive.metadata.totalRecords) ||
    archive.metadata.totalRecords !== total
  )
    throw new Error(
      'Selected backup archive total record count is inconsistent.'
    );
  return {
    timestamp: new Date(timestamp).toISOString(),
    ageMs,
    totalRecords: total,
  };
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requireCompleteValueComparison(error) {
  if (error?.code === 'ENOBUFS')
    throw new Error(
      'Full row-value comparison exceeded the 32 MiB local result bound; verification is incomplete.'
    );
}

function sanitizedError(label) {
  return new Error(`${label} failed; Wrangler output was suppressed.`);
}

function runWrangler(
  args,
  env,
  timeout = 120_000,
  maxBuffer = 2 * 1024 * 1024
) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer,
    windowsHide: true,
  });
  if (result.error?.code === 'ENOBUFS') {
    const error = sanitizedError(args.slice(0, 3).join(' '));
    error.code = 'ENOBUFS';
    throw error;
  }
  if (result.error || result.status !== 0)
    throw sanitizedError(args.slice(0, 3).join(' '));
  return result.stdout.trim();
}

function parseJsonOutput(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned an invalid JSON response.`);
  }
}

function extractRows(input, key) {
  const pending = [input];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      if (
        value.length &&
        value.every((row) => row && typeof row === 'object' && key in row)
      )
        return value;
      pending.push(...value);
    } else {
      if (Array.isArray(value.results)) pending.push(value.results);
      pending.push(...Object.values(value));
    }
  }
  return [];
}

async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error('Temporary directory is not private.');
}

async function buildConfig(
  path,
  { name, accountId, databaseName, databaseId }
) {
  const lines = [
    `name = ${JSON.stringify(name)}`,
    `account_id = ${JSON.stringify(accountId)}`,
  ];
  if (databaseName && databaseId) {
    lines.push(
      '',
      '[[d1_databases]]',
      'binding = "DB"',
      `database_name = ${JSON.stringify(databaseName)}`,
      `database_id = ${JSON.stringify(databaseId)}`,
      'remote = false'
    );
  }
  await writeFile(path, lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
}

async function verifyBucketPrivacy(bucket, configPath, remoteEnv) {
  const info = parseJsonOutput(
    runWrangler(
      ['r2', 'bucket', 'info', bucket, '--json', '--config', configPath],
      remoteEnv
    ),
    'R2 bucket info'
  );
  if (info?.name !== bucket)
    throw new Error('R2 bucket identity did not match.');
  const devUrl = runWrangler(
    ['r2', 'bucket', 'dev-url', 'get', bucket, '--config', configPath],
    remoteEnv
  );
  if (!devUrl.includes('Public access via the r2.dev URL is disabled.'))
    throw new Error('Selected R2 bucket allows public r2.dev access.');
  const domains = runWrangler(
    ['r2', 'bucket', 'domain', 'list', bucket, '--config', configPath],
    remoteEnv
  );
  if (
    !domains.includes('There are no custom domains connected to this bucket.')
  )
    throw new Error('Selected R2 bucket has a public custom domain.');
}

async function downloadObject(key, destination, configPath, remoteEnv, signal) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        WRANGLER,
        'r2',
        'object',
        'get',
        `${BUCKET}/${key}`,
        '--file',
        destination,
        '--remote',
        '--config',
        configPath,
      ],
      { cwd: ROOT, env: remoteEnv, stdio: 'ignore', windowsHide: true }
    );
    let settled = false;
    let failure;
    let forceKill;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(watcher);
      clearTimeout(timeout);
      clearTimeout(forceKill);
      signal.removeEventListener('abort', onAbort);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const terminate = (error) => {
      if (failure) return;
      failure = new Error('Interrupted.');
      child.kill('SIGTERM');
      if (error) failure = error;
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
    };
    const onAbort = () => terminate(new Error('Interrupted.'));
    signal.addEventListener('abort', onAbort, { once: true });
    const watcher = setInterval(async () => {
      try {
        if ((await stat(destination)).size > MAX_ARCHIVE_BYTES) {
          terminate(new Error('Selected R2 object exceeds the 100 MiB limit.'));
        }
      } catch {
        // The file is not present until Wrangler begins the download.
      }
    }, 200);
    const timeout = setTimeout(() => {
      terminate(
        new Error('R2 object download exceeded the 10-minute timeout.')
      );
    }, GET_TIMEOUT_MS);
    child.once('error', () => finish(sanitizedError('R2 object download')));
    child.once('exit', (code) => {
      if (failure || signal.aborted)
        return finish(failure || new Error('Interrupted.'));
      if (code !== 0) return finish(sanitizedError('R2 object download'));
      finish();
    });
  });
  const fileInfo = await stat(destination);
  if (fileInfo.size <= 0 || fileInfo.size > MAX_ARCHIVE_BYTES)
    throw new Error(
      'Downloaded archive is empty or exceeds the 100 MiB limit.'
    );
  await chmod(destination, 0o600);
  return fileInfo.size;
}

async function executeLocal(
  databaseName,
  configPath,
  persistPath,
  env,
  query,
  maxBuffer = 2 * 1024 * 1024
) {
  const output = runWrangler(
    [
      'd1',
      'execute',
      databaseName,
      '--local',
      '--json',
      '--command',
      query,
      '--config',
      configPath,
      '--persist-to',
      persistPath,
    ],
    env,
    120_000,
    maxBuffer
  );
  return parseJsonOutput(output, 'Local D1 query');
}

async function verifyLocalDatabase(
  databaseName,
  configPath,
  persistPath,
  env,
  archive
) {
  const counts = {};
  for (const table of BACKUP_TABLES) {
    const result = await executeLocal(
      databaseName,
      configPath,
      persistPath,
      env,
      `SELECT COUNT(*) AS count FROM "${table}";`
    );
    const row = extractRows(result, 'count')[0];
    if (!row) throw new Error(`Could not verify the restored ${table} count.`);
    counts[table] = Number(row.count);
    if (counts[table] !== archive.metadata.tableCounts[table])
      throw new Error(`Restored ${table} row count differs from the archive.`);
  }
  const fkResult = await executeLocal(
    databaseName,
    configPath,
    persistPath,
    env,
    'PRAGMA foreign_key_check;'
  );
  if (extractRows(fkResult, 'table').length)
    throw new Error('Restored D1 foreign_key_check failed.');
  const quickResult = await executeLocal(
    databaseName,
    configPath,
    persistPath,
    env,
    'PRAGMA quick_check;'
  );
  const quickRows = extractRows(quickResult, 'quick_check');
  if (
    quickRows.length !== 1 ||
    String(quickRows[0].quick_check).toLowerCase() !== 'ok'
  )
    throw new Error('Restored D1 quick_check failed.');

  try {
    for (const table of BACKUP_TABLES) {
      const result = await executeLocal(
        databaseName,
        configPath,
        persistPath,
        env,
        `SELECT rowid AS "__backup_drill_rowid", * FROM "${table}" ORDER BY rowid;`,
        COMPARE_BUFFER_BYTES
      );
      const actual = extractRows(result, '__backup_drill_rowid').map((row) => {
        const { __backup_drill_rowid: _ignored, ...values } = row;
        return values;
      });
      const expected = archive.data[table];
      if (actual.length !== expected.length)
        throw new Error(`Restored ${table} values differ from the archive.`);
      for (let index = 0; index < expected.length; index += 1) {
        if (stableJson(actual[index]) !== stableJson(expected[index]))
          throw new Error(`Restored ${table} values differ from the archive.`);
      }
    }
  } catch (error) {
    requireCompleteValueComparison(error);
    throw error;
  }
  return { counts, valueComparison: 'full' };
}

function parseArchiveFile(path) {
  let archive;
  try {
    archive = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Selected R2 object is not valid JSON.');
  }
  const validated = validateArchiveMetadata(archive);
  return { archive, validated };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) return help();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!validateAccountId(accountId))
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal ID.'
    );
  if (typeof apiToken !== 'string' || !apiToken.trim())
    throw new Error('CLOUDFLARE_API_TOKEN is required.');
  if (!validateArchiveKey(args.key))
    throw new Error(
      '--key must identify an explicit backups/tossa_backup_*.json object.'
    );
  const keyTimestamp = Date.parse(archiveKeyTimestamp(args.key));
  const keyAgeMs = Date.now() - keyTimestamp;
  if (keyAgeMs < -MAX_FUTURE_SKEW_MS || keyAgeMs > MAX_ARCHIVE_AGE_MS)
    throw new Error(
      'Selected backup key is outside the 26-hour freshness window.'
    );
  const confirmation = `${accountId}/${BUCKET}/${args.key}`;
  if (args['confirm-target'] !== confirmation)
    throw new Error('--confirm-target must exactly match account/bucket/key.');
  if (typeof args.report !== 'string' || !args.report)
    throw new Error(
      '--report is required for the sanitized verification report.'
    );
  const reportPath = resolve(args.report);

  const tempRoot = await mkdtemp(join(tmpdir(), 'tossa-production-recovery-'));
  await chmod(tempRoot, 0o700);
  await ensurePrivateDirectory(tempRoot);
  const remoteConfig = join(tempRoot, 'remote.wrangler.toml');
  const localConfig = join(tempRoot, 'local.wrangler.toml');
  const archivePath = join(tempRoot, 'backup.json');
  const restoreSqlPath = join(tempRoot, 'restore.sql');
  const persistPath = join(tempRoot, 'local-state');
  const logPath = join(tempRoot, 'wrangler.log');
  const remoteEnv = buildWranglerEnv(process.env, logPath, {
    remoteAuth: true,
  });
  const localEnv = buildWranglerEnv(process.env, logPath);
  const databaseName = `tossa-recovery-${randomUUID().slice(0, 8)}`;
  const databaseId = randomUUID();
  const abortController = new AbortController();
  let interrupted;
  const onSignal = (signal) => {
    interrupted = signal;
    abortController.abort();
  };
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  const startedAt = performance.now();

  try {
    await buildConfig(remoteConfig, {
      name: 'tossa-production-recovery',
      accountId,
    });
    await buildConfig(localConfig, {
      name: 'tossa-local-recovery',
      accountId: '00000000000000000000000000000000',
      databaseName,
      databaseId,
    });
    runWrangler(
      ['whoami', '--json', '--account', accountId, '--config', remoteConfig],
      remoteEnv
    );
    await verifyBucketPrivacy(BUCKET, remoteConfig, remoteEnv);

    const downloadStartedAt = performance.now();
    const archiveBytes = await downloadObject(
      args.key,
      archivePath,
      remoteConfig,
      remoteEnv,
      abortController.signal
    );
    const downloadDurationMs = Math.round(
      performance.now() - downloadStartedAt
    );
    const { archive, validated } = parseArchiveFile(archivePath);
    if (archiveKeyTimestamp(args.key) !== validated.timestamp)
      throw new Error(
        'Backup key timestamp does not match the archive metadata.'
      );
    const archiveHash = await fileSha256(archivePath);

    const restoreStartedAt = performance.now();
    const restored = spawnSync(
      process.execPath,
      [RESTORE, archivePath, restoreSqlPath],
      { cwd: ROOT, env: localEnv, stdio: 'ignore', timeout: RESTORE_TIMEOUT_MS }
    );
    if (restored.error || restored.status !== 0)
      throw sanitizedError('restore-backup.mjs');
    const restoreSqlInfo = await stat(restoreSqlPath);
    if (restoreSqlInfo.size > MAX_RESTORE_SQL_BYTES)
      throw new Error(
        'Generated restore SQL exceeds the 512 MiB local safety limit.'
      );
    await chmod(restoreSqlPath, 0o600);
    await mkdir(persistPath, { mode: 0o700 });
    const importResult = spawnSync(
      process.execPath,
      [
        WRANGLER,
        'd1',
        'execute',
        databaseName,
        '--local',
        '--yes',
        '--config',
        localConfig,
        '--persist-to',
        persistPath,
        '--file',
        restoreSqlPath,
      ],
      { cwd: ROOT, env: localEnv, stdio: 'ignore', timeout: RESTORE_TIMEOUT_MS }
    );
    if (importResult.error || importResult.status !== 0)
      throw sanitizedError('isolated local D1 import');
    const verification = await verifyLocalDatabase(
      databaseName,
      localConfig,
      persistPath,
      localEnv,
      archive
    );
    const restoreDurationMs = Math.round(performance.now() - restoreStartedAt);
    const totalDurationMs = Math.round(performance.now() - startedAt);
    const report = {
      format: 'tossa-production-recovery-report-v1',
      createdAt: new Date().toISOString(),
      accountId,
      archiveKeySha256: createHash('sha256').update(args.key).digest('hex'),
      archiveSha256: archiveHash,
      archiveBytes,
      archiveTimestamp: validated.timestamp,
      archiveAgeMs: validated.ageMs,
      tableCounts: verification.counts,
      totalRecords: validated.totalRecords,
      restoreSqlBytes: restoreSqlInfo.size,
      valueComparison: verification.valueComparison,
      checks: {
        v2Archive: 'ok',
        freshness: 'ok',
        restoreBackupValidation: 'ok',
        localTableCounts: 'ok',
        foreignKeyCheck: 'ok',
        quickCheck: 'ok',
      },
      timingsMs: {
        r2Download: downloadDurationMs,
        restoreAndVerify: restoreDurationMs,
        total: totalDurationMs,
      },
      remoteD1Accessed: false,
      remoteR2Written: false,
    };
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      JSON.stringify({ success: true, report: reportPath, ...report })
    );
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    await rm(tempRoot, { recursive: true, force: true });
    if (interrupted) process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
  }
}

async function fileSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      `[backup:production-drill] ${error instanceof Error ? error.message : 'Failed.'}`
    );
    process.exitCode = 1;
  });
}
