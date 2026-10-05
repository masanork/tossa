import { createHash } from 'node:crypto';

const origin = process.env.SMOKE_BASE_URL || 'https://tossa.app';

async function get(path) {
  const url = new URL(path, origin);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}`);
  }
  return response;
}

async function checkProduction() {
  const html = await (await get('/')).text();
  if (!html.includes('id="app"')) {
    throw new Error('Home page is missing the app mount point');
  }

  const scriptPath = html.match(
    /<script[^>]+src="(\/assets\/[^" ]+\.js)"/
  )?.[1];
  if (!scriptPath) {
    throw new Error('Home page is missing the frontend script');
  }
  await get(scriptPath);

  const health = await (await get('/api/health')).json();
  if (health.status !== 'ok' || health.app !== 'tossa') {
    throw new Error('Health endpoint returned an unexpected response');
  }

  const posts = await (await get('/api/posts?limit=1')).json();
  if (posts.success !== true || !Array.isArray(posts.posts)) {
    throw new Error('Posts endpoint returned an unexpected response');
  }
  if (posts.posts.some((post) => 'author_cookie_id' in post)) {
    throw new Error('Public posts expose device ownership keys');
  }
  const worker = await (await get('/sw.js')).text();
  if (!/tossa-shell-[a-f0-9]{20}/.test(worker))
    throw new Error(
      'Service Worker is missing its build-specific shell version'
    );
  const manifestPath = worker.match(
    /['"](\/offline-assets-[a-f0-9]{20}\.json)['"]/
  )?.[1];
  if (!manifestPath)
    throw new Error('Service Worker is missing its versioned asset manifest');
  const manifest = await (await get(manifestPath)).text();
  const manifestHash = createHash('sha256')
    .update(manifest)
    .digest('hex')
    .slice(0, 20);
  if (manifestPath !== `/offline-assets-${manifestHash}.json`)
    throw new Error('Offline asset manifest does not match its versioned URL');
  const offlineAssets = JSON.parse(manifest);
  if (
    !Array.isArray(offlineAssets) ||
    !offlineAssets.length ||
    offlineAssets.some(
      (path) => typeof path !== 'string' || !path.startsWith('/assets/')
    )
  ) {
    throw new Error('Offline asset manifest is missing or invalid');
  }
  if (!offlineAssets.includes(scriptPath))
    throw new Error('Offline manifest does not include the current frontend');
  await Promise.all(
    offlineAssets.map(async (path) => {
      const response = await get(path);
      const type = (response.headers.get('Content-Type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      const allowedTypes = {
        js: ['text/javascript', 'application/javascript'],
        css: ['text/css'],
        woff: ['font/woff', 'application/font-woff', 'application/x-font-woff'],
        woff2: [
          'font/woff2',
          'application/font-woff2',
          'application/x-font-woff2',
        ],
      };
      const extension = path.match(/\.([^.]+)$/)?.[1];
      if (!allowedTypes[extension]?.includes(type))
        throw new Error(
          `Offline asset has an unexpected content type: ${path}`
        );
    })
  );
  const blocked = await fetch(
    new URL('/api/images/backups%2Ftossa_backup_test.json', origin),
    { signal: AbortSignal.timeout(15_000) }
  );
  if (blocked.status !== 404)
    throw new Error('Image API does not block backup keys');

  const preview = await fetch(
    new URL('/api/settings/statistics/preview', origin),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (
    preview.status !== 401 ||
    preview.headers.get('Cache-Control') !== 'private, no-store' ||
    preview.headers.has('Set-Cookie')
  )
    throw new Error('Statistics preview is not read-only and auth protected');
}

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await checkProduction();
    console.log(`Production smoke check passed: ${origin}`);
    break;
  } catch (error) {
    console.error(`Production smoke check ${attempt}/5 failed:`, error);
    if (attempt === 5) {
      process.exitCode = 1;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}
