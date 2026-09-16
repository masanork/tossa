<!-- web/src/lib/UpdateStatusModal.svelte -->
<script lang="ts">
  import type { Post } from './types';
  import { updatePostStatus } from './api';
  import { enqueueStatusUpdate } from './offlineQueue';
  import { X, Check, Clock, Coffee, XCircle, HelpCircle } from '@lucide/svelte';

  interface Props {
    post: Post;
    onClose: () => void;
    onUpdated: () => void;
  }

  const { post, onClose, onUpdated }: Props = $props();

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
      label: '受付中 / 利用可能',
      desc: '現在利用・利用受付が可能です',
      color: 'bg-emerald-50 text-emerald-700 border-emerald-300',
      icon: Check,
    },
    {
      status: 'crowded',
      label: '混雑中 / 順番待ち',
      desc: '利用可能ですが、待ち時間が発生しています',
      color: 'bg-amber-50 text-amber-700 border-amber-300',
      icon: Clock,
    },
    {
      status: 'few',
      label: '残りわずか',
      desc: '物資や定員が残り少なくなっています',
      color: 'bg-orange-50 text-orange-700 border-orange-300',
      icon: Coffee,
    },
    {
      status: 'closed',
      label: '終了 / 休止中',
      desc: '本日の受付終了、または一時休止中です',
      color: 'bg-rose-50 text-rose-700 border-rose-300',
      icon: XCircle,
    },
    {
      status: 'unknown',
      label: '確認中 / 不明',
      desc: '状況を確認中、または詳細不明です',
      color: 'bg-slate-50 text-slate-700 border-slate-300',
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
        enqueueStatusUpdate({
          postId: post.id,
          status: selectedStatus,
          statusLabel: selectedLabel,
          note: note.trim() || undefined,
        });
        onUpdated();
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
        onUpdated();
        onClose();
      } else {
        errorMessage = res.error || '更新に失敗しました';
      }
    } catch {
      // Offline fallback: save to local outbox
      enqueueStatusUpdate({
        postId: post.id,
        status: selectedStatus,
        statusLabel: selectedLabel,
        note: note.trim() || undefined,
      });
      onUpdated();
      onClose();
    } finally {
      isSubmitting = false;
    }
  }
</script>

{#if post}
  <div
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs"
  >
    <div
      class="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-150 max-h-[92vh] flex flex-col"
    >
      <!-- Mobile drag handle -->
      <div
        class="w-10 h-1 bg-slate-300 rounded-full mx-auto my-2 sm:hidden shrink-0"
      ></div>

      <!-- Modal header -->
      <div
        class="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0"
      >
        <div>
          <span class="text-xs font-bold text-blue-600 tracking-wide uppercase"
            >状況の報告・更新</span
          >
          <h2
            class="text-base font-black text-slate-900 truncate max-w-xs sm:max-w-md"
          >
            {post.title}
          </h2>
        </div>
        <button
          type="button"
          onclick={onClose}
          class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Form -->
      <form onsubmit={handleSubmit} class="p-5 flex flex-col gap-4">
        {#if errorMessage}
          <div
            class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium"
          >
            {errorMessage}
          </div>
        {/if}

        <div>
          <span class="block text-xs font-bold text-slate-700 mb-2"
            >現在の状況を選択（1タップ）</span
          >
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {#each statusOptions as opt (opt.status)}
              {@const Icon = opt.icon}
              <button
                type="button"
                onclick={() => selectPreset(opt.status, opt.label)}
                class={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                  selectedStatus === opt.status
                    ? `${opt.color} ring-2 ring-offset-1 font-bold shadow-xs`
                    : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div class="flex items-center gap-1.5 text-xs">
                  <Icon class="w-4 h-4 shrink-0" />
                  <span class="font-bold">{opt.label}</span>
                </div>
                <span
                  class="text-[11px] text-slate-500 line-clamp-2 leading-tight"
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
            class="block text-xs font-bold text-slate-700 mb-1"
          >
            補足・現場メモ（任意）
          </label>
          <input
            id="update-note"
            type="text"
            bind:value={note}
            placeholder="例: 現在待機列10名程度、ポリタンク持参必須、パン入荷など"
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>

        <div
          class="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px] leading-relaxed"
        >
          💡 現場の善意による情報提供です。正確な情報の維持にご協力ください。
        </div>

        <!-- Action buttons -->
        <div
          class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100"
        >
          <button
            type="button"
            onclick={onClose}
            class="px-4 py-2 text-xs font-bold rounded-lg text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            class="px-5 py-2 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-xs transition active:scale-95 cursor-pointer"
          >
            {isSubmitting ? '更新中...' : 'この状況を報告する'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
