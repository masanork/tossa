import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Only the isolated E2E database contains these actors. Exercise the real
// authorization and UI with its local-only signing key; Passkey is tested separately.
function token(role: 'admin' | 'moderator') {
  const payload = Buffer.from(
    JSON.stringify({
      userId: `e2e-${role}`,
      username: `e2e-${role}`,
      role,
      issuedAt: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    })
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', 'tossa-e2e-only-not-a-production-secret').update(payload).digest('base64url')}`;
}

async function createOperationPost(
  page: import('@playwright/test').Page,
  title: string
) {
  const response = await page.request.post('/api/posts', {
    data: { title, requestId: crypto.randomUUID() },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string }>;
}

for (const role of ['admin', 'moderator'] as const) {
  test(`${role} reviews and resolves a report; backups remain admin-only`, async ({
    page,
  }) => {
    const title = `Operations ${role} ${crypto.randomUUID()}`;
    const created = await page.request.post('/api/posts', {
      data: { title, requestId: crypto.randomUUID() },
    });
    expect(created.status()).toBe(201);
    const post = await created.json();
    const reported = await page.request.post(`/api/posts/${post.id}/report`, {
      data: { reason: 'incorrect', note: 'E2E review note' },
    });
    expect(reported.status()).toBe(201);
    const session = token(role);
    await page.addInitScript(
      (session) => localStorage.setItem('tossa_token', session),
      session
    );
    await page.goto('/');
    await page
      .getByRole('button', {
        name: role === 'admin' ? 'E2E Admin' : 'E2E Moderator',
        exact: true,
      })
      .click();
    if (role === 'admin')
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^(情報の問題を報告|Report a problem)$/ })
        .click();
    const report = page
      .getByRole('region', { name: '通報の確認と対応' })
      .locator('article')
      .filter({ hasText: title });
    await expect(report).toBeVisible();
    await report.getByRole('button', { name: '対応結果を記録' }).click();
    await report
      .getByRole('textbox')
      .fill('E2E: reviewed in isolated test environment');
    await report.getByRole('button', { name: '対応済みにする' }).click();
    await expect(report).toHaveCount(0);
    if (role === 'moderator') {
      await expect(
        page.getByRole('button', { name: 'バックアップ', exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'データ合流', exact: true })
      ).toHaveCount(0);
      expect(
        (
          await page.request.get('/api/settings/backups', {
            headers: { Authorization: `Bearer ${session}` },
          })
        ).status()
      ).toBe(403);
      expect(
        (
          await page.request.post('/api/settings/statistics/preview', {
            headers: { Authorization: `Bearer ${session}` },
            data: { feed: {}, mappings: [] },
          })
        ).status()
      ).toBe(403);
      expect(
        (
          await page.request.post('/api/settings/statistics/preview', {
            data: { feed: {}, mappings: [] },
          })
        ).status()
      ).toBe(401);
    } else {
      await page
        .getByRole('button', { name: 'バックアップ', exact: true })
        .click();
      await page
        .getByRole('button', { name: '今すぐバックアップ実行' })
        .click();
      await expect(
        page.getByText('D1データベースのバックアップが完了しました', {
          exact: false,
        })
      ).toBeVisible();
      await expect(
        page.getByRole('status', { name: 'バックアップ保存実績' })
      ).toContainText('最新の保存日時');
      await expect(page.getByText('処理時間:', { exact: false })).toBeVisible();
      const downloadEvent = page.waitForEvent('download');
      await page
        .getByRole('button', { name: /をダウンロード$/ })
        .first()
        .click();
      const download = await downloadEvent;
      const path = await download.path();
      expect(path).toBeTruthy();
      const archive = JSON.parse(readFileSync(path!, 'utf8'));
      expect(archive.metadata.version).toBe(2);
      expect(Object.keys(archive.data)).toHaveLength(17);
      expect(
        archive.data.posts.some((row: { title: string }) => row.title === title)
      ).toBe(true);
    }
  });
}

test('admin previews public tsudoi statistics without saving them', async ({
  page,
}) => {
  const title = `Statistics preview target ${crypto.randomUUID()}`;
  const post = await createOperationPost(page, title);
  const beforePreviewResponse = await page.request.get(`/api/posts/${post.id}`);
  expect(beforePreviewResponse.status()).toBe(200);
  const beforePostBytes = await beforePreviewResponse.body();
  const beforePost = (await beforePreviewResponse.json()).post;
  const session = token('admin');
  await page.addInitScript(
    (value) => localStorage.setItem('tossa_token', value),
    session
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'E2E Admin', exact: true }).click();
  await page.getByRole('button', { name: 'データ合流', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'つどい統計データのプレビュー' })
  ).toBeVisible();
  await expect(
    page.getByText('このプレビューは保存されず、現地の投稿も変更しません。', {
      exact: false,
    })
  ).toBeVisible();
  await page.getByRole('button', { name: 'サンプルJSONを読み込む' }).click();
  await page.getByRole('button', { name: '対応付けを追加' }).click();
  await page.getByLabel('対応付け 1 の外部ID').fill('shelter-001');
  await page.getByLabel('対応付け 1 の投稿ID').fill(post.id);
  await page.getByRole('button', { name: '統計プレビューを作成' }).click();
  const preview = page.locator(
    '[aria-labelledby="tsudoi-preview-title"] [aria-live="polite"]'
  );
  await expect(preview).toContainText('43');
  await expect(preview).toContainText('100');
  await expect(preview).toContainText('現在滞在人数');
  await expect(preview).toContainText('定員');
  await expect(preview).toContainText('集計値');
  await expect(preview).toContainText('非公開');
  await expect(preview).toContainText('版1');
  await expect(preview).toContainText('未対応対象');
  await expect(preview).toContainText('未対応');
  await expect(preview).toContainText('観測時刻');
  await expect(preview).toContainText('出典を確認');
  const sourceLink = preview.getByRole('link', { name: '出典を確認' }).first();
  await expect(sourceLink).toHaveAttribute('target', '_blank');
  await expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(preview).toContainText('2026');

  const feedText = await page
    .getByRole('textbox', { name: '公開統計JSON' })
    .inputValue();
  const delayedApiResponse = await page.request.post(
    '/api/settings/statistics/preview',
    {
      headers: { Authorization: `Bearer ${session}` },
      data: {
        feed: JSON.parse(feedText),
        mappings: [
          { kind: 'shelter', externalId: 'shelter-001', postId: post.id },
        ],
      },
    }
  );
  expect(delayedApiResponse.status()).toBe(200);
  const delayedResponseBody = await delayedApiResponse.json();
  await page.evaluate((responseBody) => {
    const originalFetch = window.fetch.bind(window);
    const state = window as typeof window & {
      __statsPreviewStarted?: boolean;
      __releaseStatsPreview?: () => void;
    };
    state.__statsPreviewStarted = false;
    window.fetch = async (input, init) => {
      const path = new URL(
        typeof input === 'string' ? input : input.url,
        location.href
      ).pathname;
      if (path === '/api/settings/statistics/preview') {
        state.__statsPreviewStarted = true;
        return await new Promise<Response>((resolve) => {
          state.__releaseStatsPreview = () =>
            resolve(
              new Response(JSON.stringify(responseBody), {
                headers: { 'Content-Type': 'application/json' },
              })
            );
        });
      }
      return originalFetch(input, init);
    };
  }, delayedResponseBody);
  await page.getByRole('button', { name: '統計プレビューを作成' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window as typeof window & {
          __statsPreviewStarted?: boolean;
        };
        return state.__statsPreviewStarted === true;
      })
    )
    .toBe(true);
  await page
    .getByRole('textbox', { name: '公開統計JSON' })
    .fill(`${feedText}\n`);
  await page.evaluate(() => {
    const state = window as typeof window & {
      __releaseStatsPreview?: () => void;
    };
    state.__releaseStatsPreview?.();
  });
  await expect(
    page.locator(
      '[aria-labelledby="tsudoi-preview-title"] [aria-live="polite"]'
    )
  ).toHaveCount(0);

  const afterPreviewResponse = await page.request.get(`/api/posts/${post.id}`);
  expect(afterPreviewResponse.status()).toBe(200);
  const afterPostBytes = await afterPreviewResponse.body();
  const afterPost = (await afterPreviewResponse.json()).post;
  expect(afterPost).toEqual(beforePost);
  expect(afterPost.title).toBe(beforePost.title);
  expect(afterPost.current_status).toBe(beforePost.current_status);
  expect(afterPost.is_verified).toBe(beforePost.is_verified);
  expect(afterPost.attributes).toEqual(beforePost.attributes);
  expect(afterPostBytes.equals(beforePostBytes)).toBe(true);
});

test('backup monitoring distinguishes a delayed archive, failed reload and empty storage', async ({
  page,
}) => {
  const session = token('admin');
  await page.addInitScript(
    (value) => localStorage.setItem('tossa_token', value),
    session
  );
  let response: object = {
    success: true,
    checkedAt: '2026-10-05T05:00:00Z',
    notifications: {
      emailConfigured: false,
      adminEmailRecipients: 0,
      webhookConfigured: false,
    },
    backups: [
      {
        key: 'backups/tossa_backup_2026-10-04T03-00-00-000Z.json',
        uploaded: '2026-10-05T04:59:00Z',
        snapshotAt: '2026-10-04T03:00:00Z',
        size: 1024,
        totalRecords: 10,
      },
    ],
  };
  await page.route('**/api/settings/backups', (route) =>
    route.fulfill({ json: response })
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'E2E Admin', exact: true }).click();
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'バックアップ保存実績' })
  ).toContainText('26時間以上');
  await expect(
    page.getByRole('status', { name: 'バックアップ保存実績' })
  ).toContainText('バックアップ失敗時の通知先が未設定です。');
  response = {
    success: true,
    checkedAt: '2026-10-05T05:00:00Z',
    notifications: {
      emailConfigured: true,
      adminEmailRecipients: 2,
      webhookConfigured: false,
    },
    backups: [],
  };
  await page.getByRole('button', { name: '再読込', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'バックアップ保存実績' })
  ).toContainText('エラー通知先は設定済みです（確認済み管理者メール 2 件');
  response = {
    success: true,
    checkedAt: '2026-10-05T05:00:00Z',
    backups: [
      {
        key: 'backups/tossa_backup_2026-10-04T03-00-00-000Z.json',
        uploaded: '2026-10-05T04:59:00Z',
        snapshotAt: '2026-10-04T03:00:00Z',
        size: 1024,
        totalRecords: 10,
      },
    ],
  };
  await page.getByRole('button', { name: '再読込', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'バックアップ保存実績' })
  ).toContainText('エラー通知先の状態を確認できません。');
  response = { success: false, error: 'Test storage unavailable' };
  await page.getByRole('button', { name: '再読込', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    '保存実績を確認できません'
  );
  await expect(
    page.getByRole('status', { name: 'バックアップ保存実績' })
  ).toHaveCount(0);
  await expect(
    page.getByText('保存されているバックアップはありません', { exact: false })
  ).toHaveCount(0);
  response = { success: true, checkedAt: '2026-10-05T05:00:00Z', backups: [] };
  await page.getByRole('button', { name: '再読込', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'バックアップ保存実績' })
  ).toContainText('保存実績がありません');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
