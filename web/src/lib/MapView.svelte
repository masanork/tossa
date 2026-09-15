<!-- web/src/lib/MapView.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Post } from './types';
  import type * as L from 'leaflet';

  interface Props {
    posts: Post[];
    onOpenUpdateStatus: (post: Post) => void;
  }

  let { posts, onOpenUpdateStatus }: Props = $props();

  let mapContainer: HTMLDivElement;
  let map: L.Map | null = null;
  let markersLayer: L.LayerGroup | null = null;
  let leaflet: typeof L | null = null;

  onMount(async () => {
    // Dynamic import for Leaflet (SSR-safe)
    leaflet = await import('leaflet');

    // 地図初期化（熊本市中心をデフォルト）
    map = leaflet.map(mapContainer, {
      center: [32.798, 130.725],
      zoom: 13,
      zoomControl: false,
    });

    leaflet.control.zoom({ position: 'bottomright' }).addTo(map);

    // 国土地理院またはOpenStreetMapタイル
    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    markersLayer = leaflet.layerGroup().addTo(map);
    updateMarkers();
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });

  // posts が変化したらマーカーを再描画
  $effect(() => {
    if (posts && markersLayer && leaflet) {
      updateMarkers();
    }
  });

  function updateMarkers() {
    if (!map || !markersLayer || !leaflet) return;

    markersLayer.clearLayers();
    const bounds = leaflet.latLngBounds([]);
    let hasCoords = false;

    posts.forEach((post) => {
      if (post.lat && post.lng) {
        hasCoords = true;
        bounds.extend([post.lat, post.lng]);

        // アイコン生成（ステータスに応じた視認性の高いピン）
        const pinColor = post.current_status === 'danger' || post.current_status === 'closed'
          ? '#dc2626'
          : post.current_status === 'crowded'
          ? '#d97706'
          : '#2563eb';

        const customIcon = leaflet!.divIcon({
          className: 'custom-map-pin',
          html: `
            <div style="
              background-color: ${pinColor};
              width: 30px;
              height: 30px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 15px;
              box-shadow: 0 2px 5px rgba(0,0,0,0.3);
              border: 2px solid white;
            ">
              📍
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -16],
        });

        const popupContent = document.createElement('div');
        popupContent.className = 'p-1';
        popupContent.innerHTML = `
          <div style="font-weight: 800; font-size: 13px; margin-bottom: 4px; color: #0f172a;">
            ${post.title}
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">
              ${post.area}
            </span>
            <span style="background: #2563eb; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">
              ${post.status_label}
            </span>
          </div>
          ${post.address ? `<div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${post.address}</div>` : ''}
          ${post.note ? `<div style="font-size: 11px; color: #334155; margin-bottom: 8px;">${post.note}</div>` : ''}
          <button id="btn-update-${post.id}" style="
            width: 100%;
            background: #2563eb;
            color: white;
            font-size: 11px;
            font-weight: bold;
            padding: 5px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
          ">状況を報告する</button>
        `;

        const marker = leaflet!.marker([post.lat, post.lng], { icon: customIcon }).addTo(markersLayer!);
        marker.bindPopup(popupContent);

        marker.on('popupopen', () => {
          const btn = document.getElementById(`btn-update-${post.id}`);
          if (btn) {
            btn.onclick = () => onOpenUpdateStatus(post);
          }
        });
      }
    });

    if (hasCoords) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }
</script>

<div class="relative w-full h-[calc(100vh-210px)] min-h-[420px] rounded-2xl overflow-hidden border border-slate-200 shadow-inner">
  <div bind:this={mapContainer} class="w-full h-full z-0"></div>
</div>
