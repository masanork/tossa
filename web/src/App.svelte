<!-- web/src/App.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Post, SystemSettings, User, TagCount } from './lib/types';
  import {
    fetchSettings,
    fetchPosts,
    fetchVocabularyTags,
    checkAuth,
  } from './lib/api';
  import Header from './lib/Header.svelte';
  import VocabularyFilter from './lib/VocabularyFilter.svelte';
  import PostCard from './lib/PostCard.svelte';
  import MapView from './lib/MapView.svelte';
  import UpdateStatusModal from './lib/UpdateStatusModal.svelte';
  import CreatePostModal from './lib/CreatePostModal.svelte';
  import AdminModal from './lib/AdminModal.svelte';
  import { List, Map as MapIcon, Search, Plus, RotateCw } from '@lucide/svelte';

  let settings = $state<SystemSettings>({
    site_title: 'tossa｜生活情報板',
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
  let updatingPost = $state<Post | null>(null);

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

  async function handleSettingsUpdated(newSettings: SystemSettings) {
    settings = newSettings;
    await reloadPosts();
  }
</script>

<div class="min-h-screen flex flex-col bg-slate-50">
  <!-- ヘッダー -->
  <Header
    {settings}
    user={currentUser}
    onOpenAdmin={() => { showAdminModal = true; }}
    onOpenCreate={() => { showCreateModal = true; }}
  />

  <!-- 自発的ボキャブラリ（タグ）メインフィルターバー -->
  <VocabularyFilter
    tags={vocabularyTags}
    {selectedTag}
    totalCount={totalPosts}
    onSelectTag={handleSelectTag}
  />

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
          placeholder="場所名、物資名、タグ、キーワード検索..."
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
          <option value="">全地区</option>
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
        <span>リスト</span>
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
        <span>地図</span>
      </button>

      <button
        type="button"
        onclick={() => reloadPosts()}
        class="p-1 text-slate-500 hover:text-slate-800 ml-1 rounded-md transition cursor-pointer"
        title="最新情報に更新"
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
        <span>生活情報を読み込み中...</span>
      </div>
    {:else if viewMode === 'map'}
      <!-- 地図ビュー -->
      {#if posts.length === 0}
        <div class="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8 shadow-xs mb-4">
          <div class="text-3xl mb-2">🗺️</div>
          <h3 class="text-sm font-bold text-slate-800 mb-1">地図上に表示できる情報がまだありません</h3>
          <p class="text-xs text-slate-500 mb-4">
            「＋ 情報を投稿」から緯度経度や住所を含む生活情報を投稿すると、ここにピンが表示されます。
          </p>
          <button
            type="button"
            onclick={() => { showCreateModal = true; }}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
          >
            ＋ 最初の情報を登録する
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
            <h3 class="text-sm font-bold text-slate-800 mb-1">条件に一致する情報が見つかりません</h3>
            <p class="text-xs text-slate-500 mb-4">
              検索条件を変更するか、右上の「＋ 情報を投稿」から新しい生活情報を登録してください。
            </p>
            <button
              type="button"
              onclick={() => { selectedTag = null; searchQuery = ''; selectedArea = ''; reloadPosts(); }}
              class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition cursor-pointer"
            >
              条件をクリア
            </button>
          </div>
        {:else}
          <!-- 完全白紙時のウェルカムCTA -->
          <div class="py-12 sm:py-16 text-center bg-gradient-to-b from-white to-blue-50/40 rounded-3xl border border-blue-100 p-8 sm:p-12 shadow-xs">
            <div class="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-inner">
              🌱
            </div>
            <h3 class="text-lg font-black text-slate-900 mb-2">
              まだ生活情報が登録されていません
            </h3>
            <p class="text-xs sm:text-sm text-slate-600 max-w-md mx-auto leading-relaxed mb-6">
              平時のカフェ・店舗・地域イベントから、有事の給水所・避難所・物資配布まで。<br />
              あなたの身近な生活情報を投稿して、地域の情報板を一緒に育てましょう。
            </p>
            <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onclick={() => { showCreateModal = true; }}
                class="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-sm rounded-xl shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer flex items-center justify-center gap-2"
              >
                <Plus class="w-4 h-4" />
                <span>＋ 最初の生活情報を投稿する</span>
              </button>
            </div>
          </div>
        {/if}
      {:else}
        <div class="flex items-center justify-between text-xs text-slate-500 mb-2 px-1">
          <span>{totalPosts} 件の生活情報</span>
          {#if selectedTag}
            <span class="inline-flex items-center gap-1 font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              #{selectedTag} で絞り込み中
              <button type="button" onclick={() => handleSelectTag(null)} class="hover:text-blue-800">×</button>
            </span>
          {/if}
          <span class="text-[11px] text-slate-400">※ エッジキャッシュにより高速配信</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {#each posts as post (post.id)}
            <PostCard
              {post}
              onOpenUpdateStatus={(p) => { updatingPost = p; }}
              onSelectTag={handleSelectTag}
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
      onclick={() => { showCreateModal = true; }}
      class="flex items-center gap-2 px-5 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 text-white rounded-full font-black text-sm shadow-xl active:scale-95 transition-all cursor-pointer ring-4 ring-blue-500/20"
    >
      <Plus class="w-4 h-4" />
      <span>情報を投稿</span>
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
      onClose={() => { showCreateModal = false; }}
      onCreated={() => { reloadPosts(); }}
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
</div>
