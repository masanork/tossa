<!-- web/src/lib/QrScannerModal.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { swipeDown } from './swipeToDismiss';
  import type { Post } from './types';
  import {
    decodePostFromQrString,
    decodeQrFromImageData,
    playScanSuccessBeep,
    vibrateSuccess,
  } from './qrCodec';
  import { savePeerPost, isPeerPostId } from './peerPosts';
  import { geolocationManager } from './geolocation.svelte';
  import {
    formatDistance,
    calculateDistance,
    calculateBearing,
    getCardinalDirection,
  } from './geoDistance';
  import { i18n } from './i18n.svelte';
  import * as m from '../paraglide/messages.js';
  import {
    ScanQrCode,
    X,
    Upload,
    Camera,
    Flashlight,
    RefreshCw,
    Navigation,
    CheckCircle2,
    AlertCircle,
  } from '@lucide/svelte';

  interface Props {
    isTop?: boolean;
    zIndex?: number;
    onClose: () => void;
    onImportPost: (post: Post, andNavigate?: boolean) => void;
  }

  const { isTop = true, zIndex = 50, onClose, onImportPost }: Props = $props();

  let videoElement = $state<HTMLVideoElement | null>(null);
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  let mediaStream: MediaStream | null = null;
  let animationFrameId: number | null = null;

  let isScanning = $state(false);
  let cameraError = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let facingMode = $state<'environment' | 'user'>('environment');
  let hasTorch = $state(false);
  let torchActive = $state(false);

  let scannedPost = $state<Post | null>(null);
  let isAlreadySaved = $state(false);

  // Compute distance and bearing from user's current GPS if post has coordinates
  const distanceInfo = $derived.by(() => {
    if (
      !scannedPost ||
      scannedPost.lat === null ||
      scannedPost.lng === null ||
      !geolocationManager.currentLocation
    ) {
      return null;
    }
    const userLat = geolocationManager.currentLocation.lat;
    const userLng = geolocationManager.currentLocation.lng;
    const dist = calculateDistance(
      userLat,
      userLng,
      scannedPost.lat,
      scannedPost.lng
    );
    const bearing = calculateBearing(
      userLat,
      userLng,
      scannedPost.lat,
      scannedPost.lng
    );
    return {
      distanceMeters: dist,
      formattedDistance: formatDistance(dist),
      cardinal: getCardinalDirection(bearing, i18n.current),
    };
  });

  onMount(async () => {
    await startCamera();
  });

  onDestroy(() => {
    stopCamera();
  });

  async function startCamera() {
    cameraError = null;
    errorMessage = null;
    scannedPost = null;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      cameraError = m.qr_scanner_camera_error();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      mediaStream = stream;
      if (videoElement) {
        videoElement.srcObject = stream;
        await videoElement.play();
      }

      // Check for torch capability on track
      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities() as any;
        hasTorch = !!caps.torch;
      }

      isScanning = true;
      requestScanFrame();
    } catch (err: any) {
      console.warn('Camera access not granted or unavailable:', err);
      cameraError = m.qr_scanner_camera_error();
    }
  }

  function stopCamera() {
    isScanning = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
    torchActive = false;
  }

  async function toggleTorch() {
    if (!mediaStream || !hasTorch) return;
    const track = mediaStream.getVideoTracks()[0];
    if (!track) return;
    try {
      torchActive = !torchActive;
      await (track as any).applyConstraints({
        advanced: [{ torch: torchActive }],
      });
    } catch {
      torchActive = false;
    }
  }

  async function toggleCamera() {
    stopCamera();
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    await startCamera();
  }

  function requestScanFrame() {
    if (!isScanning) return;
    animationFrameId = requestAnimationFrame(async () => {
      await scanVideoFrame();
      if (isScanning) {
        requestScanFrame();
      }
    });
  }

  async function scanVideoFrame() {
    if (
      !videoElement ||
      videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return;
    }

    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;
    if (!width || !height) return;

    if (!canvasElement) {
      canvasElement = document.createElement('canvas');
    }
    canvasElement.width = width;
    canvasElement.height = height;

    const ctx = canvasElement.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(videoElement, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    const rawCode = await decodeQrFromImageData(imageData);
    if (rawCode) {
      handleScannedData(rawCode);
    }
  }

  function handleScannedData(rawCode: string) {
    const post = decodePostFromQrString(rawCode);
    if (!post) {
      errorMessage = m.qr_invalid_code();
      return;
    }

    // Success feedback
    playScanSuccessBeep();
    vibrateSuccess();

    // Check if already in peer storage
    isAlreadySaved = isPeerPostId(post.id);

    scannedPost = post;
    errorMessage = null;
    stopCamera();
  }

  function handleRescan() {
    scannedPost = null;
    errorMessage = null;
    void startCamera();
  }

  async function handleFileUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    errorMessage = null;
    const reader = new FileReader();

    reader.onload = async () => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const rawCode = await decodeQrFromImageData(imageData);

        if (rawCode) {
          handleScannedData(rawCode);
        } else {
          errorMessage = m.qr_invalid_code();
        }
      };
      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
    // Reset file input
    target.value = '';
  }

  function handleConfirmImport(andNavigate = false) {
    if (!scannedPost) return;
    savePeerPost(scannedPost);
    onImportPost(scannedPost, andNavigate);
    onClose();
  }
</script>

<div
  style="z-index: {zIndex}"
  role="presentation"
  inert={!isTop}
  onclick={(e) => {
    if (e.target === e.currentTarget && isTop) onClose();
  }}
  class="fixed inset-0 flex items-end justify-center bg-black/70 p-0 backdrop-blur-xs transition-opacity duration-200 sm:items-center sm:p-4 {isTop
    ? 'opacity-100'
    : 'opacity-80'}"
>
  <div
    use:swipeDown={onClose}
    class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-all duration-200 sm:rounded-2xl dark:bg-slate-900 dark:text-slate-100 {isTop
      ? 'scale-100 opacity-100'
      : 'pointer-events-none scale-[0.97] opacity-85'}"
  >
    <!-- Mobile drag handle -->
    <div
      class="mx-auto my-2.5 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
    ></div>

    <!-- Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/80"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="rounded-lg bg-blue-100 p-2 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
        >
          <ScanQrCode class="h-5 w-5" />
        </div>
        <div>
          <h2 class="text-base font-black text-slate-900 dark:text-white">
            {m.qr_scanner_title()}
          </h2>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">
            {scannedPost ? m.qr_scanned_preview_title() : m.qr_scanner_desc()}
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

    <!-- Body -->
    <div class="flex flex-col items-center overflow-y-auto p-5">
      <!-- Hidden file input for screenshot/image upload -->
      <input
        type="file"
        accept="image/*"
        bind:this={fileInput}
        onchange={handleFileUpload}
        class="hidden"
      />

      {#if scannedPost}
        <!-- ================= Scanned Post Detail View ================= -->
        <div class="animate-in fade-in w-full duration-200">
          <div
            class="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            <CheckCircle2
              class="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            <div class="text-xs">
              <span class="font-bold">QRコードを認識しました</span>
              {#if isAlreadySaved}
                <p class="text-[11px] text-emerald-700 dark:text-emerald-400">
                  {m.qr_already_imported()}
                </p>
              {/if}
            </div>
          </div>

          <!-- Preview Card -->
          <div
            class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-800/80"
          >
            <div class="flex items-start justify-between gap-2">
              <span
                class="rounded-full px-2.5 py-0.5 text-xs font-bold text-white shadow-2xs"
                style="background-color: {scannedPost.category_color ||
                  '#3b82f6'};"
              >
                {scannedPost.category_icon || '📢'}
                {scannedPost.category_name || '一般'}
              </span>
              <span
                class="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              >
                {scannedPost.status_label}
              </span>
            </div>

            <h3
              class="mt-2 text-base font-black text-slate-900 dark:text-white"
            >
              {scannedPost.title}
            </h3>

            <div
              class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
            >
              <span class="font-semibold text-slate-800 dark:text-slate-200"
                >📍 {scannedPost.area}</span
              >
              {#if scannedPost.address}
                <span class="text-slate-400">•</span>
                <span class="truncate">{scannedPost.address}</span>
              {/if}
            </div>

            <!-- GPS Straight-line distance if available -->
            {#if distanceInfo}
              <div
                class="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/80 px-2.5 py-1 text-xs font-bold text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
              >
                <Navigation class="h-3.5 w-3.5" />
                <span
                  >現在地から直線 {distanceInfo.formattedDistance} ({distanceInfo.cardinal})</span
                >
              </div>
            {/if}

            {#if scannedPost.note}
              <p
                class="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
              >
                {scannedPost.note}
              </p>
            {/if}
          </div>

          <!-- Actions -->
          <div class="mt-4 flex flex-col gap-2">
            {#if scannedPost.lat !== null && scannedPost.lng !== null}
              <button
                type="button"
                onclick={() => handleConfirmImport(true)}
                class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-black text-white shadow-md transition hover:from-blue-700 hover:to-indigo-700 active:scale-98"
              >
                <Navigation class="h-4 w-4" />
                <span>{m.qr_import_and_navigate()}</span>
              </button>
            {/if}

            <button
              type="button"
              onclick={() => handleConfirmImport(false)}
              class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-800 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <CheckCircle2
                class="h-4 w-4 text-emerald-600 dark:text-emerald-400"
              />
              <span>{m.qr_import_save()}</span>
            </button>

            <button
              type="button"
              onclick={handleRescan}
              class="mt-1 flex w-full cursor-pointer items-center justify-center gap-1.5 py-1.5 text-xs text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <RefreshCw class="h-3.5 w-3.5" />
              <span>{m.qr_rescan()}</span>
            </button>
          </div>
        </div>
      {:else}
        <!-- ================= Live Camera Viewfinder ================= -->
        <div class="relative flex w-full flex-col items-center">
          {#if cameraError}
            <!-- Fallback when camera is unavailable -->
            <div
              class="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/40"
            >
              <Camera
                class="mb-3 h-10 w-10 text-slate-400 dark:text-slate-500"
              />
              <p class="mb-4 text-xs text-slate-600 dark:text-slate-300">
                {cameraError}
              </p>
              <button
                type="button"
                onclick={() => fileInput?.click()}
                class="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md transition hover:bg-blue-700"
              >
                <Upload class="h-4 w-4" />
                <span>{m.qr_scanner_upload()}</span>
              </button>
            </div>
          {:else}
            <!-- Camera Viewfinder Box -->
            <div
              class="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl bg-black shadow-inner"
            >
              <!-- Video Stream -->
              <video
                bind:this={videoElement}
                playsinline
                muted
                class="h-full w-full object-cover"
              ></video>

              <!-- Viewfinder Overlay & Framing Corners -->
              <div
                class="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
              >
                <div
                  class="relative h-full w-full rounded-xl border-2 border-white/50 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
                >
                  <!-- Animated Scanning Line -->
                  <div
                    class="absolute right-0 left-0 h-0.5 animate-bounce bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_8px_#3b82f6]"
                    style="animation-duration: 2s;"
                  ></div>

                  <!-- Corner brackets -->
                  <div
                    class="absolute -top-1 -left-1 h-4 w-4 border-t-2 border-l-2 border-blue-400"
                  ></div>
                  <div
                    class="absolute -top-1 -right-1 h-4 w-4 border-t-2 border-r-2 border-blue-400"
                  ></div>
                  <div
                    class="absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-blue-400"
                  ></div>
                  <div
                    class="absolute -right-1 -bottom-1 h-4 w-4 border-r-2 border-b-2 border-blue-400"
                  ></div>
                </div>
              </div>

              <!-- Viewfinder Controls (Torch & Camera Switch) -->
              <div
                class="absolute right-2.5 bottom-2.5 flex items-center gap-1.5"
              >
                {#if hasTorch}
                  <button
                    type="button"
                    onclick={toggleTorch}
                    class="cursor-pointer rounded-full bg-black/60 p-2 text-white backdrop-blur-xs transition hover:bg-black/80"
                    title="ライト (懐中電灯)"
                    aria-label="ライト切替"
                  >
                    <Flashlight
                      class="h-4 w-4 {torchActive
                        ? 'text-amber-400'
                        : 'text-white'}"
                    />
                  </button>
                {/if}
                <button
                  type="button"
                  onclick={toggleCamera}
                  class="cursor-pointer rounded-full bg-black/60 p-2 text-white backdrop-blur-xs transition hover:bg-black/80"
                  title="カメラ切替"
                  aria-label="カメラ切替"
                >
                  <RefreshCw class="h-4 w-4 text-white" />
                </button>
              </div>
            </div>

            <!-- Error message toast if scanned code was invalid -->
            {#if errorMessage}
              <div
                class="mt-3 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
              >
                <AlertCircle class="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            {/if}

            <!-- File Upload Alternative Button -->
            <div class="mt-4 flex w-full justify-center">
              <button
                type="button"
                onclick={() => fileInput?.click()}
                class="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Upload class="h-3.5 w-3.5" />
                <span>{m.qr_scanner_upload()}</span>
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
