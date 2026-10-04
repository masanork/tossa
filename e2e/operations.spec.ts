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
      expect(
        (
          await page.request.get('/api/settings/backups', {
            headers: { Authorization: `Bearer ${session}` },
          })
        ).status()
      ).toBe(403);
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
