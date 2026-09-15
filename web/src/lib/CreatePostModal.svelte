<!-- web/src/lib/CreatePostModal.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { TagCount, ImageMeta } from './types';
  import { createPost } from './api';
  import { processImageFile } from './media-processor';
  import type * as L from 'leaflet';
  import {
    X,
    Plus,
    AlertCircle,
    Sparkles,
    MapPin,
    Navigation,
    Search,
    Check,
    RotateCcw,
    Camera,
    ShieldCheck,
    Globe,
    Link,
    Clock,
    Trash2,
  } from '@lucide/svelte';

  interface Props {
    vocabularyTags: TagCount[];
    defaultArea?: string;
    availableAreas?: string[];
    token: string | null;
    onClose: () => void;
    onCreated: () => void;
  }

  let {
    vocabularyTags,
    defaultArea = '',
    availableAreas = [],
    token,
    onClose,
    onCreated,
  }: Props = $props();

  let title = $state('');
  let area = $state('');
  let address = $state('');
  let currentStatus = $state('available');
  let statusLabel = $state('受付中 / 利用可能');
  let note = $state('');
  let sourceUrl = $state('');
  let url = $state('');

  // 写真・EXIF・C2PA用ステート
  let fileInput = $state<HTMLInputElement | null>(null);
  let imagePreviewUrl = $state<string | null>(null);
  let imageMeta = $state<ImageMeta | null>(null);
  let isProcessingImage = $state(false);
  let c2paVerified = $state(false);
  let c2paInfo = $state<{ generator?: string; isSigned?: boolean } | null>(null);
  let photoTakenTime = $state<string | null>(null);

  // 緯度経度・地図ピッカー用ステート
  let lat = $state<number | null>(null);
  let lng = $state<number | null>(null);
  let isLocating = $state(false);
  let isGeocoding = $state(false);
  let geoStatusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

  let pickerMapContainer: HTMLDivElement;
  let pickerMap: L.Map | null = null;
  let pickerMarker: L.Marker | null = null;
  let leaflet: typeof L | null = null;

  // 自発的ボキャブラリ（タグ）
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

  // 写真選択・解析ハンドラ（EXIF & C2PA）
  async function handleImageSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    isProcessingImage = true;
    try {
      const result = await processImageFile(file);
      imagePreviewUrl = result.dataUrl;
      imageMeta = result.meta;

      // EXIF 撮影日時
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

      // C2PA 真正性情報
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

      // EXIF GPS 座標があれば自動的にピンをセット！
      if (result.gpsCoordinates) {
        setCoordinates(result.gpsCoordinates.lat, result.gpsCoordinates.lng, 16);
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

  // 情報源URLの信頼性判定
  let sourceTrustBadge = $derived.by(() => {
    if (!sourceUrl.trim()) return null;
    try {
      const parsed = new URL(sourceUrl.startsWith('http') ? sourceUrl : `https://${sourceUrl}`);
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith('.go.jp') || host.endsWith('.lg.jp')) {
        return { label: '公的機関・自治体公式', color: 'bg-emerald-50 text-emerald-800 border-emerald-300', icon: '🏛️' };
      }
      if (host.endsWith('.ac.jp')) {
        return { label: '大学・学術研究機関', color: 'bg-blue-50 text-blue-800 border-blue-300', icon: '🎓' };
      }
      if (
        host.includes('nhk.or.jp') ||
        host.includes('asahi.com') ||
        host.includes('yomiuri.co.jp') ||
        host.includes('mainichi.jp') ||
        host.includes('nikkei.com') ||
        host.includes('kyodonews.jp')
      ) {
        return { label: '報道機関・ニュース', color: 'bg-indigo-50 text-indigo-800 border-indigo-300', icon: '📰' };
      }
      if (host.includes('x.com') || host.includes('twitter.com')) {
        return { label: 'SNS公式・現地ポスト', color: 'bg-slate-100 text-slate-800 border-slate-300', icon: '📱' };
      }
      return { label: '外部リンク', color: 'bg-slate-50 text-slate-700 border-slate-200', icon: '🔗' };
    } catch {
      return null;
    }
  });

  let attrKey = $state('');
  let attrVal = $state('');
  let attributes = $state<Record<string, string>>({});

  let isSubmitting = $state(false);
  let errorMessage = $state('');

  function addAttribute() {
    if (attrKey.trim() && attrVal.trim()) {
      attributes = { ...attributes, [attrKey.trim()]: attrVal.trim() };
      attrKey = '';
      attrVal = '';
    }
  }

  function removeAttribute(key: string) {
    const next = { ...attributes };
    delete next[key];
    attributes = next;
  }

  onMount(async () => {
    // Leaflet の初期化
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

    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(pickerMap);

    // 地図クリックでピン設置・移動
    pickerMap.on('click', (e: L.LeafletMouseEvent) => {
      setCoordinates(e.latlng.lat, e.latlng.lng);
      geoStatusMessage = { type: 'success', text: '地図をタップしてピンを配置しました' };
    });

    setTimeout(() => {
      pickerMap?.invalidateSize();
    }, 250);

    // defaultArea が設定されていれば、その地域を中心にする
    if (defaultArea) {
      try {
        const res = await fetch(
          `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(defaultArea)}`
        );
        const data = await res.json();
        if (data && data.length > 0 && data[0].geometry?.coordinates) {
          const [cLng, cLat] = data[0].geometry.coordinates;
          pickerMap.setView([cLat, cLng], 12);
        }
      } catch (e) {
        // フォールバック
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
    if (!pickerMap || !leaflet) return;

    lat = Math.round(newLat * 1000000) / 1000000;
    lng = Math.round(newLng * 1000000) / 1000000;

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
        geoStatusMessage = { type: 'success', text: 'ピンの位置を微調整しました' };
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

  function handleGetCurrentLocation() {
    if (!navigator.geolocation) {
      geoStatusMessage = { type: 'error', text: 'お使いのブラウザは現在地取得に対応していません' };
      return;
    }

    isLocating = true;
    geoStatusMessage = null;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        isLocating = false;
        setCoordinates(pos.coords.latitude, pos.coords.longitude, 16);
        geoStatusMessage = { type: 'success', text: '現在地の位置情報をセットしました' };
      },
      (err) => {
        isLocating = false;
        geoStatusMessage = {
          type: 'error',
          text: `現在地を取得できませんでした (${err.message})。地図上をタップして指定してください。`,
        };
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function handleGeocodeAddress() {
    const query = [defaultArea, area, address, title].filter(Boolean).join(' ').trim();
    if (!query) {
      geoStatusMessage = { type: 'error', text: '拠点名または住所を入力してください' };
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
        const osmRes = await fetch(osmUrl, { headers: { 'Accept-Language': 'ja' } });
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
    } catch (err: any) {
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
          attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
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
    } catch (err: any) {
      errorMessage = err.message || '通信エラーが発生しました';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
  <div class="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[94vh] flex flex-col">
    <!-- ヘッダー -->
    <div class="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
        <h2 class="text-base font-black text-slate-900">＋ 情報を投稿</h2>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
      >
        <X class="w-5 h-5" />
      </button>
    </div>

    <!-- フォーム -->
    <form onsubmit={handleSubmit} class="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto">
      {#if errorMessage}
        <div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-1.5">
          <AlertCircle class="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      {/if}

      <!-- 📸 写真の添付（EXIF自動位置取得 & C2PA真正性検証） -->
      <div class="p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200 flex flex-col gap-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Camera class="w-4 h-4 text-blue-600" />
            <span>現場写真の添付</span>
          </div>
          <span class="text-[10px] text-slate-500">EXIF自動抽出・C2PA対応</span>
        </div>

        {#if imagePreviewUrl}
          <!-- 写真プレビューとメタ情報バッジ -->
          <div class="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 flex flex-col">
            <div class="relative max-h-56 overflow-hidden flex items-center justify-center bg-black/40">
              <img src={imagePreviewUrl} alt="添付写真" class="w-full h-auto max-h-56 object-contain" />
              <button
                type="button"
                onclick={removeImage}
                class="absolute top-2 right-2 p-1.5 bg-black/70 hover:bg-rose-600 text-white rounded-full transition shadow-md cursor-pointer"
                title="写真を削除"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- EXIF & C2PA 検証ステータスバー -->
            <div class="p-2.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div class="flex flex-wrap items-center gap-1.5">
                {#if c2paVerified}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">
                    <ShieldCheck class="w-3.5 h-3.5 text-emerald-600" />
                    <span>C2PA 真正性確認済 ({c2paInfo?.generator || '認証カメラ'})</span>
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    <span>標準画像</span>
                  </span>
                {/if}

                {#if photoTakenTime}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium border border-blue-200">
                    <Clock class="w-3 h-3 text-blue-500" />
                    <span>撮影: {photoTakenTime}</span>
                  </span>
                {/if}
              </div>

              {#if imageMeta?.exif?.latitude && imageMeta?.exif?.longitude}
                <span class="text-[10px] text-emerald-700 font-semibold flex items-center gap-1">
                  ✓ EXIF座標連動済
                </span>
              {/if}
            </div>
          </div>
        {:else}
          <!-- アップロード選択エリア -->
          <label class="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 bg-white cursor-pointer transition hover:bg-blue-50/20 group">
            <input
              type="file"
              accept="image/*"
              bind:this={fileInput}
              onchange={handleImageSelect}
              class="hidden"
            />
            {#if isProcessingImage}
              <div class="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-xs text-slate-500">EXIF解析・C2PA検証中...</span>
            {:else}
              <div class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition">
                <Camera class="w-4 h-4" />
              </div>
              <div class="text-xs font-bold text-slate-700">写真を撮影または選択</div>
              <p class="text-[10px] text-slate-400 text-center leading-tight">
                写真の位置情報（EXIF GPS）からピンが自動配置されます。<br />
                C2PA来歴署名も自動検知し真正性を担保します。
              </p>
            {/if}
          </label>
        {/if}
      </div>

      <!-- 施設・拠点名 -->
      <div>
        <label for="post-title" class="block text-xs font-bold text-slate-700 mb-1">
          施設・拠点・情報タイトル <span class="text-rose-600">*</span>
        </label>
        <input
          id="post-title"
          type="text"
          bind:value={title}
          placeholder="例: 中央公民館 給水所、〇〇カフェ、市民総合体育館"
          required
          class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      <!-- 地区名 & 住所 -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label for="post-area" class="block text-xs font-bold text-slate-700 mb-1">
            地区・地域名 <span class="text-rose-600">*</span>
          </label>
          <input
            id="post-area"
            type="text"
            bind:value={area}
            placeholder={defaultArea ? `例: ${defaultArea}` : '例: 中央区、本町、北地区'}
            required
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          {#if availableAreas.length > 0}
            <div class="flex flex-wrap gap-1 mt-1.5">
              <span class="text-[10px] text-slate-400 py-0.5">候補:</span>
              {#each availableAreas.slice(0, 5) as a}
                <button
                  type="button"
                  onclick={() => { area = a; }}
                  class="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
                >
                  {a}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="sm:col-span-2">
          <label for="post-address" class="block text-xs font-bold text-slate-700 mb-1">住所・場所の詳細（任意）</label>
          <input
            id="post-address"
            type="text"
            bind:value={address}
            placeholder="例: 〇〇町1-2-3 正門前、体育館入口付近"
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
      </div>

      <!-- 📍 地図上の位置（緯度経度・直感的なピン設定） -->
      <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col gap-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <MapPin class="w-4 h-4 text-blue-600" />
            <span>地図上の位置（ピン設定）</span>
          </div>
          {#if lat !== null && lng !== null}
            <span class="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check class="w-3 h-3" />
              <span>ピン設定済み</span>
            </span>
          {:else}
            <span class="text-[10px] text-slate-500">写真EXIF、GPS、住所または地図タップで設定</span>
          {/if}
        </div>

        <!-- クイック取得ボタン群 -->
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={handleGetCurrentLocation}
            disabled={isLocating}
            class="flex-1 py-1.5 px-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
          >
            <Navigation class={`w-3.5 h-3.5 text-blue-600 ${isLocating ? 'animate-spin' : ''}`} />
            <span>{isLocating ? '現在地を取得中...' : '📍 現在地からセット'}</span>
          </button>

          <button
            type="button"
            onclick={handleGeocodeAddress}
            disabled={isGeocoding || (!address.trim() && !title.trim() && !area.trim())}
            class="flex-1 py-1.5 px-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
            title="入力した住所や拠点名から地図位置を自動検索します"
          >
            <Search class={`w-3.5 h-3.5 text-indigo-600 ${isGeocoding ? 'animate-spin' : ''}`} />
            <span>{isGeocoding ? '住所検索中...' : '🔍 住所からピン配置'}</span>
          </button>
        </div>

        {#if geoStatusMessage}
          <div
            class={`text-[11px] px-2.5 py-1.5 rounded-lg flex items-center justify-between ${
              geoStatusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            <span>{geoStatusMessage.text}</span>
            <button
              type="button"
              onclick={() => { geoStatusMessage = null; }}
              class="text-slate-400 hover:text-slate-700 font-bold ml-1 cursor-pointer"
            >
              ×
            </button>
          </div>
        {/if}

        <!-- インタラクティブミニマップ -->
        <div class="relative w-full h-44 rounded-xl overflow-hidden border border-slate-300 shadow-inner bg-slate-200">
          <div bind:this={pickerMapContainer} class="w-full h-full z-0"></div>

          <div class="absolute top-2 left-2 right-2 z-[400] pointer-events-none flex justify-center">
            <div class="bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-medium px-2.5 py-1 rounded-full shadow-xs">
              👆 地図タップでピン配置、ピンのドラッグで位置微調整
            </div>
          </div>
        </div>

        <!-- 座標数値表示 & 解除ボタン -->
        <div class="flex items-center justify-between text-[11px] text-slate-600 pt-0.5">
          {#if lat !== null && lng !== null}
            <div class="font-mono font-semibold text-slate-800 text-[11px]">
              緯度: {lat.toFixed(5)}, 経度: {lng.toFixed(5)}
            </div>
            <button
              type="button"
              onclick={clearLocation}
              class="text-rose-600 hover:text-rose-800 font-bold cursor-pointer hover:underline flex items-center gap-1"
            >
              <RotateCcw class="w-3 h-3" />
              <span>ピンを解除</span>
            </button>
          {:else}
            <span class="text-slate-400 text-[10px]">
              ※ 地図上をクリックするか「現在地」「住所検索」または写真EXIFでピンを置けます
            </span>
          {/if}
        </div>
      </div>

      <!-- 🔗 情報源・参照リンク（任意） -->
      <div class="p-3 bg-slate-50/80 rounded-xl border border-slate-200 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label for="post-source-url" class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Link class="w-3.5 h-3.5 text-blue-600" />
            <span>情報源・参照リンク（任意）</span>
          </label>
          <span class="text-[10px] text-slate-500">正確性検証用</span>
        </div>

        <input
          id="post-source-url"
          type="url"
          bind:value={sourceUrl}
          placeholder="例: https://www.city.example.lg.jp/... または 公式XポストURL"
          class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />

        {#if sourceTrustBadge}
          <div class="flex items-center gap-2">
            <span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${sourceTrustBadge.color}`}>
              <span>{sourceTrustBadge.icon}</span>
              <span>{sourceTrustBadge.label}</span>
            </span>
            <span class="text-[10px] text-slate-500">信頼できる情報源として識別されます</span>
          </div>
        {/if}
      </div>

      <!-- 初期ステータス -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label for="post-status-select" class="block text-xs font-bold text-slate-700 mb-1">現在の状況</label>
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
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="available">利用可能 / 配布中</option>
            <option value="open">営業中 / 開設中</option>
            <option value="crowded">混雑中</option>
            <option value="out_of_stock">終了 / 完売</option>
          </select>
        </div>
        <div>
          <label for="post-status-label" class="block text-xs font-bold text-slate-700 mb-1">状況の表示名</label>
          <input
            id="post-status-label"
            type="text"
            bind:value={statusLabel}
            placeholder="例: 給水中、電源開放中、時短営業中"
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
      </div>

      <!-- 詳細メモ -->
      <div>
        <label for="post-note" class="block text-xs font-bold text-slate-700 mb-1">補足メモ・備考（任意）</label>
        <textarea
          id="post-note"
          bind:value={note}
          rows="2"
          placeholder="持参が必要な物（ポリタンク等）、営業時間、連絡先など"
          class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        ></textarea>
      </div>

      <!-- 自発的ボキャブラリ（タグ） -->
      <div class="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex flex-col gap-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Sparkles class="w-3.5 h-3.5 text-blue-600" />
            <span>タグ（地域のボキャブラリ）</span>
          </div>
          <span class="text-[10px] text-slate-500">複数追加可能</span>
        </div>

        {#if selectedTags.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each selectedTags as tag}
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold shadow-2xs">
                <span>#{tag}</span>
                <button
                  type="button"
                  onclick={() => toggleTag(tag)}
                  class="text-blue-200 hover:text-white transition ml-0.5 cursor-pointer"
                >
                  ×
                </button>
              </span>
            {/each}
          </div>
        {/if}

        {#if vocabularyTags.length > 0}
          <div>
            <span class="block text-[11px] font-semibold text-slate-500 mb-1">
              地域のボキャブラリから選ぶ（タップで追加）:
            </span>
            <div class="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 bg-white rounded-lg border border-slate-200">
              {#each vocabularyTags as vt}
                <button
                  type="button"
                  onclick={() => toggleTag(vt.name)}
                  class={`px-2 py-0.5 rounded-md text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                    selectedTags.includes(vt.name)
                      ? 'bg-blue-100 text-blue-800 font-bold border border-blue-300'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
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
          <span class="block text-[11px] font-semibold text-slate-500 mb-1">
            新しいタグを追加する:
          </span>
          <div class="flex items-center gap-1.5">
            <div class="relative flex-1">
              <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">#</span>
              <input
                type="text"
                bind:value={newTagInput}
                onkeydown={handleTagKeydown}
                placeholder="例: Wi-Fi, 給水, ペット可, 電源あり, テイクアウト"
                class="w-full pl-6 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onclick={addNewTag}
              class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-2xs shrink-0 cursor-pointer"
            >
              追加
            </button>
          </div>
        </div>
      </div>

      <!-- フッター -->
      <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
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
          class="px-5 py-2 text-xs font-bold rounded-lg text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 shadow-xs transition active:scale-95 cursor-pointer"
        >
          {isSubmitting ? '登録中...' : '情報を投稿する'}
        </button>
      </div>
    </form>
  </div>
</div>
