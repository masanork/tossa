import { test, expect } from '@playwright/test';
import { createServer, request } from 'node:http';
import { readFileSync } from 'node:fs';

test('failed update keeps the old shell; successful update preserves a legacy outbox and replays once', async ({
  context,
  page,
}) => {
  test.setTimeout(60000);
  const builtWorker = readFileSync('web/dist/sw.js', 'utf8');
  expect(builtWorker).toMatch(/tossa-shell-[a-f0-9]{20}/);
  const manifestPath = builtWorker.match(
    /['"](\/offline-assets-[a-f0-9]{20}\.json)['"]/
  )?.[1];
  expect(manifestPath).toBeTruthy();
  // The deployed legacy worker cannot answer the IndexedDB capability check.
  const legacyWorker = builtWorker.replace(
    /\/\/ Migration is unsafe[\s\S]*?(?=\/\/ Install:)/,
    ''
  );
  expect(legacyWorker).not.toContain('OUTBOX_STORAGE_CHECK');
  let version: 'old' | 'broken' | 'broken-type' | 'new' = 'old';
  let disconnected = false;
  const server = createServer((incoming, outgoing) => {
    if (disconnected) {
      incoming.socket.destroy();
      return;
    }
    if (incoming.url === '/sw.js') {
      outgoing.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Cache-Control': 'no-store',
      });
      outgoing.end(
        (version === 'old' ? legacyWorker : builtWorker).replace(
          /tossa-shell-[a-f0-9]{20}/,
          `tossa-shell-test-${version}`
        )
      );
      return;
    }
    if (incoming.url === manifestPath && version === 'broken') {
      outgoing.writeHead(503);
      outgoing.end();
      return;
    }
    if (
      version === 'broken-type' &&
      incoming.url?.startsWith('/assets/') &&
      incoming.url.endsWith('.js')
    ) {
      // A stale manifest can request a missing JS chunk which the SPA asset
      // handler answers with index.html and HTTP 200. Installation must fail.
      outgoing.writeHead(200, { 'Content-Type': 'text/html' });
      outgoing.end('<!doctype html><title>SPA fallback</title>');
      return;
    }
    if (incoming.url === manifestPath && version === 'new') {
      const assets = JSON.parse(
        readFileSync('web/dist/offline-assets.json', 'utf8')
      );
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify([...assets, '/assets/upgrade-chunk.js']));
      return;
    }
    if (incoming.url === '/assets/upgrade-chunk.js') {
      outgoing.writeHead(200, { 'Content-Type': 'text/javascript' });
      outgoing.end('export const version = "prepared-update";');
      return;
    }
    const upstream = request(
      {
        hostname: 'localhost',
        port: 8787,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode || 502, response.headers);
        response.pipe(outgoing);
      }
    );
    upstream.on('error', () => outgoing.destroy());
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No proxy address');
  const origin = `http://localhost:${address.port}`;
  const title = `PWA upgrade ${crypto.randomUUID()}`;
  const queue = [
    {
      id: crypto.randomUUID(),
      type: 'create_post',
      data: { title },
      createdAt: new Date().toISOString(),
    },
  ];
  async function migratedQueue(target: typeof page) {
    return target.evaluate(async () => {
      const name = 'tossa-offline-outbox';
      if (!(await indexedDB.databases()).some((db) => db.name === name))
        return [];
      return new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('items', 'readonly');
          const items = tx.objectStore('items').getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(items.result);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    });
  }
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    })
  );
  try {
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await page.evaluate(
      (queue) =>
        localStorage.setItem('tossa_offline_outbox', JSON.stringify(queue)),
      queue
    );
    // Cache owned by another app must survive activation.
    await page.evaluate(async () => {
      await (
        await caches.open('another-app')
      ).put('/sentinel', new Response('keep'));
    });
    version = 'broken';
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('No registration');
      const failed = new Promise<string>((resolve) =>
        registration.addEventListener(
          'updatefound',
          () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'redundant') resolve(worker.state);
            });
          },
          { once: true }
        )
      );
      await registration.update();
      return failed;
    });
    expect(state).toBe('redundant');
    version = 'broken-type';
    const badTypeState = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('No registration');
      const failed = new Promise<string>((resolve) =>
        registration.addEventListener(
          'updatefound',
          () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'redundant') resolve(worker.state);
            });
          },
          { once: true }
        )
      );
      await registration.update();
      return failed;
    });
    expect(badTypeState).toBe('redundant');
    disconnected = true;
    server.closeAllConnections();
    await page.reload();
    await expect(page.locator('header')).toBeVisible();
    await expect(
      page.getByText('端末保存を更新するため', { exact: false })
    ).toBeVisible({ timeout: 10000 });
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('tossa_offline_outbox') || '[]')
      )
    ).toEqual(queue);
    disconnected = false;
    version = 'new';
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await navigator.serviceWorker.getRegistration())?.waiting?.state
        )
      )
      .toBe('installed');
    expect(await page.evaluate(() => caches.has('tossa-shell-test-old'))).toBe(
      true
    );
    disconnected = true;
    server.closeAllConnections();
    expect(
      await page.evaluate(async () => {
        const path = '/assets/upgrade-chunk.js';
        return (await import(path)).version;
      })
    ).toBe('prepared-update');
    disconnected = false;
    await page.close();
    const upgraded = await context.newPage();
    await upgraded.goto(origin);
    await expect
      .poll(() => upgraded.evaluate(() => caches.has('tossa-shell-test-old')))
      .toBe(false);
    disconnected = true;
    server.closeAllConnections();
    await upgraded.reload();
    await expect(upgraded.locator('header')).toBeVisible();
    await upgraded.locator('header button:has-text("＋")').click();
    await expect(upgraded.locator('#post-title')).toBeVisible();
    await expect.poll(() => migratedQueue(upgraded)).toEqual(queue);
    expect(
      await upgraded.evaluate(() =>
        localStorage.getItem('tossa_offline_outbox')
      )
    ).toBeNull();
    expect(await upgraded.evaluate(() => caches.has('another-app'))).toBe(true);
    disconnected = false;
    await upgraded.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
      });
      window.dispatchEvent(new Event('online'));
    });
    await expect
      .poll(async () => (await migratedQueue(upgraded)).length)
      .toBe(0);
    const posts = await upgraded.evaluate(
      async (title) =>
        (
          await (
            await fetch(`/api/posts?q=${encodeURIComponent(title)}`)
          ).json()
        ).posts,
      title
    );
    expect(posts).toHaveLength(1);
    await upgraded.evaluate(() => window.dispatchEvent(new Event('online')));
    expect(
      await upgraded.evaluate(
        async (title) =>
          (
            await (
              await fetch(`/api/posts?q=${encodeURIComponent(title)}`)
            ).json()
          ).posts.length,
        title
      )
    ).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
