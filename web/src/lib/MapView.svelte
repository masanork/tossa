<!-- web/src/lib/MapView.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Post } from './types';
  import type { MapBounds } from './mapTileCache';
  import type * as L from 'leaflet';
  import * as m from '../paraglide/messages.js';
  import { Download, WifiOff } from '@lucide/svelte';

  interface Props {
    posts: Post[];
    defaultArea?: string;
    onOpenUpdateStatus: (post: Post) => void;
    onOpenOfflineMap?: (
      currentBounds: MapBounds,
      currentZoom: number,
      postsBounds: MapBounds | null
    ) => void;
  }

  const { posts, defaultArea, onOpenUpdateStatus, onOpenOfflineMap }: Props =
    $props();

  let mapContainer: HTMLDivElement;
  let map: L.Map | null = null;
  let markersLayer: L.LayerGroup | null = null;
  let leaflet: typeof L | null = null;
  let isOnline = $state(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  function handleOnline() {
    isOnline = true;
  }

  function handleOffline() {
    isOnline = false;
  }

  onMount(async () => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Dynamic import for Leaflet (SSR-safe)
    leaflet = await import('leaflet');

    // Initialize map (default to nationwide view, auto-adjust to posts or defaultArea)
    map = leaflet.map(mapContainer, {
      center: [36.2048, 138.2529],
      zoom: 5,
      zoomControl: false,
    });

    leaflet.control.zoom({ position: 'bottomright' }).addTo(map);

    // OpenStreetMap tiles (with crossOrigin support for service worker caching)
    leaflet
      .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
        crossOrigin: true,
      })
      .addTo(map);

    markersLayer = leaflet.layerGroup().addTo(map);
    updateMarkers();

    // If no posts have coordinates, pan to defaultArea if specified
    const hasAnyCoords = posts.some((p) => p.lat && p.lng);
    if (!hasAnyCoords && defaultArea) {
      try {
        const res = await fetch(
          `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(defaultArea)}`
        );
        const data = await res.json();
        if (data && data.length > 0 && data[0].geometry?.coordinates) {
          const [lng, lat] = data[0].geometry.coordinates;
          map.setView([lat, lng], 12);
        }
      } catch (err) {
        console.warn('Failed to geocode default area:', err);
      }
    }
  });

  onDestroy(() => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    if (map) {
      map.remove();
      map = null;
    }
  });

  function getPostsBounds(): MapBounds | null {
    const coords = posts.filter((p) => p.lat && p.lng);
    if (coords.length === 0) return null;
    let north = -90;
    let south = 90;
    let east = -180;
    let west = 180;
    for (const p of coords) {
      if (p.lat! > north) north = p.lat!;
      if (p.lat! < south) south = p.lat!;
      if (p.lng! > east) east = p.lng!;
      if (p.lng! < west) west = p.lng!;
    }
    return {
      north: Math.min(85, north + 0.05),
      south: Math.max(-85, south - 0.05),
      east: Math.min(180, east + 0.05),
      west: Math.max(-180, west - 0.05),
    };
  }

  function handleOpenOfflineMap() {
    if (!map) return;
    const b = map.getBounds();
    const currentBounds: MapBounds = {
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    };
    const currentZoom = map.getZoom();
    const postsBounds = getPostsBounds();
    if (onOpenOfflineMap) {
      onOpenOfflineMap(currentBounds, currentZoom, postsBounds);
    }
  }

  // Re-render markers when posts update
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

        // Generate pin icon styled by status
        const pinColor =
          post.current_status === 'danger' || post.current_status === 'closed'
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

        const marker = leaflet!
          .marker([post.lat, post.lng], { icon: customIcon })
          .addTo(markersLayer!);
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

<div
  class="relative h-[calc(100vh-210px)] min-h-[420px] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-inner"
>
  <!-- Offline status badge on map -->
  {#if !isOnline}
    <div
      class="absolute top-3 left-3 z-[400] flex items-center gap-1.5 rounded-lg bg-amber-500/95 px-2.5 py-1 text-xs font-bold text-white shadow-md backdrop-blur-xs"
    >
      <WifiOff class="h-3.5 w-3.5" />
      <span>{m.map_offline_badge()}</span>
    </div>
  {/if}

  <!-- Save Offline Map Button -->
  {#if onOpenOfflineMap}
    <button
      type="button"
      onclick={handleOpenOfflineMap}
      class="absolute top-3 right-3 z-[400] flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-800 shadow-md backdrop-blur-xs transition hover:bg-slate-50 hover:text-blue-600 active:scale-95"
    >
      <Download class="h-3.5 w-3.5 text-blue-600" />
      <span>{m.map_offline_btn()}</span>
    </button>
  {/if}

  <div bind:this={mapContainer} class="z-0 h-full w-full"></div>
</div>
