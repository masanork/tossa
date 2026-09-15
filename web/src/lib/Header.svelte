<!-- web/src/lib/Header.svelte -->
<script lang="ts">
  import type { SystemSettings, User } from './types';
  import { Shield, Radio, Sparkles, MapPin, KeyRound, AlertTriangle } from '@lucide/svelte';

  interface Props {
    settings: SystemSettings;
    user: User | null;
    onOpenAdmin: () => void;
    onOpenCreate: () => void;
  }

  let { settings, user, onOpenAdmin, onOpenCreate }: Props = $props();
</script>

<header class="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
  <!-- 緊急告知アナウンスバー（管理者が告知文を設定している場合に表示） -->
  {#if settings.emergency_banner}
    <div class="bg-amber-500 text-slate-950 px-4 py-2 text-xs md:text-sm font-bold flex items-center justify-between shadow-inner">
      <div class="flex items-center gap-2 max-w-4xl mx-auto w-full">
        <AlertTriangle class="w-4 h-4 shrink-0 text-slate-900" />
        <span class="truncate">{settings.emergency_banner}</span>
      </div>
    </div>
  {/if}

  <div class="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
    <!-- タイトル -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2.5">
        <span class="text-xl font-black tracking-tight text-slate-900">
          tossa
        </span>
        {#if settings.default_area}
          <div class="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50/80 px-2.5 py-0.5 rounded-full border border-blue-200">
            <MapPin class="w-3 h-3 text-blue-600" />
            <span>{settings.default_area}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- アクションボタン群 -->
    <div class="flex items-center gap-2.5">
      <!-- 管理者 / Passkey ボタン（控えめ） -->
      <button
        type="button"
        onclick={onOpenAdmin}
        class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition cursor-pointer border border-transparent hover:border-slate-200"
        title="管理者メニュー（Passkey認証）"
      >
        {#if user}
          <Shield class="w-3.5 h-3.5 text-blue-600" />
          <span class="hidden sm:inline font-semibold text-slate-700">{user.displayName}</span>
        {:else}
          <KeyRound class="w-3.5 h-3.5 text-slate-400" />
          <span class="hidden sm:inline">管理</span>
        {/if}
      </button>

      <!-- 投稿ボタン（右端・最優先で目立つCTA） -->
      <button
        type="button"
        onclick={onOpenCreate}
        class="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-black rounded-xl text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 active:scale-95 cursor-pointer ring-2 ring-blue-500/20"
      >
        <span class="text-sm font-black leading-none">＋</span>
        <span class="tracking-wide">情報を投稿</span>
      </button>
    </div>
  </div>
</header>
