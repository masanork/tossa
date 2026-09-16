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
  import {
    List,
    Map as MapIcon,
    Search,
    Plus,
    RotateCw,
    WifiOff,
    Check,
  } from '@lucide/svelte';
  import { m } from './lib/i18n.svelte';
  import { getPendingQueueCount, flushOfflineQueue } from './lib/offlineQueue';

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

  // Modal state
  let showAdminModal = $state(false);
  let showCreateModal = $state(false);
  let showMessagesModal = $state(false);
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

  // Candidate areas (extracted from posts)
  const availableAreas = $derived(
    Array.from(new Set(posts.map((p) => p.area).filter(Boolean)))
  );

  // Lock body scroll when any modal is open
  $effect(() => {
    const hasModal =
      showAdminModal ||
      showCreateModal ||
      showMessagesModal ||
      updatingPost !== null;
    if (typeof document !== 'undefined') {
      document.body.style.overflow = hasModal ? 'hidden' : '';
    }
  });

  function pushModalHistory() {
    if (typeof window !== 'undefined') {
      history.pushState({ tossaModal: true }, '');
    }
  }

  async function syncOfflineQueue() {
    pendingCount = getPendingQueueCount();
    if (pendingCount === 0) return;

    const res = await flushOfflineQueue(authToken);
    pendingCount = getPendingQueueCount();
    if (res.succeeded > 0) {
      offlineNotice = m.offline_sync_success({ count: res.succeeded });
      setTimeout(() => {
        offlineNotice = null;
      }, 4000);
      await reloadPosts();
    }
  }

  function handleOnline() {
    isOnline = true;
    syncOfflineQueue();
  }

  function handleOffline() {
    isOnline = false;
    pendingCount = getPendingQueueCount();
  }

  function handlePopstate() {
    if (showAdminModal) {
      showAdminModal = false;
    } else if (showCreateModal) {
      showCreateModal = false;
      editingPost = null;
    } else if (showMessagesModal) {
      showMessagesModal = false;
      messageContextPost = null;
    } else if (updatingPost) {
      updatingPost = null;
    }
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

    // 3. Online/Offline & Outbox Listeners
    pendingCount = getPendingQueueCount();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('popstate', handlePopstate);

    if (navigator.onLine && pendingCount > 0) {
      await syncOfflineQueue();
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('popstate', handlePopstate);
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
    pushModalHistory();
    updatingPost = post;
  }

  // Open create post (cookie identification allows instant posting without login)
  function handleOpenCreate() {
    pushModalHistory();
    editingPost = null;
    showCreateModal = true;
  }

  // Open edit post
  function handleEditPost(post: Post) {
    pushModalHistory();
    editingPost = post;
    showCreateModal = true;
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

  // Open E2EE messaging modal
  function handleOpenMessages() {
    pushModalHistory();
    if (!currentUser || !authToken) {
      alert(m.e2ee_need_auth());
      showAdminModal = true;
      return;
    }
    messageContextPost = null;
    showMessagesModal = true;
  }

  // Contact about post (open messages modal with post context)
  function handleContactPost(post: Post) {
    pushModalHistory();
    if (!currentUser || !authToken) {
      alert(m.e2ee_need_auth());
      showAdminModal = true;
      return;
    }
    messageContextPost = post;
    showMessagesModal = true;
  }

  // Passkey nudge banner dismissed state
  let hidePasskeyNudge = $state(false);
</script>

<div class="flex min-h-screen flex-col bg-slate-50">
  <!-- Header -->
  <Header
    {settings}
    user={currentUser}
    onOpenAdmin={() => {
      pushModalHistory();
      showAdminModal = true;
    }}
    onOpenCreate={handleOpenCreate}
    onOpenMessages={handleOpenMessages}
  />

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
        class="flex items-center justify-between gap-3 rounded-2xl border border-blue-200/80 bg-gradient-to-r from-blue-50 via-indigo-50 to-white p-3 shadow-2xs sm:p-3.5"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs"
          >
            🔑
          </div>
          <div class="text-xs leading-tight">
            <span class="font-bold text-slate-800"
              >{m.nudge_cookie_title()}</span
            >
            <p class="mt-0.5 text-[11px] text-slate-500">
              {m.nudge_cookie_desc()}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onclick={() => {
              showAdminModal = true;
            }}
            class="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white shadow-2xs transition hover:bg-blue-700"
          >
            {m.nudge_register_btn()}
          </button>
          <button
            type="button"
            onclick={() => {
              hidePasskeyNudge = true;
            }}
            class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200/50 hover:text-slate-600"
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
          class="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={searchQuery}
          oninput={handleSearchInput}
          placeholder={m.search_placeholder()}
          class="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      <!-- Area dropdown -->
      {#if availableAreas.length > 0}
        <select
          bind:value={selectedArea}
          onchange={() => reloadPosts()}
          class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-2xs focus:outline-none"
        >
          <option value="">{m.all_areas()}</option>
          {#each availableAreas as a (a)}
            <option value={a}>{a}</option>
          {/each}
        </select>
      {/if}
    </div>

    <!-- List / Map view toggle -->
    <div
      class="flex shrink-0 items-center self-end rounded-lg bg-slate-200/80 p-0.5 sm:self-auto"
    >
      <button
        type="button"
        onclick={() => {
          viewMode = 'list';
        }}
        class={`flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 text-xs font-bold transition-all ${
          viewMode === 'list'
            ? 'bg-white text-slate-900 shadow-xs'
            : 'text-slate-600 hover:text-slate-900'
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
            ? 'bg-white text-slate-900 shadow-xs'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <MapIcon class="h-3.5 w-3.5" />
        <span>{m.btn_map_view()}</span>
      </button>

      <button
        type="button"
        onclick={() => reloadPosts()}
        class="ml-1 cursor-pointer rounded-md p-1 text-slate-500 transition hover:text-slate-800"
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
          {posts}
          defaultArea={settings.default_area || ''}
          onOpenUpdateStatus={handleOpenUpdateStatus}
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
          class="mb-2 flex items-center justify-between px-1 text-xs text-slate-500"
        >
          <span>{m.posts_count({ count: totalPosts })}</span>
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
          {#each posts as post (post.id)}
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

  <!-- Modals -->
  {#if updatingPost}
    <UpdateStatusModal
      post={updatingPost}
      onClose={() => {
        updatingPost = null;
      }}
      onUpdated={() => {
        reloadPosts();
      }}
    />
  {/if}

  {#if showCreateModal}
    <CreatePostModal
      {vocabularyTags}
      defaultArea={settings.default_area || ''}
      {availableAreas}
      token={authToken}
      {editingPost}
      onClose={() => {
        showCreateModal = false;
        editingPost = null;
      }}
      onCreated={() => {
        reloadPosts();
      }}
      onUpdated={() => {
        reloadPosts();
      }}
      onOpenAuth={() => {
        showAdminModal = true;
      }}
    />
  {/if}

  {#if showAdminModal}
    <AdminModal
      {settings}
      user={currentUser}
      token={authToken}
      onClose={() => {
        showAdminModal = false;
      }}
      onAuthSuccess={handleAuthSuccess}
      onLogout={handleLogout}
      onSettingsUpdated={handleSettingsUpdated}
    />
  {/if}

  {#if showMessagesModal && currentUser && authToken}
    <MessagesModal
      {currentUser}
      token={authToken}
      initialPostId={messageContextPost?.id}
      initialPostTitle={messageContextPost?.title}
      onClose={() => {
        showMessagesModal = false;
        messageContextPost = null;
      }}
    />
  {/if}
</div>
