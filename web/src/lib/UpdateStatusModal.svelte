<!-- web/src/lib/UpdateStatusModal.svelte -->
<script lang="ts">
  import type { Post } from './types';
  import { updatePostStatus } from './api';
  import { enqueueStatusUpdate } from './offlineQueue';
  import { swipeDown } from './swipeToDismiss';
  import { focusTrap } from './focusTrap';
  import { X, Check, Clock, Coffee, XCircle, HelpCircle } from '@lucide/svelte';

  interface Props {
    post: Post;
    isTop?: boolean;
    zIndex?: number;
    onClose: () => void;
    onUpdated: (update?: {
      status: string;
      statusLabel: string;
      note?: string;
    }) => void;
  }

  const {
    post,
    isTop = true,
    zIndex = 50,
    onClose,
    onUpdated,
  }: Props = $props();

  let selectedStatus = $state('available');
  let selectedLabel = $state('受付中');
  let note = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');

  $effect(() => {
    if (post) {
      selectedStatus = post.current_status || 'available';
      selectedLabel = post.status_label || '受付中';
    }
  });

  // Status preset options
  const statusOptions = [
    {
      status: 'available',
      symbol: '○',
      label: '受付中 / 利用可能',
      desc: '現在利用・利用受付が可能です',
      color:
        'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700',
      icon: Check,
    },
    {
      status: 'crowded',
      symbol: '▲',
      label: '混雑中 / 順番待ち',
      desc: '利用可能ですが、待ち時間が発生しています',
      color:
        'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700',
      icon: Clock,
    },
    {
      status: 'few',
      symbol: '▲',
      label: '残りわずか',
      desc: '物資や定員が残り少なくなっています',
      color:
        'bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-700',
      icon: Coffee,
    },
    {
      status: 'closed',
      symbol: '✕',
      label: '終了 / 休止中',
      desc: '本日の受付終了、または一時休止中です',
      color:
        'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-700',
      icon: XCircle,
    },
    {
      status: 'unknown',
      symbol: '?',
      label: '確認中 / 不明',
      desc: '状況を確認中、または詳細不明です',
      color:
        'bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      icon: HelpCircle,
    },
  ];

  function selectPreset(status: string, label: string) {
    selectedStatus = status;
    selectedLabel = label;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!post) return;

    isSubmitting = true;
    errorMessage = '';

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const payload = {
          status: selectedStatus,
          statusLabel: selectedLabel,
          note: note.trim() || undefined,
        };
        enqueueStatusUpdate({
          postId: post.id,
          ...payload,
        });
        onUpdated(payload);
        onClose();
        return;
      }

      const res = await updatePostStatus(
        post.id,
        selectedStatus,
        selectedLabel,
        note
      );
      if (res.success) {
        onUpdated({
          status: selectedStatus,
          statusLabel: selectedLabel,
          note: note.trim() || undefined,
        });
        onClose();
      } else {
        errorMessage = res.error || '更新に失敗しました';
      }
    } catch {
      // Offline fallback: save to local outbox
      const payload = {
        status: selectedStatus,
        statusLabel: selectedLabel,
        note: note.trim() || undefined,
      };
      enqueueStatusUpdate({
        postId: post.id,
        ...payload,
      });
      onUpdated(payload);
      onClose();
    } finally {
      isSubmitting = false;
    }
  }
</script>

{#if post}
  <div
    role="presentation"
    style="z-index: {zIndex};"
    inert={!isTop}
    onclick={(e) => {
      if (e.target === e.currentTarget && isTop) onClose();
    }}
    class="fixed inset-0 flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs transition-opacity duration-200 sm:items-center sm:p-4 {isTop
      ? 'opacity-100'
      : 'opacity-80'}"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-status-title"
      use:focusTrap={{ onEscape: onClose }}
      use:swipeDown={onClose}
      class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl transition-all duration-200 sm:rounded-2xl sm:border dark:border-slate-800 dark:bg-slate-900 {isTop
        ? 'scale-100 opacity-100'
        : 'pointer-events-none scale-[0.97] opacity-85'}"
    >
      <!-- Mobile drag handle -->
      <div
        class="mx-auto my-2.5 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
      ></div>

      <!-- Modal header -->
      <div
        class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/80"
      >
        <div>
          <span
            class="text-xs font-bold tracking-wide text-blue-600 uppercase dark:text-blue-400"
            >状況の報告・更新</span
          >
          <h2
            id="update-status-title"
            class="mt-0.5 text-base font-black text-slate-900 dark:text-slate-100"
          >
            {post.title}
          </h2>
        </div>
        <button
          type="button"
          onclick={onClose}
          aria-label="閉じる"
          class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <!-- Form -->
      <form onsubmit={handleSubmit} class="flex flex-col gap-4 p-5">
        {#if errorMessage}
          <div
            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
          >
            {errorMessage}
          </div>
        {/if}

        <div>
          <span
            class="mb-2 block text-xs font-bold text-slate-700 dark:text-slate-300"
            >現在の状況を選択（1タップ）</span
          >
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {#each statusOptions as opt (opt.status)}
              {@const Icon = opt.icon}
              <button
                type="button"
                onclick={() => selectPreset(opt.status, opt.label)}
                class={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition-all ${
                  selectedStatus === opt.status
                    ? `${opt.color} font-bold shadow-xs ring-2 ring-offset-1 dark:ring-offset-slate-900`
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <div class="flex items-center gap-1.5 text-xs">
                  <Icon class="h-4 w-4 shrink-0" />
                  <span class="font-bold">[{opt.symbol}] {opt.label}</span>
                </div>
                <span
                  class="line-clamp-2 text-[11px] leading-tight text-slate-500 dark:text-slate-400"
                >
                  {opt.desc}
                </span>
              </button>
            {/each}
          </div>
        </div>

        <!-- Additional notes -->
        <div>
          <label
            for="update-note"
            class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            補足・現場メモ（任意）
          </label>
          <input
            id="update-note"
            type="text"
            bind:value={note}
            placeholder="例: 現在待機列10名程度、ポリタンク持参必須、パン入荷など"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div
          class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        >
          💡 現場の善意による情報提供です。正確な情報の維持にご協力ください。
        </div>

        <!-- Action buttons -->
        <div
          class="flex items-center justify-end gap-2 border-t border-slate-100 pt-2 dark:border-slate-800"
        >
          <button
            type="button"
            onclick={onClose}
            class="cursor-pointer rounded-lg px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            class="cursor-pointer rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 active:scale-95 disabled:opacity-50"
          >
            {isSubmitting ? '更新中...' : 'この状況を報告する'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
