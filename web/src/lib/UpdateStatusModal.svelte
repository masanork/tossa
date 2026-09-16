<!-- web/src/lib/UpdateStatusModal.svelte -->
<script lang="ts">
  import type { Post } from './types';
  import { updatePostStatus } from './api';
  import { X, CheckCircle2, AlertCircle, Clock, Ban } from '@lucide/svelte';

  interface Props {
    post: Post | null;
    onClose: () => void;
    onUpdated: () => void;
  }

  let { post, onClose, onUpdated }: Props = $props();

  let selectedStatus = $state('available');
  let selectedLabel = $state('受付中 / 在庫あり');
  let note = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');

  // Preset status options
  const statusOptions = [
    {
      status: 'available',
      label: '受付中 / 利用可能',
      desc: '問題なく利用・給水・配布が行われています',
      color:
        'bg-emerald-50 border-emerald-300 text-emerald-800 ring-emerald-500',
      icon: CheckCircle2,
    },
    {
      status: 'crowded',
      label: '混雑中 / 残りわずか',
      desc: '待機列が発生している、または在庫が少なくなっています',
      color: 'bg-amber-50 border-amber-300 text-amber-800 ring-amber-500',
      icon: Clock,
    },
    {
      status: 'out_of_stock',
      label: '配布終了 / 完売',
      desc: '本日の配分が終了したか、売り切れました',
      color: 'bg-rose-50 border-rose-300 text-rose-800 ring-rose-500',
      icon: Ban,
    },
    {
      status: 'closed',
      label: '一時休止 / 閉鎖中',
      desc: '現在は受付を中断または終了しています',
      color: 'bg-slate-100 border-slate-300 text-slate-800 ring-slate-500',
      icon: AlertCircle,
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
    } catch (err: any) {
      errorMessage = err.message || '通信エラーが発生しました';
    } finally {
      isSubmitting = false;
    }
  }
</script>

{#if post}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
  >
    <div
      class="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      <!-- Modal header -->
      <div
        class="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50"
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
            {#each statusOptions as opt}
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
