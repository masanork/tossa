import { test as base, expect, type Page } from '@playwright/test';
import { createServer, request as proxyRequest } from 'node:http';

// WebKit setOffline blocks service-worker navigation even for literal responses:
// https://github.com/microsoft/playwright/issues/42775
// Disconnect a real origin proxy instead, so cache handling still runs in WebKit.
const test = base.extend<{
  network: { origin: string; setOffline(value: boolean): Promise<void> };
}>({
  network: async ({ page, context, browserName }, use) => {
    if (browserName !== 'webkit') {
      await use({
        origin: '/',
        setOffline: (value) => context.setOffline(value),
      });
      return;
    }
    let disconnected = false;
    const server = createServer((incoming, outgoing) => {
      if (disconnected) {
        incoming.socket.destroy();
        return;
      }
      const upstream = proxyRequest(
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
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Proxy did not start');
    try {
      await use({
        origin: `http://localhost:${address.port}/`,
        setOffline: async (value) => {
          disconnected = value;
          server.closeAllConnections();
          await page.addInitScript(
            (value) =>
              Object.defineProperty(navigator, 'onLine', {
                configurable: true,
                get: () => !value,
              }),
            value
          );
          await page.evaluate((value) => {
            Object.defineProperty(navigator, 'onLine', {
              configurable: true,
              get: () => !value,
            });
            window.dispatchEvent(new Event(value ? 'offline' : 'online'));
          }, value);
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

async function waitForOfflineShell(page: Page, origin = '/') {
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => resolve(),
          { once: true }
        );
      });
  });
  await expect(page.locator('header')).toBeVisible();
}

test('offline cold reload can open uncached dialogs and keeps a post until reconnection', async ({
  page,
  network,
}) => {
  await waitForOfflineShell(page, network.origin);
  await network.setOffline(true);
  await page.reload();
  await expect(page.locator('header')).toBeVisible();
  await page.locator('header button:has-text("＋")').click();
  await expect(page.locator('#post-title')).toBeVisible();
  const title = `Offline replay ${crypto.randomUUID()}`;
  await page.fill('#post-title', title);
  await page.locator('form button[type="submit"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('tossa_offline_outbox') || '[]')
            .length
      )
    )
    .toBe(1);
  await network.setOffline(false);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('tossa_offline_outbox') || '[]')
              .length
        ),
      { timeout: 15000 }
    )
    .toBe(0);
  await expect(
    page.locator('article').filter({ hasText: title })
  ).toBeVisible();
  const posts = await page.evaluate(
    async (title) =>
      (await (await fetch(`/api/posts?q=${encodeURIComponent(title)}`)).json())
        .posts,
    title
  );
  expect(posts).toHaveLength(1);
});

test('storage exhaustion leaves the draft open with an explicit error', async ({
  page,
  network,
}) => {
  await waitForOfflineShell(page, network.origin);
  await network.setOffline(true);
  await page.locator('header button:has-text("＋")').click();
  await page.fill('#post-title', 'Do not lose this draft');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tossa_offline_outbox')
        throw new DOMException('Storage is full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('#post-title')).toHaveValue(
    'Do not lose this draft'
  );
  await expect(
    page.getByText('端末に保存できませんでした。', { exact: false })
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('tossa_offline_outbox'))
  ).toBeNull();
});

test('private API responses are absent from the offline cache', async ({
  page,
}) => {
  await waitForOfflineShell(page);
  await page.evaluate(async () => {
    await fetch('/api/posts?mine=true');
    await fetch('/api/auth/status');
    await fetch('/api/posts', {
      headers: { Authorization: 'Bearer invalid-token' },
    });
  });
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('tossa-api-v2');
    return (await cache.keys()).map((request) => request.url);
  });
  expect(
    cached.some((url) => url.includes('mine=true') || url.includes('/auth/'))
  ).toBe(false);
});

test('native Passkey registration and login, with cross-account registration blocked', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Virtual authenticators are supported through Chromium CDP; physical Safari authentication remains a field check.'
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto('/');
  const username = `passkey-${crypto.randomUUID()}`;
  const registered = await page.evaluate(async (username) => {
    const decode = (value: string) =>
      Uint8Array.from(
        atob(value.replace(/-/g, '+').replace(/_/g, '/')),
        (character) => character.charCodeAt(0)
      );
    const options = await (
      await fetch('/api/auth/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
    ).json();
    const credential = (await navigator.credentials.create({
      publicKey: {
        ...options.options,
        challenge: decode(options.options.challenge),
        user: { ...options.options.user, id: decode(options.options.user.id) },
        excludeCredentials: options.options.excludeCredentials.map(
          (item: { id: string }) => ({ ...item, id: decode(item.id) })
        ),
      },
    })) as PublicKeyCredential;
    const result = await (
      await fetch('/api/auth/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, response: credential.toJSON() }),
      })
    ).json();
    if (!result.success) throw new Error(result.error);
    return result;
  }, username);
  expect(registered.success).toBe(true);
  const loggedIn = await page.evaluate(async (username) => {
    const decode = (value: string) =>
      Uint8Array.from(
        atob(value.replace(/-/g, '+').replace(/_/g, '/')),
        (character) => character.charCodeAt(0)
      );
    const options = await (
      await fetch('/api/auth/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
    ).json();
    const credential = (await navigator.credentials.get({
      publicKey: {
        ...options.options,
        challenge: decode(options.options.challenge),
        allowCredentials: options.options.allowCredentials?.map(
          (item: { id: string }) => ({ ...item, id: decode(item.id) })
        ),
      },
    })) as PublicKeyCredential;
    return await (
      await fetch('/api/auth/verify-authentication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential.toJSON(), username }),
      })
    ).json();
  }, username);
  expect(loggedIn.success).toBe(true);
  await context.clearCookies();
  const rejected = await page.evaluate(
    async (username) =>
      (
        await fetch('/api/auth/register-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        })
      ).status,
    username
  );
  expect(rejected).toBe(403);
});
