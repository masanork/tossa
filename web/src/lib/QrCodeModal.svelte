<!-- web/src/lib/QrCodeModal.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { swipeDown } from './swipeToDismiss';
  import { focusTrap } from './focusTrap';
  import type { Post } from './types';
  import {
    encodePostToQrUrl,
    generateQrSvg,
    generateQrDataUrl,
  } from './qrCodec';
  import * as m from '../paraglide/messages.js';
  import {
    QrCode as QrCodeIcon,
    X,
    Download,
    Copy,
    Check,
    Share2,
    Sun,
    MapPin,
  } from '@lucide/svelte';

  interface Props {
    isTop?: boolean;
    zIndex?: number;
    post: Post;
    onClose: () => void;
  }

  const { isTop = true, zIndex = 50, post, onClose }: Props = $props();

  let qrSvg = $state<string>('');
  let qrDataUrl = $state<string>('');
  let shareUrl = $state<string>('');
  let isCopied = $state(false);
  let isGenerating = $state(true);
  let canShare = $state(false);

  onMount(async () => {
    canShare = typeof navigator !== 'undefined' && 'share' in navigator;
    try {
      shareUrl = encodePostToQrUrl(post);
      const [svg, dataUrl] = await Promise.all([
        generateQrSvg(shareUrl, { width: 260, margin: 2 }),
        generateQrDataUrl(shareUrl, { width: 400, margin: 2 }),
      ]);
      qrSvg = svg;
      qrDataUrl = dataUrl;
    } catch (err) {
      console.error('Failed to generate QR code:', err);
    } finally {
      isGenerating = false;
    }
  });

  async function handleCopyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      isCopied = true;
      setTimeout(() => {
        isCopied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }

  function handleDownloadImage() {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    const cleanTitle = post.title
      .replace(/[^a-zA-Z0-9_\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff-]/g, '_')
      .slice(0, 16);
    a.download = `tossa_qr_${cleanTitle || 'post'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleNativeShare() {
    if (!navigator.share || !shareUrl) return;
    try {
      await navigator.share({
        title: `tossa: ${post.title}`,
        text: `【${post.status_label}】${post.title} (${post.area})\n${post.note || ''}`,
        url: shareUrl,
      });
    } catch {
      // User cancelled share or aborted
    }
  }
</script>

<div
  style="z-index: {zIndex}"
  role="presentation"
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
    aria-labelledby="qr-code-modal-title"
    use:focusTrap={{ onEscape: onClose }}
    use:swipeDown={onClose}
    class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-all duration-200 sm:rounded-2xl dark:bg-slate-900 dark:text-slate-100 {isTop
      ? 'scale-100 opacity-100'
      : 'pointer-events-none scale-[0.97] opacity-85'}"
  >
    <!-- Mobile drag handle -->
    <div
      class="mx-auto my-2.5 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
    ></div>

    <!-- Modal Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/80"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="rounded-lg bg-indigo-100 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400"
        >
          <QrCodeIcon class="h-5 w-5" />
        </div>
        <div>
          <h2
            id="qr-code-modal-title"
            class="text-base font-black text-slate-900 dark:text-white"
          >
            {m.qr_share_title()}
          </h2>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">
            {post.area} • {post.status_label}
          </p>
        </div>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
        aria-label="閉じる"
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <!-- Modal Body -->
    <div
      class="flex flex-col items-center overflow-y-auto px-5 py-4 text-center"
    >
      <!-- Target post brief info -->
      <div
        class="mb-3 w-full rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-left text-xs dark:border-slate-800 dark:bg-slate-800/50"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="line-clamp-1 font-bold text-slate-900 dark:text-white">
            {post.title}
          </span>
          <span
            class="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          >
            {post.status_label}
          </span>
        </div>
        {#if post.address}
          <div
            class="mt-1 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
          >
            <MapPin class="h-3 w-3 shrink-0" />
            <span class="truncate">{post.address}</span>
          </div>
        {/if}
      </div>

      <!-- QR Code high-contrast viewport (always pure white box for optical recognition) -->
      <div
        class="relative flex h-[260px] w-[260px] items-center justify-center rounded-2xl border border-slate-300 bg-white p-3 shadow-md dark:border-slate-600"
      >
        {#if isGenerating}
          <div
            class="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500"
          >
            <div
              class="h-8 w-8 animate-spin rounded-full border-3 border-indigo-500 border-t-transparent"
            ></div>
            <span class="text-xs">QRコード生成中...</span>
          </div>
        {:else if qrSvg}
          <div class="h-full w-full [&>svg]:h-full [&>svg]:w-full">
            <!-- Render pure SVG -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html qrSvg}
          </div>
        {:else}
          <span class="text-xs text-rose-500">QRコード生成に失敗しました</span>
        {/if}
      </div>

      <!-- Instructions & Brightness tip -->
      <div
        class="mt-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
      >
        <Sun class="h-4 w-4 shrink-0 text-amber-500" />
        <span>{m.qr_brightness_tip()}</span>
      </div>
      <p class="mt-1 max-w-xs text-[11px] text-slate-400 dark:text-slate-500">
        {m.qr_share_desc()}
      </p>

      <!-- Action Buttons -->
      <div class="mt-4 grid w-full grid-cols-2 gap-2 sm:flex sm:justify-center">
        <!-- Download image button -->
        <button
          type="button"
          onclick={handleDownloadImage}
          disabled={!qrDataUrl}
          class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Download class="h-3.5 w-3.5" />
          <span>{m.qr_save_image()}</span>
        </button>

        <!-- Copy link button -->
        <button
          type="button"
          onclick={handleCopyLink}
          disabled={!shareUrl}
          class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {#if isCopied}
            <Check class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span class="text-emerald-600 dark:text-emerald-400"
              >{m.qr_copied()}</span
            >
          {:else}
            <Copy class="h-3.5 w-3.5" />
            <span>{m.qr_copy_link()}</span>
          {/if}
        </button>

        <!-- Web Share API button if supported -->
        {#if canShare}
          <button
            type="button"
            onclick={handleNativeShare}
            class="col-span-2 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md transition hover:bg-indigo-700 sm:col-span-1"
          >
            <Share2 class="h-3.5 w-3.5" />
            <span>{m.qr_share_btn()}</span>
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
