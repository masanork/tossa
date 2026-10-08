#!/usr/bin/env node
// Find the newest fresh private v2 backup, restore it locally, and append a
// small sanitized recovery proof to R2. This script never accesses remote D1.
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWranglerEnv } from './d1-export-archive.mjs';
import {
  archiveKeyTimestamp,
  validateArchiveKey,
} from './backup-production-drill.mjs';
import {
  buildFailureProof,
  buildRecoveryProof,
  MAX_ARCHIVE_BYTES,
  MAX_PROOF_BYTES,
  PROOF_PREFIX,
  recoveryProofKey,
  validateRecoveryProof,
} from './recovery-proof.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const DRILL = join(ROOT, 'scripts/backup-production-drill.mjs');
const BUCKET = 'tossa-backups';
const BACKUP_PREFIX = 'backups/';
const MAX_ARCHIVE_AGE_MS = 26 * 60 * 60 * 1000;
const MAX_PAGES = 20;
const PAGE_SIZE = 1000;
const CHILD_TIMEOUT_MS = 20 * 60 * 1000;
const REST_TIMEOUT_MS = 30_000;

function discoveryError(failureCode, message) {
  const error = new Error(message);
  error.failureCode = failureCode;
  return error;
}

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
    node scripts/backup-scheduled-drill.mjs \\
    --confirm-target=<account-id>/tossa-backups \\
    --report=artifacts/recovery-report.json

Discovers a fresh v2 backup from private R2, restores it to an isolated local
D1 database, then appends a sanitized recovery proof under recovery-checks/.
It never reads, exports, or writes remote D1. The source archive must be at
most 100 MiB and no older than 26 hours. R2 listing is bounded to 20 pages.
`);
}

export async function listR2Objects({
  accountId,
  apiToken,
  prefix,
  fetchImpl = fetch,
}) {
  if (prefix !== BACKUP_PREFIX && prefix !== PROOF_PREFIX)
    throw new Error('R2 listing requires an approved object prefix.');
  const objects = [];
  let cursor;
  const cursors = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects`
    );
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('per_page', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      });
    } catch {
      throw discoveryError(
        'archive_list_request_failed',
        'R2 object listing request failed.'
      );
    }
    if (!response.ok)
      throw discoveryError(
        'archive_list_request_failed',
        'R2 object listing request failed.'
      );
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw discoveryError(
        'archive_list_response_invalid',
        'R2 object listing response was invalid.'
      );
    }
    if (payload?.success !== true || !Array.isArray(payload.result))
      throw discoveryError(
        'archive_list_response_invalid',
        'R2 object listing response was invalid.'
      );
    objects.push(...payload.result);
    const pageInfo = payload.result_info ?? {};
    if (pageInfo.is_truncated !== true) return objects;
    if (
      typeof pageInfo.cursor !== 'string' ||
      !pageInfo.cursor ||
      cursors.has(pageInfo.cursor)
    )
      throw discoveryError(
        'archive_list_pagination_invalid',
        'R2 object listing pagination was invalid.'
      );
    cursor = pageInfo.cursor;
    cursors.add(cursor);
  }
  throw discoveryError(
    'archive_list_pagination_limit',
    'R2 object listing exceeded the 20-page safety bound.'
  );
}

export function selectLatestBackup(objects, now = Date.now()) {
  if (!objects.length)
    throw discoveryError('archive_list_empty', 'R2 backup listing was empty.');
  const keyObjects = objects.filter(
    (object) => typeof object?.key === 'string'
  );
  if (!keyObjects.length)
    throw discoveryError(
      'archive_object_key_field_missing',
      'R2 object metadata did not contain keys.'
    );
  const prefixObjects = keyObjects.filter((object) =>
    object.key.startsWith('backups/')
  );
  if (!prefixObjects.length)
    throw discoveryError(
      'archive_prefix_empty',
      'R2 listing returned no objects under the backup prefix.'
    );
  const backups = objects.filter((object) => validateArchiveKey(object?.key));
  if (!backups.length)
    throw discoveryError(
      'archive_key_format_invalid',
      'No backup object key matched the required format.'
    );
  backups.sort((left, right) =>
    archiveKeyTimestamp(right.key).localeCompare(archiveKeyTimestamp(left.key))
  );
  const selected = backups[0];
  const timestamp = Date.parse(archiveKeyTimestamp(selected.key));
  if (!Number.isSafeInteger(selected.size) || selected.size <= 0)
    throw discoveryError(
      'archive_latest_size_invalid',
      'Latest backup size metadata is invalid.'
    );
  if (selected.size > MAX_ARCHIVE_BYTES)
    throw discoveryError(
      'archive_latest_oversized',
      'Latest backup exceeds the 100 MiB limit.'
    );
  if (now - timestamp < -5 * 60 * 1000 || now - timestamp > MAX_ARCHIVE_AGE_MS)
    throw discoveryError(
      'archive_latest_stale',
      'Latest backup is outside the 26-hour freshness window.'
    );
  return selected;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function command(
  args,
  env,
  timeout = 120_000,
  failureCode = 'proof_publish_failed'
) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const error = new Error('Remote Wrangler operation failed.');
    error.failureCode = failureCode;
    throw error;
  }
  return result.stdout.trim();
}

function verifyPrivateBucket(accountId, config, env) {
  let bucketInfo;
  try {
    bucketInfo = JSON.parse(
      command(
        ['r2', 'bucket', 'info', BUCKET, '--json', '--config', config],
        env,
        120_000,
        'target_bucket_info_failed'
      )
    );
  } catch {
    const error = new Error('R2 bucket identity could not be verified.');
    error.failureCode = 'target_bucket_info_failed';
    throw error;
  }
  if (bucketInfo?.name !== BUCKET) {
    const error = new Error('R2 bucket identity did not match.');
    error.failureCode = 'target_bucket_info_failed';
    throw error;
  }
  const devUrl = command(
    ['r2', 'bucket', 'dev-url', 'get', BUCKET, '--config', config],
    env,
    120_000,
    'target_bucket_privacy_check_failed'
  );
  if (!devUrl.includes('Public access via the r2.dev URL is disabled.')) {
    const error = new Error('R2 bucket allows public r2.dev access.');
    error.failureCode = 'target_bucket_privacy_check_failed';
    throw error;
  }
  const domains = command(
    ['r2', 'bucket', 'domain', 'list', BUCKET, '--config', config],
    env,
    120_000,
    'target_bucket_privacy_check_failed'
  );
  if (
    !domains.includes('There are no custom domains connected to this bucket.')
  ) {
    const error = new Error('R2 bucket has a public custom domain.');
    error.failureCode = 'target_bucket_privacy_check_failed';
    throw error;
  }
  return Number.isSafeInteger(bucketInfo.object_count)
    ? bucketInfo.object_count
    : undefined;
}

async function privateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error('Temporary directory is not private.');
}

async function publishAndVerifyProof({
  proof,
  accountId,
  apiToken,
  config,
  env,
  path,
  readbackPath,
}) {
  const key = recoveryProofKey(proof.checkedAt);
  validateRecoveryProof(proof, key);
  const body = Buffer.from(`${JSON.stringify(proof)}\n`, 'utf8');
  if (body.byteLength > MAX_PROOF_BYTES)
    throw new Error('Recovery proof exceeds the 16 KiB limit.');
  await writeFile(path, body, { flag: 'wx', mode: 0o600 });
  const existing = await listR2Objects({
    accountId,
    apiToken,
    prefix: PROOF_PREFIX,
  });
  if (existing.some((object) => object?.key === key))
    throw new Error('Recovery proof key already exists.');
  command(
    [
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      '--file',
      path,
      '--remote',
      '--content-type',
      'application/json',
      '--config',
      config,
    ],
    env,
    120_000
  );
  command(
    [
      'r2',
      'object',
      'get',
      `${BUCKET}/${key}`,
      '--file',
      readbackPath,
      '--remote',
      '--config',
      config,
    ],
    env,
    120_000
  );
  await chmod(readbackPath, 0o600);
  const readbackStat = await lstat(readbackPath);
  if (
    !readbackStat.isFile() ||
    readbackStat.isSymbolicLink() ||
    readbackStat.size > MAX_PROOF_BYTES
  )
    throw new Error('Recovery proof readback exceeded the size limit.');
  const readback = await readFile(readbackPath);
  if (!readback.equals(body) || sha256(readback) !== sha256(body))
    throw new Error('Recovery proof readback hash validation failed.');
  return { key, body };
}

async function writeSafeArtifact(reportPath, proof, proofKey, diagnostics) {
  const body = Buffer.from(`${JSON.stringify(proof)}\n`, 'utf8');
  const report = {
    ...proof,
    ...(diagnostics ? { diagnostics } : {}),
    proofKeySha256: sha256(Buffer.from(proofKey)),
    proofSha256: sha256(body),
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return report;
}

function validAccountId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/iu.test(value);
}

export function buildDrillEnvironment(remoteEnv, accountId) {
  if (!validAccountId(accountId))
    throw new Error('A valid account ID is required for the remote drill.');
  return { ...remoteEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
}

export function classifyDrillFailure(child) {
  if (child.error) return 'recovery_child_timeout_or_spawn_failed';
  const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
  if (/whoami[^\n]*failed/iu.test(output)) return 'recovery_child_auth_failed';
  if (
    /R2 bucket info failed|bucket allows public|custom domain|r2\.dev/iu.test(
      output
    )
  )
    return 'recovery_child_bucket_verification_failed';
  if (
    /R2 object download failed|Selected R2 object|backup archive|backup key/iu.test(
      output
    )
  )
    return 'recovery_child_archive_failed';
  if (
    /restore-backup|local D1|foreign_key_check|quick_check|row-value comparison|values differ/iu.test(
      output
    )
  )
    return 'recovery_child_restore_verification_failed';
  return 'recovery_drill_failed';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) return help();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!validAccountId(accountId) || !apiToken?.trim())
    throw new Error('Cloudflare account credentials are required.');
  if (args['confirm-target'] !== `${accountId}/${BUCKET}`)
    throw new Error('--confirm-target must exactly match account/bucket.');
  if (typeof args.report !== 'string' || !args.report)
    throw new Error('--report is required for the sanitized result.');
  const reportPath = resolve(args.report);
  const tempRoot = await mkdtemp(join(tmpdir(), 'tossa-scheduled-recovery-'));
  await chmod(tempRoot, 0o700);
  await privateDir(tempRoot);
  const config = join(tempRoot, 'remote.wrangler.toml');
  const drillReportPath = join(tempRoot, 'local-recovery-report.json');
  const proofPath = join(tempRoot, 'proof.json');
  const readbackPath = join(tempRoot, 'proof-readback.json');
  const logPath = join(tempRoot, 'wrangler.log');
  const env = buildWranglerEnv(process.env, logPath, { remoteAuth: true });
  const drillEnv = buildDrillEnvironment(env, accountId);
  let phase = 'archive_discovery_failed';
  let proofKey;
  let proof;
  let drillReport;
  let bucketVerified = false;
  let failureCode = 'archive_discovery_failed';
  let bucketObjectCount;
  let r2ListedObjectCount;
  let diagnostics;
  try {
    await writeFile(
      config,
      `name = "tossa-scheduled-recovery"\naccount_id = "${accountId}"\n`,
      { flag: 'wx', mode: 0o600 }
    );
    bucketObjectCount = verifyPrivateBucket(accountId, config, env);
    bucketVerified = true;
    const objects = await listR2Objects({
      accountId,
      apiToken,
      prefix: BACKUP_PREFIX,
    });
    r2ListedObjectCount = objects.length;
    diagnostics = {
      ...(bucketObjectCount !== undefined ? { bucketObjectCount } : {}),
      r2ListedObjectCount,
    };
    const selected = selectLatestBackup(objects);
    phase = 'recovery_drill_failed';
    const child = spawnSync(
      process.execPath,
      [
        DRILL,
        `--key=${selected.key}`,
        `--confirm-target=${accountId}/${BUCKET}/${selected.key}`,
        `--report=${drillReportPath}`,
      ],
      {
        cwd: ROOT,
        env: drillEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: CHILD_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      }
    );
    if (child.error || child.status !== 0) {
      const error = new Error('Local recovery verification failed.');
      error.failureCode = classifyDrillFailure(child);
      throw error;
    }
    drillReport = JSON.parse(await readFile(drillReportPath, 'utf8'));
    proof = buildRecoveryProof(drillReport, new Date().toISOString());
    phase = 'proof_publish_failed';
  } catch (error) {
    failureCode =
      error &&
      typeof error === 'object' &&
      typeof error.failureCode === 'string'
        ? error.failureCode
        : phase;
    proof = buildFailureProof(new Date().toISOString(), failureCode);
  }

  if (!bucketVerified) {
    const safeFailure = {
      format: 'tossa-recovery-proof-v1',
      status: 'failure',
      checkedAt: proof.checkedAt,
      failureCode,
      proofPublished: false,
    };
    try {
      await writeFile(reportPath, `${JSON.stringify(safeFailure, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      // Keep the failure path generic; the workflow can report nonzero status.
    }
    console.error(
      '[backup:scheduled-drill] Recovery could not verify the private target; proof was not written.'
    );
    process.exitCode = 1;
    await rm(tempRoot, { recursive: true, force: true });
    return;
  }

  try {
    await privateDir(tempRoot);
    const result = await publishAndVerifyProof({
      proof,
      accountId,
      apiToken,
      config,
      env,
      path: proofPath,
      readbackPath,
    });
    proofKey = result.key;
    const safeReport = await writeSafeArtifact(
      reportPath,
      proof,
      proofKey,
      diagnostics
    );
    console.log(
      JSON.stringify({
        success: proof.status === 'success',
        proofKeySha256: safeReport.proofKeySha256,
        proofSha256: safeReport.proofSha256,
        report: reportPath,
      })
    );
    if (proof.status !== 'success') process.exitCode = 1;
  } catch {
    const failedProof = buildFailureProof(
      new Date().toISOString(),
      'proof_publish_failed'
    );
    try {
      const fallbackPath = join(tempRoot, 'failure-proof.json');
      const fallbackReadback = join(tempRoot, 'failure-proof-readback.json');
      const result = await publishAndVerifyProof({
        proof: failedProof,
        accountId,
        apiToken,
        config,
        env,
        path: fallbackPath,
        readbackPath: fallbackReadback,
      });
      await writeSafeArtifact(reportPath, failedProof, result.key);
    } catch {
      // A second attempt is best effort; never expose CLI or API error contents.
    }
    console.error(
      '[backup:scheduled-drill] Sanitized recovery proof could not be published and verified.'
    );
    process.exitCode = 1;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      '[backup:scheduled-drill] Recovery drill failed; details were suppressed.'
    );
    process.exitCode = 1;
  });
}
