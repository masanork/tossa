<!-- web/src/lib/HelpModal.svelte: Comprehensive User, Disaster & AI Guide -->
<script lang="ts">
  import {
    X,
    HelpCircle,
    Info,
    Shield,
    Radio,
    Bot,
    Compass,
    QrCode,
    WifiOff,
    Bell,
    MapPin,
    Cpu,
    ExternalLink,
    Copy,
    Check,
    Lock,
    Sparkles,
    Accessibility,
  } from '@lucide/svelte';
  import { focusTrap } from './focusTrap';
  import { m } from './i18n.svelte';

  interface Props {
    onClose: () => void;
    zIndex?: number;
    isTop?: boolean;
  }

  const { onClose, zIndex = 60, isTop: _isTop = true }: Props = $props();

  type TabKey = 'basics' | 'disaster' | 'security' | 'ai_api' | 'a11y';
  let currentTab = $state<TabKey>('basics');
  let copiedConfig = $state(false);

  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        tossa: {
          url:
            typeof window !== 'undefined'
              ? `${window.location.origin}/mcp`
              : 'https://tossa.app/mcp',
        },
      },
    },
    null,
    2
  );

  async function copyMcpConfig() {
    try {
      await navigator.clipboard.writeText(mcpConfigJson);
      copiedConfig = true;
      setTimeout(() => {
        copiedConfig = false;
      }, 2000);
    } catch {
      // Fallback
    }
  }
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200"
  style="z-index: {zIndex};"
  onclick={onClose}
  role="presentation"
></div>

<!-- Modal Container -->
<div
  class="pointer-events-none fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4"
  style="z-index: {zIndex + 1};"
>
  <div
    class="pointer-events-auto flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl transition-all sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
    role="dialog"
    aria-modal="true"
    aria-labelledby="help-modal-title"
    use:focusTrap={{ onEscape: onClose }}
  >
    <!-- Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
        >
          <HelpCircle class="h-5 w-5" />
        </div>
        <div>
          <h2
            id="help-modal-title"
            class="text-base font-bold text-slate-900 sm:text-lg dark:text-white"
          >
            {m.help_modal_title()}
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {m.help_modal_subtitle()}
          </p>
        </div>
      </div>
      <button
        type="button"
        onclick={onClose}
        data-close-modal
        class="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        aria-label={m.btn_close()}
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <!-- Navigation Tabs -->
    <div
      role="tablist"
      aria-label={m.help_modal_title()}
      class="no-scrollbar flex shrink-0 overflow-x-auto border-b border-slate-200 bg-slate-50/75 px-3 py-1.5 sm:px-6 dark:border-slate-800 dark:bg-slate-800/40"
    >
      <div class="flex min-w-max gap-1.5">
        <button
          type="button"
          role="tab"
          id="tab-help-basics"
          aria-selected={currentTab === 'basics'}
          aria-controls="panel-help-basics"
          onclick={() => (currentTab = 'basics')}
          class={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            currentTab === 'basics'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/60'
          }`}
        >
          <Info class="h-3.5 w-3.5" />
          <span>{m.help_tab_basics()}</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-help-disaster"
          aria-selected={currentTab === 'disaster'}
          aria-controls="panel-help-disaster"
          onclick={() => (currentTab = 'disaster')}
          class={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            currentTab === 'disaster'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/60'
          }`}
        >
          <Radio class="h-3.5 w-3.5" />
          <span>{m.help_tab_disaster()}</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-help-security"
          aria-selected={currentTab === 'security'}
          aria-controls="panel-help-security"
          onclick={() => (currentTab = 'security')}
          class={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            currentTab === 'security'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/60'
          }`}
        >
          <Shield class="h-3.5 w-3.5" />
          <span>{m.help_tab_security()}</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-help-ai"
          aria-selected={currentTab === 'ai_api'}
          aria-controls="panel-help-ai"
          onclick={() => (currentTab = 'ai_api')}
          class={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            currentTab === 'ai_api'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/60'
          }`}
        >
          <Bot class="h-3.5 w-3.5" />
          <span>{m.help_tab_ai_api()}</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-help-a11y"
          aria-selected={currentTab === 'a11y'}
          aria-controls="panel-help-a11y"
          onclick={() => (currentTab = 'a11y')}
          class={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            currentTab === 'a11y'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/60'
          }`}
        >
          <Accessibility class="h-3.5 w-3.5" />
          <span>{m.help_tab_a11y()}</span>
        </button>
      </div>
    </div>

    <!-- Tab Content Area -->
    <div
      class="flex-1 space-y-6 overflow-y-auto p-4 text-slate-700 sm:p-6 dark:text-slate-300"
    >
      {#if currentTab === 'basics'}
        <!-- 1. Basics & Philosophy -->
        <section class="space-y-4">
          <div
            class="rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/30"
          >
            <h3
              class="flex items-center gap-2 text-sm font-bold text-blue-900 dark:text-blue-300"
            >
              <Sparkles class="h-4 w-4" />
              {m.help_basics_concept_title()}
            </h3>
            <p
              class="mt-1.5 text-xs leading-relaxed text-blue-800 dark:text-blue-200"
            >
              {m.help_basics_concept_desc()}
            </p>
          </div>

          <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div
              class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/30"
            >
              <div
                class="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white"
              >
                <MapPin class="h-4 w-4 text-emerald-500" />
                {m.help_basics_exif_title()}
              </div>
              <p
                class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
              >
                {m.help_basics_exif_desc()}
              </p>
            </div>

            <div
              class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/30"
            >
              <div
                class="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white"
              >
                <Shield class="h-4 w-4 text-blue-500" />
                {m.help_basics_c2pa_title()}
              </div>
              <p
                class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
              >
                {m.help_basics_c2pa_desc()}
              </p>
            </div>

            <div
              class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/30"
            >
              <div
                class="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white"
              >
                <Radio class="h-4 w-4 text-amber-500" />
                {m.help_basics_status_title()}
              </div>
              <p
                class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
              >
                {m.help_basics_status_desc()}
              </p>
            </div>

            <div
              class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/30"
            >
              <div
                class="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white"
              >
                <Check class="h-4 w-4 text-indigo-500" />
                {m.help_basics_verify_title()}
              </div>
              <p
                class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
              >
                {m.help_basics_verify_desc()}
              </p>
            </div>
          </div>
        </section>
      {:else if currentTab === 'disaster'}
        <!-- 2. Offline & Disaster Resilience -->
        <section class="space-y-4">
          <div
            class="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
          >
            <h3
              class="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-300"
            >
              <WifiOff class="h-4 w-4" />
              {m.help_disaster_concept_title()}
            </h3>
            <p
              class="mt-1.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200"
            >
              {m.help_disaster_concept_desc()}
            </p>
          </div>

          <div class="space-y-3">
            <div
              class="flex items-start gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <Compass class="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h4 class="text-xs font-bold text-slate-900 dark:text-white">
                  {m.help_disaster_hud_title()}
                </h4>
                <p
                  class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
                >
                  {m.help_disaster_hud_desc()}
                </p>
              </div>
            </div>

            <div
              class="flex items-start gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <QrCode
                  class="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                />
              </div>
              <div>
                <h4 class="text-xs font-bold text-slate-900 dark:text-white">
                  {m.help_disaster_qr_title()}
                </h4>
                <p
                  class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
                >
                  {m.help_disaster_qr_desc()}
                </p>
              </div>
            </div>

            <div
              class="flex items-start gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <Bell class="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h4 class="text-xs font-bold text-slate-900 dark:text-white">
                  {m.help_disaster_push_title()}
                </h4>
                <p
                  class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
                >
                  {m.help_disaster_push_desc()}
                </p>
              </div>
            </div>
          </div>
        </section>
      {:else if currentTab === 'security'}
        <!-- 3. Security & E2EE -->
        <section class="space-y-4">
          <div
            class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30"
          >
            <h3
              class="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-300"
            >
              <Shield class="h-4 w-4" />
              {m.help_security_concept_title()}
            </h3>
            <p
              class="mt-1.5 text-xs leading-relaxed text-emerald-800 dark:text-emerald-200"
            >
              {m.help_security_concept_desc()}
            </p>
          </div>

          <div class="space-y-3">
            <div
              class="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800"
            >
              <div
                class="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white"
              >
                <Lock class="h-4 w-4 text-amber-500" />
                {m.help_security_passkey_title()}
              </div>
              <p
                class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
              >
                {m.help_security_passkey_desc()}
              </p>
            </div>

            <div
              class="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800"
            >
              <div
                class="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white"
              >
                <Shield class="h-4 w-4 text-blue-500" />
                {m.help_security_e2ee_title()}
              </div>
              <p
                class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
              >
                {m.help_security_e2ee_desc()}
              </p>
            </div>

            <div
              class="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800"
            >
              <div
                class="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white"
              >
                <Cpu class="h-4 w-4 text-purple-500" />
                {m.help_security_edge_title()}
              </div>
              <p
                class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
              >
                {m.help_security_edge_desc()}
              </p>
            </div>
          </div>
        </section>
      {:else if currentTab === 'ai_api'}
        <!-- 4. AI & MCP / Developer Integration -->
        <section class="space-y-4">
          <div
            class="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/30"
          >
            <h3
              class="flex items-center gap-2 text-sm font-bold text-indigo-900 dark:text-indigo-300"
            >
              <Bot class="h-4 w-4" />
              {m.help_ai_mcp_title()}
            </h3>
            <p
              class="mt-1.5 text-xs leading-relaxed text-indigo-800 dark:text-indigo-200"
            >
              {m.help_ai_mcp_desc()}
            </p>
          </div>

          <!-- MCP Config Card -->
          <div
            class="rounded-xl border border-slate-200 bg-slate-900 p-4 text-slate-200 dark:border-slate-700"
          >
            <div
              class="flex items-center justify-between border-b border-slate-800 pb-2"
            >
              <span class="text-xs font-semibold text-slate-400">
                Claude Desktop / Cursor MCP Config
              </span>
              <button
                type="button"
                onclick={copyMcpConfig}
                class="text-2xs flex cursor-pointer items-center gap-1 rounded bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:bg-slate-700"
              >
                {#if copiedConfig}
                  <Check class="h-3 w-3 text-emerald-400" />
                  <span class="text-emerald-400">{m.help_ai_copied()}</span>
                {:else}
                  <Copy class="h-3 w-3" />
                  <span>{m.help_ai_copy()}</span>
                {/if}
              </button>
            </div>
            <pre
              class="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-emerald-400">{mcpConfigJson}</pre>
          </div>

          <!-- Findability Endpoints -->
          <div class="space-y-2">
            <h4 class="text-xs font-bold text-slate-900 dark:text-white">
              {m.help_ai_discovery_title()}
            </h4>
            <div class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <a
                href="/llms.txt"
                target="_blank"
                rel="noreferrer"
                class="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
              >
                <div
                  class="font-mono font-medium text-blue-600 dark:text-blue-400"
                >
                  /llms.txt
                </div>
                <div class="text-2xs flex items-center gap-1 text-slate-500">
                  <span>AI/LLM Briefing</span>
                  <ExternalLink class="h-3 w-3" />
                </div>
              </a>

              <a
                href="/feed.xml"
                target="_blank"
                rel="noreferrer"
                class="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
              >
                <div
                  class="font-mono font-medium text-amber-600 dark:text-amber-400"
                >
                  /feed.xml
                </div>
                <div class="text-2xs flex items-center gap-1 text-slate-500">
                  <span>GeoRSS 2.0</span>
                  <ExternalLink class="h-3 w-3" />
                </div>
              </a>

              <a
                href="/sitemap.xml"
                target="_blank"
                rel="noreferrer"
                class="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
              >
                <div
                  class="font-mono font-medium text-emerald-600 dark:text-emerald-400"
                >
                  /sitemap.xml
                </div>
                <div class="text-2xs flex items-center gap-1 text-slate-500">
                  <span>Sitemap</span>
                  <ExternalLink class="h-3 w-3" />
                </div>
              </a>

              <a
                href="/robots.txt"
                target="_blank"
                rel="noreferrer"
                class="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
              >
                <div
                  class="font-mono font-medium text-slate-600 dark:text-slate-400"
                >
                  /robots.txt
                </div>
                <div class="text-2xs flex items-center gap-1 text-slate-500">
                  <span>Robots</span>
                  <ExternalLink class="h-3 w-3" />
                </div>
              </a>
            </div>
          </div>
        </section>
      {:else if currentTab === 'a11y'}
        <!-- 5. Web Accessibility Statement -->
        <div
          class="space-y-4"
          role="tabpanel"
          id="panel-help-a11y"
          aria-labelledby="tab-help-a11y"
          tabindex="0"
        >
          <div
            class="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50/50 p-4 dark:border-blue-900/50 dark:from-blue-950/40 dark:to-slate-900"
          >
            <div class="flex items-center gap-2">
              <Accessibility class="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">
                {m.a11y_title()}
              </h3>
            </div>
            <p
              class="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300"
            >
              {m.a11y_desc()}
            </p>
            <div
              class="mt-3 inline-flex items-center gap-1.5 rounded-full border border-blue-300 bg-white px-3 py-1 text-xs font-bold text-blue-800 shadow-2xs dark:border-blue-800 dark:bg-slate-800 dark:text-blue-300"
            >
              <span>🎯 目標水準:</span>
              <span>{m.a11y_standards()}</span>
            </div>
          </div>

          <div class="space-y-3">
            <h4 class="text-xs font-bold text-slate-800 dark:text-slate-200">
              実施している主なアクセシビリティ対応
            </h4>

            <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div
                class="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xs dark:border-slate-800 dark:bg-slate-800/80"
              >
                <div
                  class="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100"
                >
                  <span>🌸</span>
                  <span>やさしい日本語 (Easy Japanese)</span>
                </div>
                <p
                  class="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  子どもや外国人住民が緊急時に直感的に理解できるよう、平易な表現を標準言語として提供。
                </p>
              </div>

              <div
                class="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xs dark:border-slate-800 dark:bg-slate-800/80"
              >
                <div
                  class="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100"
                >
                  <span>⌨️</span>
                  <span>キーボード完全操作 & スキップリンク</span>
                </div>
                <p
                  class="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  Tab / Shift+Tab
                  による全機能操作、モーダルのフォーカストラップ、先頭スキップリンクを完備。
                </p>
              </div>

              <div
                class="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xs dark:border-slate-800 dark:bg-slate-800/80"
              >
                <div
                  class="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100"
                >
                  <span>🔊</span>
                  <span>スクリーンリーダー & Live Region</span>
                </div>
                <p
                  class="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  セマンティックHTML、WAI-ARIA、および非同期状態変化（オフライン移行や同期）の音声通知に対応。
                </p>
              </div>

              <div
                class="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xs dark:border-slate-800 dark:bg-slate-800/80"
              >
                <div
                  class="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100"
                >
                  <span>🔍</span>
                  <span>自由なズーム拡大 & コントラスト配慮</span>
                </div>
                <p
                  class="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  ユーザーによるピンチズーム拡大を制限せず、高コントラスト災害モード・ダークモードを常備。
                </p>
              </div>

              <div
                class="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xs dark:border-slate-800 dark:bg-slate-800/80"
              >
                <div
                  class="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100"
                >
                  <span>🌐</span>
                  <span>動的言語同期 (lang 属性)</span>
                </div>
                <p
                  class="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  言語切替時に HTML の lang
                  属性が動的に更新され、適切な音声合成エンジンが発動します。
                </p>
              </div>

              <div
                class="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xs dark:border-slate-800 dark:bg-slate-800/80"
              >
                <div
                  class="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100"
                >
                  <span>🍃</span>
                  <span>視覚効果の軽減 (Reduced Motion)</span>
                </div>
                <p
                  class="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  OSの「視覚効果を減らす」設定を検知し、不要な回転・明滅・アニメーションを自動抑制。
                </p>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div
      class="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50/50 px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900/50"
    >
      <span class="text-2xs text-slate-400">
        tossa v0.1.0 • Cloudflare-native Dual-use Platform
      </span>
      <button
        type="button"
        onclick={onClose}
        class="cursor-pointer rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
      >
        {m.btn_close()}
      </button>
    </div>
  </div>
</div>
