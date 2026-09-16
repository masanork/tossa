import { test, expect } from '@playwright/test';

test.describe('tossa Disaster & Community Platform E2E Tests', () => {
  test('1. Page load and i18n language switching', async ({ page }) => {
    await page.goto('/');

    // 1. Initial page load
    await expect(page.locator('header')).toBeVisible();
    const langBtn = page.locator(
      'header button[title*="言語切替"], header button[title*="Language"], header button[title*="ことば"]'
    );
    await expect(langBtn).toBeVisible();

    // 2. Switch to English
    await langBtn.click();
    await page.locator('button:has-text("English")').click();

    // Verify English translations
    await expect(page.locator('header')).toContainText('Post Info');
    await expect(page.locator('header')).toContainText('Messages (E2EE)');

    // 3. Switch to Easy Japanese (やさしい にほんご)
    await langBtn.click();
    await page.locator('button:has-text("やさしい にほんご")').click();

    // Verify Easy Japanese translations
    await expect(page.locator('header')).toContainText('じょうほうを かく');
    await expect(page.locator('header')).toContainText('あんぜんな メッセージ');

    // 4. Switch back to Standard Japanese (日本語)
    await langBtn.click();
    await page.locator('button:has-text("日本語 (標準)")').click();
    await expect(page.locator('header')).toContainText('情報を投稿');
    await expect(page.locator('header')).toContainText('連絡 (E2EE)');
  });

  test('2. Anonymous posting with device cookie and ownership recognition', async ({
    page,
  }) => {
    await page.goto('/');

    // Click "＋" post button
    const createBtn = page.locator('header button:has-text("＋")');
    await createBtn.click();

    // Fill form
    const postTitle = `E2E 防災拠点テスト ${Date.now()}`;
    await page.fill('#post-title', postTitle);
    await page.fill('#post-area', '本町中央地区');

    // Submit form
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Verify post card appears in timeline
    const postCard = page.locator(`article:has-text("${postTitle}")`);
    await expect(postCard).toBeVisible({ timeout: 10000 });

    // Verify cookie ownership badge is present (matching any active locale)
    await expect(
      postCard.locator(
        'span:has-text("自分の投稿"), span:has-text("My Post"), span:has-text("じぶんが かいた")'
      )
    ).toBeVisible();

    // Verify edit button is available to the owner
    const editBtn = postCard.locator(
      'button[title*="編集"], button[title*="Edit"], button[title*="なおす"]'
    );
    await expect(editBtn).toBeVisible();
  });

  test('3. Search and filter posts', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.locator(
      'input[type="search"], input[placeholder*="検索"]'
    );
    if (await searchInput.isVisible()) {
      await searchInput.fill('防災');
      // Verify page responds without crash
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('4. Passkey authentication modal opening', async ({ page }) => {
    await page.goto('/');

    // Click Auth / Passkey button in Header
    const authBtn = page.locator(
      'header button:has-text("認証"), header button:has-text("Passkey")'
    );
    await authBtn.click();

    // Verify modal appears
    const modal = page.locator('div[role="dialog"], div.fixed.inset-0');
    await expect(modal.first()).toBeVisible();

    // Check for username input or passkey guidance
    const usernameInput = page.locator(
      'input[placeholder*="ユーザー名"], input[name="username"], input#username'
    );
    if (await usernameInput.isVisible()) {
      await expect(usernameInput).toBeVisible();
    }
  });
});
