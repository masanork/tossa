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

  let isDisaster = $derived(settings.app_mode === 'disaster');
</script>

<header class="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
  <!-- 緊急告知アナウンスバー（災害時または告知文がある場合） -->
  {#if isDisaster && settings.emergency_banner}
    <div class="bg-rose-600 text-white px-4 py-2 text-xs md:text-sm font-medium flex items-center justify-between shadow-inner">
      <div class="flex items-center gap-2 max-w-4xl mx-auto w-full">
        <AlertTriangle class="w-4 h-4 shrink-0 animate-pulse text-amber-200" />
        <span class="truncate">{settings.emergency_banner}</span>
      </div>
    </div>
  {/if}

  <div class="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
    <!-- タイトル & モードバッジ -->
    <div class="flex items-center gap-3">
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <span class="text-xl font-black tracking-tight text-slate-900 flex items-center gap-1">
            tossa <span class="text-xs font-bold text-slate-400 font-sans">咄嗟</span>
          </span>
          {#if isDisaster}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-600 animate-ping"></span>
              災害モード
            </span>
          {:else}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
              <Sparkles class="w-3 h-3" />
              平時モード
            </span>
          {/if}
        </div>
        <div class="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
          <MapPin class="w-3 h-3 text-slate-400" />
          <span>{settings.default_area || '熊本市'}</span>
        </div>
      </div>
    </div>

    <!-- アクションボタン群 -->
    <div class="flex items-center gap-2">
      <!-- 投稿ボタン -->
      <button
        type="button"
        onclick={onOpenCreate}
        class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition active:scale-95 cursor-pointer"
      >
        <span>＋ 情報を投稿</span>
      </button>

      <!-- 管理者 / Passkey ボタン -->
      <button
        type="button"
        onclick={onOpenAdmin}
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition cursor-pointer"
        title="管理者メニュー（Passkey認証）"
      >
        {#if user}
          <Shield class="w-3.5 h-3.5 text-blue-600" />
          <span class="hidden sm:inline font-semibold">{user.displayName}</span>
        {:else}
          <KeyRound class="w-3.5 h-3.5 text-slate-500" />
          <span class="hidden sm:inline">管理 / 認証</span>
        {/if}
      </button>
    </div>
  </div>
</header>
