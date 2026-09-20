<!-- web/src/lib/PrintSheetModal.svelte: A4 printable notice sheet for posting on walls -->
<script lang="ts">

  /* eslint-disable @typescript-eslint/no-unused-vars */
  import { onMount } from 'svelte';
  import type { Post } from './types';
  import { Printer, X } from '@lucide/svelte';
  import QRCode from 'qrcode';
  import { m, i18n } from './i18n.svelte';
  import { focusTrap } from './focusTrap';

  interface Props {
    post: Post;
    onClose: () => void;
  }

  const { post, onClose }: Props = $props();

  let qrDataUrl = $state<string>('');
  let printedAt = $state<string>('');

  onMount(async () => {
    // Generate high-resolution QR code (300dpi clean print)
    try {
      const url = `${window.location.origin}/posts/${post.id}`;
      qrDataUrl = await QRCode.toDataURL(url, {
        width: 400,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
    } catch (e) {
      console.error('Failed to generate print QR', e);
    }

    const now = new Date();
    printedAt = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });

  function handlePrint() {
    window.print();
  }

  function getStatusBadgeText(
    status: string,
    customLabel?: string | null
  ): string {
    if (customLabel) return customLabel;
    switch (status) {
      case 'available':
      case 'open':
        return '◎ 開設中・利用可能';
      case 'crowded':
      case 'few':
      case 'low_stock':
        return '▲ 混雑・残りわずか';
      case 'closed':
      case 'danger':
      case 'out_of_stock':
        return '✕ 終了・受付休止中';
      default:
        return '？ 確認中';
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onClose();
  }}
/>

<!-- Backdrop (hidden during print) -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/80 p-2 backdrop-blur-sm sm:p-4 print:bg-white print:p-0"
  role="dialog"
  aria-modal="true"
  aria-label={m.print_sheet_title()}
  use:focusTrap
>
  <!-- Modal Dialog Container -->
  <div
    class="relative my-auto flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900 print:m-0 print:max-h-none print:w-full print:max-w-none print:rounded-none print:bg-white print:shadow-none"
  >
    <!-- Header Controls (hidden on print) -->
    <div
      class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800 print:hidden"
    >
      <div class="flex items-center gap-2">
        <Printer class="h-5 w-5 text-blue-600 dark:text-blue-400" />
        <div>
          <h2 class="text-sm font-bold text-slate-900 dark:text-white">
            {m.print_sheet_title()}
          </h2>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">
            {m.print_sheet_desc()}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={handlePrint}
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
        >
          <Printer class="h-3.5 w-3.5" />
          <span>{m.print_btn_action()}</span>
        </button>
        <button
          type="button"
          onclick={onClose}
          class="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label={m.btn_close()}
        >
          <X class="h-5 w-5" />
        </button>
      </div>
    </div>

    <!-- Scrollable A4 Sheet Paper Preview -->
    <div
      class="overflow-y-auto bg-slate-100 p-4 sm:p-6 dark:bg-slate-950/60 print:bg-white print:p-0"
    >
      <!-- A4 Sheet (aspect-ratio close to A4: 1:1.414) -->
      <div
        class="print-sheet-paper mx-auto w-full max-w-[640px] rounded-lg border-2 border-slate-800 bg-white p-6 text-slate-950 shadow-md sm:p-8 print:m-0 print:w-full print:max-w-none print:border-4 print:border-black print:p-8 print:shadow-none"
      >
        <!-- Sheet Header -->
        <div
          class="flex items-center justify-between border-b-2 border-black pb-3"
        >
          <div>
            <span
              class="text-xs font-black tracking-wider text-slate-700 uppercase print:text-black"
            >
              tossa 地域の生活情報・防災速報 掲示板
            </span>
            <div class="text-[11px] text-slate-500 print:text-black">
              発行日時: {printedAt}
            </div>
          </div>
          <div
            class="rounded border border-black px-2 py-0.5 text-[11px] font-black"
          >
            📍 {post.area}
          </div>
        </div>

        <!-- Facility Name & Status Banner -->
        <div class="my-5">
          <div
            class="inline-block rounded-md border-2 border-black bg-black px-3 py-1 text-sm font-black text-white"
          >
            {getStatusBadgeText(post.current_status, post.status_label)}
          </div>

          <h1
            class="mt-3 text-2xl leading-tight font-black tracking-tight sm:text-3xl print:text-4xl"
          >
            {post.title}
          </h1>

          {#if post.address}
            <div class="mt-2 text-sm font-bold text-slate-700 print:text-black">
              所在地: {post.address}
            </div>
          {/if}
        </div>

        <!-- Details / Notes Box -->
        {#if post.note}
          <div
            class="my-4 rounded-lg border-2 border-black bg-slate-50 p-4 print:bg-white"
          >
            <div
              class="text-xs font-black text-slate-500 uppercase print:text-black"
            >
              ■ 現在の状況・連絡事項
            </div>
            <p
              class="mt-1 text-base leading-relaxed font-semibold whitespace-pre-wrap"
            >
              {post.note}
            </p>
          </div>
        {/if}

        <!-- QR Code & Scanner Instructions -->
        <div class="my-6 rounded-xl border-2 border-dashed border-black p-4">
          <div
            class="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="space-y-1.5 text-center sm:text-left">
              <div class="text-sm font-black text-blue-900 print:text-black">
                【スマホで最新状況を確認・更新】
              </div>
              <p
                class="text-xs leading-relaxed text-slate-700 print:text-black"
              >
                {m.print_qr_instruction()}
              </p>
              <div class="text-[11px] text-slate-500 print:text-black">
                ※ アプリのインストール不要。カメラで読み取るだけで開きます。
              </div>
            </div>

            {#if qrDataUrl}
              <div class="shrink-0 border-2 border-black bg-white p-1">
                <img
                  src={qrDataUrl}
                  alt="QR Code"
                  class="h-32 w-32 object-contain sm:h-36 sm:w-36 print:h-40 print:w-40"
                />
              </div>
            {/if}
          </div>
        </div>

        <!-- Footer -->
        <div
          class="mt-auto border-t border-slate-300 pt-3 text-center text-[10px] text-slate-500 print:border-black print:text-black"
        >
          tossa（咄嗟）-
          通信途絶時もオフライン動作する超軽量・地域生活情報システム
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  @media print {
    :global(body) {
      background: white !important;
      color: black !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    :global(header),
    :global(nav),
    :global(footer),
    :global(.no-print) {
      display: none !important;
    }
    .print-sheet-paper {
      width: 100% !important;
      max-width: 100% !important;
      box-shadow: none !important;
      border: 3px solid black !important;
      page-break-inside: avoid;
    }
  }
</style>
