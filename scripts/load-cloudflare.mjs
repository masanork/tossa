// Provisions only fresh, isolated resources; synthetic HTTP load; deletes only this run's resources.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !/^[a-f0-9]{32}$/.test(account) || !token)
  throw new Error(
    'Cloudflare account and API token environment variables are required'
  );
const args = {};
for (const arg of process.argv.slice(2)) {
  const match = /^--(posts|requests|concurrency|output)=(.+)$/.exec(arg);
  if (!match || args[match[1]])
    throw new Error(
      'Use --posts=5000 --requests=120 --concurrency=4,12,24 --output=path.json'
    );
  args[match[1]] = match[2];
}
const posts = Number(args.posts || 5000);
const requests = Number(args.requests || 120);
const levels = (args.concurrency || '4,12,24').split(',').map(Number);
if (
  !Number.isInteger(posts) ||
  posts < 100 ||
  posts > 50000 ||
  !Number.isInteger(requests) ||
  requests < 20 ||
  requests > 1000 ||
  levels.length > 4 ||
  !levels.length ||
  levels.some((n) => !Number.isInteger(n) || n < 1 || n > 50)
)
  throw new Error('Invalid load bounds');
const state = await mkdtemp(join(tmpdir(), 'tossa-cloud-load-'));
const name =
  'tossa-load-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const config = join(state, 'wrangler.json');
const cli = join(root, 'node_modules/wrangler/bin/wrangler.js');
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: join(state, 'logs'),
};
const loadToken = crypto.randomUUID() + crypto.randomUUID();
const resources = [];
let base;
let deployed = false;
let report;
let cleanupFailed = false;
const abort = new AbortController();
const stop = () => abort.abort(new Error('Interrupted'));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const secrets = [token, loadToken];
const redact = (value) =>
  secrets.reduce(
    (text, secret) => text.replaceAll(secret, '[redacted]'),
    String(value)
  );
async function cf(path, method = 'GET', body, cleanup = false) {
  const response = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' + account + path,
    {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: cleanup
        ? AbortSignal.timeout(30000)
        : AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
    }
  );
  const parsed = await response.json();
  if (!response.ok || parsed.success !== true)
    throw new Error(
      'Cloudflare ' +
        method +
        ' ' +
        path +
        ' failed HTTP ' +
        response.status +
        ' codes=' +
        (parsed.errors || []).map((e) => e.code).join(',')
    );
  return parsed.result;
}
async function wrangler(args, timeout = 180000) {
  console.log('Cloud load phase: ' + args.slice(0, 2).join(' '));
  abort.signal.throwIfAborted();
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: state,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (data) => {
      output = (output + data).slice(-50000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeout);
    const cancel = () => child.kill('SIGTERM');
    abort.signal.addEventListener('abort', cancel, { once: true });
    child.once('error', (error) => {
      clearTimeout(timer);
      abort.signal.removeEventListener('abort', cancel);
      fail(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      abort.signal.removeEventListener('abort', cancel);
      if (code !== 0)
        fail(new Error('Wrangler failed: ' + redact(output).slice(-4000)));
      else ok(output);
    });
  });
}
async function loadFetch(path, options = {}) {
  return fetch(base + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + loadToken, ...options.headers },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
  });
}
async function stateOf() {
  const response = await loadFetch('/__load/state');
  if (!response.ok)
    throw new Error('Isolated state check failed HTTP ' + response.status);
  const value = await response.json();
  if (value.marker !== name) throw new Error('Isolated marker mismatch');
  return value;
}
async function metrics(id) {
  const result = await cf('/queues/' + id + '/metrics');
  const count = result.backlog_count;
  const timestamp = Number(result.oldest_message_timestamp_ms);
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0)
    throw new Error('Invalid Queue metrics');
  return {
    backlogCount: count,
    backlogBytes: result.backlog_bytes,
    oldestAgeSeconds:
      count === 0
        ? 0
        : timestamp > 0 && timestamp <= Date.now()
          ? Math.round((Date.now() - timestamp) / 1000)
          : null,
  };
}
async function detachConsumers(resource) {
  const consumers = await cf(
    resource.path + '/consumers',
    'GET',
    undefined,
    true
  );
  if (!Array.isArray(consumers)) throw new Error('Unexpected consumer list');
  for (const consumer of consumers) {
    if (
      consumer.script !== name ||
      !/^[a-f0-9]{32}$/.test(consumer.consumer_id)
    )
      throw new Error('Unexpected consumer on isolated Queue');
    await cf(
      resource.path + '/consumers/' + consumer.consumer_id,
      'DELETE',
      undefined,
      true
    );
  }
}
const percentile = (times, p) =>
  Math.round(
    times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)] * 100
  ) / 100;
async function measure(concurrency, step, seed) {
  const timings = [];
  const statuses = {};
  const sources = {};
  const accepted = [];
  let next = 0,
    errors = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < requests) {
        const index = next++;
        const start = performance.now();
        const kind =
          index % 10 < 2
            ? 'write'
            : index % 10 < 6
              ? 'public'
              : index % 10 < 8
                ? 'search'
                : 'nearest';
        try {
          let response;
          if (kind === 'write') {
            const id = 'load_' + name + '_' + step + '_' + index;
            response = await loadFetch('/api/posts', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Cookie:
                  'tossa_device=' + crypto.randomUUID().replaceAll('-', ''),
              },
              body: JSON.stringify({
                title: 'Synthetic cloud load ' + index,
                area: 'Load area',
                requestId: id,
              }),
            });
            const body = await response.json();
            if (!response.ok || !body.success || !body.buffered || !body.id)
              errors++;
            else accepted.push({ id: body.id, acceptedAt: performance.now() });
          } else {
            const path =
              kind === 'public'
                ? '/api/posts?limit=50'
                : kind === 'search'
                  ? '/api/posts?limit=50&q=shelter&_t=' + step + '-' + index
                  : '/api/posts?limit=50&lat=32.75&lng=130.65&_t=' +
                    step +
                    '-' +
                    index;
            response = await loadFetch(path);
            const body = await response.json();
            if (
              !response.ok ||
              !body.success ||
              !Array.isArray(body.posts) ||
              body.posts.length > 50 ||
              body.posts.some((p) => 'author_cookie_id' in p)
            )
              errors++;
            const source = response.headers.get('X-Feed-Source') || 'unknown';
            sources[source] = (sources[source] || 0) + 1;
          }
          statuses[response.status] = (statuses[response.status] || 0) + 1;
        } catch {
          errors++;
        }
        timings.push(performance.now() - start);
      }
    })
  );
  timings.sort((a, b) => a - b);
  const requestMs = performance.now() - started;
  const deadline = Date.now() + 90000;
  let observed;
  while (true) {
    observed = await stateOf();
    if (observed.counts.writes === seed + accepted.length) break;
    if (Date.now() > deadline)
      throw new Error('Accepted writes did not drain within 90s');
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  // Verify every accepted operation is present, not just a matching aggregate.
  for (const item of accepted) {
    const response = await loadFetch(
      '/api/posts/' + encodeURIComponent(item.id)
    );
    const value = await response.json();
    if (!response.ok || value.post?.id !== item.id) errors++;
  }
  const completedAt = performance.now();
  const visibility = accepted
    .map((item) => completedAt - item.acceptedAt)
    .sort((a, b) => a - b);
  return {
    concurrency,
    requests,
    errors,
    statuses,
    sources,
    acceptedWrites: accepted.length,
    persistedWrites: observed.counts.writes - seed,
    p50Ms: percentile(timings, 0.5),
    p95Ms: percentile(timings, 0.95),
    p99Ms: percentile(timings, 0.99),
    requestDurationMs: Math.round(requestMs),
    allWritesVisibleWithinMs: Math.round(visibility.at(-1) || 0),
    note: 'Visibility is an upper bound from end-of-batch polling; it is not individual queue lag or consumer throughput.',
  };
}
try {
  // Query authenticated account before creating any resource.
  const accountInfo = await cf('');
  if (accountInfo.id !== account) throw new Error('Account mismatch');
  const db = await cf('/d1/database', 'POST', {
    name,
    primary_location_hint: 'apac',
  });
  if (db.name !== name || !db.uuid)
    throw new Error('Unexpected isolated D1 creation result');
  resources.push({ kind: 'd1', path: '/d1/database/' + db.uuid, id: db.uuid });
  const kv = await cf('/storage/kv/namespaces', 'POST', { title: name });
  if (kv.title !== name || !kv.id)
    throw new Error('Unexpected isolated KV creation result');
  resources.push({
    kind: 'kv',
    path: '/storage/kv/namespaces/' + kv.id,
    id: kv.id,
  });
  const dlq = await cf('/queues', 'POST', { queue_name: name + '-dlq' });
  if (dlq.queue_name !== name + '-dlq' || !/^[a-f0-9]{32}$/.test(dlq.queue_id))
    throw new Error('Unexpected isolated DLQ result');
  resources.push({
    kind: 'queue',
    path: '/queues/' + dlq.queue_id,
    id: dlq.queue_id,
  });
  const queue = await cf('/queues', 'POST', { queue_name: name + '-write' });
  if (
    queue.queue_name !== name + '-write' ||
    !/^[a-f0-9]{32}$/.test(queue.queue_id)
  )
    throw new Error('Unexpected isolated Queue result');
  resources.push({
    kind: 'queue',
    path: '/queues/' + queue.queue_id,
    id: queue.queue_id,
  });
  if (!queue.queue_id || !dlq.queue_id)
    throw new Error('Isolated queue creation failed');
  await writeFile(
    config,
    JSON.stringify(
      {
        name,
        account_id: account,
        main: join(root, 'scripts/load-cloudflare-worker.ts'),
        compatibility_date: '2025-02-04',
        compatibility_flags: ['nodejs_compat'],
        workers_dev: true,
        preview_urls: false,
        vars: {
          RP_NAME: 'Synthetic load',
          RP_ID: 'localhost',
          EXPECTED_ORIGIN: 'http://localhost',
          LOAD_MARKER: name,
          LOAD_EXPIRES_AT: String(Date.now() + 1800000),
        },
        d1_databases: [
          { binding: 'DB', database_name: name, database_id: db.uuid },
        ],
        kv_namespaces: [{ binding: 'FEED_KV', id: kv.id }],
        ratelimits: [
          'POST_CREATE_LIMITER',
          'POST_UPDATE_LIMITER',
          'THREAD_CREATE_LIMITER',
          'THREAD_UPDATE_LIMITER',
          'AUTH_LIMITER',
          'FEDERATION_LIMITER',
          'MCP_LIMITER',
          'WRITE_IP_LIMITER',
          'OTHER_WRITE_LIMITER',
        ].map((binding, index) => ({
          name: binding,
          namespace_id: String(
            1000000000 + parseInt(name.slice(-6), 16) * 8 + index
          ),
          simple: {
            limit: [30, 45, 30, 45, 20, 10, 120, 6000, 60][index],
            period: 60,
          },
        })),
        queues: {
          producers: [{ binding: 'WRITE_QUEUE', queue: name + '-write' }],
          consumers: [
            {
              queue: name + '-write',
              max_batch_size: 50,
              max_batch_timeout: 5,
              max_concurrency: 1,
              max_retries: 5,
              dead_letter_queue: name + '-dlq',
            },
          ],
        },
        observability: {
          enabled: true,
          head_sampling_rate: 0.1,
          traces: { enabled: true, head_sampling_rate: 0.01 },
        },
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  await wrangler([
    'd1',
    'execute',
    name,
    '--remote',
    '--yes',
    '--config',
    config,
    '--file',
    join(root, 'schema.sql'),
  ]);
  const fixture = join(state, 'fixture.sql');
  await writeFile(
    fixture,
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${posts})
    INSERT INTO posts(id,title,area,lat,lng,current_status,status_label,tags,updated_at)
    SELECT printf('fixture_%06d',i),'Local shelter ' || i,'Load area',32.7+(i%100)*.001,130.6+(i%150)*.001,'available','Open','["water"]',datetime('now','-' || i || ' seconds') FROM n;`,
    { mode: 0o600 }
  );
  await wrangler([
    'd1',
    'execute',
    name,
    '--remote',
    '--yes',
    '--config',
    config,
    '--file',
    fixture,
  ]);
  deployed = true; // Cleanup also runs when deploy only partially succeeds.
  const output = await wrangler(['deploy', '--config', config]);
  base = output.match(
    new RegExp('https://' + name + '\\.[a-z0-9-]+\\.workers\\.dev')
  )?.[0];
  if (!base)
    throw new Error('Expected isolated workers.dev deployment URL missing');
  const secretFile = join(state, 'secrets.json');
  await writeFile(
    secretFile,
    JSON.stringify({
      LOAD_TOKEN: loadToken,
      JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    }),
    { mode: 0o600 }
  );
  await wrangler(['secret', 'bulk', secretFile, '--config', config]);
  console.log('Cloud load phase: protected HTTP checks');
  const noAuth = await fetch(base + '/api/health', {
    signal: AbortSignal.timeout(15000),
  });
  if (noAuth.status !== 401) throw new Error('Load worker is not protected');
  const refresh = await loadFetch('/__load/refresh', { method: 'POST' });
  if (!refresh.ok) throw new Error('Isolated refresh request failed');
  const readyDeadline = Date.now() + 90000;
  while (true) {
    const value = await stateOf();
    if (value.counts.total === posts && value.snapshot?.total === posts) break;
    if (Date.now() > readyDeadline)
      throw new Error('Initial snapshot did not publish');
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  report = {
    measuredAt: new Date().toISOString(),
    status: 'running',
    environment:
      'Isolated Cloudflare Workers + D1(apac) + KV + write Queue; synthetic data; one load-generator region',
    posts,
    mixture: {
      publicReadPercent: 40,
      filteredReadPercent: 40,
      writePercent: 20,
    },
    limitations:
      'No push delivery, backup, global multi-region traffic or guaranteed production capacity; headers represent cached response origin.',
    profiles: [],
    cleanup: [],
  };
  let priorWrites = 0;
  for (let step = 0; step < levels.length; step++) {
    const item = await measure(levels[step], step, priorWrites);
    priorWrites += item.acceptedWrites;
    item.queueAfterDrain = await metrics(queue.queue_id);
    item.deadletterAfterDrain = await metrics(dlq.queue_id);
    report.profiles.push(item);
    console.log(JSON.stringify(item));
    if (item.errors || item.deadletterAfterDrain.backlogCount)
      throw new Error('Cloud mixed load failed');
  }
  report.status = 'succeeded';
} catch (error) {
  if (report) {
    report.status = 'failed';
    report.failure = redact(error.message);
  }
  throw error;
} finally {
  for (const resource of resources.filter((r) => r.kind === 'queue')) {
    try {
      await detachConsumers(resource);
    } catch (error) {
      console.error(redact(error.message));
      process.exitCode = 1;
      cleanupFailed = true;
    }
  }
  if (deployed) {
    try {
      await cf('/workers/scripts/' + name, 'DELETE', undefined, true);
      if (report) report.cleanup.push('worker');
    } catch (error) {
      console.error(redact(error.message));
      process.exitCode = 1;
      cleanupFailed = true;
    }
  }
  for (const resource of [...resources].reverse()) {
    try {
      await cf(resource.path, 'DELETE', undefined, true);
      if (report) report.cleanup.push(resource.kind);
    } catch (error) {
      console.error(redact(error.message));
      process.exitCode = 1;
      cleanupFailed = true;
    }
  }
  if (report && cleanupFailed) report.status = 'failed-cleanup';
  if (report && args.output) {
    const target = resolve(args.output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(report, null, 2) + '\n');
  }
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  if (cleanupFailed) {
    await writeFile(
      join(state, 'cleanup.json'),
      JSON.stringify(
        { account, worker: deployed ? name : null, resources },
        null,
        2
      ),
      { mode: 0o600 }
    );
    console.error(
      'Cleanup incomplete; protected resource manifest retained: ' +
        join(state, 'cleanup.json')
    );
  } else await rm(state, { recursive: true, force: true });
}
