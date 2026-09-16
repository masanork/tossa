<!-- web/src/lib/Header.svelte -->
<script lang="ts">
  import type { SystemSettings, User } from './types';
  import {
    Shield,
    Radio,
    Sparkles,
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

  let { settings, user, onOpenAdmin, onOpenCreate, onOpenMessages }: Props =
    $props();

  let showLangMenu = $state(false);
</script>

<header
  class="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs"
>
  <!-- 緊急告知アナウンスバー（管理者が告知文を設定している場合に表示） -->
  {#if settings.emergency_banner}
    <div
      class="bg-amber-500 text-slate-950 px-4 py-2 text-xs md:text-sm font-bold flex items-center justify-between shadow-inner"
    >
      <div class="flex items-center gap-2 max-w-4xl mx-auto w-full">
        <AlertTriangle class="w-4 h-4 shrink-0 text-slate-900" />
        <span class="truncate">{settings.emergency_banner}</span>
      </div>
    </div>
  {/if}

  <div
    class="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-2"
  >
    <!-- タイトル -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2.5">
        <span class="text-xl font-black tracking-tight text-slate-900">
          {m.app_title()}
        </span>
        {#if settings.default_area}
          <div
            class="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50/80 px-2.5 py-0.5 rounded-full border border-blue-200"
          >
            <MapPin class="w-3 h-3 text-blue-600" />
            <span>{settings.default_area}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- アクションボタン群 -->
    <div class="flex items-center gap-1.5 sm:gap-2">
      <!-- 言語切り替えセレクター -->
      <div class="relative">
        <button
          type="button"
          onclick={() => {
            showLangMenu = !showLangMenu;
          }}
          class="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 hover:bg-slate-100 rounded-lg transition cursor-pointer border border-slate-200 bg-white shadow-2xs"
          title="言語切替 / Change language / ことばを えらぶ"
        >
          <Globe class="w-3.5 h-3.5 text-slate-500" />
          <span class="text-xs">
            {LANGUAGES.find((l) => l.code === i18n.current)?.shortLabel ||
              'Language'}
          </span>
        </button>

        {#if showLangMenu}
          <!-- ドロップダウンメニュー -->
          <div
            class="absolute right-0 mt-1.5 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50 text-xs flex flex-col"
          >
            {#each LANGUAGES as lang}
              <button
                type="button"
                onclick={() => {
                  i18n.setLanguage(lang.code);
                  showLangMenu = false;
                }}
                class={`w-full text-left px-3 py-2 flex items-center justify-between transition cursor-pointer hover:bg-slate-50 ${
                  i18n.current === lang.code
                    ? 'font-bold text-blue-600 bg-blue-50/60'
                    : 'text-slate-700'
                }`}
              >
                <div class="flex items-center gap-2">
                  <span>{lang.flag}</span>
                  <span>{lang.label}</span>
                </div>
                {#if i18n.current === lang.code}
                  <span class="text-blue-600 font-bold">✓</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- セキュア連絡（E2EE）ボタン -->
      <button
        type="button"
        onclick={onOpenMessages}
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 hover:bg-blue-50/60 rounded-lg transition cursor-pointer border border-slate-200/80 bg-white/80 shadow-2xs"
        title="管理者や他利用者とのE2EE暗号化連絡"
      >
        <MessageSquareLock class="w-3.5 h-3.5 text-blue-600" />
        <span class="hidden sm:inline">{m.btn_messages()}</span>
      </button>

      <!-- 認証（Passkey）ボタン -->
      <button
        type="button"
        onclick={onOpenAdmin}
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition cursor-pointer border border-slate-200/80 bg-white/80 shadow-2xs"
        title={user
          ? `${user.displayName}（クリックでメニュー表示）`
          : 'Passkey 認証・登録'}
      >
        {#if user}
          {#if user.role === 'admin'}
            <span class="text-xs">👑</span>
          {:else}
            <Shield class="w-3.5 h-3.5 text-blue-600" />
          {/if}
          <span class="font-semibold text-slate-800 truncate max-w-[120px]"
            >{user.displayName}</span
          >
        {:else}
          <KeyRound class="w-3.5 h-3.5 text-slate-500" />
          <span class="font-bold text-slate-700">{m.btn_auth()}</span>
        {/if}
      </button>

      <!-- 投稿ボタン（右端・最優先で目立つCTA） -->
      <button
        type="button"
        onclick={onOpenCreate}
        class="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-black rounded-xl text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 active:scale-95 cursor-pointer ring-2 ring-blue-500/20"
      >
        <span class="text-sm font-black leading-none">＋</span>
        <span class="tracking-wide">{m.btn_post()}</span>
      </button>
    </div>
  </div>
</header>
