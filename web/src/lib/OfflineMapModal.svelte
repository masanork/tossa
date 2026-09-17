<!-- web/src/lib/OfflineMapModal.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { swipeDown } from './swipeToDismiss';
  import { focusTrap } from './focusTrap';
  import {
    getTilesForBounds,
    getTileCacheStats,
    downloadTiles,
    clearTileCache,
    type MapBounds,
    type TileCoordinate,
    type TileCacheStats,
    type DownloadProgress,
  } from './mapTileCache';
  import * as m from '../paraglide/messages.js';
  import {
    MapPin,
    Download,
    Trash2,
    X,
    CheckCircle2,
    AlertCircle,
    HardDrive,
    Layers,
  } from '@lucide/svelte';

  interface Props {
    isTop?: boolean;
    zIndex?: number;
    currentBounds: MapBounds | null;
    currentZoom: number;
    postsBounds: MapBounds | null;
    onClose: () => void;
  }

  const {
    isTop = true,
    zIndex = 50,
    currentBounds,
    currentZoom,
    postsBounds,
    onClose,
  }: Props = $props();

  let targetMode = $state<'current' | 'posts'>('current');
  let stats = $state<TileCacheStats>({ count: 0, estimatedSizeMB: 0 });
  let isDownloading = $state(false);
  let progress = $state<DownloadProgress>({ total: 0, loaded: 0, percent: 0 });
  let statusMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  let abortController: AbortController | null = null;

  // Compute zoom levels and planned tiles reactively
  const minZoom = $derived(
    targetMode === 'current' ? Math.max(7, currentZoom - 1) : 10
  );
  const maxZoom = $derived(
    targetMode === 'current' ? Math.min(16, currentZoom + 2) : 15
  );

  const activeBounds = $derived.by<MapBounds | null>(() => {
    if (targetMode === 'posts' && postsBounds) {
      return postsBounds;
    }
    return currentBounds;
  });

  const plannedTiles = $derived.by<TileCoordinate[]>(() => {
    if (!activeBounds) return [];
    return getTilesForBounds(activeBounds, minZoom, maxZoom, 1200);
  });

  const estimatedDownloadMB = $derived(
    Math.round((plannedTiles.length * 15 * 10) / 1024) / 10
  );

  onMount(async () => {
    await refreshStats();
  });

  async function refreshStats() {
    stats = await getTileCacheStats();
  }

  async function handleStartDownload() {
    if (plannedTiles.length === 0) return;

    isDownloading = true;
    statusMessage = null;
    progress = { total: plannedTiles.length, loaded: 0, percent: 0 };
    abortController = new AbortController();

    try {
      const result = await downloadTiles(plannedTiles, {
        signal: abortController.signal,
        concurrency: 4,
        delayMs: 20,
        onProgress: (p) => {
          progress = p;
        },
      });

      await refreshStats();

      if (result.success) {
        statusMessage = {
          type: 'success',
          text: m.map_offline_success(),
        };
      } else if (abortController?.signal.aborted) {
        statusMessage = {
          type: 'error',
          text: 'ダウンロードを中断しました',
        };
      }
    } catch (err) {
      statusMessage = {
        type: 'error',
        text: 'タイルのダウンロード中にエラーが発生しました',
      };
      console.error(err);
    } finally {
      isDownloading = false;
      abortController = null;
    }
  }

  function handleCancelDownload() {
    if (abortController) {
      abortController.abort();
    }
  }

  async function handleClearCache() {
    if (!confirm(m.map_offline_clear_confirm())) return;
    await clearTileCache();
    await refreshStats();
    statusMessage = {
      type: 'success',
      text: '保存した地図キャッシュを削除しました',
    };
  }
</script>

<div
  role="presentation"
  style="z-index: {zIndex};"
  inert={!isTop}
  onclick={(e) => {
    if (e.target === e.currentTarget && isTop && !isDownloading) onClose();
  }}
  class="fixed inset-0 flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs transition-opacity duration-200 sm:items-center sm:p-4 {isTop
    ? 'opacity-100'
    : 'opacity-80'}"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="offline-map-modal-title"
    tabindex="-1"
    use:focusTrap={{ onEscape: onClose }}
    use:swipeDown={onClose}
    class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-all duration-200 sm:rounded-2xl dark:bg-slate-900 dark:text-slate-100 {isTop
      ? 'scale-100 opacity-100'
      : 'pointer-events-none scale-[0.97] opacity-85'}"
  >
    <!-- Mobile drag handle -->
    <div
      class="mx-auto my-2.5 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
    ></div>

    <!-- Modal Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/80"
    >
      <div class="flex items-center gap-2">
        <div
          class="rounded-lg bg-blue-100 p-2 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
        >
          <Download class="h-5 w-5" />
        </div>
        <div>
          <h2
            id="offline-map-modal-title"
            class="text-base font-black text-slate-900 dark:text-white"
          >
            {m.map_offline_title()}
          </h2>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">
            {m.map_offline_desc()}
          </p>
        </div>
      </div>
      <button
        type="button"
        onclick={onClose}
        disabled={isDownloading}
        class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-300"
        aria-label="閉じる"
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <!-- Modal Body -->
    <div
      class="flex-1 space-y-4 overflow-y-auto p-5 text-xs text-slate-700 dark:text-slate-300"
    >
      <!-- Current Cache Status Card -->
      <div
        class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-800/60"
      >
        <div class="flex items-center gap-2.5">
          <HardDrive class="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <div>
            <div class="font-bold text-slate-800 dark:text-slate-100">
              {m.map_offline_stats({
                count: stats.count,
                size: stats.estimatedSizeMB,
              })}
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              端末ストレージに保管中（通信遮断時も即時表示）
            </div>
          </div>
        </div>
        {#if stats.count > 0}
          <button
            type="button"
            onclick={handleClearCache}
            disabled={isDownloading}
            class="flex cursor-pointer items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400"
          >
            <Trash2 class="h-3.5 w-3.5" />
            <span>{m.map_offline_clear_btn()}</span>
          </button>
        {/if}
      </div>

      <!-- Area Preset Selection -->
      <div class="space-y-2">
        <div class="block font-bold text-slate-800 dark:text-slate-200">
          保存する地図エリアを選択:
        </div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onclick={() => {
              targetMode = 'current';
            }}
            disabled={isDownloading}
            class={`flex cursor-pointer flex-col rounded-xl border p-3 text-left transition ${
              targetMode === 'current'
                ? 'border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/20 dark:border-blue-500 dark:bg-blue-950/60 dark:ring-blue-500/30'
                : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600'
            }`}
          >
            <div
              class="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white"
            >
              <MapPin class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>表示中のエリア</span>
            </div>
            <span class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              ズーム {minZoom}〜{maxZoom}
            </span>
          </button>

          <button
            type="button"
            onclick={() => {
              targetMode = 'posts';
            }}
            disabled={isDownloading || !postsBounds}
            class={`flex cursor-pointer flex-col rounded-xl border p-3 text-left transition ${
              targetMode === 'posts'
                ? 'border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/20 dark:border-blue-500 dark:bg-blue-950/60 dark:ring-blue-500/30'
                : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600'
            } ${!postsBounds ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <div
              class="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white"
            >
              <Layers
                class="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400"
              />
              <span>{m.map_offline_target_posts()}</span>
            </div>
            <span class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              投稿・避難所のある全地点（ズーム 10〜15）
            </span>
          </button>
        </div>
      </div>

      <!-- Estimated Download Info -->
      <div
        class="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-[11px] text-slate-600 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200"
      >
        <span>予定タイル数: <strong>{plannedTiles.length} 枚</strong></span>
        <span>予想データ量: <strong>約 {estimatedDownloadMB} MB</strong></span>
      </div>

      <!-- Status Notification -->
      {#if statusMessage}
        <div
          class="flex items-center gap-2 rounded-xl p-3 text-xs font-bold {statusMessage.type ===
          'success'
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'}"
        >
          {#if statusMessage.type === 'success'}
            <CheckCircle2
              class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          {:else}
            <AlertCircle
              class="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
            />
          {/if}
          <span>{statusMessage.text}</span>
        </div>
      {/if}

      <!-- Progress bar during download -->
      {#if isDownloading}
        <div
          class="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60"
        >
          <div class="flex items-center justify-between text-xs font-bold">
            <span class="text-blue-700 dark:text-blue-400">
              {m.map_offline_downloading({
                loaded: progress.loaded,
                total: progress.total,
                percent: progress.percent,
              })}
            </span>
            <button
              type="button"
              onclick={handleCancelDownload}
              class="cursor-pointer font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              {m.map_offline_cancel()}
            </button>
          </div>
          <div
            class="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
          >
            <div
              class="h-full bg-blue-600 transition-all duration-150"
              style="width: {progress.percent}%"
            ></div>
          </div>
        </div>
      {/if}

      <div
        class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
      >
        💡 <strong>安心機能</strong>:
        事前に地図を保存しておくと、電波が寸断された停電時や避難中でも現在地や避難所の位置関係をスムーズに確認できます。
      </div>
    </div>

    <!-- Modal Footer -->
    <div
      class="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/80"
    >
      <button
        type="button"
        onclick={onClose}
        disabled={isDownloading}
        class="cursor-pointer rounded-lg px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        閉じる
      </button>
      <button
        type="button"
        onclick={handleStartDownload}
        disabled={isDownloading || plannedTiles.length === 0}
        class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 active:scale-95 disabled:opacity-50"
      >
        <Download class="h-4 w-4" />
        <span
          >{isDownloading ? '保存中...' : m.map_offline_start_download()}</span
        >
      </button>
    </div>
  </div>
</div>
