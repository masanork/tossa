<!-- web/src/lib/CreatePostModal.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createPost, updatePost } from './api';
  import { enqueuePost } from './offlineQueue';
  import { swipeDown } from './swipeToDismiss';
  import type { Post, TagCount, ImageMeta } from './types';
  import { processImageFile } from './media-processor';
  import type * as L from 'leaflet';
  import {
    X,
    Edit3,
    AlertCircle,
    Sparkles,
    MapPin,
    Navigation,
    Search,
    Check,
    RotateCcw,
    Camera,
    ShieldCheck,
    Link,
    Clock,
    Trash2,
  } from '@lucide/svelte';
  import { m } from './i18n.svelte';
  import { geolocationManager } from './geolocation.svelte';

  interface Props {
    vocabularyTags: TagCount[];
    defaultArea?: string;
    availableAreas?: string[];
    token: string | null;
    editingPost?: Post | null;
    isTop?: boolean;
    zIndex?: number;
    onClose: () => void;
    onCreated: () => void;
    onUpdated?: () => void;
    onOpenAuth?: () => void;
  }

  const {
    vocabularyTags,
    defaultArea = '',
    availableAreas = [],
    token,
    editingPost = null,
    isTop = true,
    zIndex = 50,
    onClose,
    onCreated,
    onUpdated,
    onOpenAuth,
  }: Props = $props();

  let title = $state('');
  let area = $state('');
  let address = $state('');
  let currentStatus = $state('available');
  let statusLabel = $state('受付中 / 利用可能');
  let note = $state('');
  let sourceUrl = $state('');
  let url = $state('');

  // Photo, EXIF & C2PA state
  let fileInput = $state<HTMLInputElement | null>(null);
  let imagePreviewUrl = $state<string | null>(null);
  let imageMeta = $state<ImageMeta | null>(null);
  let isProcessingImage = $state(false);
  let c2paVerified = $state(false);
  let c2paInfo = $state<{ generator?: string; isSigned?: boolean } | null>(
    null
  );
  let photoTakenTime = $state<string | null>(null);

  // Coordinates & map picker state
  let lat = $state<number | null>(null);
  let lng = $state<number | null>(null);
  let isLocating = $state(false);
  let isGeocoding = $state(false);
  let geoStatusMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  let pickerMapContainer: HTMLDivElement;
  let pickerMap: L.Map | null = null;
  let pickerMarker: L.Marker | null = null;
  let leaflet: typeof L | null = null;

  // Voluntary vocabulary (tags)
  let selectedTags = $state<string[]>([]);
  let newTagInput = $state('');

  function toggleTag(tagName: string) {
    if (selectedTags.includes(tagName)) {
      selectedTags = selectedTags.filter((t) => t !== tagName);
    } else {
      selectedTags = [...selectedTags, tagName];
    }
  }

  function addNewTag() {
    const cleaned = newTagInput.trim().replace(/^#/, '');
    if (cleaned && !selectedTags.includes(cleaned)) {
      selectedTags = [...selectedTags, cleaned];
      newTagInput = '';
    }
  }

  function handleTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewTag();
    }
  }

  // Photo selection & analysis handler (EXIF & C2PA)
  async function handleImageSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    isProcessingImage = true;
    try {
      const result = await processImageFile(file);
      imagePreviewUrl = result.dataUrl;
      imageMeta = result.meta;

      // EXIF photo taken timestamp
      if (result.dateTime) {
        photoTakenTime = result.dateTime.toLocaleString('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      } else {
        photoTakenTime = null;
      }

      // C2PA authenticity information
      if (result.c2paDetected) {
        c2paVerified = true;
        c2paInfo = {
          generator: result.c2paDetails?.generator,
          isSigned: result.c2paDetails?.isSigned,
        };
      } else {
        c2paVerified = false;
        c2paInfo = null;
      }

      // Automatically set pin if EXIF GPS coordinates are present
      if (result.gpsCoordinates) {
        setCoordinates(
          result.gpsCoordinates.lat,
          result.gpsCoordinates.lng,
          16
        );
        geoStatusMessage = {
          type: 'success',
          text: '📷 写真のEXIF撮影位置からピンを自動セットしました！',
        };
      }
    } catch (err: any) {
      console.error('Failed to process image:', err);
    } finally {
      isProcessingImage = false;
    }
  }

  function removeImage() {
    imagePreviewUrl = null;
    imageMeta = null;
    c2paVerified = false;
    c2paInfo = null;
    photoTakenTime = null;
    if (fileInput) fileInput.value = '';
  }

  // Source URL trust determination
  const sourceTrustBadge = $derived.by(() => {
    if (!sourceUrl.trim()) return null;
    try {
      const parsed = new URL(
        sourceUrl.startsWith('http') ? sourceUrl : `https://${sourceUrl}`
      );
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith('.go.jp') || host.endsWith('.lg.jp')) {
        return {
          label: '公的機関・自治体公式',
          color: 'bg-emerald-50 text-emerald-800 border-emerald-300',
          icon: '🏛️',
        };
      }
      if (host.endsWith('.ac.jp')) {
        return {
          label: '大学・学術研究機関',
          color: 'bg-blue-50 text-blue-800 border-blue-300',
          icon: '🎓',
        };
      }
      if (
        host.includes('nhk.or.jp') ||
        host.includes('asahi.com') ||
        host.includes('yomiuri.co.jp') ||
        host.includes('mainichi.jp') ||
        host.includes('nikkei.com') ||
        host.includes('kyodonews.jp')
      ) {
        return {
          label: '報道機関・ニュース',
          color: 'bg-indigo-50 text-indigo-800 border-indigo-300',
          icon: '📰',
        };
      }
      if (host.includes('x.com') || host.includes('twitter.com')) {
        return {
          label: 'SNS公式・現地ポスト',
          color: 'bg-slate-100 text-slate-800 border-slate-300',
          icon: '📱',
        };
      }
      return {
        label: '外部リンク',
        color: 'bg-slate-50 text-slate-700 border-slate-200',
        icon: '🔗',
      };
    } catch {
      return null;
    }
  });

  let attributes = $state<Record<string, string>>({});

  let isSubmitting = $state(false);
  let errorMessage = $state('');

  onMount(async () => {
    // Set initial values if editing existing post
    if (editingPost) {
      title = editingPost.title || '';
      area = editingPost.area || '';
      address = editingPost.address || '';
      currentStatus = editingPost.current_status || 'available';
      statusLabel = editingPost.status_label || '';
      note = editingPost.note || '';
      sourceUrl = editingPost.source_url || '';
      url = editingPost.url || '';
      imagePreviewUrl = editingPost.image_url || null;
      if (editingPost.image_meta) {
        try {
          imageMeta =
            typeof editingPost.image_meta === 'string'
              ? JSON.parse(editingPost.image_meta)
              : (editingPost.image_meta as ImageMeta);
        } catch {}
      }
      if (editingPost.tags) {
        try {
          selectedTags =
            typeof editingPost.tags === 'string'
              ? JSON.parse(editingPost.tags)
              : editingPost.tags;
        } catch {}
      }
      if (editingPost.attributes) {
        try {
          attributes =
            typeof editingPost.attributes === 'string'
              ? JSON.parse(editingPost.attributes)
              : (editingPost.attributes as Record<string, string>);
        } catch {}
      }
    }

    // Leaflet initialization
    leaflet = await import('leaflet');

    const initialLat = 36.2048;
    const initialLng = 138.2529;
    const initialZoom = 5;

    pickerMap = leaflet.map(pickerMapContainer, {
      center: [initialLat, initialLng],
      zoom: initialZoom,
      zoomControl: false,
    });

    leaflet.control.zoom({ position: 'bottomright' }).addTo(pickerMap);

    leaflet
      .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
        crossOrigin: true,
      })
      .addTo(pickerMap);

    // Set/move pin on map click
    pickerMap.on('click', (e: L.LeafletMouseEvent) => {
      setCoordinates(e.latlng.lat, e.latlng.lng);
      geoStatusMessage = {
        type: 'success',
        text: '地図をタップしてピンを配置しました',
      };
    });

    setTimeout(() => {
      pickerMap?.invalidateSize();
    }, 250);

    // Center on existing post location, or fallback to defaultArea
    if (
      editingPost &&
      editingPost.lat !== null &&
      editingPost.lng !== null &&
      editingPost.lat !== undefined &&
      editingPost.lng !== undefined
    ) {
      setCoordinates(editingPost.lat, editingPost.lng, 15);
    } else if (defaultArea) {
      try {
        const res = await fetch(
          `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(defaultArea)}`
        );
        const data = await res.json();
        if (data && data.length > 0 && data[0].geometry?.coordinates) {
          const [cLng, cLat] = data[0].geometry.coordinates;
          pickerMap.setView([cLat, cLng], 12);
        }
      } catch {
        // Fallback
      }
    }
  });

  onDestroy(() => {
    if (pickerMap) {
      pickerMap.remove();
      pickerMap = null;
    }
  });

  function setCoordinates(newLat: number, newLng: number, zoomLevel?: number) {
    lat = Math.round(newLat * 1000000) / 1000000;
    lng = Math.round(newLng * 1000000) / 1000000;

    if (!pickerMap || !leaflet) return;

    const customIcon = leaflet.divIcon({
      className: 'picker-map-pin',
      html: `
        <div style="
          background-color: #2563eb;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          border: 2.5px solid white;
          cursor: grab;
        ">
          📍
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    if (pickerMarker) {
      pickerMarker.setLatLng([newLat, newLng]);
    } else {
      pickerMarker = leaflet
        .marker([newLat, newLng], {
          icon: customIcon,
          draggable: true,
        })
        .addTo(pickerMap);

      pickerMarker.on('dragend', () => {
        const pos = pickerMarker!.getLatLng();
        lat = Math.round(pos.lat * 1000000) / 1000000;
        lng = Math.round(pos.lng * 1000000) / 1000000;
        geoStatusMessage = {
          type: 'success',
          text: 'ピンの位置を微調整しました',
        };
      });
    }

    if (zoomLevel) {
      pickerMap.setView([newLat, newLng], zoomLevel);
    } else {
      pickerMap.panTo([newLat, newLng]);
    }
  }

  function clearLocation() {
    lat = null;
    lng = null;
    if (pickerMarker && pickerMap) {
      pickerMap.removeLayer(pickerMarker);
      pickerMarker = null;
    }
    geoStatusMessage = null;
  }

  async function handleGetCurrentLocation() {
    if (geolocationManager.currentLocation) {
      setCoordinates(
        geolocationManager.currentLocation.lat,
        geolocationManager.currentLocation.lng,
        16
      );
      geoStatusMessage = {
        type: 'success',
        text: '現在地の位置情報をセットしました',
      };
      return;
    }

    isLocating = true;
    geoStatusMessage = null;

    const loc = await geolocationManager.requestLocation();
    isLocating = false;
    if (loc) {
      setCoordinates(loc.lat, loc.lng, 16);
      geoStatusMessage = {
        type: 'success',
        text: '現在地の位置情報をセットしました',
      };
    } else {
      geoStatusMessage = {
        type: 'error',
        text:
          geolocationManager.error ||
          '現在地を取得できませんでした。地図上をタップして指定してください。',
      };
    }
  }

  async function handleGeocodeAddress() {
    const query = [defaultArea, area, address, title]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!query) {
      geoStatusMessage = {
        type: 'error',
        text: '拠点名または住所を入力してください',
      };
      return;
    }

    isGeocoding = true;
    geoStatusMessage = null;

    try {
      const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      const results = await res.json();

      if (results && results.length > 0 && results[0].geometry?.coordinates) {
        const [cLng, cLat] = results[0].geometry.coordinates;
        setCoordinates(cLat, cLng, 16);
        const matchTitle = results[0].properties?.title || query;
        geoStatusMessage = {
          type: 'success',
          text: `「${matchTitle}」付近にピンを配置しました（ドラッグで微調整可能）`,
        };
      } else {
        const osmUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
        const osmRes = await fetch(osmUrl, {
          headers: { 'Accept-Language': 'ja' },
        });
        const osmResults = await osmRes.json();
        if (osmResults && osmResults.length > 0) {
          const cLat = parseFloat(osmResults[0].lat);
          const cLng = parseFloat(osmResults[0].lon);
          setCoordinates(cLat, cLng, 16);
          geoStatusMessage = {
            type: 'success',
            text: `「${osmResults[0].display_name.split(',')[0]}」付近にピンを配置しました`,
          };
        } else {
          geoStatusMessage = {
            type: 'error',
            text: '住所から位置を特定できませんでした。地図上をタップしてピンを置いてください。',
          };
        }
      }
    } catch {
      geoStatusMessage = {
        type: 'error',
        text: '住所検索中にエラーが発生しました。地図上をタップしてピンを指定してください。',
      };
    } finally {
      isGeocoding = false;
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!title.trim() || !area.trim()) {
      errorMessage = '施設名と地区名は必須です';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      if (editingPost) {
        const res = await updatePost(
          editingPost.id,
          {
            title: title.trim(),
            area: area.trim(),
            address: address.trim() || undefined,
            lat: lat !== null ? lat : null,
            lng: lng !== null ? lng : null,
            currentStatus,
            statusLabel,
            note: note.trim() || null,
            url: url.trim() || null,
            sourceUrl: sourceUrl.trim() || null,
            imageUrl: imagePreviewUrl || null,
            imageMeta: imageMeta ? (imageMeta as any) : null,
            attributes: Object.keys(attributes).length > 0 ? attributes : null,
            tags: selectedTags.length > 0 ? selectedTags : null,
          },
          token
        );

        if (res.success) {
          onUpdated?.();
          onClose();
        } else {
          errorMessage = res.error || '更新に失敗しました';
        }
      } else {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          enqueuePost({
            title: title.trim(),
            area: area.trim(),
            address: address.trim() || undefined,
            lat: lat !== null ? lat : undefined,
            lng: lng !== null ? lng : undefined,
            currentStatus,
            statusLabel,
            note: note.trim() || undefined,
            url: url.trim() || undefined,
            sourceUrl: sourceUrl.trim() || undefined,
            imageUrl: imagePreviewUrl || undefined,
            imageMeta: imageMeta ? (imageMeta as any) : undefined,
            tags: selectedTags.length > 0 ? selectedTags : undefined,
          });
          onCreated();
          onClose();
          return;
        }

        const res = await createPost(
          {
            title: title.trim(),
            area: area.trim(),
            address: address.trim() || undefined,
            lat: lat !== null ? lat : undefined,
            lng: lng !== null ? lng : undefined,
            currentStatus,
            statusLabel,
            note: note.trim() || undefined,
            url: url.trim() || undefined,
            sourceUrl: sourceUrl.trim() || undefined,
            imageUrl: imagePreviewUrl || undefined,
            imageMeta: imageMeta ? (imageMeta as any) : undefined,
            attributes:
              Object.keys(attributes).length > 0 ? attributes : undefined,
            tags: selectedTags.length > 0 ? selectedTags : undefined,
          },
          token
        );

        if (res.success) {
          onCreated();
          onClose();
        } else {
          errorMessage = res.error || '作成に失敗しました';
        }
      }
    } catch (err: any) {
      if (!editingPost) {
        enqueuePost({
          title: title.trim(),
          area: area.trim(),
          address: address.trim() || undefined,
          lat: lat !== null ? lat : undefined,
          lng: lng !== null ? lng : undefined,
          currentStatus,
          statusLabel,
          note: note.trim() || undefined,
          url: url.trim() || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
          imageUrl: imagePreviewUrl || undefined,
          imageMeta: imageMeta ? (imageMeta as any) : undefined,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        });
        onCreated();
        onClose();
        return;
      }
      errorMessage = err.message || '通信エラーが発生しました';
    } finally {
      isSubmitting = false;
    }
  }
</script>

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
    use:swipeDown={onClose}
    class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl transition-all duration-200 sm:rounded-2xl sm:border dark:border-slate-800 dark:bg-slate-900 {isTop
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
      <div class="flex items-center gap-2">
        {#if editingPost}
          <Edit3 class="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <h2 class="text-base font-black text-slate-900 dark:text-slate-100">
            {m.modal_edit_title()}
          </h2>
        {:else}
          <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-600"
          ></span>
          <h2 class="text-base font-black text-slate-900 dark:text-slate-100">
            {m.modal_create_title()}
          </h2>
        {/if}
      </div>
      <button
        type="button"
        onclick={onClose}
        class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <!-- Form -->
    <form
      onsubmit={handleSubmit}
      class="flex flex-col gap-4 overflow-y-auto p-4 sm:p-5"
    >
      {#if !token}
        <div
          class="flex flex-col items-start justify-between gap-2.5 rounded-xl border border-blue-200/80 bg-blue-50/80 p-3 text-xs shadow-2xs sm:flex-row sm:items-center dark:border-blue-900/50 dark:bg-blue-950/30"
        >
          <div
            class="flex items-start gap-2 text-slate-700 dark:text-slate-300"
          >
            <ShieldCheck
              class="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
            />
            <div class="leading-relaxed">
              <span class="font-bold text-slate-900 dark:text-slate-100"
                >{m.modal_cookie_info_title()}</span
              ><br />
              <span class="text-[11px] text-slate-600 dark:text-slate-400"
                >{m.modal_cookie_info_desc()}</span
              >
            </div>
          </div>
          {#if onOpenAuth}
            <button
              type="button"
              onclick={() => {
                onOpenAuth();
              }}
              class="flex shrink-0 cursor-pointer items-center gap-1 self-end rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700 sm:self-auto"
            >
              <span>{m.nudge_register_btn()}</span>
            </button>
          {/if}
        </div>
      {/if}

      {#if errorMessage}
        <div
          class="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
        >
          <AlertCircle class="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      {/if}

      <!-- Photo attachment (EXIF auto location & C2PA authenticity) -->
      <div
        class="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-800/50"
      >
        <div class="flex items-center justify-between">
          <div
            class="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200"
          >
            <Camera class="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>{m.photo_attach()}</span>
          </div>
          <span class="text-[10px] text-slate-500 dark:text-slate-400"
            >{m.photo_subtext()}</span
          >
        </div>

        {#if imagePreviewUrl}
          <!-- Photo preview and metadata badge -->
          <div
            class="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-700"
          >
            <div
              class="relative flex max-h-56 items-center justify-center overflow-hidden bg-black/40"
            >
              <img
                src={imagePreviewUrl}
                alt="添付写真"
                class="h-auto max-h-56 w-full object-contain"
              />
              <button
                type="button"
                onclick={removeImage}
                class="absolute top-2 right-2 cursor-pointer rounded-full bg-black/70 p-1.5 text-white shadow-md transition hover:bg-rose-600"
                title="写真を削除"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>

            <!-- EXIF & C2PA verification status bar -->
            <div
              class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white p-2.5 text-[11px] dark:border-slate-700 dark:bg-slate-900"
            >
              <div class="flex flex-wrap items-center gap-1.5">
                {#if c2paVerified}
                  <span
                    class="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                  >
                    <ShieldCheck
                      class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                    />
                    <span
                      >C2PA 真正性確認済 ({c2paInfo?.generator ||
                        '認証カメラ'})</span
                    >
                  </span>
                {:else}
                  <span
                    class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <span>標準画像</span>
                  </span>
                {/if}

                {#if photoTakenTime}
                  <span
                    class="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                  >
                    <Clock class="h-3 w-3 text-blue-500 dark:text-blue-400" />
                    <span>撮影: {photoTakenTime}</span>
                  </span>
                {/if}
              </div>

              {#if imageMeta?.exif?.latitude && imageMeta?.exif?.longitude}
                <span
                  class="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
                >
                  ✓ EXIF座標連動済
                </span>
              {/if}
            </div>
          </div>
        {:else}
          <!-- Upload dropzone area -->
          <label
            class="group dark:bg-slate-850 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-white p-4 transition hover:border-blue-500 hover:bg-blue-50/20 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-blue-400 dark:hover:bg-blue-950/20"
          >
            <input
              type="file"
              accept="image/*"
              bind:this={fileInput}
              onchange={handleImageSelect}
              class="hidden"
            />
            {#if isProcessingImage}
              <div
                class="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
              ></div>
              <span class="text-xs text-slate-500 dark:text-slate-400"
                >EXIF解析・C2PA検証中...</span
              >
            {:else}
              <div
                class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition group-hover:scale-110 dark:bg-blue-950/50 dark:text-blue-400"
              >
                <Camera class="h-4 w-4" />
              </div>
              <div class="text-xs font-bold text-slate-700 dark:text-slate-200">
                写真を撮影または選択
              </div>
              <p
                class="text-center text-[10px] leading-tight text-slate-400 dark:text-slate-500"
              >
                写真の位置情報（EXIF GPS）からピンが自動配置されます。<br />
                C2PA来歴署名も自動検知し真正性を担保します。
              </p>
            {/if}
          </label>
        {/if}
      </div>

      <!-- Facility / Place name -->
      <div>
        <label
          for="post-title"
          class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
        >
          施設・拠点・情報タイトル <span class="text-rose-600">*</span>
        </label>
        <input
          id="post-title"
          type="text"
          bind:value={title}
          placeholder="例: 中央公民館 給水所、〇〇カフェ、市民総合体育館"
          required
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </div>

      <!-- Area name & address -->
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <label
            for="post-area"
            class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            地区・地域名 <span class="text-rose-600">*</span>
          </label>
          <input
            id="post-area"
            type="text"
            bind:value={area}
            placeholder={defaultArea
              ? `例: ${defaultArea}`
              : '例: 中央区、本町、北地区'}
            required
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {#if availableAreas.length > 0}
            <div class="mt-1.5 flex flex-wrap gap-1">
              <span
                class="py-0.5 text-[10px] text-slate-400 dark:text-slate-500"
                >候補:</span
              >
              {#each availableAreas.slice(0, 5) as a (a)}
                <button
                  type="button"
                  onclick={() => {
                    area = a;
                  }}
                  class="cursor-pointer rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {a}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="sm:col-span-2">
          <label
            for="post-address"
            class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
            >住所・場所の詳細（任意）</label
          >
          <input
            id="post-address"
            type="text"
            bind:value={address}
            placeholder="例: 〇〇町1-2-3 正門前、体育館入口付近"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <!-- Pin location on map (lat/lng) -->
      <div
        class="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/50"
      >
        <div class="flex items-center justify-between">
          <div
            class="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200"
          >
            <MapPin class="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>地図上の位置（ピン設定）</span>
          </div>
          {#if lat !== null && lng !== null}
            <span
              class="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
            >
              <Check class="h-3 w-3" />
              <span>ピン設定済み</span>
            </span>
          {:else}
            <span class="text-[10px] text-slate-500 dark:text-slate-400"
              >写真EXIF、GPS、住所または地図タップで設定</span
            >
          {/if}
        </div>

        <!-- Quick coordinate action buttons -->
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={handleGetCurrentLocation}
            disabled={isLocating}
            class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Navigation
              class={`h-3.5 w-3.5 text-blue-600 dark:text-blue-400 ${isLocating ? 'animate-spin' : ''}`}
            />
            <span
              >{isLocating ? '現在地を取得中...' : '📍 現在地からセット'}</span
            >
          </button>

          <button
            type="button"
            onclick={handleGeocodeAddress}
            disabled={isGeocoding ||
              (!address.trim() && !title.trim() && !area.trim())}
            class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            title="入力した住所や拠点名から地図位置を自動検索します"
          >
            <Search
              class={`h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 ${isGeocoding ? 'animate-spin' : ''}`}
            />
            <span>{isGeocoding ? '住所検索中...' : '🔍 住所からピン配置'}</span>
          </button>
        </div>

        {#if geoStatusMessage}
          <div
            class={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] ${
              geoStatusMessage.type === 'success'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
            }`}
          >
            <span>{geoStatusMessage.text}</span>
            <button
              type="button"
              onclick={() => {
                geoStatusMessage = null;
              }}
              class="ml-1 cursor-pointer font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              ×
            </button>
          </div>
        {/if}

        <!-- Interactive minimap -->
        <div
          class="relative h-44 w-full overflow-hidden rounded-xl border border-slate-300 bg-slate-200 shadow-inner dark:border-slate-700 dark:bg-slate-800"
        >
          <div bind:this={pickerMapContainer} class="z-0 h-full w-full"></div>

          <div
            class="pointer-events-none absolute top-2 right-2 left-2 z-[400] flex justify-center"
          >
            <div
              class="rounded-full bg-slate-900/80 px-2.5 py-1 text-[10px] font-medium text-white shadow-xs backdrop-blur-xs"
            >
              👆 地図タップでピン配置、ピンのドラッグで位置微調整
            </div>
          </div>
        </div>

        <!-- Numeric coordinate display & clear button -->
        <div
          class="flex items-center justify-between pt-0.5 text-[11px] text-slate-600 dark:text-slate-400"
        >
          {#if lat !== null && lng !== null}
            <div
              class="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200"
            >
              緯度: {lat.toFixed(5)}, 経度: {lng.toFixed(5)}
            </div>
            <button
              type="button"
              onclick={clearLocation}
              class="flex cursor-pointer items-center gap-1 font-bold text-rose-600 hover:text-rose-800 hover:underline dark:text-rose-400 dark:hover:text-rose-300"
            >
              <RotateCcw class="h-3 w-3" />
              <span>ピンを解除</span>
            </button>
          {:else}
            <span class="text-[10px] text-slate-400 dark:text-slate-500">
              ※
              地図上をクリックするか「現在地」「住所検索」または写真EXIFでピンを置けます
            </span>
          {/if}
        </div>
      </div>

      <!-- Source / reference link (optional) -->
      <div
        class="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/50"
      >
        <div class="flex items-center justify-between">
          <label
            for="post-source-url"
            class="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            <Link class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>情報源・参照リンク（任意）</span>
          </label>
          <span class="text-[10px] text-slate-500 dark:text-slate-400"
            >正確性検証用</span
          >
        </div>

        <input
          id="post-source-url"
          type="url"
          bind:value={sourceUrl}
          placeholder="例: https://www.city.example.lg.jp/... または 公式XポストURL"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
        />

        {#if sourceTrustBadge}
          <div class="flex items-center gap-2">
            <span
              class={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${sourceTrustBadge.color}`}
            >
              <span>{sourceTrustBadge.icon}</span>
              <span>{sourceTrustBadge.label}</span>
            </span>
            <span class="text-[10px] text-slate-500 dark:text-slate-400"
              >信頼できる情報源として識別されます</span
            >
          </div>
        {/if}
      </div>

      <!-- Status selection -->
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label
            for="post-status-select"
            class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
            >現在の状況</label
          >
          <select
            id="post-status-select"
            bind:value={currentStatus}
            onchange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val === 'available') statusLabel = '受付中 / 利用可能';
              if (val === 'crowded') statusLabel = '混雑中';
              if (val === 'out_of_stock') statusLabel = '本日分終了';
              if (val === 'open') statusLabel = '営業中';
            }}
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="available">利用可能 / 配布中</option>
            <option value="open">営業中 / 開設中</option>
            <option value="crowded">混雑中</option>
            <option value="out_of_stock">終了 / 完売</option>
          </select>
        </div>
        <div>
          <label
            for="post-status-label"
            class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
            >状況の表示名</label
          >
          <input
            id="post-status-label"
            type="text"
            bind:value={statusLabel}
            placeholder="例: 給水中、電源開放中、時短営業中"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <!-- Detailed notes -->
      <div>
        <label
          for="post-note"
          class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
          >補足メモ・備考（任意）</label
        >
        <textarea
          id="post-note"
          bind:value={note}
          rows="2"
          placeholder="持参が必要な物（ポリタンク等）、営業時間、連絡先など"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
        ></textarea>
      </div>

      <!-- Voluntary vocabulary (tags) -->
      <div
        class="flex flex-col gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/50"
      >
        <div class="flex items-center justify-between">
          <div
            class="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200"
          >
            <Sparkles class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>タグ（地域のボキャブラリ）</span>
          </div>
          <span class="text-[10px] text-slate-500 dark:text-slate-400"
            >複数追加可能</span
          >
        </div>

        {#if selectedTags.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each selectedTags as tag (tag)}
              <span
                class="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-bold text-white shadow-2xs"
              >
                <span>#{tag}</span>
                <button
                  type="button"
                  onclick={() => toggleTag(tag)}
                  class="ml-0.5 cursor-pointer text-blue-200 transition hover:text-white"
                >
                  ×
                </button>
              </span>
            {/each}
          </div>
        {/if}

        {#if vocabularyTags.length > 0}
          <div>
            <span
              class="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
            >
              地域のボキャブラリから選ぶ（タップで追加）:
            </span>
            <div
              class="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-800"
            >
              {#each vocabularyTags as vt (vt.name)}
                <button
                  type="button"
                  onclick={() => toggleTag(vt.name)}
                  class={`flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                    selectedTags.includes(vt.name)
                      ? 'border border-blue-300 bg-blue-100 font-bold text-blue-800 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>#{vt.name}</span>
                  <span class="text-[9px] text-slate-400">({vt.count})</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div>
          <span
            class="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            新しいタグを追加する:
          </span>
          <div class="flex items-center gap-1.5">
            <div class="relative flex-1">
              <span
                class="absolute top-1/2 left-2.5 -translate-y-1/2 text-xs font-bold text-slate-400 dark:text-slate-500"
                >#</span
              >
              <input
                type="text"
                bind:value={newTagInput}
                onkeydown={handleTagKeydown}
                placeholder="例: Wi-Fi, 給水, ペット可, 電源あり, テイクアウト"
                class="w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-3 pl-6 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
            <button
              type="button"
              onclick={addNewTag}
              class="shrink-0 cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700"
            >
              {m.btn_add()}
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div
        class="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
      >
        <button
          type="button"
          onclick={onClose}
          class="cursor-pointer rounded-lg px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {m.btn_cancel()}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          class="cursor-pointer rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:from-blue-700 hover:to-indigo-700 active:scale-95 disabled:opacity-50"
        >
          {isSubmitting
            ? editingPost
              ? m.btn_updating()
              : m.btn_submitting()
            : editingPost
              ? m.btn_save()
              : m.btn_submit_post()}
        </button>
      </div>
    </form>
  </div>
</div>
