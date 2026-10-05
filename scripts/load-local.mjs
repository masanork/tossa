// Isolated local workerd/SQLite load measurements. Never accepts a remote URL.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (const arg of process.argv.slice(2)) {
  const match = /^--(sizes|requests|concurrency|output)=(.+)$/.exec(arg);
  if (!match || args[match[1]])
    throw new Error(
      'Use --sizes=5000,20000,50000 --requests=120 --concurrency=12 --output=path.json'
    );
  args[match[1]] = match[2];
}
const sizes = (args.sizes || '5000,20000,50000').split(',').map(Number);
const requests = Number(args.requests || 120);
const concurrency = Number(args.concurrency || 12);
if (
  !sizes.length ||
  sizes.length > 5 ||
  sizes.some((n) => !Number.isInteger(n) || n < 100 || n > 100000) ||
  !Number.isInteger(requests) ||
  requests < 1 ||
  requests > 2000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 50
)
  throw new Error('Invalid measurement bounds');
const state = await mkdtemp(join(tmpdir(), 'tossa-load-local-'));
const config = join(state, 'wrangler.toml');
const persist = join(state, 'state');
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(CLOUDFLARE_|CF_)/i.test(key)
  )
);
env.WRANGLER_SEND_METRICS = 'false';
env.WRANGLER_LOG_PATH = join(state, 'wrangler-logs');
const abort = new AbortController();
const stop = () => abort.abort(new Error('Interrupted'));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
let child;
let logs = '';
let base;
function runD1(file) {
  const result = spawnSync(
    process.execPath,
    [
      wrangler,
      'd1',
      'execute',
      'tossa-local-load',
      '--local',
      '--yes',
      '--config',
      config,
      '--persist-to',
      persist,
      '--file',
      file,
    ],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      'Local D1 command failed: ' +
        (result.stderr || result.stdout).slice(-3000)
    );
}
async function localFetch(path) {
  return fetch(base + path, {
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
  });
}
async function availablePort() {
  const server = createServer();
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const port = server.address().port;
  await new Promise((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok()))
  );
  return port;
}
async function measure(name, path, expectedSource) {
  const timings = [];
  const sources = {};
  const statuses = {};
  let errors = 0;
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, requests) }, async () => {
      while (next < requests && !abort.signal.aborted) {
        const index = next++;
        const start = performance.now();
        try {
          const suffix =
            name === 'warm_public' ? '' : '&_t=' + name + '-' + index;
          const response = await localFetch(path + suffix);
          statuses[response.status] = (statuses[response.status] || 0) + 1;
          const source = response.headers.get('X-Feed-Source') || 'unknown';
          sources[source] = (sources[source] || 0) + 1;
          const body = await response.json();
          if (
            !response.ok ||
            !body.success ||
            !Array.isArray(body.posts) ||
            body.posts.length > 100 ||
            !Number.isFinite(body.total) ||
            body.posts.length === 0 ||
            source !== expectedSource
          )
            errors++;
        } catch {
          errors++;
        }
        timings.push(performance.now() - start);
      }
    })
  );
  abort.signal.throwIfAborted();
  timings.sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(
      timings[Math.min(timings.length - 1, Math.ceil(timings.length * p) - 1)] *
        100
    ) / 100;
  const durationMs = performance.now() - started;
  return {
    name,
    requests: timings.length,
    concurrency,
    errors,
    statuses,
    sources,
    durationMs: Math.round(durationMs),
    throughputPerSecond:
      Math.round((timings.length / durationMs) * 1000 * 100) / 100,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: percentile(1),
  };
}
try {
  const port = await availablePort();
  base = 'http://127.0.0.1:' + port;
  const quote = (value) => JSON.stringify(value);
  await writeFile(
    config,
    [
      'name = "tossa-local-load"',
      'main = ' + quote(join(root, 'scripts/load-local-worker.ts')),
      'compatibility_date = "2025-02-04"',
      'compatibility_flags = ["nodejs_compat"]',
      'workers_dev = false',
      '[vars]',
      'RP_NAME = "Local load"',
      'RP_ID = "localhost"',
      'EXPECTED_ORIGIN = ' + quote(base),
      'JWT_SECRET = "synthetic-local-load-secret-not-for-production"',
      'DISABLE_WRITE_BUFFER = "false"',
      '[[d1_databases]]',
      'binding = "DB"',
      'database_name = "tossa-local-load"',
      'database_id = ' + quote(crypto.randomUUID()),
      'remote = false',
      '[[kv_namespaces]]',
      'binding = "FEED_KV"',
      'id = "local-load-only"',
      'remote = false',
      '[[queues.producers]]',
      'binding = "WRITE_QUEUE"',
      'queue = "tossa-local-load-only"',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 }
  );
  runD1(join(root, 'schema.sql'));
  const report = {
    measuredAt: new Date().toISOString(),
    environment:
      'local workerd and SQLite; synthetic data; read-only HTTP load; no write/push workload',
    limitation:
      'These timings are not Cloudflare D1 latency, a production concurrency limit, or a mixed read/write capacity test.',
    node: process.version,
    wrangler: JSON.parse(
      await readFile(join(root, 'node_modules/wrangler/package.json'), 'utf8')
    ).version,
    datasets: [],
  };
  for (const count of sizes) {
    const sql = join(state, 'fixture.sql');
    await writeFile(
      sql,
      `DELETE FROM posts;
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${count})
      INSERT INTO posts (id,title,area,lat,lng,current_status,status_label,note,tags,created_at,updated_at)
      SELECT printf('load_%06d',i), 'Local shelter ' || i, 'Area ' || (i%20), 32.7+(i%100)*0.001, 130.6+(i%150)*0.001,
        'available', 'Open', 'Synthetic local load data', CASE WHEN i%4=0 THEN '["water","shelter"]' ELSE '["shelter"]' END,
        datetime('now','-' || i || ' seconds'), datetime('now','-' || i || ' seconds') FROM n;`
    );
    runD1(sql);
    // Stop before reseeding; each dataset gets fresh cache state and snapshot.
    child = spawn(
      process.execPath,
      [
        wrangler,
        'dev',
        '--local',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--test-scheduled',
        '--config',
        config,
        '--persist-to',
        persist,
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child.stdout.on('data', (data) => {
      logs = (logs + data).slice(-6000);
    });
    child.stderr.on('data', (data) => {
      logs = (logs + data).slice(-6000);
    });
    let spawnError;
    child.on('error', (error) => {
      spawnError = error;
    });
    const deadline = Date.now() + 45000;
    while (true) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || Date.now() > deadline)
        throw new Error('Local worker failed to start: ' + logs);
      try {
        if ((await localFetch('/api/health')).ok) break;
      } catch {
        /* startup */
      }
      abort.signal.throwIfAborted();
      await new Promise((ok) => setTimeout(ok, 200));
    }
    const scheduled = await localFetch(
      '/cdn-cgi/handler/scheduled?cron=' + encodeURIComponent('* * * * *')
    );
    if (!scheduled.ok)
      throw new Error(
        'Local scheduled refresh failed: HTTP ' + scheduled.status
      );
    const warmDeadline = Date.now() + 10000;
    let prime = 0;
    while (true) {
      const response = await localFetch('/api/posts?limit=50&prime=' + prime++);
      const body = await response.json();
      if (
        response.headers.get('X-Feed-Source') === 'kv' &&
        body.total === count
      )
        break;
      if (Date.now() > warmDeadline)
        throw new Error('Local snapshot was not ready: ' + logs);
      await new Promise((ok) => setTimeout(ok, 200));
    }
    const cases = [
      ['warm_public', '/api/posts?limit=50', 'kv'],
      ['cold_d1', '/api/posts?limit=50', 'd1'],
      ['text_search', '/api/posts?limit=50&q=shelter', 'd1'],
      ['tag_filter', '/api/posts?limit=50&tag=water', 'd1'],
      ['bbox', '/api/posts?limit=50&bbox=130.62,32.72,130.70,32.78', 'd1'],
      ['nearest', '/api/posts?limit=50&lat=32.75&lng=130.65', 'd1'],
      ['deep_page', '/api/posts?limit=50&offset=' + (count - 100), 'd1'],
    ];
    const measurements = [];
    for (const [name, path, source] of cases) {
      const result = await measure(name, path, source);
      measurements.push(result);
      console.log(JSON.stringify({ posts: count, ...result }));
    }
    report.datasets.push({ posts: count, measurements });
    await stopWorker();
  }
  if (args.output) {
    const target = resolve(args.output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(report, null, 2) + '\n');
    console.log('Measurement report: ' + target);
  }
  if (
    report.datasets.some((dataset) =>
      dataset.measurements.some((item) => item.errors > 0)
    )
  )
    throw new Error('Measurement detected failed responses');
} finally {
  await stopWorker();
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  await rm(state, { recursive: true, force: true });
}
async function stopWorker() {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode)
    return;
  const current = child;
  await new Promise((ok) => {
    const timeout = setTimeout(() => {
      current.kill('SIGKILL');
      ok();
    }, 5000);
    current.once('exit', () => {
      clearTimeout(timeout);
      ok();
    });
    current.kill('SIGTERM');
  });
  child = undefined;
}
