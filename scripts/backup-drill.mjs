import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerCli = join(
  projectRoot,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js'
);
const schemaPath = join(projectRoot, 'schema.sql');
const restoreCli = join(projectRoot, 'scripts', 'restore-backup.mjs');
const tempRoot = await mkdtemp(join(tmpdir(), 'tossa-backup-drill-'));
const persistPath = join(tempRoot, 'wrangler-state');
const sourceName = 'tossa-drill-src-' + randomHex(8);
const destinationName = 'tossa-drill-dest-' + randomHex(8);
const bucketName = 'tossa-drill-backups-' + randomHex(8);
const sourceId = randomUuid();
const destinationId = randomUuid();
const configPath = join(tempRoot, 'wrangler.toml');
const archivePath = join(tempRoot, 'backup.json');
const restoreSqlPath = join(tempRoot, 'restore.sql');
const workerLogPath = join(tempRoot, 'worker.log');
const runAbort = new AbortController();
let worker;
let workerSpawnError;
let workerLogs = '';
let baseUrl;
let ok = false;
let terminationSignal;
const onSignal = (signal) => {
  if (terminationSignal) return;
  terminationSignal = signal;
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  runAbort.abort(new Error('Interrupted by ' + signal));
};
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

function onSigint() {
  onSignal('SIGINT');
}

function onSigterm() {
  onSignal('SIGTERM');
}

try {
  await writeFile(
    configPath,
    [
      'name = "tossa-backup-drill-' + randomHex(6) + '"',
      'main = "' +
        tomlPath(join(projectRoot, 'scripts', 'backup-drill-worker.ts')) +
        '"',
      'compatibility_date = "2025-02-04"',
      'compatibility_flags = ["nodejs_compat"]',
      'workers_dev = false',
      '',
      '[[d1_databases]]',
      'binding = "DB_SOURCE"',
      'database_name = "' + sourceName + '"',
      'database_id = "' + sourceId + '"',
      'remote = false',
      '',
      '[[d1_databases]]',
      'binding = "DB_DEST"',
      'database_name = "' + destinationName + '"',
      'database_id = "' + destinationId + '"',
      'remote = false',
      '',
      '[[r2_buckets]]',
      'binding = "BACKUPS_BUCKET"',
      'bucket_name = "' + bucketName + '"',
      'remote = false',
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 }
  );

  const localEnv = isolatedWranglerEnv();
  runWrangler(
    [
      'd1',
      'execute',
      sourceName,
      '--local',
      '--yes',
      '--config',
      configPath,
      '--persist-to',
      persistPath,
      '--file',
      schemaPath,
    ],
    localEnv
  );

  const port = await findLocalPort();
  baseUrl = 'http://127.0.0.1:' + port;
  worker = spawn(
    process.execPath,
    [
      wranglerCli,
      'dev',
      '--config',
      configPath,
      '--local',
      '--persist-to',
      persistPath,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--show-interactive-dev-session=false',
      '--log-level',
      'warn',
    ],
    {
      cwd: projectRoot,
      env: localEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  worker.on('error', (error) => {
    workerSpawnError = error;
  });
  worker.stdout.setEncoding('utf8');
  worker.stderr.setEncoding('utf8');
  worker.stdout.on('data', (chunk) => appendWorkerLog(chunk));
  worker.stderr.on('data', (chunk) => appendWorkerLog(chunk));
  await waitForWorker();

  const seed = await postJson('/seed');
  if (seed.titleBytes?.max < 100_000)
    throw new Error('The synthetic fixture lacks a single value above 100 KB');
  const backup = await postJson('/backup');
  if (!backup.success || !backup.backupKey)
    throw new Error(
      'Production backup service returned failure: ' + JSON.stringify(backup)
    );

  const download = await fetch(
    baseUrl + '/object?' + new URLSearchParams({ key: backup.backupKey }),
    {
      signal: AbortSignal.any([
        runAbort.signal,
        AbortSignal.timeout(10 * 60 * 1000),
      ]),
    }
  );
  if (!download.ok)
    throw new Error('Local R2 object download failed: HTTP ' + download.status);
  const archiveBytes = Buffer.from(await download.arrayBuffer());
  await writeFile(archivePath, archiveBytes, { flag: 'wx', mode: 0o600 });

  if (archiveBytes.byteLength <= 5 * 1024 * 1024)
    throw new Error(
      'Synthetic archive did not exceed 5 MiB; multipart was not exercised'
    );
  if (backup.sizeBytes !== archiveBytes.byteLength)
    throw new Error('R2 object size does not match the downloaded archive');
  const multipart = backup.multipart;
  if (
    !multipart ||
    multipart.partCount < 2 ||
    multipart.completedPartCount !== multipart.partCount ||
    multipart.partBytes !== archiveBytes.byteLength ||
    multipart.partSizes.slice(0, -1).some((size) => size !== 5 * 1024 * 1024)
  )
    throw new Error('R2 multipart parts do not match the completed object');

  const archive = JSON.parse(archiveBytes.toString('utf8'));
  if (
    archive.metadata?.version !== 2 ||
    Object.keys(archive.data ?? {}).length !== 17
  )
    throw new Error(
      'Downloaded object is not the complete 17-table v2 archive'
    );
  for (const [table, count] of Object.entries(
    archive.metadata.tableCounts ?? {}
  )) {
    if (
      !Array.isArray(archive.data[table]) ||
      archive.data[table].length !== count
    )
      throw new Error('Archive row count mismatch for ' + table);
  }
  if (
    archive.metadata.totalRecords !==
    Object.values(archive.data).reduce((sum, rows) => sum + rows.length, 0)
  )
    throw new Error('Archive total record count mismatch');
  if (
    !archive.data.posts.some(
      (post) =>
        post.title.includes('\u0000') && post.title.includes('災害情報 "復旧"')
    )
  )
    throw new Error(
      'Archive did not preserve the UTF-8, quote and NUL fixture'
    );

  const restore = spawnSync(
    process.execPath,
    [restoreCli, archivePath, restoreSqlPath],
    {
      cwd: projectRoot,
      env: localEnv,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    }
  );
  if (restore.error) throw restore.error;
  throwIfTerminated();
  if (restore.status !== 0)
    throw new Error(
      'restore-backup.mjs failed: ' + (restore.stderr || restore.stdout).trim()
    );

  const restoreSql = await readFile(restoreSqlPath, 'utf8');
  const maxStatementBytes = restoreSql
    .split(';')
    .reduce(
      (maximum, line) => Math.max(maximum, Buffer.byteLength(line, 'utf8')),
      0
    );
  if (maxStatementBytes > 100_000)
    throw new Error(
      'Generated restore SQL exceeds the 100,000-byte D1 statement limit: ' +
        maxStatementBytes
    );

  runWrangler(
    [
      'd1',
      'execute',
      destinationName,
      '--local',
      '--yes',
      '--config',
      configPath,
      '--persist-to',
      persistPath,
      '--file',
      restoreSqlPath,
    ],
    localEnv
  );

  const verification = await postJson('/verify', {
    expectedCounts: archive.metadata.tableCounts,
    key: backup.backupKey,
  });
  const report = {
    runtime: 'Wrangler local Worker with local D1 and R2 bindings',
    remote: false,
    boundAddress: '127.0.0.1',
    wranglerVersion: readWranglerVersion(),
    archiveKey: backup.backupKey,
    archiveBytes: archiveBytes.byteLength,
    multipartPartCount: multipart.partCount,
    multipartPartSizes: multipart.partSizes,
    maximumRestoreStatementBytes: maxStatementBytes,
    seed,
    verification,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!verification.ok)
    throw new Error(
      'Local restore verification failed: ' + JSON.stringify(verification)
    );
  ok = true;
} catch (error) {
  console.error(
    '[backup:drill] ' +
      (error instanceof Error ? error.stack || error.message : String(error))
  );
  if (workerLogs) {
    await writeFile(workerLogPath, workerLogs.slice(-64_000), {
      mode: 0o600,
    }).catch(() => {});
    console.error(
      '[backup:drill] Local Worker log tail:\n' + workerLogs.slice(-8_000)
    );
  }
  process.exitCode = terminationSignal
    ? terminationSignal === 'SIGINT'
      ? 130
      : 143
    : 1;
} finally {
  if (worker) await stopWorker(worker);
  await rm(tempRoot, { recursive: true, force: true });
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
}

if (!ok && process.exitCode === undefined) process.exitCode = 1;

function appendWorkerLog(chunk) {
  workerLogs = (workerLogs + chunk).slice(-128_000);
}

async function waitForWorker() {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    throwIfTerminated();
    if (workerSpawnError) throw workerSpawnError;
    if (childHasExited(worker))
      throw new Error(
        'Wrangler local Worker exited before ready with code ' + worker.exitCode
      );
    try {
      const response = await fetch(baseUrl + '/health', {
        signal: AbortSignal.any([runAbort.signal, AbortSignal.timeout(1_000)]),
      });
      if (response.ok) return;
      lastError = new Error('HTTP ' + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(
    'Wrangler local Worker did not become ready: ' + String(lastError)
  );
}

async function postJson(path, body) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? '{}' : JSON.stringify(body),
    signal: AbortSignal.any([
      runAbort.signal,
      AbortSignal.timeout(10 * 60 * 1000),
    ]),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      path +
        ' returned non-JSON HTTP ' +
        response.status +
        ': ' +
        text.slice(0, 500)
    );
  }
  if (!response.ok)
    throw new Error(
      path + ' failed HTTP ' + response.status + ': ' + JSON.stringify(parsed)
    );
  return parsed;
}

function runWrangler(args, env) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  if (result.error) throw result.error;
  throwIfTerminated();
  if (result.status !== 0)
    throw new Error(
      'Wrangler local command failed (' +
        args.slice(0, 3).join(' ') +
        '):\n' +
        (result.stderr || result.stdout).slice(-8_000)
    );
}

async function findLocalPort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local port'));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolvePromise(address.port)
      );
    });
  });
}

async function stopWorker(child) {
  if (childHasExited(child)) return;
  child.kill('SIGTERM');
  let timeout;
  const stopped = await Promise.race([
    new Promise((resolvePromise) =>
      child.once('exit', () => resolvePromise(true))
    ),
    new Promise((resolvePromise) => {
      timeout = setTimeout(() => resolvePromise(false), 5_000);
    }),
  ]);
  clearTimeout(timeout);
  if (!stopped && !childHasExited(child)) {
    child.kill('SIGKILL');
    if (!childHasExited(child)) await waitForExit(child, 2_000);
  }
}

function childHasExited(child) {
  return (
    (child === worker && Boolean(workerSpawnError)) ||
    child.exitCode !== null ||
    child.signalCode !== null
  );
}

async function waitForExit(child, milliseconds) {
  let timeout;
  const exited = await Promise.race([
    new Promise((resolvePromise) =>
      child.once('exit', () => resolvePromise(true))
    ),
    new Promise((resolvePromise) => {
      timeout = setTimeout(() => resolvePromise(false), milliseconds);
    }),
  ]);
  clearTimeout(timeout);
  return exited;
}

function isolatedWranglerEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLOUDFLARE_|CF_)/i.test(key)) continue;
    env[key] = value;
  }
  env.WRANGLER_SEND_METRICS = 'false';
  env.WRANGLER_LOG_PATH = join(tempRoot, 'wrangler-logs');
  return env;
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function randomUuid() {
  return crypto.randomUUID();
}

function tomlPath(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function readWranglerVersion() {
  const result = spawnSync(process.execPath, [wranglerCli, '--version'], {
    cwd: projectRoot,
    env: isolatedWranglerEnv(),
    encoding: 'utf8',
    timeout: 30_000,
  });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function throwIfTerminated() {
  if (terminationSignal) throw new Error('Interrupted by ' + terminationSignal);
}
