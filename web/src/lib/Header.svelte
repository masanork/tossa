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
  } from '@lucide/svelte';
  import { i18n, m, LANGUAGES } from './i18n.svelte';

  interface Props {
    settings: SystemSettings;
    user: User | null;
    onOpenAdmin: () => void;
    onOpenCreate: () => void;
    onOpenMessages: () => void;
  }

  const { settings, user, onOpenAdmin, onOpenCreate, onOpenMessages }: Props =
    $props();

  let showLangMenu = $state(false);
</script>

<header
  class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-xs backdrop-blur-md"
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
    class="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3"
  >
    <!-- Title -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2.5">
        <span class="text-xl font-black tracking-tight text-slate-900">
          {m.app_title()}
        </span>
        {#if settings.default_area}
          <div
            class="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50/80 px-2.5 py-0.5 text-xs font-semibold text-blue-700"
          >
            <MapPin class="h-3 w-3 text-blue-600" />
            <span>{settings.default_area}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Action buttons -->
    <div class="flex items-center gap-1.5 sm:gap-2">
      <!-- Language selector -->
      <div class="relative">
        <button
          type="button"
          onclick={() => {
            showLangMenu = !showLangMenu;
          }}
          class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-100 hover:text-blue-700"
          title="言語切替 / Change language / ことばを えらぶ"
        >
          <Globe class="h-3.5 w-3.5 text-slate-500" />
          <span class="text-xs">
            {LANGUAGES.find((l) => l.code === i18n.current)?.shortLabel ||
              'Language'}
          </span>
        </button>

        {#if showLangMenu}
          <!-- Dropdown menu -->
          <div
            class="absolute right-0 z-50 mt-1.5 flex w-44 flex-col rounded-xl border border-slate-200 bg-white py-1 text-xs shadow-lg"
          >
            {#each LANGUAGES as lang (lang.code)}
              <button
                type="button"
                onclick={() => {
                  i18n.setLanguage(lang.code);
                  showLangMenu = false;
                }}
                class={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left transition hover:bg-slate-50 ${
                  i18n.current === lang.code
                    ? 'bg-blue-50/60 font-bold text-blue-600'
                    : 'text-slate-700'
                }`}
              >
                <div class="flex items-center gap-2">
                  <span>{lang.flag}</span>
                  <span>{lang.label}</span>
                </div>
                {#if i18n.current === lang.code}
                  <span class="font-bold text-blue-600">✓</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Secure messaging (E2EE) button -->
      <button
        type="button"
        onclick={onOpenMessages}
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-blue-50/60 hover:text-blue-700"
        title="管理者や他利用者とのE2EE暗号化連絡"
      >
        <MessageSquareLock class="h-3.5 w-3.5 text-blue-600" />
        <span class="hidden sm:inline">{m.btn_messages()}</span>
      </button>

      <!-- Auth (Passkey) button -->
      <button
        type="button"
        onclick={onOpenAdmin}
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-600 shadow-2xs transition hover:bg-slate-100 hover:text-slate-900"
        title={user
          ? `${user.displayName}（クリックでメニュー表示）`
          : 'Passkey 認証・登録'}
      >
        {#if user}
          {#if user.role === 'admin'}
            <span class="text-xs">👑</span>
          {:else}
            <Shield class="h-3.5 w-3.5 text-blue-600" />
          {/if}
          <span class="max-w-[120px] truncate font-semibold text-slate-800"
            >{user.displayName}</span
          >
        {:else}
          <KeyRound class="h-3.5 w-3.5 text-slate-500" />
          <span class="font-bold text-slate-700">{m.btn_auth()}</span>
        {/if}
      </button>

      <!-- Create post CTA button -->
      <button
        type="button"
        onclick={onOpenCreate}
        class="inline-flex transform cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 py-2 text-xs font-black text-white shadow-md ring-2 ring-blue-500/20 transition-all hover:-translate-y-0.5 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg active:translate-y-0 active:scale-95 sm:px-4 sm:text-sm"
      >
        <span class="text-sm leading-none font-black">＋</span>
        <span class="tracking-wide">{m.btn_post()}</span>
      </button>
    </div>
  </div>
</header>
