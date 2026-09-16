<!-- web/src/lib/WaypointNavHUD.svelte: Emergency Evacuation Waypoint HUD & Live Compass Tracker -->
<script lang="ts">
  import { geolocationManager } from './geolocation.svelte';
  import {
    formatDistance,
    getCardinalDirection,
    getRelativeAngle,
  } from './geoDistance';
  import { i18n, m } from './i18n.svelte';
  import {
    Navigation,
    X,
    MapPin,
    ChevronUp,
    ChevronDown,
    CheckCircle2,
    Compass,
  } from '@lucide/svelte';

  interface Props {
    onViewOnMap?: () => void;
  }

  const { onViewOnMap }: Props = $props();

  let isExpanded = $state(false);

  // Reactive navigation computations
  const target = $derived(geolocationManager.activeWaypoint);
  const distance = $derived(geolocationManager.waypointDistance);
  const bearing = $derived(geolocationManager.waypointBearing);

  const formattedDist = $derived(
    distance !== null ? formatDistance(distance) : '---'
  );

  const cardinal = $derived(
    bearing !== null ? getCardinalDirection(bearing, i18n.current) : '---'
  );

  const relativeAngle = $derived(
    bearing !== null
      ? getRelativeAngle(bearing, geolocationManager.deviceHeading)
      : 0
  );

  const isArrived = $derived(geolocationManager.isWaypointArrived);
</script>

{#if target}
  <aside
    class="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 transition-all duration-300 ease-out"
    aria-label={m.nav_hud_title()}
  >
    <div
      class={`overflow-hidden rounded-2xl border bg-white/95 shadow-2xl backdrop-blur-md transition-all dark:bg-slate-900/95 ${
        isArrived
          ? 'border-emerald-500 ring-2 ring-emerald-500/30'
          : 'border-blue-500/80 ring-2 ring-blue-500/20 dark:border-blue-600'
      }`}
    >
      <!-- Expanded Giant Compass Dial View -->
      {#if isExpanded}
        <div class="border-b border-slate-100 p-5 dark:border-slate-800">
          <div class="mb-3 flex items-center justify-between">
            <div
              class="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400"
            >
              <Compass class="h-4 w-4" />
              <span>{m.nav_hud_title()}</span>
            </div>
            <button
              type="button"
              onclick={() => (isExpanded = false)}
              class="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title={m.nav_collapse()}
            >
              <ChevronDown class="h-4 w-4" />
            </button>
          </div>

          <!-- Compass Rose Graphic -->
          <div class="my-4 flex flex-col items-center justify-center">
            <div
              class="relative flex h-36 w-36 items-center justify-center rounded-full border-4 border-slate-200 bg-slate-50 shadow-inner dark:border-slate-700 dark:bg-slate-800/80"
            >
              <!-- 8-point tick indicators -->
              <span class="absolute top-1 text-[10px] font-black text-rose-500"
                >N</span
              >
              <span
                class="absolute right-2 text-[10px] font-black text-slate-400"
                >E</span
              >
              <span
                class="absolute bottom-1 text-[10px] font-black text-slate-400"
                >S</span
              >
              <span
                class="absolute left-2 text-[10px] font-black text-slate-400"
                >W</span
              >

              <!-- Live Rotating Arrow Pointer -->
              <div
                class="flex items-center justify-center transition-transform duration-200 ease-out"
                style="transform: rotate({relativeAngle}deg);"
              >
                <div class="relative flex flex-col items-center">
                  <!-- North / Target tip (Red triangle needle) -->
                  <div
                    class="h-0 w-0 border-x-8 border-b-[38px] border-x-transparent border-b-rose-600 drop-shadow-md"
                  ></div>
                  <!-- Pivot center -->
                  <div
                    class="h-4 w-4 rounded-full border-2 border-white bg-slate-800 shadow-md"
                  ></div>
                  <!-- Tail -->
                  <div
                    class="h-0 w-0 border-x-6 border-t-[26px] border-x-transparent border-t-slate-400"
                  ></div>
                </div>
              </div>
            </div>

            <div class="mt-3 text-center">
              {#if isArrived}
                <div
                  class="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                >
                  <CheckCircle2 class="h-4 w-4 text-emerald-600" />
                  <span>{m.nav_arrived()}</span>
                </div>
              {:else}
                <div
                  class="text-2xl font-black tracking-tight text-slate-900 dark:text-white"
                >
                  {formattedDist}
                </div>
                <div class="text-xs font-bold text-blue-600 dark:text-blue-400">
                  {cardinal} ({Math.round(relativeAngle)}°)
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Compact Bottom Bar (Always visible while active) -->
      <div class="flex items-center justify-between gap-3 p-3">
        <!-- Live Compass Arrow Avatar -->
        <button
          type="button"
          onclick={() => (isExpanded = !isExpanded)}
          class={`relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl shadow-md transition-transform active:scale-95 ${
            isArrived
              ? 'bg-emerald-600 text-white'
              : 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white'
          }`}
          title={isExpanded ? m.nav_collapse() : m.nav_expand()}
        >
          {#if isArrived}
            <CheckCircle2 class="h-6 w-6" />
          {:else}
            <Navigation
              class="h-6 w-6 transition-transform duration-200 ease-out"
              style="transform: rotate({relativeAngle}deg);"
            />
          {/if}
        </button>

        <!-- Target Info & Remaining Distance -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span
              class="truncate text-xs font-black text-slate-900 dark:text-white"
            >
              {target.title}
            </span>
            {#if target.statusLabel}
              <span
                class="py-0.2 shrink-0 rounded bg-blue-100 px-1.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300"
              >
                {target.statusLabel}
              </span>
            {/if}
          </div>

          <div class="mt-0.5 flex items-center gap-2 text-xs">
            {#if isArrived}
              <span class="font-bold text-emerald-600 dark:text-emerald-400">
                {m.nav_arrived()}
              </span>
            {:else}
              <span class="font-black text-blue-600 dark:text-blue-400">
                {m.nav_approaching({ dist: formattedDist })}
              </span>
              <span class="text-slate-500 dark:text-slate-400">
                ({cardinal})
              </span>
            {/if}
          </div>
        </div>

        <!-- Quick Action Buttons -->
        <div class="flex shrink-0 items-center gap-1">
          <!-- View on Map Button -->
          {#if onViewOnMap}
            <button
              type="button"
              onclick={onViewOnMap}
              class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-2xs transition hover:bg-slate-100 hover:text-blue-600 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title={m.nav_view_map()}
            >
              <MapPin class="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </button>
          {/if}

          <!-- Expand / Collapse Toggle -->
          <button
            type="button"
            onclick={() => (isExpanded = !isExpanded)}
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-2xs transition hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            title={isExpanded ? m.nav_collapse() : m.nav_expand()}
          >
            {#if isExpanded}
              <ChevronDown class="h-4 w-4" />
            {:else}
              <ChevronUp class="h-4 w-4" />
            {/if}
          </button>

          <!-- Stop Guidance Button -->
          <button
            type="button"
            onclick={() => geolocationManager.stopNavigation()}
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 shadow-2xs transition hover:bg-rose-100 active:scale-95 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
            title={m.nav_stop()}
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </aside>
{/if}
