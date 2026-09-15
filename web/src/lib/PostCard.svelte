<!-- web/src/lib/PostCard.svelte -->
<script lang="ts">
  import type { Post, ImageMeta } from './types';
  import { verifyPost } from './api';
  import {
    MapPin,
    Clock,
    ExternalLink,
    CheckCircle,
    RefreshCw,
    ShieldCheck,
    Camera,
    ThumbsUp,
    Link,
    Check,
    Image as ImageIcon,
  } from '@lucide/svelte';

  interface Props {
    post: Post;
    onOpenUpdateStatus: (post: Post) => void;
    onSelectTag?: (tag: string) => void;
  }

  let { post, onOpenUpdateStatus, onSelectTag }: Props = $props();

  // 現地確認ステート
  let verificationCount = $state(0);
  let lastVerifiedAt = $state<string | null>(null);
  let isVerifiedByMe = $state(false);
  let isVerifying = $state(false);

  $effect(() => {
    verificationCount = post.verification_count || 0;
    lastVerifiedAt = post.last_verified_at || null;
  });

  // 画像メタデータ（EXIF & C2PA）パース
  let parsedImageMeta = $derived.by<ImageMeta | null>(() => {
    if (!post.image_meta) return null;
    try {
      return typeof post.image_meta === 'string'
        ? JSON.parse(post.image_meta)
        : (post.image_meta as ImageMeta);
    } catch {
      return null;
    }
  });

  // Tags パース
  let parsedTags = $derived.by(() => {
    try {
      return post.tags ? (JSON.parse(post.tags) as string[]) : [];
    } catch {
      return [];
    }
  });

  // JSON attributes パース
  let parsedAttrs = $derived.by(() => {
    try {
      return post.attributes ? JSON.parse(post.attributes) : {};
    } catch {
      return {};
    }
  });

  // 情報源URLの信頼性バッジ
  let sourceTrustBadge = $derived.by(() => {
    if (!post.source_url) return null;
    try {
      const parsed = new URL(post.source_url.startsWith('http') ? post.source_url : `https://${post.source_url}`);
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith('.go.jp') || host.endsWith('.lg.jp')) {
        return { label: '公的機関・自治体公式', color: 'bg-emerald-50 text-emerald-800 border-emerald-300', icon: '🏛️', host };
      }
      if (host.endsWith('.ac.jp')) {
        return { label: '大学・学術機関', color: 'bg-blue-50 text-blue-800 border-blue-300', icon: '🎓', host };
      }
      if (
        host.includes('nhk.or.jp') ||
        host.includes('asahi.com') ||
        host.includes('yomiuri.co.jp') ||
        host.includes('mainichi.jp') ||
        host.includes('nikkei.com') ||
        host.includes('kyodonews.jp')
      ) {
        return { label: '報道機関', color: 'bg-indigo-50 text-indigo-800 border-indigo-300', icon: '📰', host };
      }
      if (host.includes('x.com') || host.includes('twitter.com')) {
        return { label: 'SNS公式・現地ポスト', color: 'bg-slate-100 text-slate-800 border-slate-300', icon: '📱', host };
      }
      return { label: '情報源', color: 'bg-slate-50 text-slate-700 border-slate-200', icon: '🔗', host };
    } catch {
      return null;
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

  // 現地確認アクション（コミュニティによる正確性検証）
  async function handleVerify() {
    if (isVerifiedByMe || isVerifying) return;
    isVerifying = true;
    try {
      const res = await verifyPost(post.id);
      if (res.success) {
        isVerifiedByMe = true;
        if (typeof res.verificationCount === 'number') {
          verificationCount = res.verificationCount;
        } else {
          verificationCount += 1;
        }
        if (res.lastVerifiedAt) {
          lastVerifiedAt = res.lastVerifiedAt;
        }
      }
    } catch (err) {
      console.error('Failed to verify post:', err);
    } finally {
      isVerifying = false;
    }
  }

  // 写真モーダル拡大
  let showImageModal = $state(false);
</script>

<article class="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 hover:border-slate-300 transition-all flex flex-col gap-3">
  <!-- 上段: エリア・タグ・公式バッジ・最終更新 -->
  <div class="flex items-center justify-between gap-2 text-xs">
    <div class="flex items-center gap-1.5 flex-wrap">
      {#if parsedTags.length > 0}
        <button
          type="button"
          onclick={() => onSelectTag?.(parsedTags[0])}
          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-white text-[11px] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition shadow-2xs cursor-pointer"
        >
          <span>🏷️</span>
          <span>#{parsedTags[0]}</span>
        </button>
      {/if}

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

  <!-- 写真（添付されている場合） -->
  {#if post.image_url}
    <div class="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-950/5 flex flex-col">
      <button
        type="button"
        onclick={() => { showImageModal = true; }}
        class="relative w-full h-44 sm:h-48 overflow-hidden bg-slate-900 group cursor-pointer"
      >
        <img
          src={post.image_url}
          alt={post.title}
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
          <ImageIcon class="w-4 h-4" />
          <span>拡大表示</span>
        </div>
      </button>

      <!-- メディア真正性・EXIFバー -->
      <div class="p-2 bg-white/95 border-t border-slate-100 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
        <div class="flex items-center gap-1.5 flex-wrap">
          {#if parsedImageMeta?.c2pa?.hasC2pa}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-bold border border-emerald-300">
              <ShieldCheck class="w-3 h-3 text-emerald-600" />
              <span>C2PA 真正性認証済 ({parsedImageMeta.c2pa.claimGenerator || '署名済カメラ'})</span>
            </span>
          {/if}

          {#if parsedImageMeta?.exif?.dateTimeOriginal}
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
              <Camera class="w-3 h-3 text-slate-500" />
              <span>撮影: {new Date(parsedImageMeta.exif.dateTimeOriginal).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          {/if}
        </div>

        {#if post.lat && post.lng}
          <span class="text-slate-400 font-mono">📍 GPS位置あり</span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- タイトル & ステータスバッジ -->
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

  <!-- 情報源・参照リンク（検証バッジ付き） -->
  {#if post.source_url && sourceTrustBadge}
    <div class="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200/80 text-xs">
      <span class="text-slate-400 shrink-0">情報源:</span>
      <a
        href={post.source_url}
        target="_blank"
        rel="noopener noreferrer"
        class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[11px] border transition hover:opacity-80 shrink-0 ${sourceTrustBadge.color}`}
      >
        <span>{sourceTrustBadge.icon}</span>
        <span>{sourceTrustBadge.label}</span>
        <ExternalLink class="w-2.5 h-2.5 ml-0.5" />
      </a>
      <span class="text-[10px] text-slate-400 truncate">{sourceTrustBadge.host}</span>
    </div>
  {/if}

  <!-- 動的属性タグ（水の種類、営業時間など） -->
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

  <!-- 自発的ボキャブラリ・タグ -->
  {#if parsedTags.length > 0}
    <div class="flex items-center gap-1.5 flex-wrap">
      {#each parsedTags as t}
        {#if onSelectTag}
          <button
            type="button"
            onclick={() => onSelectTag?.(t)}
            class="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[11px] font-semibold transition cursor-pointer"
          >
            #{t}
          </button>
        {:else}
          <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold">
            #{t}
          </span>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- 下段: 正確性の検証 & 状況報告アクションバー -->
  <div class="pt-2.5 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mt-auto">
    <!-- 情報の正確性・現地確認ボタン -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={handleVerify}
        disabled={isVerifiedByMe || isVerifying}
        class={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer ${
          isVerifiedByMe
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
            : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 active:scale-95'
        }`}
        title="この情報が現在も有効であることを支持します"
      >
        {#if isVerifiedByMe}
          <Check class="w-3.5 h-3.5 text-emerald-600" />
          <span>現地確認済み ({verificationCount})</span>
        {:else}
          <ThumbsUp class="w-3.5 h-3.5 text-blue-600" />
          <span>現地で確認 ({verificationCount})</span>
        {/if}
      </button>

      {#if lastVerifiedAt}
        <span class="text-[10px] text-slate-400">
          確認: {formatRelativeTime(lastVerifiedAt)}
        </span>
      {/if}
    </div>

    <!-- 状況を報告するボタン -->
    <button
      type="button"
      onclick={() => onOpenUpdateStatus(post)}
      class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-95 transition cursor-pointer shadow-2xs"
    >
      <RefreshCw class="w-3.5 h-3.5 text-slate-500" />
      <span>状況を報告する</span>
    </button>
  </div>
</article>

<!-- 写真拡大モーダル -->
{#if showImageModal && post.image_url}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- 背景オーバーレイ -->
    <button
      type="button"
      onclick={() => { showImageModal = false; }}
      class="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity cursor-pointer border-none"
      aria-label="モーダルを閉じる"
    ></button>

    <!-- モーダルコンテンツ -->
    <div
      class="relative z-10 max-w-3xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="写真拡大表示"
    >
      <div class="p-3 bg-slate-800 text-white flex items-center justify-between">
        <span class="text-xs font-bold truncate pr-4">{post.title} の写真</span>
        <button
          type="button"
          onclick={() => { showImageModal = false; }}
          class="p-1 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
        >
          <X class="w-5 h-5" />
        </button>
      </div>
      <div class="p-2 flex items-center justify-center bg-black overflow-auto">
        <img src={post.image_url} alt={post.title} class="max-w-full max-h-[75vh] object-contain rounded" />
      </div>
      {#if parsedImageMeta?.c2pa?.hasC2pa}
        <div class="p-3 bg-slate-800 border-t border-slate-700 text-xs text-emerald-400 flex items-center gap-1.5 font-bold">
          <ShieldCheck class="w-4 h-4 text-emerald-400" />
          <span>C2PA コンテンツ来歴・真正性認証済み ({parsedImageMeta.c2pa.claimGenerator || '真正カメラ署名'})</span>
        </div>
      {/if}
    </div>
  </div>
{/if}
