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
