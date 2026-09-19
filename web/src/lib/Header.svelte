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
    Palette,
    HelpCircle,
    User as UserIcon,
    Type,
    Menu,
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

  let showMenu = $state(false);

  function closeMenu() {
    showMenu = false;
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && showMenu) {
      closeMenu();
    }
  }}
/>

{#if showMenu}
  <div
    class="fixed inset-0 z-40 bg-transparent"
    onclick={closeMenu}
    role="presentation"
  ></div>
{/if}

<header
  class={`sticky top-0 ${
    showMenu ? 'z-50' : 'z-30'
  } border-b border-slate-200 bg-white/95 shadow-xs backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95`}
>
  {#if settings.emergency_banner || settings.operation_mode === 'disaster'}
    <div
      class="flex flex-col gap-1.5 px-4 py-2 text-xs font-bold shadow-inner md:text-sm {settings.operation_mode ===
      'disaster'
        ? 'bg-red-600 text-white'
        : 'bg-amber-500 text-slate-950'}"
    >
      <div
        class="mx-auto flex w-full max-w-4xl items-center justify-between gap-2"
      >
        <div class="flex items-center gap-2 truncate">
          <AlertTriangle
            class="h-4 w-4 shrink-0 {settings.operation_mode === 'disaster'
              ? 'text-white'
              : 'text-slate-900'}"
          />
          <span class="truncate">
            {settings.emergency_banner || m.admin_mode_badge_disaster()}
          </span>
        </div>
        {#if settings.active_disasters && settings.active_disasters.length > 0}
          <div
            class="hidden shrink-0 items-center gap-1 rounded bg-black/20 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-xs sm:inline-flex"
          >
            <span>{settings.active_disasters.length} 件の災害対応中</span>
          </div>
        {/if}
      </div>

      {#if settings.active_disasters && settings.active_disasters.length > 0}
        <div
          class="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1.5 text-[11px]"
        >
          {#each settings.active_disasters as disaster (disaster.id)}
            <span
              class="inline-flex items-center gap-1 rounded bg-black/25 px-2 py-0.5 font-bold text-white shadow-xs backdrop-blur-xs"
            >
              <span>🚨 {disaster.name}</span>
              {#if disaster.areas && disaster.areas.length > 0}
                <span class="font-normal opacity-85">
                  ({disaster.areas.map((a) => a.name).join(', ')})
                </span>
              {/if}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div
    class="mx-auto flex max-w-4xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3"
  >
    <div class="flex min-w-0 items-center gap-2 sm:gap-3">
      <span
        class="shrink-0 text-xl font-black tracking-tight text-slate-900 dark:text-white"
      >
        {m.app_title()}
      </span>
      {#if settings.default_area}
        <div
          class="hidden max-w-[130px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs font-semibold min-[380px]:inline-flex sm:max-w-none {settings.operation_mode ===
          'disaster'
            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300'
            : 'border-blue-200 bg-blue-50/80 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300'}"
        >
          <MapPin
            class="h-3 w-3 shrink-0 {settings.operation_mode === 'disaster'
              ? 'text-red-600 dark:text-red-400'
              : 'text-blue-600 dark:text-blue-400'}"
          />
          <span class="truncate">
            {settings.operation_mode === 'disaster'
              ? '🚨 '
              : ''}{settings.default_area}
          </span>
        </div>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <div class="relative">
        <button
          type="button"
          data-header-menu
          aria-haspopup="true"
          aria-expanded={showMenu}
          onclick={() => {
            showMenu = !showMenu;
          }}
          class={`relative inline-flex cursor-pointer items-center justify-center rounded-lg border p-1.5 text-xs shadow-2xs transition sm:px-2.5 sm:py-1.5 ${
            showMenu
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/60 dark:text-blue-300'
              : 'border-slate-200/80 bg-white/80 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
          }`}
          title={m.header_more_menu()}
          aria-label={m.header_more_menu()}
        >
          <Menu class="h-4 w-4" />
          {#if pushManager.isSubscribed || favoritesManager.count > 0}
            <span
              class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-white dark:ring-slate-900"
            ></span>
          {/if}
        </button>

        {#if showMenu}
          <div
            data-header-menu-panel
            data-dropdown
            class="absolute right-0 z-50 mt-1.5 w-64 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <button
              type="button"
              onclick={() => {
                closeMenu();
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
                  class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                >
                  ★{favoritesManager.count}
                </span>
              {/if}
            </button>

            <button
              type="button"
              onclick={() => {
                closeMenu();
                onOpenHelp?.();
              }}
              class="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              title={m.btn_help()}
            >
              <HelpCircle class="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>{m.btn_help()}</span>
            </button>

            <button
              type="button"
              onclick={() => {
                closeMenu();
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
                <span>{m.btn_push_alerts()}</span>
              </div>
              {#if pushManager.isSubscribed}
                <span
                  class="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  >ON</span
                >
              {/if}
            </button>

            <button
              type="button"
              data-header-qr-scan
              onclick={() => {
                closeMenu();
                onOpenQrScanner?.();
              }}
              class="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              title={m.qr_scanner_title()}
            >
              <ScanQrCode
                class="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
              />
              <span class="flex flex-col items-start gap-0.5 text-left">
                <span>{m.qr_scan_btn()}</span>
                <span
                  class="text-[10px] font-medium text-slate-400 dark:text-slate-500"
                  >{m.qr_scan_btn_hint()}</span
                >
              </span>
            </button>

            <div
              class="my-1.5 border-t border-slate-100 dark:border-slate-800"
            ></div>

            <div class="px-1 py-1">
              <div
                class="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500"
              >
                <Globe class="h-3 w-3" />
                <span>言語</span>
              </div>
              <div class="flex flex-col gap-0.5">
                {#each LANGUAGES as lang (lang.code)}
                  <button
                    type="button"
                    onclick={() => {
                      i18n.setLanguage(lang.code);
                      closeMenu();
                    }}
                    class={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      i18n.current === lang.code
                        ? 'bg-blue-50 font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{lang.flag} {lang.label}</span>
                    {#if i18n.current === lang.code}
                      <span>✓</span>
                    {/if}
                  </button>
                {/each}
              </div>
            </div>

            <div
              class="my-1.5 border-t border-slate-100 dark:border-slate-800"
            ></div>

            <div class="px-1 py-1">
              <div
                class="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500"
              >
                <Palette class="h-3 w-3" />
                <span>{m.theme_title()}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                {#each THEME_OPTIONS as opt (opt.mode)}
                  <button
                    type="button"
                    onclick={() => {
                      themeManager.setTheme(opt.mode);
                      closeMenu();
                    }}
                    title={opt.label}
                    class={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      themeManager.mode === opt.mode
                        ? 'bg-blue-50 font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{opt.icon} {opt.label}</span>
                    {#if themeManager.mode === opt.mode}
                      <span>✓</span>
                    {/if}
                  </button>
                {/each}
              </div>
            </div>

            <div
              class="my-1.5 border-t border-slate-100 dark:border-slate-800"
            ></div>

            <div class="px-1 py-1">
              <div
                class="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500"
              >
                <Type class="h-3 w-3" />
                <span>{m.font_size()}</span>
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
                    {opt.labelJa}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <button
        type="button"
        onclick={() => {
          closeMenu();
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

      <button
        type="button"
        onclick={() => {
          closeMenu();
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

      <button
        type="button"
        onclick={() => {
          closeMenu();
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
