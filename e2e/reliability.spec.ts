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
  await waitForOutbox(page);
}

// Opening a nonexistent database in a fixture would create version 1 before
// the app's upgrade handler, leaving it without stores. Wait for the app's
// committed migration marker without creating a database ourselves.
async function waitForOutbox(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const name = 'tossa-offline-outbox';
        if (!(await indexedDB.databases()).some((db) => db.name === name))
          return false;
        return new Promise<boolean>((resolve) => {
          const request = indexedDB.open(name);
          request.onerror = () => resolve(false);
          request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('meta')) {
              db.close();
              resolve(false);
              return;
            }
            const tx = db.transaction('meta', 'readonly');
            const marker = tx.objectStore('meta').get('legacy-migration');
            tx.oncomplete = () => {
              db.close();
              resolve(!!marker.result);
            };
            tx.onabort = () => {
              db.close();
              resolve(false);
            };
          };
        });
      })
    )
    .toBe(true);
}

async function readOutbox(page: Page): Promise<any[]> {
  await waitForOutbox(page);
  return page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const request = indexedDB.open('tossa-offline-outbox', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('items', 'readonly');
          const read = transaction.objectStore('items').getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve(read.result);
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
        };
      })
  );
}

async function writeOutbox(page: Page, items: unknown[]): Promise<void> {
  await waitForOutbox(page);
  await page.evaluate(
    (entries) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('tossa-offline-outbox', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('items', 'readwrite');
          const store = transaction.objectStore('items');
          store.clear();
          for (const item of entries) store.put(item);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
    items
  );
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
    .poll(() => readOutbox(page).then((items) => items.length))
    .toBe(1);
  await network.setOffline(false);
  await expect
    .poll(() => readOutbox(page).then((items) => items.length), {
      timeout: 15000,
    })
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
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...keys) {
      if (this.name === 'items')
        throw new DOMException('Storage is full', 'QuotaExceededError');
      return original.call(this, value, ...keys);
    };
  });
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('#post-title')).toHaveValue(
    'Do not lose this draft'
  );
  await expect(
    page.getByText('保存容量が不足しています。', { exact: false })
  ).toBeVisible();
  expect(await readOutbox(page)).toHaveLength(0);
});

test('two tabs retain offline additions and receive outbox changes', async ({
  page,
  context,
  network,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
  );
  const second = await context.newPage();
  let releaseRequest: (() => Promise<void>) | undefined;
  try {
    await second.addInitScript(() =>
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      })
    );
    await Promise.all([
      waitForOfflineShell(page, network.origin),
      waitForOfflineShell(second, network.origin),
    ]);
    await network.setOffline(true);
    await second.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });

    const titleA = `Two tab A ${crypto.randomUUID()}`;
    const titleB = `Two tab B ${crypto.randomUUID()}`;
    await page.locator('header button:has-text("＋")').click();
    await second.locator('header button:has-text("＋")').click();
    await page.fill('#post-title', titleA);
    await second.fill('#post-title', titleB);
    await Promise.all([
      page.locator('form button[type="submit"]').click(),
      second.locator('form button[type="submit"]').click(),
    ]);
    // The IDB commit can be observed before the submit handler closes its
    // dialog. Finish both submissions before opening another draft.
    await Promise.all([
      expect(page.locator('#post-title')).toBeHidden(),
      expect(second.locator('#post-title')).toBeHidden(),
    ]);
    await expect
      .poll(() => readOutbox(page).then((items) => items.length))
      .toBe(2);
    await expect(second.getByText('未送信: 2件')).toBeVisible();

    for (const tab of [page, second])
      await tab.evaluate(() => {
        const state = window as Window & {
          __tossaReplayHeld?: boolean;
          __tossaReplayRelease?: () => void;
        };
        const originalFetch = window.fetch.bind(window);
        state.__tossaReplayHeld = false;
        window.fetch = async (input, init) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          const method =
            init?.method || (input instanceof Request ? input.method : 'GET');
          if (
            url.includes('/api/posts') &&
            method === 'POST' &&
            !state.__tossaReplayHeld
          ) {
            state.__tossaReplayHeld = true;
            await new Promise<void>((resolve) => {
              state.__tossaReplayRelease = resolve;
            });
          }
          return originalFetch(input, init);
        };
      });
    releaseRequest = async () => {
      await Promise.all(
        [page, second].map((tab) =>
          tab.evaluate(() => {
            const state = window as Window & {
              __tossaReplayRelease?: () => void;
            };
            state.__tossaReplayRelease?.();
          })
        )
      );
    };
    await network.setOffline(false);
    await expect
      .poll(async () =>
        (
          await Promise.all(
            [page, second].map((tab) =>
              tab.evaluate(
                () =>
                  (window as Window & { __tossaReplayHeld?: boolean })
                    .__tossaReplayHeld === true
              )
            )
          )
        ).some(Boolean)
      )
      .toBe(true);

    await second.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });
    const titleC = `Two tab during replay ${crypto.randomUUID()}`;
    await second.locator('header button:has-text("＋")').click();
    await second.fill('#post-title', titleC);
    await second.locator('form button[type="submit"]').click();
    await expect(second.locator('#post-title')).toBeHidden();
    await expect
      .poll(() =>
        readOutbox(page).then((items) =>
          items.map((item) => item.data.title).sort()
        )
      )
      .toEqual([titleA, titleB, titleC].sort());
    await releaseRequest();
    await expect
      .poll(() => readOutbox(page).then((items) => items.length))
      .toBeLessThanOrEqual(1);
    const sendButton = page.getByRole('button', { name: '今すぐ送信' });
    if ((await readOutbox(page)).length > 0) {
      await expect(sendButton).toBeEnabled();
      if (await sendButton.isVisible()) await sendButton.click();
    }
    await expect
      .poll(() => readOutbox(page).then((items) => items.length))
      .toBe(0);
    const counts = await page.evaluate(
      async (titles) => {
        return Promise.all(
          titles.map(async (title) => {
            const data = await fetch(
              `/api/posts?q=${encodeURIComponent(title)}`
            ).then((response) => response.json());
            return data.posts.length;
          })
        );
      },
      [titleA, titleB, titleC]
    );
    expect(counts).toEqual([1, 1, 1]);
  } finally {
    await releaseRequest?.().catch(() => {});
    await second.close();
  }
});

test('corrupt outbox can be exported and explicitly repaired with valid entries', async ({
  page,
}) => {
  await page.goto('/');
  const raw = JSON.stringify([
    {
      id: 'recover-e2e',
      type: 'create_post',
      createdAt: new Date().toISOString(),
      data: {
        title: 'recoverable',
        area: '',
        currentStatus: 'available',
        statusLabel: '受付中',
      },
    },
    { id: 'broken-e2e', type: 'create_post', data: null },
  ]);
  await writeOutbox(page, JSON.parse(raw));
  await page.reload();
  await expect(page.getByText(/未送信データを読み取れません/)).toBeVisible();
  await expect(page.getByText('端末保存の状態')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存データを書き出す' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^tossa-offline-outbox-.*\.json$/
  );

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '書き出しを確認して復旧' }).click();
  await expect(
    page.getByText(
      /既存の1件を保持し、新たに0件を復旧、1件を退避ファイルに残しました/
    )
  ).toBeVisible();
  expect(await readOutbox(page)).toMatchObject([{ id: 'recover-e2e' }]);
});

test('conflicting status report can be reviewed against the latest post and replaced', async ({
  page,
}) => {
  await page.goto('/');
  const postId = await page.evaluate(async () => {
    const result = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        title: `Conflict review ${crypto.randomUUID()}`,
        area: 'E2E',
        currentStatus: 'available',
        statusLabel: '受付中',
      }),
    }).then((response) => response.json());
    return result.id as string;
  });
  expect(postId).toBeTruthy();
  const old = {
    id: 'old-conflict-report',
    type: 'update_status',
    createdAt: new Date().toISOString(),
    data: {
      postId,
      status: 'closed',
      statusLabel: '終了',
      note: '保留中の古い内容',
      expectedUpdatedAt: 'stale-version',
      observedAt: new Date().toISOString(),
    },
    lastError: '更新競合',
    conflict: true,
  };
  await writeOutbox(page, [old]);
  await page.reload();
  await page.getByRole('button', { name: '内訳' }).click();
  await expect(
    page.getByRole('button', { name: '最新を確認して再入力' })
  ).toBeVisible();
  await page.getByRole('button', { name: '最新を確認して再入力' }).click();
  await expect(page.getByText(/保留中の報告: 終了 \(closed\)/)).toBeVisible();
  await expect(
    page.getByText(/下の選択肢には最新の状態が反映されています/)
  ).toBeVisible();
  await page.getByRole('button', { name: /混雑中/ }).click();
  await page.locator('#update-note').fill('現地で確認した新しい内容');
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('#update-note')).not.toBeVisible();
  await expect
    .poll(() => readOutbox(page).then((items) => items.length))
    .toBe(0);
  const detail = await page.evaluate(
    async (id) => fetch(`/api/posts/${id}`).then((response) => response.json()),
    postId
  );
  expect(detail.post.current_status).toBe('crowded');
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
