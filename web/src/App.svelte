<!-- web/src/App.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Post, SystemSettings, User, TagCount } from './lib/types';
  import {
    fetchSettings,
    fetchPosts,
    fetchVocabularyTags,
    checkAuth,
    deletePost,
  } from './lib/api';
  import Header from './lib/Header.svelte';
  import VocabularyFilter from './lib/VocabularyFilter.svelte';
  import PostCard from './lib/PostCard.svelte';
  import MapView from './lib/MapView.svelte';
  import UpdateStatusModal from './lib/UpdateStatusModal.svelte';
  import CreatePostModal from './lib/CreatePostModal.svelte';
  import AdminModal from './lib/AdminModal.svelte';
  import MessagesModal from './lib/MessagesModal.svelte';
  import OfflineMapModal from './lib/OfflineMapModal.svelte';
  import type { MapBounds } from './lib/mapTileCache';
  import {
    List,
    Map as MapIcon,
    Search,
    Plus,
    RotateCw,
    WifiOff,
    Check,
    Smartphone,
    Navigation,
  } from '@lucide/svelte';
  import { m } from './lib/i18n.svelte';
  import { getPendingQueueCount, flushOfflineQueue } from './lib/offlineQueue';
  import { modalManager, type ModalName } from './lib/modalManager.svelte';
  import { geolocationManager } from './lib/geolocation.svelte';
  import { calculateDistance } from './lib/geoDistance';

  let settings = $state<SystemSettings>({
    site_title: 'tossa',
    emergency_banner: '',
    default_area: '',
  });

  let posts = $state<Post[]>([]);
  let vocabularyTags = $state<TagCount[]>([]);
  let totalPosts = $state(0);
  let isLoading = $state(true);

  // Filter state (vocabulary tag, keyword, area)
  let selectedTag = $state<string | null>(null);
  let searchQuery = $state('');
  let selectedArea = $state<string>('');
  let viewMode = $state<'list' | 'map'>('list');

  // Modal context state
  let updatingPost = $state<Post | null>(null);
  let editingPost = $state<Post | null>(null);
  let messageContextPost = $state<Post | null>(null);

  // Auth state
  let currentUser = $state<User | null>(null);
  let authToken = $state<string | null>(localStorage.getItem('tossa_token'));

  // Offline & PWA state
  let isOnline = $state(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  let pendingCount = $state(0);
  let offlineNotice = $state<string | null>(null);
  let isSyncing = $state(false);
  let deferredInstallPrompt = $state<any>(null);
  let showInstallBanner = $state(false);

  // Candidate areas (extracted from posts)
  const availableAreas = $derived(
    Array.from(new Set(posts.map((p) => p.area).filter(Boolean)))
  );

  // Sorted posts (newest vs closest by GPS straight-line distance)
  const displayPosts = $derived.by(() => {
    if (
      !geolocationManager.sortByDistance ||
      !geolocationManager.currentLocation
    ) {
      return posts;
    }
    const userLat = geolocationManager.currentLocation.lat;
    const userLng = geolocationManager.currentLocation.lng;

    return [...posts].sort((a, b) => {
      const hasA =
        a.lat !== null &&
        a.lat !== undefined &&
        a.lng !== null &&
        a.lng !== undefined;
      const hasB =
        b.lat !== null &&
        b.lat !== undefined &&
        b.lng !== null &&
        b.lng !== undefined;

      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;

      const distA = calculateDistance(userLat, userLng, a.lat!, a.lng!);
      const distB = calculateDistance(userLat, userLng, b.lat!, b.lng!);
      return distA - distB;
    });
  });

  function handleCloseModal(name: ModalName) {
    modalManager.close(name);
    if (name === 'create') editingPost = null;
    if (name === 'update_status') updatingPost = null;
    if (name === 'messages') messageContextPost = null;
  }

  async function syncOfflineQueue() {
    pendingCount = getPendingQueueCount();
    if (pendingCount === 0 || isSyncing) return;

    isSyncing = true;
    try {
      const res = await flushOfflineQueue(authToken);
      pendingCount = getPendingQueueCount();
      if (res.succeeded > 0) {
        offlineNotice = m.offline_sync_success({ count: res.succeeded });
        setTimeout(() => {
          offlineNotice = null;
        }, 4000);
        await reloadPosts();
      }
    } finally {
      isSyncing = false;
    }
  }

  function handleOnline() {
    isOnline = true;
    void syncOfflineQueue();
  }

  function handleOffline() {
    isOnline = false;
    pendingCount = getPendingQueueCount();
  }

  function handleBeforeInstallPrompt(e: Event) {
    e.preventDefault();
    deferredInstallPrompt = e;
    const dismissedAt = localStorage.getItem('tossa_pwa_dismissed');
    if (!dismissedAt || Date.now() - Number(dismissedAt) > 7 * 86400000) {
      showInstallBanner = true;
    }
  }

  async function handleInstallPwa() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice?.outcome === 'accepted') {
      showInstallBanner = false;
    }
    deferredInstallPrompt = null;
  }

  function handleDismissInstall() {
    showInstallBanner = false;
    localStorage.setItem('tossa_pwa_dismissed', String(Date.now()));
  }

  onMount(async () => {
    // 1. Verify auth token
    if (authToken) {
      const authRes = await checkAuth(authToken);
      if (authRes.authenticated && authRes.user) {
        currentUser = authRes.user;
      } else {
        authToken = null;
        localStorage.removeItem('tossa_token');
      }
    }

    // 2. Load initial data
    await loadInitialData();

    // 3. Online/Offline, PWA & Outbox Listeners
    pendingCount = getPendingQueueCount();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    if (navigator.onLine && pendingCount > 0) {
      await syncOfflineQueue();
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
    }
  });

  async function loadInitialData() {
    isLoading = true;
    try {
      const fetchedSettings = await fetchSettings();
      settings = fetchedSettings || {};
      vocabularyTags = await fetchVocabularyTags();
      await reloadPosts();
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      isLoading = false;
    }
  }

  async function reloadPosts() {
    try {
      const [postRes, tags] = await Promise.all([
        fetchPosts({
          area: selectedArea || undefined,
          tag: selectedTag || undefined,
          q: searchQuery || undefined,
        }),
        fetchVocabularyTags(),
      ]);
      posts = postRes.posts || [];
      totalPosts = postRes.total || 0;
      vocabularyTags = tags;
    } catch (err) {
      console.error('Failed to reload posts:', err);
    }
  }

  // Tag (vocabulary) selection handler
  function handleSelectTag(tag: string | null) {
    selectedTag = tag;
    reloadPosts();
  }

  // Search input handler
  let searchTimeout: any = null;
  function handleSearchInput(e: Event) {
    searchQuery = (e.target as HTMLInputElement).value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      reloadPosts();
    }, 300);
  }

  // Auth success handler
  function handleAuthSuccess(user: User, token: string) {
    currentUser = user;
    authToken = token;
    localStorage.setItem('tossa_token', token);
  }

  function handleLogout() {
    currentUser = null;
    authToken = null;
    localStorage.removeItem('tossa_token');
  }

  function handleOpenUpdateStatus(post: Post) {
    updatingPost = post;
    modalManager.open('update_status');
  }

  // Open create post (cookie identification allows instant posting without login)
  function handleOpenCreate() {
    editingPost = null;
    modalManager.open('create');
  }

  // Open edit post
  function handleEditPost(post: Post) {
    editingPost = post;
    modalManager.open('create');
  }

  // Delete post (cookie owner, author, or admin)
  async function handleDeletePost(postId: string) {
    try {
      const res = await deletePost(postId, authToken);
      if (res.success) {
        await reloadPosts();
      } else {
        alert(res.error || '削除に失敗しました');
      }
    } catch (err: any) {
      alert(err.message || '削除中にエラーが発生しました');
    }
  }

  async function handleSettingsUpdated(newSettings: SystemSettings) {
    settings = newSettings;
    await reloadPosts();
  }

  function handleOpenAdmin() {
    modalManager.open('admin');
  }

  // Open E2EE messaging modal
  function handleOpenMessages(post?: Post) {
    if (!currentUser || !authToken) {
      alert(m.e2ee_need_auth());
      modalManager.open('admin');
      return;
    }
    messageContextPost = post || null;
    modalManager.open('messages');
  }

  // Contact about post (open messages modal with post context)
  function handleContactPost(post: Post) {
    handleOpenMessages(post);
  }

  // Offline map state & opening handler
  let currentMapBounds = $state<MapBounds | null>(null);
  let currentMapZoom = $state<number>(12);
  let postsMapBounds = $state<MapBounds | null>(null);

  function handleOpenOfflineMap(
    bounds: MapBounds,
    zoom: number,
    postsBounds: MapBounds | null
  ) {
    currentMapBounds = bounds;
    currentMapZoom = zoom;
    postsMapBounds = postsBounds;
    modalManager.open('offline_map');
  }

  // Passkey nudge banner dismissed state
  let hidePasskeyNudge = $state(false);
</script>

<div
  class="flex min-h-screen flex-col bg-slate-50 text-slate-900 transition-colors duration-200 dark:bg-slate-950 dark:text-slate-100"
>
  <!-- Header -->
  <Header
    {settings}
    user={currentUser}
    onOpenAdmin={handleOpenAdmin}
    onOpenCreate={handleOpenCreate}
    onOpenMessages={() => handleOpenMessages()}
  />

  <!-- PWA Install Banner -->
  {#if showInstallBanner}
    <div
      class="animate-in fade-in flex items-center justify-between gap-3 bg-gradient-to-r from-blue-700 to-indigo-700 px-4 py-2.5 text-xs text-white shadow-md duration-200"
    >
      <div class="flex items-center gap-2">
        <Smartphone class="h-4 w-4 shrink-0 text-blue-200" />
        <span class="font-medium"
          >ホーム画面に追加して、オフラインでも迅速に起動できます</span
        >
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onclick={handleInstallPwa}
          class="cursor-pointer rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-blue-700 shadow-2xs transition hover:bg-blue-50"
        >
          インストール
        </button>
        <button
          type="button"
          onclick={handleDismissInstall}
          class="cursor-pointer rounded-md p-1 text-blue-200 transition hover:text-white"
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>
    </div>
  {/if}

  <!-- Offline status & Sync notification banners -->
  {#if !isOnline}
    <div
      class="flex items-center justify-center gap-2 bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition"
    >
      <WifiOff class="h-4 w-4 shrink-0" />
      <span>{m.offline_banner()}</span>
      {#if pendingCount > 0}
        <span
          class="shrink-0 rounded-full bg-amber-800 px-2 py-0.5 font-mono text-[11px]"
        >
          未送信: {pendingCount}件
        </span>
      {/if}
    </div>
  {:else if pendingCount > 0}
    <div
      class="animate-in fade-in flex items-center justify-between gap-2 bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs duration-200"
    >
      <div class="flex items-center gap-2">
        <RotateCw
          class="h-3.5 w-3.5 shrink-0 {isSyncing ? 'animate-spin' : ''}"
        />
        <span>未送信の投稿・更新が {pendingCount} 件あります</span>
      </div>
      <button
        type="button"
        onclick={() => syncOfflineQueue()}
        disabled={isSyncing}
        class="cursor-pointer rounded bg-white/20 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-white/30 disabled:opacity-50"
      >
        {isSyncing ? '送信中...' : '今すぐ送信'}
      </button>
    </div>
  {:else if offlineNotice}
    <div
      class="animate-in fade-in flex items-center justify-center gap-2 bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs duration-200"
    >
      <Check class="h-4 w-4 shrink-0" />
      <span>{offlineNotice}</span>
    </div>
  {/if}

  <!-- Organic vocabulary tag filter bar -->
  <VocabularyFilter
    tags={vocabularyTags}
    {selectedTag}
    totalCount={totalPosts}
    onSelectTag={handleSelectTag}
  />

  <!-- Passkey nudge banner for cookie-identified users -->
  {#if !currentUser && !hidePasskeyNudge}
    <div class="mx-auto mb-3 w-full max-w-4xl px-4">
      <div
        class="flex items-center justify-between gap-3 rounded-2xl border border-blue-200/80 bg-gradient-to-r from-blue-50 via-indigo-50 to-white p-3 shadow-2xs sm:p-3.5 dark:border-blue-900/50 dark:from-slate-900 dark:via-blue-950/40 dark:to-slate-900"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs"
          >
            🔑
          </div>
          <div class="text-xs leading-tight">
            <span class="font-bold text-slate-800 dark:text-slate-200"
              >{m.nudge_cookie_title()}</span
            >
            <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {m.nudge_cookie_desc()}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onclick={handleOpenAdmin}
            class="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white shadow-2xs transition hover:bg-blue-700"
          >
            {m.nudge_register_btn()}
          </button>
          <button
            type="button"
            onclick={() => {
              hidePasskeyNudge = true;
            }}
            class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200/50 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="閉じる"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Sub-bar: Search, Area, View toggle (List ⇄ Map) -->
  <div
    class="mx-auto mb-3 flex w-full max-w-4xl flex-col items-center justify-between gap-2.5 px-4 sm:flex-row"
  >
    <div class="flex w-full flex-1 items-center gap-2 sm:w-auto">
      <!-- Search input -->
      <div class="relative flex-1">
        <Search
          class="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        />
        <input
          type="text"
          value={searchQuery}
          oninput={handleSearchInput}
          placeholder={m.search_placeholder()}
          class="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
        />
      </div>

      <!-- Area dropdown -->
      {#if availableAreas.length > 0}
        <select
          bind:value={selectedArea}
          onchange={() => reloadPosts()}
          class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-2xs focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="">{m.all_areas()}</option>
          {#each availableAreas as a (a)}
            <option value={a}>{a}</option>
          {/each}
        </select>
      {/if}

      <!-- Distance / GPS sort toggle button -->
      <button
        type="button"
        onclick={() => geolocationManager.toggleSortByDistance()}
        disabled={geolocationManager.isLocating}
        class={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold shadow-2xs transition-all ${
          geolocationManager.sortByDistance
            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
        title={geolocationManager.sortByDistance
          ? m.sort_newest()
          : m.geo_prompt_enable()}
      >
        <Navigation
          class={`h-3.5 w-3.5 text-blue-600 dark:text-blue-400 ${
            geolocationManager.isLocating ? 'animate-spin' : ''
          }`}
        />
        <span>
          {#if geolocationManager.isLocating}
            {m.geo_locating()}
          {:else if geolocationManager.sortByDistance}
            {m.sort_distance()}
          {:else}
            {m.sort_newest()}
          {/if}
        </span>
      </button>
    </div>

    <!-- List / Map view toggle -->
    <div
      class="flex shrink-0 items-center self-end rounded-lg bg-slate-200/80 p-0.5 sm:self-auto dark:bg-slate-800"
    >
      <button
        type="button"
        onclick={() => {
          viewMode = 'list';
        }}
        class={`flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 text-xs font-bold transition-all ${
          viewMode === 'list'
            ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        <List class="h-3.5 w-3.5" />
        <span>{m.btn_list_view()}</span>
      </button>

      <button
        type="button"
        onclick={() => {
          viewMode = 'map';
        }}
        class={`flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 text-xs font-bold transition-all ${
          viewMode === 'map'
            ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        <MapIcon class="h-3.5 w-3.5" />
        <span>{m.btn_map_view()}</span>
      </button>

      <button
        type="button"
        onclick={() => reloadPosts()}
        class="ml-1 cursor-pointer rounded-md p-1 text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        title={m.btn_refresh()}
      >
        <RotateCw class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>

  <!-- Main content -->
  <main class="mx-auto w-full max-w-4xl flex-1 px-4 pb-16">
    {#if isLoading}
      <div
        class="flex flex-col items-center gap-2 py-16 text-center text-xs text-slate-400"
      >
        <div
          class="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
        ></div>
        <span>{m.loading_posts()}</span>
      </div>
    {:else if viewMode === 'map'}
      <!-- Map view -->
      {#if posts.length === 0}
        <div
          class="mb-4 rounded-2xl border border-slate-200 bg-white p-8 py-16 text-center shadow-xs"
        >
          <div class="mb-2 text-3xl">🗺️</div>
          <h3 class="mb-1 text-sm font-bold text-slate-800">
            {m.map_empty_title()}
          </h3>
          <p class="mb-4 text-xs text-slate-500">
            {m.map_empty_desc()}
          </p>
          <button
            type="button"
            onclick={handleOpenCreate}
            class="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700"
          >
            {m.empty_btn()}
          </button>
        </div>
      {:else}
        <MapView
          posts={displayPosts}
          defaultArea={settings.default_area || ''}
          onOpenUpdateStatus={handleOpenUpdateStatus}
          onOpenOfflineMap={handleOpenOfflineMap}
        />
      {/if}
    {:else}
      <!-- List view -->
      {#if posts.length === 0}
        {#if selectedTag || searchQuery || selectedArea}
          <!-- Empty results from filter -->
          <div
            class="rounded-2xl border border-slate-200 bg-white p-8 py-16 text-center shadow-xs"
          >
            <div class="mb-2 text-3xl">🔍</div>
            <h3 class="mb-1 text-sm font-bold text-slate-800">
              {m.empty_filter_title()}
            </h3>
            <p class="mb-4 text-xs text-slate-500">
              {m.empty_filter_desc()}
            </p>
            <button
              type="button"
              onclick={() => {
                selectedTag = null;
                searchQuery = '';
                selectedArea = '';
                reloadPosts();
              }}
              class="cursor-pointer rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
            >
              {m.btn_clear_filters()}
            </button>
          </div>
        {:else}
          <!-- Welcome CTA when zero posts exist -->
          <div
            class="rounded-3xl border border-blue-100 bg-gradient-to-b from-white to-blue-50/40 p-8 py-12 text-center shadow-xs sm:p-12 sm:py-16"
          >
            <div
              class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-3xl text-blue-600 shadow-inner"
            >
              🌱
            </div>
            <h3 class="mb-2 text-lg font-black text-slate-900">
              {m.empty_title()}
            </h3>
            <p
              class="mx-auto mb-6 max-w-md text-xs leading-relaxed text-slate-600 sm:text-sm"
            >
              {m.empty_description()}
            </p>
            <div
              class="flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <button
                type="button"
                onclick={handleOpenCreate}
                class="flex w-full transform cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-black text-white shadow-md transition-all hover:-translate-y-0.5 hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg active:translate-y-0 sm:w-auto"
              >
                <Plus class="h-4 w-4" />
                <span>{m.empty_btn()}</span>
              </button>
            </div>
          </div>
        {/if}
      {:else}
        <div
          class="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500"
        >
          <div class="flex items-center gap-2">
            <span>{m.posts_count({ count: totalPosts })}</span>
            {#if geolocationManager.sortByDistance && geolocationManager.currentLocation}
              <span
                class="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300"
              >
                <span>📍</span>
                <span
                  >{m.sort_distance()} (±{geolocationManager.currentLocation
                    .accuracy}m)</span
                >
              </span>
            {/if}
          </div>
          {#if selectedTag}
            <span
              class="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 font-bold text-blue-600"
            >
              {m.filtering_by_tag({ tag: selectedTag })}
              <button
                type="button"
                onclick={() => handleSelectTag(null)}
                class="hover:text-blue-800">×</button
              >
            </span>
          {/if}
          <span class="text-[11px] text-slate-400">{m.edge_cache_notice()}</span
          >
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          {#each displayPosts as post (post.id)}
            <PostCard
              {post}
              {currentUser}
              onOpenUpdateStatus={handleOpenUpdateStatus}
              onSelectTag={handleSelectTag}
              onEditPost={handleEditPost}
              onDeletePost={handleDeletePost}
              onContactPost={handleContactPost}
            />
          {/each}
        </div>
      {/if}
    {/if}
  </main>

  <!-- Floating post CTA button (mobile) -->
  <div class="fixed right-5 bottom-5 z-30 sm:hidden">
    <button
      type="button"
      onclick={handleOpenCreate}
      class="flex cursor-pointer items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3.5 text-sm font-black text-white shadow-xl ring-4 ring-blue-500/20 transition-all hover:from-blue-700 active:scale-95"
    >
      <Plus class="h-4 w-4" />
      <span>{m.btn_post()}</span>
    </button>
  </div>

  <!-- Modals (with Stack & Bottom Sheet coordination) -->
  {#if modalManager.isOpen('update_status') && updatingPost}
    <UpdateStatusModal
      post={updatingPost}
      isTop={modalManager.isTop('update_status')}
      zIndex={modalManager.getZIndex('update_status')}
      onClose={() => handleCloseModal('update_status')}
      onUpdated={() => {
        reloadPosts();
      }}
    />
  {/if}

  {#if modalManager.isOpen('create')}
    <CreatePostModal
      {vocabularyTags}
      defaultArea={settings.default_area || ''}
      {availableAreas}
      token={authToken}
      {editingPost}
      isTop={modalManager.isTop('create')}
      zIndex={modalManager.getZIndex('create')}
      onClose={() => handleCloseModal('create')}
      onCreated={() => {
        pendingCount = getPendingQueueCount();
        reloadPosts();
      }}
      onUpdated={() => {
        pendingCount = getPendingQueueCount();
        reloadPosts();
      }}
      onOpenAuth={() => {
        modalManager.open('admin');
      }}
    />
  {/if}

  {#if modalManager.isOpen('admin')}
    <AdminModal
      {settings}
      user={currentUser}
      token={authToken}
      isTop={modalManager.isTop('admin')}
      zIndex={modalManager.getZIndex('admin')}
      onClose={() => handleCloseModal('admin')}
      onAuthSuccess={handleAuthSuccess}
      onLogout={handleLogout}
      onSettingsUpdated={handleSettingsUpdated}
    />
  {/if}

  {#if modalManager.isOpen('messages') && currentUser && authToken}
    <MessagesModal
      {currentUser}
      token={authToken}
      initialPostId={messageContextPost?.id}
      initialPostTitle={messageContextPost?.title}
      isTop={modalManager.isTop('messages')}
      zIndex={modalManager.getZIndex('messages')}
      onClose={() => handleCloseModal('messages')}
    />
  {/if}

  {#if modalManager.isOpen('offline_map')}
    <OfflineMapModal
      currentBounds={currentMapBounds}
      currentZoom={currentMapZoom}
      postsBounds={postsMapBounds}
      isTop={modalManager.isTop('offline_map')}
      zIndex={modalManager.getZIndex('offline_map')}
      onClose={() => handleCloseModal('offline_map')}
    />
  {/if}
</div>
