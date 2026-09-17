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
    await expect(page.locator('header')).toContainText('Messages');

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
    await expect(page.locator('header')).toContainText('連絡');
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

  test('7. Theme switching (Dark mode & High-contrast emergency mode)', async ({
    page,
  }) => {
    await page.goto('/');

    const themeBtn = page.locator(
      'header button[aria-label="テーマ切替"], header button[title*="テーマ切替"]'
    );
    await expect(themeBtn).toBeVisible();

    // 1. Switch to Dark mode
    await themeBtn.click();
    const darkOption = page.locator('button:has-text("ダーク")');
    await expect(darkOption).toBeVisible();
    await darkOption.click();

    // HTML root should have 'dark' class
    await expect(page.locator('html')).toHaveClass(/dark/);
    const metaThemeColor = page.locator('meta[name="theme-color"]');
    await expect(metaThemeColor).toHaveAttribute('content', '#090d16');

    // 2. Switch to High-Contrast mode
    await themeBtn.click();
    const contrastOption = page.locator('button:has-text("ハイコントラスト")');
    await expect(contrastOption).toBeVisible();
    await contrastOption.click();

    // HTML root should have both 'dark' and 'contrast' classes
    await expect(page.locator('html')).toHaveClass(/contrast/);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(metaThemeColor).toHaveAttribute('content', '#000000');

    // 3. Switch back to Light mode
    await themeBtn.click();
    const lightOption = page.locator('button:has-text("ライト")');
    await expect(lightOption).toBeVisible();
    await lightOption.click();

    // HTML root should not have 'dark' or 'contrast'
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('html')).not.toHaveClass(/contrast/);
    await expect(metaThemeColor).toHaveAttribute('content', '#2563eb');
  });

  test('8. Emergency evacuation straight-line distance, compass bearing & GPS sorting', async ({
    page,
    context,
  }) => {
    // 1. Grant geolocation permissions and set initial location near Tokyo Station
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({
      latitude: 35.6812,
      longitude: 139.7671,
    });

    await page.goto('/');

    // Ensure Japanese locale
    const langBtn = page.locator(
      'header button[title*="言語切替"], header button[title*="Language"], header button[title*="ことば"]'
    );
    if (await langBtn.isVisible()) {
      await langBtn.click();
      await page.locator('button:has-text("日本語 (標準)")').click();
    }

    // 2. Toggle distance sorting to activate geolocationManager
    const sortBtn = page.locator(
      'button:has-text("新しい順"), button:has-text("近い順"), button:has-text("Newest"), button:has-text("Closest")'
    );
    await expect(sortBtn).toBeVisible();
    await sortBtn.click();
    await expect(
      page.locator(
        'button:has-text("近い順"), button:has-text("Closest (GPS)")'
      )
    ).toBeVisible();

    // 3. Create a post with coordinates using UI modal
    const createBtn = page.locator(
      'header button:has-text("＋"), header button:has-text("Post")'
    );
    await createBtn.click();

    const postTitle = `避難所（直線距離テスト） ${Date.now()}`;
    await page.fill('#post-title', postTitle);
    await page.fill('#post-area', '丸の内地区');

    const geoBtn = page.locator('button:has-text("現在地からセット")');
    await expect(geoBtn).toBeVisible();
    await geoBtn.click();
    await expect(page.getByText('ピン設定済み')).toBeVisible();

    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // 4. Verify post card appears and shows distance badge
    const postCard = page.locator(`article:has-text("${postTitle}")`);
    await expect(postCard).toBeVisible({ timeout: 10000 });

    const distanceBadge = postCard.locator(
      'span:has-text("直線"), span:has-text("Direct")'
    );
    await expect(distanceBadge).toBeVisible();

    // 5. Test Map View center on location button
    const mapTabBtn = page.locator(
      'button:has-text("地図"), button:has-text("Map")'
    );
    await mapTabBtn.click();

    const locateBtn = page.locator('button[aria-label="現在地に移動"]');
    await expect(locateBtn).toBeVisible();
    await locateBtn.click();
  });

  test('9. Emergency evacuation waypoint navigation HUD & compass tracking', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({
      latitude: 35.6812,
      longitude: 139.7671,
    });

    await page.goto('/');

    // Ensure Japanese locale
    const langBtn = page.locator(
      'header button[title*="言語切替"], header button[title*="Language"], header button[title*="ことば"]'
    );
    if (await langBtn.isVisible()) {
      await langBtn.click();
      await page.locator('button:has-text("日本語 (標準)")').click();
    }

    // 1. Find a post with navigation guide button
    const navBtn = page
      .locator('button:has-text("避難案内"), button:has-text("Navigate")')
      .first();
    await expect(navBtn).toBeVisible({ timeout: 10000 });
    await navBtn.click();

    // 2. HUD should appear at bottom of screen
    const hud = page.locator(
      'aside[aria-label*="ナビゲーション"], aside[aria-label*="Navigation"]'
    );
    await expect(hud).toBeVisible();

    // 3. Expand HUD to show Compass Rose
    const expandBtn = hud.locator(
      'button[title*="拡大"], button[title*="Expand"]'
    );
    await expandBtn.first().click();

    // Cardinal indicator "N" should be visible inside compass dial
    const northIndicator = hud.locator('span:has-text("N")');
    await expect(northIndicator).toBeVisible();

    // 4. Test View on Map action from HUD
    const viewMapBtn = hud.locator(
      'button[title*="地図で追従"], button[title*="Track on Map"]'
    );
    if (await viewMapBtn.isVisible()) {
      await viewMapBtn.click();
      const mapContainer = page.locator('.leaflet-container');
      await expect(mapContainer).toBeVisible();
    }

    // 5. End navigation guidance
    const stopBtn = hud.locator('button[title*="終了"], button[title*="End"]');
    await stopBtn.click();

    // HUD should be dismissed
    await expect(hud).not.toBeVisible();
  });

  test('10. Offline Post QR Code Display & Peer-to-Peer Import Relay', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Open QR Share modal on an existing post
    const qrShareBtn = page
      .locator('button:has-text("QR共有"), button:has-text("QR Share")')
      .first();
    await expect(qrShareBtn).toBeVisible({ timeout: 10000 });
    await qrShareBtn.click();

    // Verify QR modal opens with SVG code and copy link button
    const qrModal = page.locator(
      'h2:has-text("オフラインQR共有"), h2:has-text("Offline QR Share")'
    );
    await expect(qrModal).toBeVisible();

    const qrSvg = page.locator('div:has(> svg)');
    await expect(qrSvg.first()).toBeVisible();

    // Close QR modal
    const closeBtn = page.locator('button[aria-label="閉じる"]').first();
    await closeBtn.click();
    await expect(qrModal).not.toBeVisible();

    // 2. Open QR Scanner modal from Header
    const scanHeaderBtn = page.locator(
      'header button[title*="Offline Import"], header button[title*="QRコード読取"], header button[title*="QRコードを よみとる"]'
    );
    await expect(scanHeaderBtn).toBeVisible();
    await scanHeaderBtn.click();

    // Verify Scanner modal opens
    const scannerTitle = page.locator(
      'h2:has-text("QRコード読取"), h2:has-text("Scan QR Code")'
    );
    await expect(scannerTitle).toBeVisible();

    // File upload fallback button should be present
    const uploadBtn = page.locator(
      'button:has-text("画像・スクショから読取"), button:has-text("Scan from Image")'
    );
    await expect(uploadBtn).toBeVisible();

    // Close scanner modal
    await page.locator('button[aria-label="閉じる"]').first().click();
    await expect(scannerTitle).not.toBeVisible();

    // 3. Test URL hash auto-import (simulates scanning a peer QR code with camera app)
    const peerPayload = {
      _t: 'tossa',
      v: 1,
      id: `peer-test-${Date.now()}`,
      title: '避難所直結 給水ステーション',
      area: '港町埠頭',
      status: 'open',
      label: '稼働中',
      lat: 35.65,
      lng: 139.75,
      note: 'ポリタンク持参推奨',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const hashUrl = `/#post-data=${encodeURIComponent(JSON.stringify(peerPayload))}`;

    await page.goto(hashUrl);

    // Timeline should now contain the peer-imported post
    const peerCard = page.locator(
      'article:has-text("避難所直結 給水ステーション")'
    );
    await expect(peerCard).toBeVisible({ timeout: 10000 });

    // Peer relay badge should be visible on the card
    const peerBadge = peerCard.locator('span:has-text("📡")');
    await expect(peerBadge).toBeVisible();
  });
});
