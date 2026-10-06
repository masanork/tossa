#!/usr/bin/env node
// Bounded D1 SQL export to a protected local archive, with isolated restore verification.
// Remote mode is deliberately opt-in and never runs as part of tests or CI.
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const schemaText = readFileSync(join(ROOT, 'schema.sql'), 'utf8');
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const DEFAULT_ARCHIVE_DIR = join(homedir(), '.local/share/tossa/d1-exports');
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
const APP_TABLES = schemaTableNames();
const INTERNAL_TABLE_NAMES = new Set([
  'tossa_backup_control',
  'tossa_alert_control',
  '_cf_METADATA',
]);
const RESTORE_TABLE_ORDER = [
  'categories',
  'disasters',
  'users',
  'device_sessions',
  'posts',
  'status_updates',
  'post_verifications',
  'credentials',
  'system_settings',
  'threads',
  'thread_members',
  'messages',
  'access_logs',
  'device_user_links',
  'push_subscriptions',
  'mutation_receipts',
  'post_reports',
];

function schemaTableNames() {
  const schema = requireSchemaText();
  return [
    ...schema.matchAll(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/giu
    ),
  ].map((match) => match[1]);
}

function requireSchemaText() {
  // The schema is also included in each export. Reading it here only establishes
  // the known application-table inventory; no production source is modified.
  return schemaText;
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
  node scripts/d1-export-archive.mjs --local-drill [--rows=30000]
  node scripts/d1-export-archive.mjs --remote-export \\
    --database-name=tossa-db --database-id=<uuid> --account-id=<32-hex-id> \\
    --private-bucket=tossa-backups \\
    --confirm-target=<account-id>/<database-name>/<database-id>/<bucket> \\
    [--archive-dir=<private-directory>] [--max-bytes=<up-to-104857600>]

Remote mode exports only the 17 application tables. Runtime control tables and
backup snapshot shadows are excluded. The verified local SQL file is retained
with mode 0600; R2 upload happens only after an isolated local restore passes.
The SQL export is not the v2 JSON backup format and does not guarantee a
cross-table point-in-time snapshot while writes continue.`);
}

function uuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value
    )
  );
}

function validAccountId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/iu.test(value);
}

function safeIdentifier(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,62}$/u.test(value);
}

function readOnlyEnv(logPath) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(CLOUDFLARE_|CF_)/iu.test(key)
    )
  );
  env.WRANGLER_SEND_METRICS = 'false';
  env.WRANGLER_LOG_PATH = logPath;
  return env;
}

function commandError(label) {
  return new Error(
    `${label} failed. Wrangler output was suppressed to protect credentials and signed URLs.`
  );
}

function runSmall(args, { cwd = ROOT, env, timeoutMs = 120_000 } = {}) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw commandError(args.slice(0, 2).join(' '));
  return result.stdout.trim();
}

async function runExport(args, outputPath, env, signal, maxBytes) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    let finished = false;
    let failure;
    const done = (error) => {
      if (finished) return;
      finished = true;
      clearInterval(watcher);
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const onAbort = () => {
      failure = new Error('Export interrupted.');
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const watcher = setInterval(async () => {
      try {
        const info = await stat(outputPath);
        if (info.size > maxBytes) {
          failure = new Error(
            `Export exceeded configured ${maxBytes}-byte file limit.`
          );
          child.kill('SIGTERM');
        }
      } catch {
        // The output file may not exist until Wrangler begins writing it.
      }
    }, 250);
    const timeout = setTimeout(
      () => {
        failure = new Error(
          'Wrangler export exceeded the 30-minute safety timeout.'
        );
        child.kill('SIGTERM');
      },
      30 * 60 * 1000
    );
    child.once('error', () => done(commandError('wrangler d1 export')));
    child.once('exit', (code) => {
      if (failure || signal?.aborted)
        return done(failure || new Error('Export interrupted.'));
      if (code !== 0) return done(commandError('wrangler d1 export'));
      done();
    });
  });
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned an unrecognized JSON response.`);
  }
}

function findObjectWithUuid(input, expectedId) {
  const pending = [input];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (
      [value.uuid, value.database_id, value.id].some(
        (candidate) =>
          typeof candidate === 'string' &&
          candidate.toLowerCase() === expectedId.toLowerCase()
      )
    )
      return value;
    pending.push(...Object.values(value));
  }
  return undefined;
}

function extractRows(input, key) {
  const pending = [input];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (value.every((row) => row && typeof row === 'object' && key in row))
        return value;
      pending.push(...value);
    } else {
      if (Array.isArray(value.results)) pending.push(value.results);
      pending.push(...Object.values(value));
    }
  }
  return [];
}

function reorderD1Dump(sql) {
  const schema = [];
  const data = new Map(RESTORE_TABLE_ORDER.map((table) => [table, []]));
  let start = 0;
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) i += 1;
        else quote = '';
      }
      continue;
    }
    if (char === '-' && next === '-') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') {
      quote = ']';
      continue;
    }
    if (char !== ';') continue;
    const statement = sql.slice(start, i + 1);
    const normalized = statement
      .replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/u, '')
      .trimStart();
    if (!normalized) {
      start = i + 1;
      continue;
    }
    if (
      /^(?:PRAGMA\b|CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\b)/iu.test(
        normalized
      )
    )
      schema.push(statement);
    else if (/^INSERT\s+INTO\b/iu.test(normalized)) {
      const match = /^INSERT\s+INTO\s+"?([a-z_][a-z0-9_]*)/iu.exec(normalized);
      const table = match?.[1]?.toLowerCase();
      const statements = table ? data.get(table) : undefined;
      if (!statements)
        throw new Error(
          'Wrangler D1 export contains data for an unexpected table.'
        );
      statements.push(statement);
    } else
      throw new Error(
        'Wrangler D1 export contains an unsupported SQL statement.'
      );
    start = i + 1;
  }
  if (quote || blockComment)
    throw new Error(
      'Wrangler D1 export ended inside a SQL literal or comment.'
    );
  if (sql.slice(start).trim())
    throw new Error(
      'Wrangler D1 export contains an unterminated SQL statement.'
    );
  if (
    schema.length === 0 ||
    [...data.values()].every((statements) => statements.length === 0)
  )
    throw new Error('Wrangler D1 export is missing schema or row data.');
  return (
    [
      ...schema,
      ...RESTORE_TABLE_ORDER.flatMap((table) => data.get(table)),
    ].join('\n') + '\n'
  );
}

function tableListSql() {
  return `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`;
}

function verifyTableInventory(names) {
  const actual = new Set(names);
  const expected = new Set(APP_TABLES);
  const missing = [...expected].filter((name) => !actual.has(name));
  const unrecognized = [...actual].filter(
    (name) =>
      !expected.has(name) &&
      !INTERNAL_TABLE_NAMES.has(name) &&
      !/^tossa_backup_snapshot_[0-9TZ_a-f]+_[a-z_]+$/u.test(name)
  );
  if (missing.length || unrecognized.length)
    throw new Error(
      `D1 table inventory changed; missing=${missing.join(',') || 'none'}, unrecognized=${unrecognized.join(',') || 'none'}. Review export allowlist before proceeding.`
    );
}

export function buildD1ExecuteArgs(
  databaseName,
  configPath,
  query,
  { remote = false, persistTo } = {}
) {
  const args = [
    'd1',
    'execute',
    databaseName,
    remote ? '--remote' : '--local',
    '--json',
    '--command',
    query,
    '--config',
    configPath,
  ];
  if (!remote && persistTo) args.push('--persist-to', persistTo);
  return args;
}

async function queryJson(
  databaseName,
  configPath,
  env,
  query,
  persistTo,
  { remote = false } = {}
) {
  const args = buildD1ExecuteArgs(databaseName, configPath, query, {
    remote,
    persistTo,
  });
  try {
    const result = runSmall(args, { env });
    return parseJsonOutput(result, 'D1 query');
  } catch {
    const queryKind = query.startsWith('PRAGMA foreign_key_check')
      ? 'foreign-key check'
      : query.startsWith('PRAGMA quick_check')
        ? 'quick check'
        : query.startsWith('SELECT name FROM sqlite_master')
          ? 'table inventory'
          : query.startsWith('SELECT')
            ? 'table counts'
            : 'verification';
    throw new Error(`Isolated D1 ${queryKind} query failed.`);
  }
}

async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(
      'Archive directory must be a real directory, not a symlink.'
    );
  if ((info.mode & 0o077) !== 0)
    throw new Error(
      'Archive directory must have private permissions (0700 or stricter).'
    );
  return path;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function buildConfig(
  path,
  { name, accountId, databaseName, databaseId }
) {
  const lines = [
    `name = ${JSON.stringify(name)}`,
    `account_id = ${JSON.stringify(accountId)}`,
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = ${JSON.stringify(databaseName)}`,
    `database_id = ${JSON.stringify(databaseId)}`,
  ];
  await writeFile(path, lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
}

function validateRemoteArgs(args) {
  const required = [
    'database-name',
    'database-id',
    'account-id',
    'private-bucket',
    'confirm-target',
  ];
  for (const key of required) {
    if (typeof args[key] !== 'string' || !args[key])
      throw new Error(`Remote mode requires --${key}.`);
  }
  if (!safeIdentifier(args['database-name']))
    throw new Error('--database-name is invalid.');
  if (!uuid(args['database-id']))
    throw new Error('--database-id must be a UUID.');
  if (!validAccountId(args['account-id']))
    throw new Error('--account-id must be 32 hexadecimal characters.');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(args['private-bucket']))
    throw new Error('--private-bucket is invalid.');
  const confirmation = [
    args['account-id'],
    args['database-name'],
    args['database-id'],
    args['private-bucket'],
  ].join('/');
  if (args['confirm-target'] !== confirmation)
    throw new Error(
      '--confirm-target must exactly match account/name/database-id/bucket.'
    );
  const maxBytes = Number(args['max-bytes'] ?? MAX_ARCHIVE_BYTES);
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_ARCHIVE_BYTES
  )
    throw new Error(`--max-bytes must be between 1 and ${MAX_ARCHIVE_BYTES}.`);
  const archiveDir = resolve(
    String(args['archive-dir'] ?? DEFAULT_ARCHIVE_DIR)
  );
  return { maxBytes, archiveDir };
}

function getTargetIds(args) {
  return {
    accountId: args['account-id'],
    databaseName: args['database-name'],
    databaseId: args['database-id'],
    bucket: args['private-bucket'],
  };
}

async function inspectPrivateBucket(bucket, configPath, env) {
  const infoText = runSmall(
    ['r2', 'bucket', 'info', bucket, '--json', '--config', configPath],
    { env }
  );
  const info = parseJsonOutput(infoText, 'R2 bucket info');
  if (!info || info.name !== bucket)
    throw new Error(
      'R2 bucket identity did not match the requested private bucket.'
    );
  const devUrl = runSmall(
    ['r2', 'bucket', 'dev-url', 'get', bucket, '--config', configPath],
    { env }
  );
  if (!devUrl.includes('Public access via the r2.dev URL is disabled.'))
    throw new Error('R2 bucket must have r2.dev public access disabled.');
  const domains = runSmall(
    ['r2', 'bucket', 'domain', 'list', bucket, '--config', configPath],
    { env }
  );
  if (
    !domains.includes('There are no custom domains connected to this bucket.')
  )
    throw new Error(
      'R2 bucket must have no public custom domain before export.'
    );
  return info;
}

async function runRemoteExport(args) {
  const { maxBytes, archiveDir } = validateRemoteArgs(args);
  await ensurePrivateDirectory(archiveDir);
  const stageDir = await mkdtemp(join(archiveDir, '.tossa-d1-export-'));
  await chmod(stageDir, 0o700);
  const logPath = join(stageDir, 'wrangler.log');
  const env = readOnlyEnv(logPath);
  const target = getTargetIds(args);
  const configPath = join(stageDir, 'remote.wrangler.toml');
  const localConfigPath = join(stageDir, 'restore.wrangler.toml');
  const databaseName = `tossa-restore-${randomUUID().slice(0, 8)}`;
  const databaseId = randomUUID();
  const outputPath = join(stageDir, 'database.partial.sql');
  const signalController = new AbortController();
  const stop = () => signalController.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let exported = false;
  let localVerified = false;
  let localOnlyDirName;
  let r2Key;
  try {
    await buildConfig(configPath, {
      name: 'tossa-private-d1-export',
      accountId: target.accountId,
      databaseName: target.databaseName,
      databaseId: target.databaseId,
    });
    await buildConfig(localConfigPath, {
      name: 'tossa-isolated-d1-restore',
      accountId: target.accountId,
      databaseName,
      databaseId,
    });

    // Explicit account membership check; output is kept private and discarded.
    runSmall(
      [
        'whoami',
        '--json',
        '--account',
        target.accountId,
        '--config',
        configPath,
      ],
      { env }
    );
    const info = parseJsonOutput(
      runSmall(
        ['d1', 'info', target.databaseName, '--json', '--config', configPath],
        { env }
      ),
      'D1 info'
    );
    const resolvedDb = findObjectWithUuid(info, target.databaseId);
    if (!resolvedDb)
      throw new Error(
        'Remote D1 name and ID do not match the explicitly selected target.'
      );
    const remoteTablesOutput = await queryJson(
      target.databaseName,
      configPath,
      env,
      tableListSql(),
      undefined,
      { remote: true }
    );
    const remoteTables = extractRows(remoteTablesOutput, 'name').map(
      (row) => row.name
    );
    verifyTableInventory(remoteTables);
    await inspectPrivateBucket(target.bucket, configPath, env);

    const exportArgs = [
      'd1',
      'export',
      target.databaseName,
      '--remote',
      '--skip-confirmation',
      '--output',
      outputPath,
      '--config',
      configPath,
    ];
    for (const table of BACKUP_TABLES) exportArgs.push('--table', table);
    await runExport(
      exportArgs,
      outputPath,
      env,
      signalController.signal,
      maxBytes
    );
    const rawExportInfo = await stat(outputPath);
    if (rawExportInfo.size === 0 || rawExportInfo.size > maxBytes)
      throw new Error(
        'D1 export is empty or exceeded the configured file-size limit.'
      );
    await chmod(outputPath, 0o600);
    const restorePath = join(stageDir, 'restore.partial.sql');
    await writeFile(
      restorePath,
      reorderD1Dump(await readFile(outputPath, 'utf8')),
      {
        flag: 'wx',
        mode: 0o600,
      }
    );
    await rm(outputPath, { force: true });
    await rename(restorePath, outputPath);
    const exportInfo = await stat(outputPath);
    if (exportInfo.size === 0 || exportInfo.size > maxBytes)
      throw new Error(
        'Ordered D1 export is empty or exceeded the configured file-size limit.'
      );

    // Restore into a fresh local D1 database with separate persistence.
    const persistPath = join(stageDir, 'restore-state');
    await mkdir(persistPath, { mode: 0o700 });
    const restore = spawnSync(
      process.execPath,
      [
        WRANGLER,
        'd1',
        'execute',
        databaseName,
        '--local',
        '--yes',
        '--config',
        localConfigPath,
        '--persist-to',
        persistPath,
        '--file',
        outputPath,
      ],
      { cwd: ROOT, env, stdio: 'ignore', timeout: 30 * 60 * 1000 }
    );
    if (restore.error || restore.status !== 0)
      throw commandError('isolated local D1 restore');
    const counts = await readLocalVerification(
      databaseName,
      localConfigPath,
      env,
      persistPath
    );
    const hash = await sha256(outputPath);
    const createdAt = new Date().toISOString();
    const basename = `tossa_d1_export_${createdAt.replace(/[:.]/gu, '-')}_${randomUUID().replaceAll('-', '')}`;
    const finalDir = join(archiveDir, basename);
    localOnlyDirName = `.local-only-${basename}`;
    const manifest = {
      format: 'tossa-d1-sql-export-v1',
      createdAt,
      accountId: target.accountId,
      databaseName: target.databaseName,
      databaseId: target.databaseId,
      includedTables: BACKUP_TABLES,
      excludedRuntimeTables: [
        'tossa_backup_control',
        'tossa_alert_control',
        'tossa_backup_snapshot_*',
      ],
      sizeBytes: exportInfo.size,
      sha256: hash,
      restoreValidation: {
        method: 'isolated local Wrangler D1 import',
        tableCounts: counts,
        foreignKeyCheck: 'ok',
        quickCheck: 'ok',
      },
      r2UploadStatus: 'pending',
      consistencyNote:
        'Wrangler d1 export result was restored and validated locally. Cross-table point-in-time consistency is not asserted by this tool.',
    };
    await writeFile(
      join(stageDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      {
        flag: 'wx',
        mode: 0o600,
      }
    );
    await chmod(join(stageDir, 'manifest.json'), 0o600);
    localVerified = true;

    // Upload only after local restore checks. The key is unique and never replaces
    // a previous generation. This is capped at 100 MiB pending large-file MPU work.
    r2Key = `d1-exports/${basename}.sql`;
    const put = spawnSync(
      process.execPath,
      [
        WRANGLER,
        'r2',
        'object',
        'put',
        `${target.bucket}/${r2Key}`,
        '--file',
        outputPath,
        '--remote',
        '--content-type',
        'application/sql',
        '--config',
        configPath,
      ],
      { cwd: ROOT, env, stdio: 'ignore', timeout: 30 * 60 * 1000 }
    );
    if (put.error || put.status !== 0)
      throw commandError('private R2 archive upload');

    const downloadPath = join(stageDir, 'r2-verify.sql');
    const get = spawnSync(
      process.execPath,
      [
        WRANGLER,
        'r2',
        'object',
        'get',
        `${target.bucket}/${r2Key}`,
        '--file',
        downloadPath,
        '--remote',
        '--config',
        configPath,
      ],
      { cwd: ROOT, env, stdio: 'ignore', timeout: 30 * 60 * 1000 }
    );
    if (get.error || get.status !== 0 || (await sha256(downloadPath)) !== hash)
      throw commandError('R2 archive read-back verification');
    await rm(downloadPath, { force: true });
    manifest.r2UploadStatus = 'verified';
    await writeFile(
      join(stageDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { mode: 0o600 }
    );
    await rm(join(stageDir, 'wrangler.log'), { force: true });
    await chmod(stageDir, 0o700);
    await rename(stageDir, finalDir);
    exported = true;
    console.log(
      JSON.stringify({
        success: true,
        localArchive: join(finalDir, 'database.partial.sql'),
        manifest: join(finalDir, 'manifest.json'),
        r2Object: `${target.bucket}/${r2Key}`,
        sizeBytes: exportInfo.size,
        sha256: hash,
        restoredTables: Object.keys(counts).length,
        totalRecords: Object.values(counts).reduce(
          (sum, value) => sum + value,
          0
        ),
      })
    );
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (!exported) {
      if (localVerified && localOnlyDirName) {
        const manifestPath = join(stageDir, 'manifest.json');
        const incompleteManifest = JSON.parse(
          await readFile(manifestPath, 'utf8')
        );
        incompleteManifest.r2UploadStatus = 'unverified';
        await writeFile(
          manifestPath,
          JSON.stringify(incompleteManifest, null, 2) + '\n',
          { mode: 0o600 }
        );
        await rm(join(stageDir, 'r2-verify.sql'), { force: true });
        await rm(join(stageDir, 'wrangler.log'), { force: true });
        await rename(stageDir, join(archiveDir, localOnlyDirName));
        console.error(
          `[d1-export-archive] Local restore-verified archive retained at ${join(archiveDir, localOnlyDirName)}; R2 upload was not verified.`
        );
      } else {
        await rm(stageDir, { recursive: true, force: true });
      }
    }
  }
}

async function readLocalVerification(databaseName, configPath, env, persistTo) {
  const counts = {};
  for (const table of BACKUP_TABLES) {
    const output = await queryJson(
      databaseName,
      configPath,
      env,
      `SELECT COUNT(*) AS count FROM "${table}";`,
      persistTo
    );
    const row = extractRows(output, 'count')[0];
    if (row) counts[table] = Number(row.count);
  }
  if (
    BACKUP_TABLES.some(
      (table) => !Number.isSafeInteger(counts[table]) || counts[table] < 0
    ) ||
    Object.keys(counts).length !== BACKUP_TABLES.length
  )
    throw new Error('Restored table-count verification was incomplete.');
  const fkOutput = await queryJson(
    databaseName,
    configPath,
    env,
    'PRAGMA foreign_key_check;',
    persistTo
  );
  if (extractRows(fkOutput, 'table').length > 0)
    throw new Error('Restored local D1 foreign_key_check found violations.');
  const quickOutput = await queryJson(
    databaseName,
    configPath,
    env,
    'PRAGMA quick_check;',
    persistTo
  );
  const quick = JSON.stringify(quickOutput).toLowerCase();
  if (!quick.includes('ok'))
    throw new Error('Restored local D1 quick_check did not return ok.');
  return counts;
}

async function runLocalDrill(args) {
  const rows = Number(args.rows ?? 30_000);
  if (!Number.isInteger(rows) || rows <= 25_600 || rows > 100_000)
    throw new Error(
      '--rows must be between 25,601 and 100,000 to exercise the former page boundary.'
    );
  const tempRoot = await mkdtemp(join(tmpdir(), 'tossa-d1-export-drill-'));
  await chmod(tempRoot, 0o700);
  const env = readOnlyEnv(join(tempRoot, 'wrangler.log'));
  const configPath = join(tempRoot, 'local.wrangler.toml');
  const sourceName = `export-drill-source-${randomUUID().slice(0, 8)}`;
  const destinationName = `export-drill-destination-${randomUUID().slice(0, 8)}`;
  const sourceId = randomUUID();
  const destinationId = randomUUID();
  // Local d1 export has no --persist-to flag; Wrangler resolves its state next
  // to the config file, so execute/seed/export all use this exact path.
  const statePath = join(tempRoot, '.wrangler', 'state');
  await buildConfig(configPath, {
    name: 'tossa-local-d1-export-drill',
    accountId: '00000000000000000000000000000000',
    databaseName: sourceName,
    databaseId: sourceId,
  });
  const configText = [
    `name = "tossa-local-d1-export-drill"`,
    `account_id = "00000000000000000000000000000000"`,
    '',
    '[[d1_databases]]',
    'binding = "DB_SOURCE"',
    `database_name = ${JSON.stringify(sourceName)}`,
    `database_id = ${JSON.stringify(sourceId)}`,
    'remote = false',
    '',
    '[[d1_databases]]',
    'binding = "DB_DEST"',
    `database_name = ${JSON.stringify(destinationName)}`,
    `database_id = ${JSON.stringify(destinationId)}`,
    'remote = false',
    '',
  ].join('\n');
  await writeFile(configPath, configText, { flag: 'w', mode: 0o600 });
  const signalController = new AbortController();
  const stop = () => signalController.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const schemaPath = join(ROOT, 'schema.sql');
    const schemaResult = spawnSync(
      process.execPath,
      [
        WRANGLER,
        'd1',
        'execute',
        sourceName,
        '--local',
        '--yes',
        '--config',
        configPath,
        '--persist-to',
        statePath,
        '--file',
        schemaPath,
      ],
      {
        cwd: ROOT,
        env,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      }
    );
    if (schemaResult.error || schemaResult.status !== 0)
      throw new Error(
        'Local source schema setup failed: ' +
          (
            schemaResult.stderr ||
            schemaResult.stdout ||
            schemaResult.error?.message ||
            ''
          ).slice(-1500)
      );

    const fixturePath = join(tempRoot, 'fixture.sql');
    await writeFile(
      fixturePath,
      `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i < ${rows})
       INSERT INTO posts (id, category_id, title, area, current_status, status_label, note, tags, created_at, updated_at)
       SELECT printf('export_drill_%06d', i), 'general', 'Synthetic export row ' || i,
              'Local drill', 'available', 'Open', 'small fixed-size row', '["test"]',
              datetime('now', '-' || i || ' seconds'), datetime('now', '-' || i || ' seconds')
       FROM n;`,
      { flag: 'wx', mode: 0o600 }
    );
    const seed = spawnSync(
      process.execPath,
      [
        WRANGLER,
        'd1',
        'execute',
        sourceName,
        '--local',
        '--yes',
        '--config',
        configPath,
        '--persist-to',
        statePath,
        '--file',
        fixturePath,
      ],
      {
        cwd: ROOT,
        env,
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        maxBuffer: 2 * 1024 * 1024,
      }
    );
    if (seed.error || seed.status !== 0)
      throw commandError('local synthetic data seed');

    const linkedFixturePath = join(tempRoot, 'linked-fixture.sql');
    await writeFile(
      linkedFixturePath,
      "INSERT INTO users (id, username, display_name, role) VALUES ('drill-user', 'drill-user', 'Drill User', 'user');\nINSERT INTO device_sessions (id) VALUES ('drill-device');\nUPDATE posts SET author_id = 'drill-user', author_cookie_id = 'drill-device' WHERE id = 'export_drill_000001';\n",
      { flag: 'wx', mode: 0o600 }
    );
    const linkedSeed = spawnSync(
      process.execPath,
      [
        WRANGLER,
        'd1',
        'execute',
        sourceName,
        '--local',
        '--yes',
        '--config',
        configPath,
        '--persist-to',
        statePath,
        '--file',
        linkedFixturePath,
      ],
      { cwd: ROOT, env, stdio: 'ignore', timeout: 120_000 }
    );
    if (linkedSeed.error || linkedSeed.status !== 0)
      throw commandError('local linked synthetic data seed');

    const inventoryOutput = await queryJson(
      sourceName,
      configPath,
      env,
      tableListSql(),
      statePath
    );
    verifyTableInventory(
      extractRows(inventoryOutput, 'name').map((row) => row.name)
    );
    const archive = join(tempRoot, 'export.sql');
    const exportArgs = [
      WRANGLER,
      'd1',
      'export',
      sourceName,
      '--local',
      '--output',
      archive,
      '--config',
      configPath,
    ];
    for (const table of BACKUP_TABLES) exportArgs.push('--table', table);
    const exported = spawnSync(process.execPath, exportArgs, {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (exported.error || exported.status !== 0)
      throw commandError('local Wrangler D1 export');
    await chmod(archive, 0o600);
    const archiveInfo = await stat(archive);
    const restorePath = join(tempRoot, 'restore.sql');
    await writeFile(
      restorePath,
      reorderD1Dump(await readFile(archive, 'utf8')),
      {
        flag: 'wx',
        mode: 0o600,
      }
    );

    const restore = spawnSync(
      process.execPath,
      [
        WRANGLER,
        'd1',
        'execute',
        destinationName,
        '--local',
        '--yes',
        '--config',
        configPath,
        '--persist-to',
        statePath,
        '--file',
        restorePath,
      ],
      { cwd: ROOT, env, stdio: 'ignore', timeout: 10 * 60 * 1000 }
    );
    if (restore.error || restore.status !== 0)
      throw new Error(
        'Local D1 export restore failed: ' +
          (restore.error?.message ||
            'Wrangler returned a non-zero exit status.')
      );
    const counts = await readLocalVerification(
      destinationName,
      configPath,
      env,
      statePath
    );
    const linkedCountOutput = await queryJson(
      destinationName,
      configPath,
      env,
      "SELECT COUNT(*) AS count FROM posts WHERE author_id = 'drill-user';",
      statePath
    );
    const postsWithAuthor = Number(
      extractRows(linkedCountOutput, 'count')[0]?.count
    );
    if (counts.posts !== rows)
      throw new Error(
        `Restored posts count ${counts.posts} did not match fixture count ${rows}.`
      );
    if (
      counts.users !== 1 ||
      counts.device_sessions !== 1 ||
      postsWithAuthor !== 1
    )
      throw new Error(
        'Restored linked user/device-session fixture did not match expected counts.'
      );
    if (
      Object.values(counts).reduce((sum, value) => sum + value, 0) !==
      rows + 2
    )
      throw new Error(
        'Restored total application table count differed from known fixture contents.'
      );

    const report = {
      success: true,
      environment: 'isolated local Wrangler D1 / Miniflare SQLite only',
      productionDataAccessed: false,
      includedTables: BACKUP_TABLES,
      excludedRuntimeTables: [
        'tossa_backup_control',
        'tossa_alert_control',
        'tossa_backup_snapshot_*',
      ],
      fixtureRows: rows,
      linkedForeignKeyFixture: {
        users: counts.users,
        deviceSessions: counts.device_sessions,
        postsWithAuthor,
      },
      pagesAt128Rows: Math.ceil(rows / 128),
      exceedsFormer200PageCeiling: Math.ceil(rows / 128) > 200,
      exportSizeBytes: archiveInfo.size,
      tableCounts: counts,
      totalRecords: Object.values(counts).reduce(
        (sum, value) => sum + value,
        0
      ),
      foreignKeyCheck: 'ok',
      quickCheck: 'ok',
      sha256: await sha256(archive),
    };
    console.log(JSON.stringify(report));
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) return help();
  if (args['local-drill'] === true) return await runLocalDrill(args);
  if (args['remote-export'] === true) return await runRemoteExport(args);
  throw new Error('Select exactly one of --local-drill or --remote-export.');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      `[d1-export-archive] ${error instanceof Error ? error.message : 'Failed.'}`
    );
    process.exitCode = 1;
  });
}
