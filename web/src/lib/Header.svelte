<!-- web/src/lib/Header.svelte -->
<script lang="ts">
  import type { SystemSettings, User } from './types';
  import {
    Shield,
    MapPin,
    KeyRound,
    AlertTriangle,
    MessageSquareLock,
    Globe,
    ScanQrCode,
    Bell,
    BellRing,
    Ellipsis,
    Palette,
    HelpCircle,
    User as UserIcon,
    Type,
  } from '@lucide/svelte';
  import { i18n, m, LANGUAGES } from './i18n.svelte';
  import { themeManager, THEME_OPTIONS } from './theme.svelte';
  import { fontSizeManager, FONT_SCALE_OPTIONS } from './fontSize.svelte';
  import { pushManager } from './pushManager.svelte';
  import { favoritesManager } from './favorites.svelte';

  interface Props {
    settings: SystemSettings;
    user: User | null;
    onOpenAdmin: () => void;
    onOpenCreate: () => void;
    onOpenMessages: () => void;
    onOpenQrScanner?: () => void;
    onOpenPush?: () => void;
    onOpenHelp?: () => void;
    onOpenMyPage?: () => void;
  }

  const {
    settings,
    user,
    onOpenAdmin,
    onOpenCreate,
    onOpenMessages,
    onOpenQrScanner,
    onOpenPush,
    onOpenHelp,
    onOpenMyPage,
  }: Props = $props();

  let showLangMenu = $state(false);
  let showThemeMenu = $state(false);
  let showMoreMenu = $state(false);

  function closeAllMenus() {
    showThemeMenu = false;
    showLangMenu = false;
    showMoreMenu = false;
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && (showThemeMenu || showLangMenu || showMoreMenu)) {
      closeAllMenus();
    }
  }}
/>

<!-- Backdrop when dropdown is open -->
{#if showThemeMenu || showLangMenu || showMoreMenu}
  <div
    class="fixed inset-0 z-40 bg-transparent"
    onclick={closeAllMenus}
    role="presentation"
  ></div>
{/if}

<header
  class={`sticky top-0 ${
    showThemeMenu || showLangMenu || showMoreMenu ? 'z-50' : 'z-30'
  } border-b border-slate-200 bg-white/95 shadow-xs backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95`}
>
  <!-- Emergency announcement banner (shown when set by administrator) -->
  {#if settings.emergency_banner}
    <div
      class="flex items-center justify-between bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-inner md:text-sm"
    >
      <div class="mx-auto flex w-full max-w-4xl items-center gap-2">
        <AlertTriangle class="h-4 w-4 shrink-0 text-slate-900" />
        <span class="truncate">{settings.emergency_banner}</span>
      </div>
    </div>
  {/if}

  <div
    class="mx-auto flex max-w-4xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3"
  >
    <!-- Title & Area -->
    <div class="flex min-w-0 items-center gap-2 sm:gap-3">
      <span
        class="shrink-0 text-xl font-black tracking-tight text-slate-900 dark:text-white"
      >
        {m.app_title()}
      </span>
      {#if settings.default_area}
        <div
          class="hidden max-w-[110px] items-center gap-1 truncate rounded-full border border-blue-200 bg-blue-50/80 px-2 py-0.5 text-xs font-semibold text-blue-700 min-[380px]:inline-flex sm:max-w-none dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
        >
          <MapPin class="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" />
          <span class="truncate">{settings.default_area}</span>
        </div>
      {/if}
    </div>

    <!-- Action buttons -->
    <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <!-- 1. Desktop only: Theme selector -->
      <div class="relative hidden sm:block">
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={showThemeMenu}
          onclick={() => {
            showThemeMenu = !showThemeMenu;
            showLangMenu = false;
            showMoreMenu = false;
          }}
          class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-100 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          title={`テーマ切替 / ${m.theme_title()}`}
          aria-label="テーマ切替"
        >
          <span>
            {THEME_OPTIONS.find((t) => t.mode === themeManager.mode)?.icon ||
              '☀️'}
          </span>
          <span class="hidden text-xs md:inline">
            {themeManager.mode === 'system'
              ? m.theme_system()
              : themeManager.mode === 'light'
                ? m.theme_light()
                : themeManager.mode === 'dark'
                  ? m.theme_dark()
                  : m.theme_contrast()}
          </span>
        </button>

        {#if showThemeMenu}
          <!-- Dropdown menu -->
          <div
            data-dropdown
            class="absolute right-0 z-50 mt-1.5 flex w-56 flex-col rounded-xl border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {#each THEME_OPTIONS as opt (opt.mode)}
              <button
                type="button"
                onclick={() => {
                  themeManager.setTheme(opt.mode);
                  closeAllMenus();
                }}
                class={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
                  themeManager.mode === opt.mode
                    ? 'bg-blue-50/60 font-bold text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <div class="flex items-center gap-2">
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </div>
                {#if themeManager.mode === opt.mode}
                  <span class="font-bold text-blue-600 dark:text-blue-400"
                    >✓</span
                  >
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- 1.5 Desktop only: Font Size Scaler -->
      <button
        type="button"
        onclick={() => fontSizeManager.cycleScale()}
        class="hidden cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-100 hover:text-blue-700 sm:inline-flex dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title="{m.font_size()}: {fontSizeManager.scale === 'normal'
          ? m.font_size_normal()
          : fontSizeManager.scale === 'large'
            ? m.font_size_large()
            : m.font_size_xlarge()}"
        aria-label="{m.font_size()}: {fontSizeManager.scale === 'normal'
          ? m.font_size_normal()
          : fontSizeManager.scale === 'large'
            ? m.font_size_large()
            : m.font_size_xlarge()}"
      >
        <Type class="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
        <span class="text-xs font-bold">
          {fontSizeManager.scale === 'normal'
            ? 'A'
            : fontSizeManager.scale === 'large'
              ? 'A+'
              : 'A++'}
        </span>
      </button>

      <!-- 2. Desktop only: Language selector -->
      <div class="relative hidden sm:block">
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={showLangMenu}
          onclick={() => {
            showLangMenu = !showLangMenu;
            showThemeMenu = false;
            showMoreMenu = false;
          }}
          class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-100 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          title="言語切替 / Change language / ことばを えらぶ"
        >
          <Globe class="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
          <span class="text-xs">
            {LANGUAGES.find((l) => l.code === i18n.current)?.shortLabel ||
              'Language'}
          </span>
        </button>

        {#if showLangMenu}
          <!-- Dropdown menu -->
          <div
            data-dropdown
            class="absolute right-0 z-50 mt-1.5 flex w-44 flex-col rounded-xl border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {#each LANGUAGES as lang (lang.code)}
              <button
                type="button"
                onclick={() => {
                  i18n.setLanguage(lang.code);
                  closeAllMenus();
                }}
                class={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
                  i18n.current === lang.code
                    ? 'bg-blue-50/60 font-bold text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <div class="flex items-center gap-2">
                  <span>{lang.flag}</span>
                  <span>{lang.label}</span>
                </div>
                {#if i18n.current === lang.code}
                  <span class="font-bold text-blue-600 dark:text-blue-400"
                    >✓</span
                  >
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- 3. Desktop only: QR Scanner button -->
      <button
        type="button"
        onclick={() => {
          closeAllMenus();
          onOpenQrScanner?.();
        }}
        class="hidden cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-blue-50/60 hover:text-blue-700 sm:inline-flex dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title={m.qr_scanner_title()}
        aria-label={m.qr_scanner_title()}
      >
        <ScanQrCode class="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
        <span class="hidden md:inline">{m.qr_scan_btn()}</span>
      </button>

      <!-- 4. Desktop only: Web Push Notifications button -->
      <button
        type="button"
        onclick={() => {
          closeAllMenus();
          onOpenPush?.();
        }}
        class={`relative hidden cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-2xs transition sm:inline-flex ${
          pushManager.isSubscribed
            ? 'border-blue-300/80 bg-blue-50/80 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
            : 'border-slate-200/80 bg-white/80 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
        }`}
        title={m.push_modal_title()}
        aria-label={m.push_modal_title()}
      >
        {#if pushManager.isSubscribed}
          <BellRing class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span class="absolute -top-1 -right-1 flex h-2 w-2">
            <span
              class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"
            ></span>
            <span class="relative inline-flex h-2 w-2 rounded-full bg-blue-600"
            ></span>
          </span>
        {:else}
          <Bell class="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
        {/if}
        <span class="hidden lg:inline">{m.btn_push_alerts()}</span>
      </button>

      <!-- 5. Desktop: Help & Guide button -->
      <button
        type="button"
        onclick={() => {
          closeAllMenus();
          onOpenHelp?.();
        }}
        class="hidden cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-blue-50/60 hover:text-blue-700 sm:inline-flex dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title={m.btn_help()}
        aria-label={m.btn_help()}
      >
        <HelpCircle class="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
        <span class="hidden xl:inline">{m.btn_help()}</span>
      </button>

      <!-- 6. Desktop: My Page (Own posts & Favorites) button -->
      <button
        type="button"
        onclick={() => {
          closeAllMenus();
          onOpenMyPage?.();
        }}
        class="hidden cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-blue-50/60 hover:text-blue-700 sm:inline-flex dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title={m.mypage_subtitle()}
        aria-label={m.btn_mypage()}
      >
        <UserIcon class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        <span class="hidden lg:inline">{m.btn_mypage()}</span>
        {#if favoritesManager.count > 0}
          <span
            class="py-0.2 rounded-full bg-amber-100 px-1.5 text-[10px] font-black text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          >
            ★{favoritesManager.count}
          </span>
        {/if}
      </button>

      <!-- 7. Mobile only: More (...) menu dropdown for Theme, Language, QR, Push, Help, MyPage -->
      <div class="relative sm:hidden">
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={showMoreMenu}
          onclick={() => {
            showMoreMenu = !showMoreMenu;
            showThemeMenu = false;
            showLangMenu = false;
          }}
          class={`relative inline-flex cursor-pointer items-center justify-center rounded-lg border p-1.5 text-xs shadow-2xs transition ${
            showMoreMenu
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/60 dark:text-blue-300'
              : 'border-slate-200/80 bg-white/80 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
          }`}
          title={m.header_more_menu()}
          aria-label={m.header_more_menu()}
        >
          <Ellipsis class="h-4 w-4" />
          {#if pushManager.isSubscribed || favoritesManager.count > 0}
            <span
              class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-white dark:ring-slate-900"
            ></span>
          {/if}
        </button>

        {#if showMoreMenu}
          <div
            data-dropdown
            class="absolute right-0 z-50 mt-1.5 w-60 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <!-- My Page -->
            <button
              type="button"
              onclick={() => {
                closeAllMenus();
                onOpenMyPage?.();
              }}
              class="flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <div class="flex items-center gap-2.5">
                <UserIcon class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>{m.btn_mypage()}</span>
              </div>
              {#if favoritesManager.count > 0}
                <span
                  class="py-0.2 rounded-full bg-amber-100 px-1.5 text-[10px] font-black text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                >
                  ★{favoritesManager.count}
                </span>
              {/if}
            </button>

            <!-- Help & Guide -->
            <button
              type="button"
              onclick={() => {
                closeAllMenus();
                onOpenHelp?.();
              }}
              class="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <HelpCircle class="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>{m.btn_help()}</span>
            </button>

            <div
              class="my-1 border-t border-slate-100 dark:border-slate-800"
            ></div>

            <!-- Web Push -->
            <button
              type="button"
              onclick={() => {
                closeAllMenus();
                onOpenPush?.();
              }}
              class="flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <div class="flex items-center gap-2.5">
                {#if pushManager.isSubscribed}
                  <BellRing class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                {:else}
                  <Bell class="h-4 w-4 text-slate-500 dark:text-slate-400" />
                {/if}
                <span>{m.push_modal_title()}</span>
              </div>
              {#if pushManager.isSubscribed}
                <span
                  class="py-0.2 rounded-full bg-blue-100 px-1.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  >ON</span
                >
              {/if}
            </button>

            <!-- QR Scanner -->
            <button
              type="button"
              onclick={() => {
                closeAllMenus();
                onOpenQrScanner?.();
              }}
              class="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ScanQrCode class="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <span>{m.qr_scanner_title()}</span>
            </button>

            <div
              class="my-1.5 border-t border-slate-100 dark:border-slate-800"
            ></div>

            <!-- Language -->
            <div class="px-1 py-1">
              <div
                class="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500"
              >
                <Globe class="h-3 w-3" />
                <span>言語 / LANGUAGE</span>
              </div>
              <div class="grid grid-cols-3 gap-1">
                {#each LANGUAGES as lang (lang.code)}
                  <button
                    type="button"
                    onclick={() => {
                      i18n.setLanguage(lang.code);
                      closeAllMenus();
                    }}
                    class={`rounded-lg py-1 text-center text-[10px] font-bold transition ${
                      i18n.current === lang.code
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    {lang.shortLabel}
                  </button>
                {/each}
              </div>
            </div>

            <div
              class="my-1.5 border-t border-slate-100 dark:border-slate-800"
            ></div>

            <!-- Theme -->
            <div class="px-1 py-1">
              <div
                class="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500"
              >
                <Palette class="h-3 w-3" />
                <span>表示モード / THEME</span>
              </div>
              <div class="grid grid-cols-4 gap-1">
                {#each THEME_OPTIONS as opt (opt.mode)}
                  <button
                    type="button"
                    onclick={() => {
                      themeManager.setTheme(opt.mode);
                      closeAllMenus();
                    }}
                    title={opt.label}
                    class={`flex flex-col items-center rounded-lg p-1 text-[10px] font-bold transition ${
                      themeManager.mode === opt.mode
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span class="text-xs">{opt.icon}</span>
                    <span class="mt-0.5 scale-90">{opt.shortLabel}</span>
                  </button>
                {/each}
              </div>
            </div>

            <div
              class="my-1.5 border-t border-slate-100 dark:border-slate-800"
            ></div>

            <!-- Font Size -->
            <div class="px-1 py-1">
              <div
                class="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500"
              >
                <Type class="h-3 w-3" />
                <span>{m.font_size()} / FONT SIZE</span>
              </div>
              <div class="grid grid-cols-3 gap-1">
                {#each FONT_SCALE_OPTIONS as opt (opt.id)}
                  <button
                    type="button"
                    onclick={() => {
                      fontSizeManager.setScale(opt.id);
                    }}
                    class={`rounded-lg py-1.5 text-center text-xs font-bold transition ${
                      fontSizeManager.scale === opt.id
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span>{opt.labelJa}</span>
                    <span class="ml-0.5 text-[10px] opacity-75"
                      >({opt.scalePercent})</span
                    >
                  </button>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- 6. 連絡 (Secure messaging) button: Always visible -->
      <button
        type="button"
        onclick={() => {
          closeAllMenus();
          onOpenMessages();
        }}
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-blue-50/60 hover:text-blue-700 sm:px-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title={m.btn_messages()}
        aria-label={m.btn_messages()}
      >
        <MessageSquareLock
          class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
        />
        <span class="hidden sm:inline">{m.btn_messages()}</span>
      </button>

      <!-- 7. 認証 (Passkey Auth) button: Always visible -->
      <button
        type="button"
        onclick={() => {
          closeAllMenus();
          onOpenAdmin();
        }}
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2 py-1.5 text-xs text-slate-600 shadow-2xs transition hover:bg-slate-100 hover:text-slate-900 sm:px-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title={user ? user.displayName : m.btn_auth()}
        aria-label={user ? user.displayName : m.btn_auth()}
      >
        {#if user}
          {#if user.role === 'admin'}
            <span class="text-xs">👑</span>
          {:else}
            <Shield class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          {/if}
          <span
            class="max-w-[70px] truncate font-semibold text-slate-800 sm:max-w-[120px] dark:text-slate-200"
            >{user.displayName}</span
          >
        {:else}
          <KeyRound class="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
          <span
            class="hidden font-bold text-slate-700 sm:inline dark:text-slate-300"
            >{m.btn_auth()}</span
          >
        {/if}
      </button>

      <!-- 8. 投稿 (Create post CTA) button: Always visible -->
      <button
        type="button"
        onclick={() => {
          closeAllMenus();
          onOpenCreate();
        }}
        class="inline-flex transform cursor-pointer items-center gap-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-1.5 text-xs font-black text-white shadow-md ring-2 ring-blue-500/20 transition-all hover:-translate-y-0.5 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg active:translate-y-0 active:scale-95 sm:gap-1.5 sm:px-4 sm:py-2 sm:text-sm"
      >
        <span class="text-sm leading-none font-black">＋</span>
        <span class="tracking-wide">{m.btn_post()}</span>
      </button>
    </div>
  </div>
</header>
