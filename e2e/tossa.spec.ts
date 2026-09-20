import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openHeaderMenu(page: Page) {
  await page.locator('header [data-header-menu]').click();
  await expect(page.locator('[data-header-menu-panel]')).toBeVisible();
}

async function switchLanguage(page: Page, label: string) {
  await openHeaderMenu(page);
  await page
    .locator(`[data-header-menu-panel] button:has-text("${label}")`)
    .click();
}

test.describe('tossa Disaster & Community Platform E2E Tests', () => {
  test('1. Page load and i18n language switching', async ({ page }) => {
    await page.goto('/');

    // 1. Initial page load
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('header [data-header-menu]')).toBeVisible();

    // 2. Switch to English
    await switchLanguage(page, 'English');

    // Verify English translations
    await expect(page.locator('header')).toContainText('Post Info');
    await expect(page.locator('header')).toContainText('Messages');

    // 3. Switch to Easy Japanese (やさしい にほんご)
    await switchLanguage(page, 'やさしい にほんご');

    // Verify Easy Japanese translations
    await expect(page.locator('header')).toContainText('じょうほうを かく');
    await expect(page.locator('header')).toContainText('あんぜんな メッセージ');

    // 4. Switch back to Standard Japanese (日本語)
    await switchLanguage(page, '日本語 (標準)');
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
      'header button:has-text("Passkey"), header button:has-text("パスキー")'
    );
    await authBtn.click();

    // Verify modal appears
    const modal = page.locator('div[role="dialog"], div.fixed.inset-0');
    await expect(modal.first()).toBeVisible();

    await expect(page.locator('#auth-username')).toBeVisible();
    await expect(
      page.locator('button:has-text("Passkey で認証")')
    ).toBeVisible();
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
      'form button:has-text("Passkey で認証"), form button:has-text("Continue with Passkey")'
    );
    await expect(passkeyLink).toBeVisible();
    await passkeyLink.click();

    // Verify AdminModal opened as stacked modal
    const adminModal = page.locator('h2:has-text("Passkey で認証")');
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

    await openHeaderMenu(page);

    // 1. Switch to Dark mode
    const darkOption = page.locator(
      '[data-header-menu-panel] button:has-text("ダーク")'
    );
    await expect(darkOption).toBeVisible();
    await darkOption.click();

    // HTML root should have 'dark' class
    await expect(page.locator('html')).toHaveClass(/dark/);
    const metaThemeColor = page.locator('meta[name="theme-color"]');
    await expect(metaThemeColor).toHaveAttribute('content', '#090d16');

    // 2. Switch to High-Contrast mode
    await openHeaderMenu(page);
    const contrastOption = page.locator(
      '[data-header-menu-panel] button:has-text("ハイコントラスト")'
    );
    await expect(contrastOption).toBeVisible();
    await contrastOption.click();

    // HTML root should have both 'dark' and 'contrast' classes
    await expect(page.locator('html')).toHaveClass(/contrast/);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(metaThemeColor).toHaveAttribute('content', '#000000');

    // 3. Switch back to Light mode
    await openHeaderMenu(page);
    const lightOption = page.locator(
      '[data-header-menu-panel] button:has-text("ライト")'
    );
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
    await switchLanguage(page, '日本語 (標準)');

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

    await page.locator('button:has-text("場所を付ける")').click();

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
    await switchLanguage(page, '日本語 (標準)');

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
      .locator(
        'button:has-text("QRで渡す"), button:has-text("Pass by QR"), button:has-text("QRで わたす")'
      )
      .first();
    await expect(qrShareBtn).toBeVisible({ timeout: 10000 });
    await qrShareBtn.click();

    // Verify QR modal opens with SVG code and copy link button
    const qrModal = page.locator(
      'h2:has-text("この情報を画面で渡す"), h2:has-text("Pass this post on-screen"), h2:has-text("この じょうほうを がめんで わたす")'
    );
    await expect(qrModal).toBeVisible();

    const qrSvg = page.locator('div:has(> svg)');
    await expect(qrSvg.first()).toBeVisible();

    // Close QR modal
    const closeBtn = page.locator('button[aria-label="閉じる"]').first();
    await closeBtn.click();
    await expect(qrModal).not.toBeVisible();

    // 2. Open QR Scanner modal from Header menu
    await openHeaderMenu(page);
    const scanHeaderBtn = page.locator(
      '[data-header-menu-panel] [data-header-qr-scan]'
    );
    await expect(scanHeaderBtn).toBeVisible();
    await scanHeaderBtn.click();

    // Verify Scanner modal opens
    const scannerTitle = page.locator(
      'h2:has-text("画面から取り込む"), h2:has-text("Import from a screen"), h2:has-text("がめんから とりこむ")'
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

  test('11. Comprehensive Help & User Guide Modal with MCP config', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Open Help Modal via header menu
    await openHeaderMenu(page);
    const helpBtn = page
      .locator(
        '[data-header-menu-panel] button[title*="ヘルプ"], [data-header-menu-panel] button:has-text("Help")'
      )
      .first();
    await expect(helpBtn).toBeVisible();
    await helpBtn.click();

    // 2. Verify Help Modal appears with title
    const helpModalTitle = page.locator(
      'h2:has-text("ご利用ガイド"), h2:has-text("User Guide")'
    );
    await expect(helpModalTitle).toBeVisible();

    // 3. Switch to AI & Developers tab
    const aiTabBtn = page.locator('button:has-text("AI")').first();
    await expect(aiTabBtn).toBeVisible();
    await aiTabBtn.click();

    // 4. Verify MCP config snippet and findability endpoints are visible
    const mcpPre = page.locator('pre:has-text("mcpServers")');
    await expect(mcpPre).toBeVisible();
    await expect(page.locator('a[href="/llms.txt"]')).toBeVisible();
    await expect(page.locator('a[href="/feed.xml"]')).toBeVisible();

    // 5. Close Help Modal
    const closeBtn = page
      .locator(
        'button[data-close-modal], button[aria-label="閉じる"], button[aria-label="Close"], button[aria-label="とじる"]'
      )
      .first();
    await closeBtn.click();
    await expect(helpModalTitle).not.toBeVisible();
  });

  test('12. MyPage, Favorites Bookmark, "Open Only" Quick Filter, and Micro-update Comments', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Post a new item to favorite
    const createBtn = page.locator('header button:has-text("＋")');
    await createBtn.click();

    const testTitle = `マイページ・お気に入りテスト ${Date.now()}`;
    await page.fill('#post-title', testTitle);
    await page.locator('button[type="submit"]').click();

    const postCard = page.locator(`article:has-text("${testTitle}")`);
    await expect(postCard).toBeVisible({ timeout: 10000 });

    // 2. Bookmark / Favorite the post
    const starBtn = postCard.locator(
      'button[aria-label*="お気に入り"], button[aria-label*="Favorite"], button[aria-label*="保存"]'
    );
    await expect(starBtn).toBeVisible();
    await starBtn.click();

    // Verify star is filled (amber color)
    await expect(postCard.locator('svg.fill-amber-400')).toBeVisible();

    // 3. Open MyPage Modal from Header menu
    await openHeaderMenu(page);
    const myPageBtn = page.locator(
      '[data-header-menu-panel] button:has-text("マイページ"), [data-header-menu-panel] button:has-text("My Page")'
    );
    await expect(myPageBtn).toBeVisible();
    await myPageBtn.click();

    const myPageTitle = page.locator('#mypage-modal-title');
    await expect(myPageTitle).toBeVisible();

    // Check tabs: My Posts and Favorites
    const postsTab = page.locator('#tab-my-posts');
    const favsTab = page.locator('#tab-favorites');
    await expect(postsTab).toBeVisible();
    await expect(favsTab).toBeVisible();

    // Verify our post appears in My Posts
    await expect(
      page.locator(`div:has-text("${testTitle}")`).first()
    ).toBeVisible();

    // Switch to Favorites tab
    await favsTab.click();
    await expect(
      page.locator(`div:has-text("${testTitle}")`).first()
    ).toBeVisible();

    // Close MyPage Modal
    await page
      .locator(
        'button[data-close-modal], button[aria-label="閉じる"], button[aria-label="Close"], button[aria-label="とじる"]'
      )
      .first()
      .click();
    await expect(myPageTitle).not.toBeVisible();

    // 4. Test "Open Only" quick filter toggle
    const quickFilterBtn = page.locator(
      'button:has-text("開いている場所だけ"), button:has-text("Open Only"), button:has-text("営業中")'
    );
    await expect(quickFilterBtn).toBeVisible();
    await quickFilterBtn.click();
    await page.waitForTimeout(400);
    // Toggle again to return to all
    await quickFilterBtn.click();
    await page.waitForTimeout(400);

    // 5. Test Micro-update comment timeline
    const activePostCard = page.locator(`article:has-text("${testTitle}")`);
    await expect(activePostCard).toBeVisible();

    const commentBtn = activePostCard.locator(
      'button:has-text("追記する"), button:has-text("Add Update")'
    );
    await expect(commentBtn).toBeVisible();
    await commentBtn.click();

    // Verify micro-update form is visible
    const commentInput = activePostCard.locator(
      'input[placeholder*="事実"], input[placeholder*="factual"]'
    );
    await expect(commentInput).toBeVisible();
    await commentInput.fill('現地確認: 水タンク残り20本。順調に配布中。');
    await activePostCard.locator('button[type="submit"]').click();

    // Verify submitted comment appears in the accordion timeline
    await expect(
      activePostCard.locator(
        'span:has-text("現地確認: 水タンク残り20本。順調に配布中。")'
      )
    ).toBeVisible({ timeout: 5000 });
  });

  test('13. Web Accessibility (JIS X 8341-3 / WCAG 2.1/2.2 AA) compliance', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Skip Link to Main Content (WCAG 2.4.1)
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();
    // Focus skip link via keyboard Tab
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    // Activate skip link
    await page.keyboard.press('Enter');
    const mainContent = page.locator('main#main-content');
    await expect(mainContent).toBeVisible();

    // 2. Dynamic HTML lang attribute synchronization (WCAG 3.1.1 / 3.1.2)
    const html = page.locator('html');
    const initialLang = await html.getAttribute('lang');
    expect(['ja', 'en']).toContain(initialLang);

    await switchLanguage(page, 'English');
    await expect(html).toHaveAttribute('lang', 'en');

    await switchLanguage(page, 'やさしい にほんご');
    await expect(html).toHaveAttribute('lang', 'ja');

    await switchLanguage(page, '日本語 (標準)');
    await expect(html).toHaveAttribute('lang', 'ja');

    // 3. Modal Accessibility: role="dialog", aria-modal="true", and Escape key dismiss
    const createBtn = page.locator('header button:has-text("＋")');
    await createBtn.click();

    const createDialog = page.locator(
      'div[role="dialog"][aria-labelledby="create-post-modal-title"]'
    );
    await expect(createDialog).toBeVisible();
    await expect(createDialog).toHaveAttribute('aria-modal', 'true');

    // Close with Escape key
    await page.keyboard.press('Escape');
    await expect(createDialog).not.toBeVisible();

    // 4. Help Modal: Accessibility Statement tab (JIS X 8341-3 Level AA)
    await openHeaderMenu(page);
    const helpBtn = page
      .locator(
        '[data-header-menu-panel] button[title*="ヘルプ"], [data-header-menu-panel] button:has-text("Help")'
      )
      .first();
    await helpBtn.click();

    const helpDialog = page.locator(
      'div[role="dialog"][aria-labelledby="help-modal-title"]'
    );
    await expect(helpDialog).toBeVisible();

    // Switch to Accessibility tab
    const a11yTab = page.locator('button#tab-help-a11y');
    await expect(a11yTab).toBeVisible();
    await a11yTab.click();

    // Verify accessibility statement & JIS X 8341-3 Level AA notice
    await expect(page.locator('#panel-help-a11y')).toContainText(
      'JIS X 8341-3:2016'
    );
    await expect(page.locator('#panel-help-a11y')).toContainText(
      'ウェブアクセシビリティ方針'
    );

    // Close Help Modal
    await page.keyboard.press('Escape');
    await expect(helpDialog).not.toBeVisible();

    // 5. Font Scaling: Standard -> Large -> X-Large
    await openHeaderMenu(page);
    const fontPanel = page.locator('[data-header-menu-panel]');
    await fontPanel.getByRole('button', { name: '大', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/text-scale-large/);
    await fontPanel.getByRole('button', { name: '特大', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/text-scale-xlarge/);
    await fontPanel.getByRole('button', { name: '標準', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/text-scale-normal/);
  });

  test('14. Automated accessibility audit with axe-core (WCAG 2.1 Level AA)', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Initial page load
    await expect(page.locator('header')).toBeVisible();

    // 2. Audit main dashboard view
    const mainScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('.leaflet-container')
      .analyze();

    expect(mainScanResults.violations.filter(v => v.id !== 'color-contrast')).toEqual([]);

    // 3. Open Create Post modal and audit dialog accessibility
    const createBtn = page.locator('header button:has-text("＋")');
    await createBtn.click();
    const createDialog = page.locator(
      'div[role="dialog"][aria-labelledby="create-post-modal-title"]'
    );
    await expect(createDialog).toBeVisible();

    const modalScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('.leaflet-container')
      .analyze();

    expect(modalScanResults.violations.filter(v => v.id !== 'color-contrast')).toEqual([]);

    // Close modal
    await page.keyboard.press('Escape');
    await expect(createDialog).not.toBeVisible();
  });
});
