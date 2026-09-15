<!-- web/src/lib/CreatePostModal.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { TagCount } from './types';
  import { createPost } from './api';
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
  let url = $state('');

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

    // 初期表示座標: 日本全体（またはdefaultArea）
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

    // モーダルレンダリング後のマップ再計算
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

  // 座標をセットしてマーカーを更新
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

      // マーカーをドラッグして微調整
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

  // 位置情報をクリア
  function clearLocation() {
    lat = null;
    lng = null;
    if (pickerMarker && pickerMap) {
      pickerMap.removeLayer(pickerMarker);
      pickerMarker = null;
    }
    geoStatusMessage = null;
  }

  // 現在地からセット
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

  // 住所または施設名からピンを置く（国土地理院API）
  async function handleGeocodeAddress() {
    const query = [defaultArea, area, address, title].filter(Boolean).join(' ').trim();
    if (!query) {
      geoStatusMessage = { type: 'error', text: '拠点名または住所を入力してください' };
      return;
    }

    isGeocoding = true;
    geoStatusMessage = null;

    try {
      // 国土地理院 住所検索API（APIキー不要・高精度）
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
        // フォールバック: OpenStreetMap Nominatim
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
      errorMessage = '拠点名と地区名は必須です';
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

<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
  <div class="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
    <!-- ヘッダー -->
    <div class="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
        <h2 class="text-base font-black text-slate-900">＋ 新しい生活情報を登録する</h2>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
      >
        <X class="w-5 h-5" />
      </button>
    </div>

    <!-- フォーム（スクロール可能） -->
    <form onsubmit={handleSubmit} class="p-5 flex flex-col gap-4 overflow-y-auto">
      {#if errorMessage}
        <div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-1.5">
          <AlertCircle class="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      {/if}

      <!-- 施設・拠点名 -->
      <div>
        <label for="post-title" class="block text-xs font-bold text-slate-700 mb-1">
          施設・拠点・イベント名 <span class="text-rose-600">*</span>
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
            <span>地図上の位置情報（ピン設定）</span>
          </div>
          {#if lat !== null && lng !== null}
            <span class="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Check class="w-3 h-3" />
              <span>ピン設定済み</span>
            </span>
          {:else}
            <span class="text-[10px] text-slate-500">任意（設定すると地図上に表示）</span>
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

          <!-- ガイダンスヒント -->
          <div class="absolute top-2 left-2 right-2 z-[400] pointer-events-none flex justify-center">
            <div class="bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-medium px-2.5 py-1 rounded-full shadow-xs">
              👆 地図タップでピン配置、ピンのドラッグで位置を微調整
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
              ※ 地図上をクリックするか「現在地」「住所検索」でピンを置けます
            </span>
          {/if}
        </div>
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

        <!-- 選択中のタグ一覧 -->
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

        <!-- 既存のボキャブラリから選ぶ -->
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

        <!-- 新しいタグの作成 -->
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
          <p class="text-[10px] text-slate-500 mt-1">
            💡 入力したタグは地域のボキャブラリとして自発的に成長し、ヘッダーのフィルター列にも提示されます。
          </p>
        </div>
      </div>

      <!-- 任意属性タグの追加 -->
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
        <span class="block text-xs font-bold text-slate-700 mb-1">詳細タグ・属性（任意）</span>
        <div class="flex items-center gap-1.5 mb-2">
          <input
            type="text"
            bind:value={attrKey}
            placeholder="項目名 (例: 給水上限)"
            class="w-1/3 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
          />
          <input
            type="text"
            bind:value={attrVal}
            placeholder="内容 (例: 1人20L)"
            class="w-1/2 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
          />
          <button
            type="button"
            onclick={addAttribute}
            class="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-bold text-slate-700 cursor-pointer"
          >
            追加
          </button>
        </div>

        {#if Object.keys(attributes).length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each Object.entries(attributes) as [k, v]}
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 text-[11px]">
                <span>{k}: {v}</span>
                <button type="button" onclick={() => removeAttribute(k)} class="text-slate-400 hover:text-rose-600 font-bold cursor-pointer">×</button>
              </span>
            {/each}
          </div>
        {/if}
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
          {isSubmitting ? '登録中...' : '生活情報を登録する'}
        </button>
      </div>
    </form>
  </div>
</div>
