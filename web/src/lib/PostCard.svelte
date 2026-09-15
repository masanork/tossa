<!-- web/src/lib/PostCard.svelte -->
<script lang="ts">
  import type { Post } from './types';
  import { MapPin, Clock, ExternalLink, CheckCircle, RefreshCw } from '@lucide/svelte';

  interface Props {
    post: Post;
    onOpenUpdateStatus: (post: Post) => void;
  }

  let { post, onOpenUpdateStatus }: Props = $props();

  // JSON attributes パース
  let parsedAttrs = $derived.by(() => {
    try {
      return post.attributes ? JSON.parse(post.attributes) : {};
    } catch {
      return {};
    }
  });

  // 相対時間フォーマット
  function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (isNaN(diffSec) || diffSec < 0) return 'たった今';
    if (diffSec < 60) return `${diffSec}秒前`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
    return `${Math.floor(diffSec / 86400)}日前`;
  }

  // ステータスの色分け
  function getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'available':
      case 'open':
        return 'bg-emerald-500 text-white';
      case 'crowded':
      case 'low_stock':
        return 'bg-amber-500 text-white';
      case 'closed':
      case 'danger':
      case 'out_of_stock':
        return 'bg-rose-600 text-white';
      default:
        return 'bg-blue-600 text-white';
    }
  }
</script>

<article class="bg-white rounded-xl p-4 shadow-xs border border-slate-200 hover:border-slate-300 transition-all flex flex-col gap-3">
  <!-- 上段: カテゴリ・エリア・公式バッジ -->
  <div class="flex items-center justify-between gap-2 text-xs">
    <div class="flex items-center gap-1.5 flex-wrap">
      <span
        class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-white text-[11px]"
        style={`background-color: ${post.category_color || '#3b82f6'};`}
      >
        <span>{post.category_icon || '📌'}</span>
        <span>{post.category_name || '情報'}</span>
      </span>

      <span class="px-2 py-0.5 rounded-md font-semibold bg-slate-100 text-slate-700 text-[11px]">
        {post.area}
      </span>

      {#if post.is_verified === 1}
        <span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-bold bg-blue-50 text-blue-700 border border-blue-200 text-[10px]">
          <CheckCircle class="w-3 h-3 text-blue-600" />
          公式確認済
        </span>
      {/if}
    </div>

    <!-- 最終更新時刻 -->
    <div class="flex items-center gap-1 text-[11px] text-slate-400 font-medium shrink-0">
      <Clock class="w-3 h-3" />
      <span>{formatRelativeTime(post.updated_at)}</span>
    </div>
  </div>

  <!-- タイトル & ステータスバッジ（最重要） -->
  <div class="flex items-start justify-between gap-3">
    <h3 class="text-base font-bold text-slate-900 leading-snug">
      {post.title}
    </h3>

    <span class={`shrink-0 px-3 py-1 rounded-lg text-xs font-black tracking-wide shadow-xs ${getStatusBadgeClass(post.current_status)}`}>
      {post.status_label}
    </span>
  </div>

  <!-- 住所 -->
  {#if post.address}
    <div class="flex items-center gap-1.5 text-xs text-slate-600">
      <MapPin class="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span class="truncate">{post.address}</span>
    </div>
  {/if}

  <!-- 備考・詳細情報 -->
  {#if post.note}
    <p class="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg leading-relaxed whitespace-pre-wrap">
      {post.note}
    </p>
  {/if}

  <!-- 動的属性タグ（水の種類、営業時間、物資一覧など） -->
  {#if Object.keys(parsedAttrs).length > 0}
    <div class="flex items-center gap-1.5 flex-wrap">
      {#each Object.entries(parsedAttrs) as [key, val]}
        {#if typeof val === 'string' || typeof val === 'number'}
          <span class="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-medium">
            <span class="text-slate-400 mr-1">{key}:</span> {val}
          </span>
        {:else if Array.isArray(val)}
          {#each val as item}
            <span class="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-medium">
              🏷️ {item}
            </span>
          {/each}
        {/if}
      {/each}
    </div>
  {/if}

  <!-- 下段アクションバー -->
  <div class="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
    <!-- 外部リンク -->
    {#if post.url}
      <a
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
      >
        <span>リンクを開く</span>
        <ExternalLink class="w-3 h-3" />
      </a>
    {:else}
      <span></span>
    {/if}

    <!-- 状況更新ボタン（1タップ更新モーダル呼び出し） -->
    <button
      type="button"
      onclick={() => onOpenUpdateStatus(post)}
      class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-95 transition cursor-pointer shadow-2xs"
    >
      <RefreshCw class="w-3.5 h-3.5 text-slate-500" />
      <span>状況を報告する</span>
    </button>
  </div>
</article>
