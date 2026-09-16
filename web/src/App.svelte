<!-- web/src/App.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
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
  import { List, Map as MapIcon, Search, Plus, RotateCw } from '@lucide/svelte';
  import { i18n, m } from './lib/i18n.svelte';

  let settings = $state<SystemSettings>({
    site_title: 'tossa',
    emergency_banner: '',
    default_area: '',
  });

  let posts = $state<Post[]>([]);
  let vocabularyTags = $state<TagCount[]>([]);
  let totalPosts = $state(0);
  let isLoading = $state(true);

  // フィルタ状態（ボキャブラリタグ、キーワード、エリア）
  let selectedTag = $state<string | null>(null);
  let searchQuery = $state('');
  let selectedArea = $state<string>('');
  let viewMode = $state<'list' | 'map'>('list');

  // モーダル
  let showAdminModal = $state(false);
  let showCreateModal = $state(false);
  let showMessagesModal = $state(false);
  let updatingPost = $state<Post | null>(null);
  let editingPost = $state<Post | null>(null);
  let messageContextPost = $state<Post | null>(null);

  // 認証
  let currentUser = $state<User | null>(null);
  let authToken = $state<string | null>(localStorage.getItem('tossa_token'));

  // エリア候補（投稿データから自動抽出）
  let availableAreas = $derived.by(() => {
    const set = new Set<string>();
    posts.forEach((p) => {
      if (p.area) set.add(p.area);
    });
    return Array.from(set);
  });

  onMount(async () => {
    // 1. 認証トークン確認
    if (authToken) {
      const authRes = await checkAuth(authToken);
      if (authRes.authenticated && authRes.user) {
        currentUser = authRes.user;
      } else {
        authToken = null;
        localStorage.removeItem('tossa_token');
      }
    }

    // 2. 初期データロード
    await loadInitialData();
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

  // タグ（ボキャブラリ）選択ハンドラ
  function handleSelectTag(tag: string | null) {
    selectedTag = tag;
    reloadPosts();
  }

  // 検索ハンドラ
  let searchTimeout: any = null;
  function handleSearchInput(e: Event) {
    searchQuery = (e.target as HTMLInputElement).value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      reloadPosts();
    }, 300);
  }

  // 認証成功ハンドラ
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

  // 投稿作成オープン（Cookie識別により未ログインでも即座に投稿可能）
  function handleOpenCreate() {
    editingPost = null;
    showCreateModal = true;
  }

  // 投稿編集オープン
  function handleEditPost(post: Post) {
    editingPost = post;
    showCreateModal = true;
  }

  // 投稿削除（Cookie所有者またはPasskey本人/管理者）
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

  // E2EEメッセージモーダルを開く
  function handleOpenMessages() {
    if (!currentUser || !authToken) {
      alert(m.e2ee_need_auth());
      showAdminModal = true;
      return;
    }
    messageContextPost = null;
    showMessagesModal = true;
  }

  // 投稿への問い合わせ（メッセージモーダルを特定投稿で開く）
  function handleContactPost(post: Post) {
    if (!currentUser || !authToken) {
      alert(m.e2ee_need_auth());
      showAdminModal = true;
      return;
    }
    messageContextPost = post;
    showMessagesModal = true;
  }

  // Passkey登録促進バナーの非表示状態
  let hidePasskeyNudge = $state(false);
</script>

<div class="min-h-screen flex flex-col bg-slate-50">
  <!-- ヘッダー -->
  <Header
    {settings}
    user={currentUser}
    onOpenAdmin={() => { showAdminModal = true; }}
    onOpenCreate={handleOpenCreate}
    onOpenMessages={handleOpenMessages}
  />

  <!-- 自発的ボキャブラリ（タグ）メインフィルターバー -->
  <VocabularyFilter
    tags={vocabularyTags}
    {selectedTag}
    totalCount={totalPosts}
    onSelectTag={handleSelectTag}
  />

  <!-- 未ログイン（端末Cookie識別）ユーザーへのPasskey登録促進バナー -->
  {#if !currentUser && !hidePasskeyNudge}
    <div class="max-w-4xl mx-auto px-4 w-full mb-3">
      <div class="bg-gradient-to-r from-blue-50 via-indigo-50 to-white border border-blue-200/80 rounded-2xl p-3 sm:p-3.5 flex items-center justify-between gap-3 shadow-2xs">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs font-bold text-sm">
            🔑
          </div>
          <div class="text-xs leading-tight">
            <span class="font-bold text-slate-800">{m.nudge_cookie_title()}</span>
            <p class="text-[11px] text-slate-500 mt-0.5">
              {m.nudge_cookie_desc()}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onclick={() => { showAdminModal = true; }}
            class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition shadow-2xs cursor-pointer whitespace-nowrap"
          >
            {m.nudge_register_btn()}
          </button>
          <button
            type="button"
            onclick={() => { hidePasskeyNudge = true; }}
            class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition cursor-pointer"
            title="閉じる"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- サブバー: 検索・エリア・表示切替 (List ⇄ Map) -->
  <div class="max-w-4xl mx-auto px-4 w-full mb-3 flex flex-col sm:flex-row items-center justify-between gap-2.5">
    <div class="flex items-center gap-2 w-full sm:w-auto flex-1">
      <!-- 検索バー -->
      <div class="relative flex-1">
        <Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          oninput={handleSearchInput}
          placeholder={m.search_placeholder()}
          class="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
        />
      </div>

      <!-- エリア選択 -->
      {#if availableAreas.length > 0}
        <select
          bind:value={selectedArea}
          onchange={() => reloadPosts()}
          class="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 shadow-2xs focus:outline-none"
        >
          <option value="">{m.all_areas()}</option>
          {#each availableAreas as a}
            <option value={a}>{a}</option>
          {/each}
        </select>
      {/if}
    </div>

    <!-- リスト / 地図トグルボタン -->
    <div class="flex items-center bg-slate-200/80 p-0.5 rounded-lg shrink-0 self-end sm:self-auto">
      <button
        type="button"
        onclick={() => { viewMode = 'list'; }}
        class={`flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
          viewMode === 'list'
            ? 'bg-white text-slate-900 shadow-xs'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <List class="w-3.5 h-3.5" />
        <span>{m.btn_list_view()}</span>
      </button>

      <button
        type="button"
        onclick={() => { viewMode = 'map'; }}
        class={`flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
          viewMode === 'map'
            ? 'bg-white text-slate-900 shadow-xs'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <MapIcon class="w-3.5 h-3.5" />
        <span>{m.btn_map_view()}</span>
      </button>

      <button
        type="button"
        onclick={() => reloadPosts()}
        class="p-1 text-slate-500 hover:text-slate-800 ml-1 rounded-md transition cursor-pointer"
        title={m.btn_refresh()}
      >
        <RotateCw class="w-3.5 h-3.5" />
      </button>
    </div>
  </div>

  <!-- メインコンテンツ -->
  <main class="max-w-4xl mx-auto px-4 w-full flex-1 pb-16">
    {#if isLoading}
      <div class="py-16 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
        <div class="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <span>{m.loading_posts()}</span>
      </div>
    {:else if viewMode === 'map'}
      <!-- 地図ビュー -->
      {#if posts.length === 0}
        <div class="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8 shadow-xs mb-4">
          <div class="text-3xl mb-2">🗺️</div>
          <h3 class="text-sm font-bold text-slate-800 mb-1">{m.map_empty_title()}</h3>
          <p class="text-xs text-slate-500 mb-4">
            {m.map_empty_desc()}
          </p>
          <button
            type="button"
            onclick={handleOpenCreate}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
          >
            {m.empty_btn()}
          </button>
        </div>
      {:else}
        <MapView
          {posts}
          defaultArea={settings.default_area || ''}
          onOpenUpdateStatus={(p) => { updatingPost = p; }}
        />
      {/if}
    {:else}
      <!-- リストビュー -->
      {#if posts.length === 0}
        {#if selectedTag || searchQuery || selectedArea}
          <!-- 絞り込みによる0件 -->
          <div class="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
            <div class="text-3xl mb-2">🔍</div>
            <h3 class="text-sm font-bold text-slate-800 mb-1">{m.empty_filter_title()}</h3>
            <p class="text-xs text-slate-500 mb-4">
              {m.empty_filter_desc()}
            </p>
            <button
              type="button"
              onclick={() => { selectedTag = null; searchQuery = ''; selectedArea = ''; reloadPosts(); }}
              class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition cursor-pointer"
            >
              {m.btn_clear_filters()}
            </button>
          </div>
        {:else}
          <!-- 完全白紙時のウェルカムCTA -->
          <div class="py-12 sm:py-16 text-center bg-gradient-to-b from-white to-blue-50/40 rounded-3xl border border-blue-100 p-8 sm:p-12 shadow-xs">
            <div class="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-inner">
              🌱
            </div>
            <h3 class="text-lg font-black text-slate-900 mb-2">
              {m.empty_title()}
            </h3>
            <p class="text-xs sm:text-sm text-slate-600 max-w-md mx-auto leading-relaxed mb-6">
              {m.empty_description()}
            </p>
            <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onclick={handleOpenCreate}
                class="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-sm rounded-xl shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer flex items-center justify-center gap-2"
              >
                <Plus class="w-4 h-4" />
                <span>{m.empty_btn()}</span>
              </button>
            </div>
          </div>
        {/if}
      {:else}
        <div class="flex items-center justify-between text-xs text-slate-500 mb-2 px-1">
          <span>{m.posts_count({ count: totalPosts })}</span>
          {#if selectedTag}
            <span class="inline-flex items-center gap-1 font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {m.filtering_by_tag({ tag: selectedTag })}
              <button type="button" onclick={() => handleSelectTag(null)} class="hover:text-blue-800">×</button>
            </span>
          {/if}
          <span class="text-[11px] text-slate-400">{m.edge_cache_notice()}</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {#each posts as post (post.id)}
            <PostCard
              {post}
              currentUser={currentUser}
              onOpenUpdateStatus={(p) => { updatingPost = p; }}
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

  <!-- フローティング投稿ボタン（スマホ用・目立つデザイン） -->
  <div class="fixed bottom-5 right-5 sm:hidden z-30">
    <button
      type="button"
      onclick={handleOpenCreate}
      class="flex items-center gap-2 px-5 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 text-white rounded-full font-black text-sm shadow-xl active:scale-95 transition-all cursor-pointer ring-4 ring-blue-500/20"
    >
      <Plus class="w-4 h-4" />
      <span>{m.btn_post()}</span>
    </button>
  </div>

  <!-- 各種モーダル -->
  {#if updatingPost}
    <UpdateStatusModal
      post={updatingPost}
      onClose={() => { updatingPost = null; }}
      onUpdated={() => { reloadPosts(); }}
    />
  {/if}

  {#if showCreateModal}
    <CreatePostModal
      vocabularyTags={vocabularyTags}
      defaultArea={settings.default_area || ''}
      availableAreas={availableAreas}
      token={authToken}
      editingPost={editingPost}
      onClose={() => { showCreateModal = false; editingPost = null; }}
      onCreated={() => { reloadPosts(); }}
      onUpdated={() => { reloadPosts(); }}
      onOpenAuth={() => { showAdminModal = true; }}
    />
  {/if}

  {#if showAdminModal}
    <AdminModal
      {settings}
      user={currentUser}
      token={authToken}
      onClose={() => { showAdminModal = false; }}
      onAuthSuccess={handleAuthSuccess}
      onLogout={handleLogout}
      onSettingsUpdated={handleSettingsUpdated}
    />
  {/if}

  {#if showMessagesModal && currentUser && authToken}
    <MessagesModal
      currentUser={currentUser}
      token={authToken}
      initialPostId={messageContextPost?.id}
      initialPostTitle={messageContextPost?.title}
      onClose={() => { showMessagesModal = false; messageContextPost = null; }}
    />
  {/if}
</div>
