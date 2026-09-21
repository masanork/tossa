<!-- web/src/lib/MapView.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Post, OpenDataShelter, DisasterArea } from './types';
  import type { MapBounds } from './mapTileCache';
  import type * as L from 'leaflet';
  import * as m from '../paraglide/messages.js';
  import { Download, WifiOff, Navigation, Landmark } from '@lucide/svelte';
  import { geolocationManager } from './geolocation.svelte';
  import { formatDistance, getCardinalDirection } from './geoDistance';
  import { escapeHtml } from './escape';

  interface Props {
    posts: Post[];
    defaultArea?: string;
    disasterAreas?: DisasterArea[];
    focusWaypointTrigger?: number;
    onOpenUpdateStatus: (post: Post) => void;
    onReportOfficialShelter?: (shelter: OpenDataShelter) => void;
    onOpenOfflineMap?: (
      currentBounds: MapBounds,
      currentZoom: number,
      postsBounds: MapBounds | null
    ) => void;
  }

  const {
    posts,
    defaultArea,
    disasterAreas = [],
    focusWaypointTrigger,
    onOpenUpdateStatus,
    onReportOfficialShelter,
    onOpenOfflineMap,
  }: Props = $props();

  let mapContainer: HTMLDivElement;
  let map: L.Map | null = null;
  let markersLayer: L.LayerGroup | null = null;
  let officialLayer: L.LayerGroup | null = null;
  let userLocationLayer: L.LayerGroup | null = null;
  let routeLayer: L.LayerGroup | null = null;
  let leaflet: typeof L | null = null;
  let initialBoundsFitted = false;
  let isOnline = $state(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Official Designated Emergency Shelters (GSI Open Data) Layer
  let showOfficialShelters = $state(true);
  let officialShelters = $state<OpenDataShelter[]>([]);
  let isLoadingOfficial = $state(false);

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
    officialLayer = leaflet.layerGroup().addTo(map);
    userLocationLayer = leaflet.layerGroup().addTo(map);
    routeLayer = leaflet.layerGroup().addTo(map);
    updateMarkers();
    updateUserLocationOnMap();
    updateWaypointRoute();
    loadOfficialShelters();

    // If no posts have coordinates, pan to disasterAreas or defaultArea
    const hasAnyCoords = posts.some((p) => p.lat && p.lng);
    if (!hasAnyCoords) {
      if (disasterAreas && disasterAreas.length > 0) {
        if (disasterAreas.length === 1 && disasterAreas[0]) {
          const zoom = disasterAreas[0].isPrefecture ? 9 : 13;
          map.setView([disasterAreas[0].lat, disasterAreas[0].lng], zoom);
        } else {
          const hasPref = disasterAreas.some((a) => a.isPrefecture);
          const bounds = leaflet.latLngBounds(
            disasterAreas.map((a) => [a.lat, a.lng])
          );
          map.fitBounds(bounds, {
            padding: [40, 40],
            maxZoom: hasPref ? 9 : 14,
          });
        }
      } else if (defaultArea) {
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

  async function loadOfficialShelters() {
    if (isLoadingOfficial || officialShelters.length > 0) return;
    isLoadingOfficial = true;
    try {
      if (disasterAreas && disasterAreas.length > 0) {
        const res = await fetch('/api/opendata/disaster-areas/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ areas: disasterAreas }),
        });
        if (res.ok) {
          const data = await res.json();
          if (
            data.success &&
            Array.isArray(data.shelters) &&
            data.shelters.length > 0
          ) {
            officialShelters = data.shelters;
            return;
          }
        }
      }

      // Fallback to all preset shelters
      const res = await fetch('/api/opendata/shelters');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.shelters)) {
          officialShelters = data.shelters;
        }
      }
    } catch (err) {
      console.warn('Failed to load official open data shelters:', err);
    } finally {
      isLoadingOfficial = false;
    }
  }

  // Re-render markers when posts update
  $effect(() => {
    if (posts && markersLayer && leaflet) {
      updateMarkers();
    }
  });

  // Re-render official shelters layer when toggle or data changes
  $effect(() => {
    const _show = showOfficialShelters;
    const _shelters = officialShelters;
    const _posts = posts;
    if (map && officialLayer && leaflet) {
      updateOfficialMarkers();
    }
  });

  // Update user location marker & circle when location changes
  $effect(() => {
    const loc = geolocationManager.currentLocation;
    if (loc && userLocationLayer && leaflet) {
      updateUserLocationOnMap();
      updateMarkers();
    }
  });

  // Update waypoint navigation route line & halo
  $effect(() => {
    const _wp = geolocationManager.activeWaypoint;
    const _loc = geolocationManager.currentLocation;
    if (map && leaflet && routeLayer) {
      updateWaypointRoute();
    }
  });

  // Pan and fit bounds to waypoint when focusWaypointTrigger changes
  $effect(() => {
    if (focusWaypointTrigger && focusWaypointTrigger > 0 && map && leaflet) {
      fitToWaypoint();
    }
  });

  function updateWaypointRoute() {
    if (!map || !leaflet || !routeLayer) return;
    routeLayer.clearLayers();

    const wp = geolocationManager.activeWaypoint;
    const loc = geolocationManager.currentLocation;
    if (!wp || !loc) return;

    const latlngs: [number, number][] = [
      [loc.lat, loc.lng],
      [wp.lat, wp.lng],
    ];

    // Dashed navigation vector line
    leaflet
      .polyline(latlngs, {
        color: '#2563eb',
        weight: 3.5,
        dashArray: '8, 8',
        opacity: 0.85,
      })
      .addTo(routeLayer);

    // Waypoint target pulsing halo
    const targetHalo = leaflet.divIcon({
      className: 'waypoint-target-halo',
      html: `
        <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; pointer-events: none;">
          <div style="position: absolute; width: 44px; height: 44px; background: rgba(37, 99, 235, 0.35); border-radius: 50%; animation: pulse-ring 1.8s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;"></div>
          <div style="position: absolute; width: 34px; height: 34px; border: 2px dashed #2563eb; border-radius: 50%;"></div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    leaflet
      .marker([wp.lat, wp.lng], { icon: targetHalo, zIndexOffset: 900 })
      .addTo(routeLayer);
  }

  function fitToWaypoint() {
    if (!map || !leaflet) return;
    const wp = geolocationManager.activeWaypoint;
    const loc = geolocationManager.currentLocation;
    if (wp && loc) {
      map.fitBounds(
        leaflet.latLngBounds([
          [loc.lat, loc.lng],
          [wp.lat, wp.lng],
        ]),
        { padding: [60, 60], maxZoom: 16 }
      );
    } else if (wp) {
      map.setView([wp.lat, wp.lng], 15);
    }
  }

  function updateUserLocationOnMap() {
    if (!map || !userLocationLayer || !leaflet) return;
    userLocationLayer.clearLayers();

    const loc = geolocationManager.currentLocation;
    if (!loc) return;

    // Accuracy circle (up to 5000m to avoid covering whole country)
    if (loc.accuracy && loc.accuracy > 0 && loc.accuracy < 5000) {
      leaflet
        .circle([loc.lat, loc.lng], {
          radius: loc.accuracy,
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.15,
          weight: 1,
        })
        .addTo(userLocationLayer);
    }

    // Pulsing user location marker
    const userIcon = leaflet.divIcon({
      className: 'custom-user-location-marker',
      html: `
        <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 24px; height: 24px; background: rgba(37, 99, 235, 0.4); border-radius: 50%; animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;"></div>
          <div style="width: 14px; height: 14px; background: #2563eb; border: 2.5px solid white; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.4); position: relative; z-index: 2;"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    leaflet
      .marker([loc.lat, loc.lng], { icon: userIcon, zIndexOffset: 1000 })
      .bindPopup(
        `<div style="font-weight: bold; font-size: 12px; color: #1e293b;">📍 現在地 (誤差 ±${loc.accuracy}m)</div>`
      )
      .addTo(userLocationLayer);
  }

  async function handleCenterOnLocation() {
    if (!geolocationManager.currentLocation) {
      const loc = await geolocationManager.requestLocation();
      if (loc && map) {
        map.setView([loc.lat, loc.lng], 15);
      }
    } else if (map) {
      map.setView(
        [
          geolocationManager.currentLocation.lat,
          geolocationManager.currentLocation.lng,
        ],
        15
      );
    }
  }

  function updateMarkers() {
    if (!map || !markersLayer || !leaflet) return;

    markersLayer.clearLayers();
    const bounds = leaflet.latLngBounds([]);
    let hasCoords = false;

    posts.forEach((post) => {
      if (post.lat && post.lng) {
        hasCoords = true;
        bounds.extend([post.lat, post.lng]);

        // Generate pin icon styled by status with CUD (Color Universal Design) symbols
        let pinColor = '#047857'; // emerald-700
        let pinSymbol = '✔';
        let statusTextPrefix = '[○]';

        if (
          post.current_status === 'danger' ||
          post.current_status === 'closed' ||
          post.current_status === 'out_of_stock'
        ) {
          pinColor = '#be123c'; // rose-700
          pinSymbol = '✖';
          statusTextPrefix = '[✕]';
        } else if (
          post.current_status === 'crowded' ||
          post.current_status === 'few' ||
          post.current_status === 'low_stock'
        ) {
          pinColor = '#b45309'; // amber-700
          pinSymbol = '▲';
          statusTextPrefix = '[▲]';
        } else if (post.current_status === 'unknown') {
          pinColor = '#334155'; // slate-700
          pinSymbol = '?';
          statusTextPrefix = '[?]';
        }

        const customIcon = leaflet!.divIcon({
          className: 'custom-map-pin',
          html: `
            <div style="
              background-color: ${pinColor};
              width: 32px;
              height: 32px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 14px;
              font-weight: 900;
              color: white;
              box-shadow: 0 3px 8px rgba(0,0,0,0.45);
              border: 2.5px solid white;
              line-height: 1;
            " role="img" aria-label="${post.status_label || ''}">
              ${pinSymbol}
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -16],
        });

        // calculate distance and direction if user location is available
        let distBadgeHtml = '';
        if (geolocationManager.currentLocation) {
          const dist = geolocationManager.getDistanceTo(post.lat, post.lng);
          const bearing = geolocationManager.getBearingTo(post.lat, post.lng);
          if (dist !== null && bearing !== null) {
            const formatted = formatDistance(dist);
            const cardinal = getCardinalDirection(bearing);
            distBadgeHtml = `
              <div style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #2563eb; background: #eff6ff; padding: 2px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid #bfdbfe;">
                <span>📍 現在地から ${formatted} (${cardinal}方向)</span>
              </div>
            `;
          }
        }

        const popupContent = document.createElement('div');
        popupContent.className = 'p-1';
        popupContent.innerHTML = `
          <div style="font-weight: 800; font-size: 13px; margin-bottom: 4px; color: #0f172a;">
            ${escapeHtml(post.title)}
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">
              ${escapeHtml(post.area)}
            </span>
            <span style="background: ${pinColor}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(255,255,255,0.2);">
              ${escapeHtml(statusTextPrefix)} ${escapeHtml(post.status_label || '')}
            </span>
          </div>
          ${distBadgeHtml}
          ${post.address ? `<div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">${escapeHtml(post.address)}</div>` : ''}
          ${post.note ? `<div style="font-size: 11px; color: #334155; margin-bottom: 8px;">${escapeHtml(post.note)}</div>` : ''}
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

    if (hasCoords && !initialBoundsFitted) {
      initialBoundsFitted = true;
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  function updateOfficialMarkers() {
    if (!map || !officialLayer || !leaflet) return;
    officialLayer.clearLayers();

    if (!showOfficialShelters || officialShelters.length === 0) return;

    officialShelters.forEach((shelter) => {
      if (!shelter.lat || !shelter.lng) return;

      // Check if there is already an active user post for this shelter
      const existingPost = posts.find(
        (p) =>
          (p.lat !== null &&
            p.lng !== null &&
            Math.hypot(p.lat - shelter.lat, p.lng - shelter.lng) < 0.0003) ||
          p.title.trim() === shelter.name.trim()
      );

      // Icon: Government official indigo theme (subtle slate if already reported)
      const customIcon = leaflet!.divIcon({
        className: 'custom-official-pin',
        html: `
          <div style="
            background: ${existingPost ? '#475569' : '#4338ca'};
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            color: white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            border: 2px solid white;
            line-height: 1;
            opacity: ${existingPost ? '0.75' : '0.95'};
          " role="img" aria-label="${shelter.name}">
            🏛️
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      });

      const popupContent = document.createElement('div');
      popupContent.className = 'p-1';
      popupContent.innerHTML = `
        <div style="display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 800; color: #4338ca; background: #e0e7ff; padding: 2px 6px; border-radius: 4px; margin-bottom: 5px;">
          ${m.map_official_badge()}
        </div>
        <div style="font-weight: 800; font-size: 13px; margin-bottom: 4px; color: #0f172a;">
          ${escapeHtml(shelter.name)}
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
          <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">
            ${escapeHtml(shelter.area)}
          </span>
          <span style="background: #f1f5f9; color: #334155; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #cbd5e1;">
            ${escapeHtml(shelter.category)}
          </span>
        </div>
        ${shelter.address ? `<div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">${escapeHtml(shelter.address)}</div>` : ''}
        ${shelter.note ? `<div style="font-size: 11px; color: #334155; margin-bottom: 6px; line-height: 1.4;">${escapeHtml(shelter.note)}</div>` : ''}
        ${
          existingPost
            ? `<div style="font-size: 11px; color: #059669; font-weight: 700; margin-bottom: 6px; background: #ecfdf5; padding: 3px 6px; border-radius: 4px; border: 1px solid #a7f3d0;">
                 ✓ 現在の状況報告あり（${escapeHtml(existingPost.status_label || existingPost.current_status)}）
               </div>`
            : `<div style="font-size: 10.5px; color: #64748b; margin-bottom: 8px; background: #f8fafc; padding: 3px 6px; border-radius: 4px; border: 1px dashed #cbd5e1;">
                 ${m.map_official_unreported()}
               </div>`
        }
        <button id="btn-report-official-${shelter.id || Math.random().toString(36).slice(2)}" style="
          width: 100%;
          background: #4338ca;
          color: white;
          font-size: 11px;
          font-weight: bold;
          padding: 6px 8px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          transition: background 0.15s;
        ">${m.map_official_report_btn()}</button>
      `;

      const marker = leaflet!
        .marker([shelter.lat, shelter.lng], {
          icon: customIcon,
          zIndexOffset: 100,
        })
        .addTo(officialLayer!);
      marker.bindPopup(popupContent);

      marker.on('popupopen', () => {
        const btnId = popupContent.querySelector('button')?.id;
        if (btnId) {
          const btn = document.getElementById(btnId);
          if (btn) {
            btn.onclick = () => {
              if (onReportOfficialShelter) {
                onReportOfficialShelter(shelter);
              }
            };
          }
        }
      });
    });
  }
</script>

<div
  class="relative h-[calc(100vh-210px)] min-h-[420px] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-inner dark:border-slate-800"
>
  <!-- Top Left Controls (Offline badge & Official Shelters Layer toggle) -->
  <div class="absolute top-3 left-3 z-[400] flex flex-wrap items-center gap-2">
    {#if !isOnline}
      <div
        class="flex items-center gap-1.5 rounded-lg bg-amber-500/95 px-2.5 py-1.5 text-xs font-bold text-white shadow-md backdrop-blur-xs"
      >
        <WifiOff class="h-3.5 w-3.5" />
        <span>{m.map_offline_badge()}</span>
      </div>
    {/if}

    <button
      type="button"
      onclick={() => {
        showOfficialShelters = !showOfficialShelters;
      }}
      class="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold shadow-md backdrop-blur-xs transition active:scale-95 {showOfficialShelters
        ? 'border-indigo-600 bg-indigo-600 text-white shadow-indigo-600/20 hover:bg-indigo-700'
        : 'border-slate-200 bg-white/95 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200'}"
      aria-pressed={showOfficialShelters}
      title="国土地理院・自治体指定避難所レイヤーの表示/非表示"
    >
      <Landmark
        class="h-3.5 w-3.5 {showOfficialShelters
          ? 'text-indigo-200'
          : 'text-indigo-600'}"
      />
      <span>{m.map_official_layer_toggle()}</span>
      {#if officialShelters.length > 0}
        <span
          class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold {showOfficialShelters
            ? 'bg-white/25 text-white'
            : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'}"
        >
          {officialShelters.length}
        </span>
      {/if}
    </button>
  </div>

  <!-- Save Offline Map Button -->
  {#if onOpenOfflineMap}
    <button
      type="button"
      onclick={handleOpenOfflineMap}
      class="absolute top-3 right-3 z-[400] flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-800 shadow-md backdrop-blur-xs transition hover:bg-slate-50 hover:text-blue-600 active:scale-95 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 dark:hover:bg-slate-800"
    >
      <Download class="h-3.5 w-3.5 text-blue-600" />
      <span>{m.map_offline_btn()}</span>
    </button>
  {/if}

  <!-- Center on current location floating button -->
  <button
    type="button"
    onclick={handleCenterOnLocation}
    title={geolocationManager.currentLocation
      ? m.geo_btn_on({ accuracy: geolocationManager.currentLocation.accuracy })
      : m.geo_btn_off()}
    aria-label="現在地に移動"
    class="absolute right-3 bottom-24 z-[400] flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur-xs transition hover:bg-slate-50 hover:text-blue-600 active:scale-95 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800"
  >
    <Navigation
      class="h-5 w-5 {geolocationManager.isLocating
        ? 'animate-spin text-blue-600'
        : geolocationManager.currentLocation
          ? 'fill-blue-600/20 text-blue-600'
          : 'text-slate-600'}"
    />
  </button>

  <div bind:this={mapContainer} class="z-0 h-full w-full"></div>
</div>

<style>
  @keyframes pulse-ring {
    0% {
      transform: scale(0.6);
      opacity: 0.8;
    }
    80%,
    100% {
      transform: scale(2.2);
      opacity: 0;
    }
  }
</style>
