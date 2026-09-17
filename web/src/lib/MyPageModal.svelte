<!-- web/src/lib/MyPageModal.svelte: User MyPage for Managing Own Posts and Favorites -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Post, User } from './types';
  import { fetchPosts } from './api';
  import { favoritesManager } from './favorites.svelte';
  import { geolocationManager } from './geolocation.svelte';
  import { i18n, m } from './i18n.svelte';
  import {
    X,
    User as UserIcon,
    FileText,
    Star,
    Edit3,
    Trash2,
    Navigation,
    QrCode,
    MapPin,
    RotateCw,
    MessageSquareLock,
    ExternalLink,
  } from '@lucide/svelte';

  interface Props {
    onClose: () => void;
    onEditPost: (post: Post) => void;
    onDeletePost: (postId: string) => Promise<void> | void;
    onOpenQrShare: (post: Post) => void;
    onContactPost?: (post: Post) => void;
    currentUser: User | null;
    zIndex?: number;
    isTop?: boolean;
  }

  const {
    onClose,
    onEditPost,
    onDeletePost,
    onOpenQrShare,
    onContactPost,
    currentUser,
    zIndex = 60,
    isTop: _isTop = true,
  }: Props = $props();

  type TabKey = 'my_posts' | 'favorites';
  let currentTab = $state<TabKey>('my_posts');

  let myPosts = $state<Post[]>([]);
  let favoritePosts = $state<Post[]>([]);
  let isLoadingMyPosts = $state(true);
  let isLoadingFavorites = $state(false);

  async function loadMyPosts() {
    isLoadingMyPosts = true;
    try {
      const res = await fetchPosts({ mine: true });
      myPosts = res.posts || [];
    } catch (err) {
      console.error('Failed to load my posts:', err);
    } finally {
      isLoadingMyPosts = false;
    }
  }

  async function loadFavorites() {
    isLoadingFavorites = true;
    try {
      if (favoritesManager.favorites.length === 0) {
        favoritePosts = [];
        return;
      }
      const res = await fetchPosts({ ids: favoritesManager.favorites });
      favoritePosts = res.posts || [];
    } catch (err) {
      console.error('Failed to load favorite posts:', err);
    } finally {
      isLoadingFavorites = false;
    }
  }

  onMount(() => {
    void loadMyPosts();
    void loadFavorites();
  });

  async function handleDelete(post: Post) {
    if (confirm(`「${post.title}」を削除してもよろしいですか？`)) {
      await onDeletePost(post.id);
      myPosts = myPosts.filter((p) => p.id !== post.id);
    }
  }

  function handleToggleFavorite(postId: string) {
    favoritesManager.toggle(postId);
    favoritePosts = favoritePosts.filter((p) => p.id !== postId);
  }

  function handleStartNav(post: Post) {
    if (
      post.lat !== null &&
      post.lng !== null &&
      post.lat !== undefined &&
      post.lng !== undefined
    ) {
      geolocationManager.startNavigation({
        id: post.id,
        title: post.title,
        area: post.area,
        lat: post.lat,
        lng: post.lng,
        statusLabel: post.status_label,
        address: post.address,
      });
      onClose();
    }
  }

  function getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'available':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300';
      case 'crowded':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300';
      case 'closed':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300';
      case 'danger':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
    }
  }
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200"
  style="z-index: {zIndex};"
  onclick={onClose}
  role="presentation"
></div>

<!-- Modal Container -->
<div
  class="pointer-events-none fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4"
  style="z-index: {zIndex + 1};"
>
  <div
    class="pointer-events-auto flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl transition-all sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
    role="dialog"
    aria-modal="true"
    aria-labelledby="mypage-modal-title"
  >
    <!-- Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
        >
          <UserIcon class="h-5 w-5" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2
              id="mypage-modal-title"
              class="text-base font-bold text-slate-900 sm:text-lg dark:text-white"
            >
              {m.mypage_title()}
            </h2>
            {#if currentUser}
              <span
                class="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-950/80 dark:text-blue-300"
              >
                {currentUser.displayName}
              </span>
            {/if}
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {m.mypage_subtitle()}
          </p>
        </div>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        aria-label="閉じる"
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <!-- Navigation Tabs -->
    <div
      class="no-scrollbar flex shrink-0 overflow-x-auto border-b border-slate-200 bg-slate-50/75 px-3 py-1.5 sm:px-6 dark:border-slate-800 dark:bg-slate-800/40"
    >
      <div class="flex min-w-max gap-2">
        <button
          type="button"
          onclick={() => {
            currentTab = 'my_posts';
            void loadMyPosts();
          }}
          class={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
            currentTab === 'my_posts'
              ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-800 dark:text-blue-400'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <FileText class="h-3.5 w-3.5" />
          <span>{m.mypage_tab_posts()}</span>
          <span
            class="py-0.2 rounded-full bg-slate-200/80 px-1.5 text-[10px] dark:bg-slate-700"
          >
            {myPosts.length}
          </span>
        </button>

        <button
          type="button"
          onclick={() => {
            currentTab = 'favorites';
            void loadFavorites();
          }}
          class={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
            currentTab === 'favorites'
              ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-800 dark:text-blue-400'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Star class="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
          <span>{m.mypage_tab_favorites()}</span>
          <span
            class="py-0.2 rounded-full bg-slate-200/80 px-1.5 text-[10px] dark:bg-slate-700"
          >
            {favoritesManager.count}
          </span>
        </button>
      </div>
    </div>

    <!-- Tab Contents -->
    <div class="flex-1 overflow-y-auto p-4 sm:p-6">
      {#if currentTab === 'my_posts'}
        <!-- Tab 1: My Posts -->
        {#if isLoadingMyPosts}
          <div
            class="flex flex-col items-center justify-center gap-2 py-12 text-xs text-slate-400"
          >
            <RotateCw class="h-6 w-6 animate-spin text-blue-600" />
            <span>{m.loading_posts()}</span>
          </div>
        {:else if myPosts.length === 0}
          <div
            class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 p-8 text-center sm:p-12 dark:border-slate-800"
          >
            <div
              class="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-2xl dark:bg-blue-950/50"
            >
              📝
            </div>
            <div>
              <h3 class="text-sm font-bold text-slate-800 dark:text-slate-200">
                {m.mypage_posts_empty_title()}
              </h3>
              <p
                class="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400"
              >
                {m.mypage_posts_empty_desc()}
              </p>
            </div>
          </div>
        {:else}
          <div class="flex flex-col gap-3">
            {#each myPosts as post (post.id)}
              <div
                class="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-blue-300 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-blue-700"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span
                        class="text-sm font-bold text-slate-900 dark:text-white"
                      >
                        {post.title}
                      </span>
                      <span
                        class={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${getStatusBadgeClass(
                          post.current_status
                        )}`}
                      >
                        {i18n.translateStatus(
                          post.current_status,
                          post.status_label
                        )}
                      </span>
                    </div>
                    {#if post.address || post.area}
                      <div
                        class="mt-1 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
                      >
                        <MapPin class="h-3 w-3 shrink-0" />
                        <span class="truncate"
                          >{post.area} {post.address || ''}</span
                        >
                      </div>
                    {/if}
                    {#if post.note}
                      <p
                        class="mt-1.5 line-clamp-2 text-xs text-slate-600 dark:text-slate-300"
                      >
                        {post.note}
                      </p>
                    {/if}
                  </div>
                </div>

                <!-- Action Toolbar for My Post -->
                <div
                  class="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-700/60"
                >
                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      onclick={() => {
                        onClose();
                        onEditPost(post);
                      }}
                      class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      title="編集する"
                    >
                      <Edit3
                        class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
                      />
                      <span>{m.btn_edit()}</span>
                    </button>

                    <button
                      type="button"
                      onclick={() => handleDelete(post)}
                      class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/50 px-2.5 py-1 text-xs font-bold text-rose-600 transition hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-900/50"
                      title="削除する"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                      <span>{m.btn_delete()}</span>
                    </button>
                  </div>

                  <div class="flex items-center gap-1.5">
                    {#if post.lat && post.lng}
                      <button
                        type="button"
                        onclick={() => handleStartNav(post)}
                        class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-300"
                        title="避難ナビ開始"
                      >
                        <Navigation class="h-3.5 w-3.5" />
                        <span>{m.nav_start()}</span>
                      </button>
                    {/if}

                    <button
                      type="button"
                      onclick={() => onOpenQrShare(post)}
                      class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      title="QRコード共有"
                    >
                      <QrCode
                        class="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400"
                      />
                    </button>

                    <a
                      href="/posts/{post.id}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-0.5 rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      title="詳細ページを開く"
                    >
                      <ExternalLink class="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <!-- Tab 2: Favorites -->
        {#if isLoadingFavorites}
          <div
            class="flex flex-col items-center justify-center gap-2 py-12 text-xs text-slate-400"
          >
            <RotateCw class="h-6 w-6 animate-spin text-blue-600" />
            <span>{m.loading_posts()}</span>
          </div>
        {:else if favoritePosts.length === 0}
          <div
            class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 p-8 text-center sm:p-12 dark:border-slate-800"
          >
            <div
              class="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-2xl dark:bg-amber-950/50"
            >
              ⭐
            </div>
            <div>
              <h3 class="text-sm font-bold text-slate-800 dark:text-slate-200">
                {m.mypage_favs_empty_title()}
              </h3>
              <p
                class="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400"
              >
                {m.mypage_favs_empty_desc()}
              </p>
            </div>
          </div>
        {:else}
          <div class="flex flex-col gap-3">
            {#each favoritePosts as post (post.id)}
              <div
                class="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-amber-300 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-amber-700"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span
                        class="text-sm font-bold text-slate-900 dark:text-white"
                      >
                        {post.title}
                      </span>
                      <span
                        class={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${getStatusBadgeClass(
                          post.current_status
                        )}`}
                      >
                        {i18n.translateStatus(
                          post.current_status,
                          post.status_label
                        )}
                      </span>
                    </div>
                    {#if post.address || post.area}
                      <div
                        class="mt-1 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
                      >
                        <MapPin class="h-3 w-3 shrink-0" />
                        <span class="truncate"
                          >{post.area} {post.address || ''}</span
                        >
                      </div>
                    {/if}
                    {#if post.note}
                      <p
                        class="mt-1.5 line-clamp-2 text-xs text-slate-600 dark:text-slate-300"
                      >
                        {post.note}
                      </p>
                    {/if}
                  </div>

                  <!-- Star Bookmark toggle -->
                  <button
                    type="button"
                    onclick={() => handleToggleFavorite(post.id)}
                    class="cursor-pointer rounded-lg p-1.5 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    title="お気に入りから外す"
                  >
                    <Star class="h-4 w-4 fill-amber-400" />
                  </button>
                </div>

                <!-- Action Toolbar for Favorite -->
                <div
                  class="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-700/60"
                >
                  <div class="flex items-center gap-1.5">
                    {#if onContactPost}
                      <button
                        type="button"
                        onclick={() => {
                          onClose();
                          onContactPost?.(post);
                        }}
                        class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <MessageSquareLock
                          class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
                        />
                        <span>{m.btn_contact()}</span>
                      </button>
                    {/if}

                    <button
                      type="button"
                      onclick={() => onOpenQrShare(post)}
                      class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <QrCode
                        class="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400"
                      />
                      <span>{m.qr_share_btn()}</span>
                    </button>
                  </div>

                  <div class="flex items-center gap-1.5">
                    {#if post.lat && post.lng}
                      <button
                        type="button"
                        onclick={() => handleStartNav(post)}
                        class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700"
                      >
                        <Navigation class="h-3.5 w-3.5" />
                        <span>{m.nav_start()}</span>
                      </button>
                    {/if}

                    <a
                      href="/posts/{post.id}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-0.5 rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      title="詳細ページを開く"
                    >
                      <ExternalLink class="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <!-- Footer -->
    <div
      class="dark:bg-slate-850 flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6 dark:border-slate-800"
    >
      <span class="text-xs text-slate-500 dark:text-slate-400">
        {#if currentTab === 'my_posts'}
          {myPosts.length} 件の自投稿
        {:else}
          {favoritePosts.length} 件のお気に入り
        {/if}
      </span>
      <button
        type="button"
        onclick={onClose}
        class="cursor-pointer rounded-xl bg-slate-200 px-4 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        {m.btn_close()}
      </button>
    </div>
  </div>
</div>
