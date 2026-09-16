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

  test('5. Mobile multi-modal bottom sheet and history back dismissal', async ({
    page,
  }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // Verify PWA manifest is linked
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');

    // Open Create Post modal
    const createBtn = page.locator('header button:has-text("＋")');
    await createBtn.click();

    // Verify Create modal is visible
    const createModal = page.locator('div.fixed.inset-0');
    await expect(createModal.first()).toBeVisible();

    // Click passkey login link inside CreatePostModal to open stacked AdminModal
    const passkeyLink = page.locator(
      'form button:has-text("Passkeyでログイン"), form button:has-text("Passkey Login")'
    );
    await expect(passkeyLink).toBeVisible();
    await passkeyLink.click();

    // Verify AdminModal opened as stacked modal
    const adminModal = page.locator('h2:has-text("Passkey 認証・設定")');
    await expect(adminModal).toBeVisible();

    // Verify CreateModal remains in DOM behind AdminModal
    const createModalTitle = page.locator(
      'h2:has-text("情報を投稿"), h2:has-text("Post Information")'
    );
    await expect(createModalTitle).toBeAttached();

    // Press browser back button -> should dismiss AdminModal and reveal CreateModal
    await page.goBack();
    await expect(adminModal).not.toBeVisible();
    await expect(createModalTitle).toBeVisible();

    // Press browser back button second time -> should dismiss CreateModal
    await page.goBack();
    await expect(createModalTitle).not.toBeVisible();
  });

  test('6. Map view and offline map cache modal', async ({ page }) => {
    await page.goto('/');

    // Switch to Map view
    const mapToggleBtn = page.locator(
      'button:has-text("地図"), button:has-text("Map")'
    );
    await mapToggleBtn.click();

    // Map container should render
    const mapContainer = page.locator('.leaflet-container');
    await expect(mapContainer).toBeVisible({ timeout: 5000 });

    // "地図を保存" button should appear on map
    const saveMapBtn = page.locator(
      'button:has-text("地図を保存"), button:has-text("Save Map")'
    );
    await expect(saveMapBtn).toBeVisible();
    await saveMapBtn.click();

    // OfflineMapModal should open
    const offlineModalTitle = page.locator(
      'h2:has-text("オフライン地図キャッシュ"), h2:has-text("Offline Map Cache")'
    );
    await expect(offlineModalTitle).toBeVisible();

    // Verify area preset button
    const currentAreaOption = page.locator(
      'button:has-text("表示中のエリア"), button:has-text("Current View Area")'
    );
    await expect(currentAreaOption).toBeVisible();

    // Close modal via Escape
    await page.keyboard.press('Escape');
    await expect(offlineModalTitle).not.toBeVisible();
  });
});
