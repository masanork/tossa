<!-- web/src/lib/PostCard.svelte -->
<script lang="ts">
  import type { Post, ImageMeta, User, StatusUpdate } from './types';
  import { verifyPost, fetchPostDetail, updatePostStatus } from './api';
  import {
    MapPin,
    Clock,
    ExternalLink,
    CheckCircle,
    RefreshCw,
    ShieldCheck,
    ThumbsUp,
    Check,
    Edit3,
    Trash2,
    MessageSquareLock,
    X,
    Navigation,
    QrCode,
    Star,
    MessageSquareText,
    ChevronDown,
    ChevronUp,
    Send,
  } from '@lucide/svelte';
  import { i18n, m } from './i18n.svelte';
  import { geolocationManager } from './geolocation.svelte';
  import { favoritesManager } from './favorites.svelte';
  import {
    formatDistance,
    getCardinalDirection,
    getRelativeAngle,
  } from './geoDistance';
  import { isPeerPostId } from './peerPosts';

  interface Props {
    post: Post;
    currentUser?: User | null;
    onOpenUpdateStatus: (post: Post) => void;
    onSelectTag?: (tag: string) => void;
    onEditPost?: (post: Post) => void;
    onDeletePost?: (postId: string) => void;
    onContactPost?: (post: Post) => void;
    onOpenQrShare?: (post: Post) => void;
  }

  const {
    post,
    currentUser,
    onOpenUpdateStatus,
    onSelectTag,
    onEditPost,
    onDeletePost,
    onContactPost,
    onOpenQrShare,
  }: Props = $props();

  const isAuthorOrAdmin = $derived.by(() => {
    // Passkey admin
    if (currentUser?.role === 'admin') return true;
    // Original author with Passkey
    if (currentUser && post.author_id && post.author_id === currentUser.id)
      return true;
    // Original author identified by cookie (verified on server)
    if (post.is_owner) return true;
    return false;
  });

  // Verification state
  let verificationCount = $state(0);
  let lastVerifiedAt = $state<string | null>(null);
  let isVerifiedByMe = $state(false);
  let isVerifying = $state(false);

  $effect(() => {
    verificationCount = post.verification_count || 0;
    lastVerifiedAt = post.last_verified_at || null;
  });

  // Micro-update timeline state
  let showUpdatesTimeline = $state(false);
  let updatesList = $state<StatusUpdate[]>([]);
  let isLoadingUpdates = $state(false);
  let newUpdateNote = $state('');
  let isSubmittingNote = $state(false);
  let noteSubmitSuccess = $state(false);

  async function handleToggleUpdatesTimeline() {
    showUpdatesTimeline = !showUpdatesTimeline;
    if (showUpdatesTimeline && updatesList.length === 0) {
      isLoadingUpdates = true;
      try {
        const detail = await fetchPostDetail(post.id);
        updatesList = detail.history || [];
      } catch (err) {
        console.error('Failed to load updates history:', err);
      } finally {
        isLoadingUpdates = false;
      }
    }
  }

  async function handleSubmitUpdateNote() {
    const trimmed = newUpdateNote.trim();
    if (!trimmed || isSubmittingNote) return;

    isSubmittingNote = true;
    try {
      const res = await updatePostStatus(
        post.id,
        undefined,
        undefined,
        trimmed
      );
      if (res.success) {
        updatesList = [
          {
            id: `temp_${Date.now()}`,
            post_id: post.id,
            status: post.current_status,
            status_label: post.status_label,
            note: trimmed,
            created_at: new Date().toISOString(),
          },
          ...updatesList,
        ];
        newUpdateNote = '';
        noteSubmitSuccess = true;
        setTimeout(() => {
          noteSubmitSuccess = false;
        }, 3000);
      }
    } catch (err) {
      console.error('Failed to submit update note:', err);
    } finally {
      isSubmittingNote = false;
    }
  }

  // Parse image metadata (EXIF & C2PA)
  const parsedImageMeta = $derived.by<ImageMeta | null>(() => {
    if (!post.image_meta) return null;
    try {
      return typeof post.image_meta === 'string'
        ? JSON.parse(post.image_meta)
        : (post.image_meta as ImageMeta);
    } catch {
      return null;
    }
  });

  const photoTakenTime = $derived.by(() => {
    if (!parsedImageMeta?.exif?.dateTimeOriginal) return null;
    try {
      return new Date(parsedImageMeta.exif.dateTimeOriginal).toLocaleString(
        'ja-JP',
        {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }
      );
    } catch {
      return null;
    }
  });

  // Parse tags
  const parsedTags = $derived.by(() => {
    try {
      return post.tags ? (JSON.parse(post.tags) as string[]) : [];
    } catch {
      return [];
    }
  });

  // Parse JSON attributes
  const parsedAttrs = $derived.by(() => {
    try {
      return post.attributes ? JSON.parse(post.attributes) : {};
    } catch {
      return {};
    }
  });

  // Geolocation straight-line distance & compass direction
  const distanceInfo = $derived.by(() => {
    if (
      post.lat === null ||
      post.lat === undefined ||
      post.lng === null ||
      post.lng === undefined ||
      !geolocationManager.currentLocation
    ) {
      return null;
    }
    const dist = geolocationManager.getDistanceTo(post.lat, post.lng);
    const bearing = geolocationManager.getBearingTo(post.lat, post.lng);
    if (dist === null || bearing === null) return null;

    const relativeAngle = getRelativeAngle(
      bearing,
      geolocationManager.deviceHeading
    );
    const cardinal = getCardinalDirection(bearing, i18n.current);
    const formattedDistance = formatDistance(dist);

    return {
      distanceMeters: dist,
      formattedDistance,
      bearing,
      relativeAngle,
      cardinal,
    };
  });

  const isPeer = $derived(!!post.is_peer || isPeerPostId(post.id));

  // Source URL trust badge
  const sourceTrustBadge = $derived.by(() => {
    if (!post.source_url) return null;
    try {
      const parsed = new URL(
        post.source_url.startsWith('http')
          ? post.source_url
          : `https://${post.source_url}`
      );
      const host = parsed.hostname.toLowerCase();
      if (host.endsWith('.go.jp') || host.endsWith('.lg.jp')) {
        return {
          label: '公的機関・自治体公式',
          color: 'bg-emerald-50 text-emerald-800 border-emerald-300',
          icon: '🏛️',
          host,
        };
      }
      if (host.endsWith('.ac.jp')) {
        return {
          label: '大学・学術機関',
          color: 'bg-blue-50 text-blue-800 border-blue-300',
          icon: '🎓',
          host,
        };
      }
      if (
        host.includes('nhk.or.jp') ||
        host.includes('asahi.com') ||
        host.includes('yomiuri.co.jp') ||
        host.includes('mainichi.jp') ||
        host.includes('nikkei.com') ||
        host.includes('kyodonews.jp')
      ) {
        return {
          label: '報道機関',
          color: 'bg-indigo-50 text-indigo-800 border-indigo-300',
          icon: '📰',
          host,
        };
      }
      if (host.includes('x.com') || host.includes('twitter.com')) {
        return {
          label: 'SNS公式・現地ポスト',
          color: 'bg-slate-100 text-slate-800 border-slate-300',
          icon: '📱',
          host,
        };
      }
      return {
        label: '情報源',
        color: 'bg-slate-50 text-slate-700 border-slate-200',
        icon: '🔗',
        host,
      };
    } catch {
      return null;
    }
  });

  // Relative time format
  function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (isNaN(diffSec) || diffSec < 0) return 'たった今';
    if (diffSec < 60) return `${diffSec}秒前`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
    return `${Math.floor(diffSec / 86400)}日前`;
  }

  // Color mapping by status
  function getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'available':
      case 'open':
        return 'bg-emerald-500 text-white';
      case 'crowded':
      case 'few':
      case 'low_stock':
        return 'bg-amber-500 text-white';
      case 'closed':
      case 'danger':
      case 'out_of_stock':
        return 'bg-rose-600 text-white';
      case 'unknown':
      default:
        return 'bg-slate-500 text-white';
    }
  }

  // Community verification action
  async function handleVerify() {
    if (isVerifiedByMe || isVerifying) return;
    isVerifying = true;
    try {
      const res = await verifyPost(post.id);
      if (res.success) {
        isVerifiedByMe = true;
        if (typeof res.verificationCount === 'number') {
          verificationCount = res.verificationCount;
        } else {
          verificationCount += 1;
        }
        if (res.lastVerifiedAt) {
          lastVerifiedAt = res.lastVerifiedAt;
        }
      }
    } catch (err) {
      console.error('Failed to verify post:', err);
    } finally {
      isVerifying = false;
    }
  }

  function handleToggleNavigation() {
    if (!post.lat || !post.lng) return;
    if (geolocationManager.activeWaypoint?.id === post.id) {
      geolocationManager.stopNavigation();
    } else {
      geolocationManager.startNavigation({
        id: post.id,
        title: post.title,
        area: post.area,
        lat: post.lat,
        lng: post.lng,
        statusLabel: post.status_label,
        address: post.address,
      });
    }
  }

  // Image zoom modal state
  let showImageModal = $state(false);
</script>

<article
  id="post-{post.id}"
  class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-100 dark:hover:border-slate-700"
>
  <!-- Top: Area, tags, official badge, last updated -->
  <div class="flex items-center justify-between gap-2 text-xs">
    <div class="flex flex-wrap items-center gap-1.5">
      {#if parsedTags[0]}
        <button
          type="button"
          onclick={() => {
            const tag = parsedTags[0];
            if (tag) onSelectTag?.(tag);
          }}
          class="inline-flex cursor-pointer items-center gap-1 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-2xs transition hover:from-blue-700 hover:to-indigo-700"
        >
          <span>🏷️</span>
          <span>#{parsedTags[0]}</span>
        </button>
      {/if}

      <span
        class="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      >
        {post.area}
      </span>

      {#if (post.author_id && currentUser?.id === post.author_id) || post.is_owner}
        <span
          class="inline-flex items-center gap-0.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
        >
          {m.my_post_badge()}
        </span>
      {:else if post.reporter_name}
        <span class="text-[10px] text-slate-400 dark:text-slate-500">
          by {post.reporter_name}
        </span>
      {/if}

      {#if post.is_verified === 1}
        <span
          class="inline-flex items-center gap-0.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
        >
          <CheckCircle class="h-3 w-3 text-blue-600 dark:text-blue-400" />
          {m.official_verified()}
        </span>
      {/if}

      {#if isPeer}
        <span
          class="inline-flex items-center gap-0.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300"
        >
          📡 {m.peer_badge()}
        </span>
      {/if}
    </div>

    <!-- Last updated time -->
    <div
      class="flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500"
    >
      <Clock class="h-3 w-3" />
      <span>{formatRelativeTime(post.updated_at)}</span>
    </div>
  </div>

  <!-- Photo (if attached) -->
  {#if post.image_url}
    <div
      class="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-950/5 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <button
        type="button"
        onclick={() => {
          showImageModal = true;
        }}
        class="group relative h-44 w-full cursor-pointer overflow-hidden bg-slate-900 sm:h-48"
      >
        <img
          src={post.image_url}
          alt={post.title}
          class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div
          class="absolute inset-0 flex items-center justify-center gap-1 bg-black/20 text-xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <span>🔍</span>
          <span>タップして拡大</span>
        </div>
      </button>

      <!-- Image authenticity metadata (timestamp, GPS, C2PA signature) -->
      <div
        class="flex items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/90 px-3 py-2 text-[11px] text-white"
      >
        <div class="flex items-center gap-2">
          {#if photoTakenTime}
            <span class="inline-flex items-center gap-1 text-slate-300">
              <Clock class="h-3 w-3 text-slate-400" />
              <span>{photoTakenTime} 撮影</span>
            </span>
          {/if}

          {#if parsedImageMeta?.c2pa?.hasC2pa}
            <span
              class="inline-flex items-center gap-1 rounded border border-blue-400/30 bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-300"
            >
              <ShieldCheck class="h-3 w-3 text-blue-400" />
              <span>C2PA真正性検証済</span>
            </span>
          {/if}
        </div>

        {#if post.lat && post.lng}
          <span class="font-mono text-slate-400">📍 GPS位置あり</span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Title & status badge -->
  <div class="flex items-start justify-between gap-3">
    <h3 class="text-base leading-snug font-bold text-slate-900 dark:text-white">
      <a
        href="/posts/{post.id}"
        class="transition hover:text-blue-600 hover:underline focus:outline-none dark:hover:text-blue-400"
        onclick={(e) => {
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            history.pushState(null, '', `/posts/${post.id}`);
            const el = document.getElementById(`post-${post.id}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }}
      >
        {post.title}
      </a>
    </h3>

    <div class="flex shrink-0 items-center gap-1.5">
      <span
        class={`rounded-lg px-3 py-1 text-xs font-black tracking-wide shadow-xs ${getStatusBadgeClass(post.current_status)}`}
      >
        {i18n.translateStatus(post.current_status, post.status_label)}
      </span>

      <button
        type="button"
        onclick={() => favoritesManager.toggle(post.id)}
        class="cursor-pointer rounded-lg p-1 transition hover:bg-slate-100 dark:hover:bg-slate-800"
        title={favoritesManager.isFavorite(post.id)
          ? m.btn_favorited()
          : m.btn_favorite()}
        aria-label={favoritesManager.isFavorite(post.id)
          ? m.btn_favorited()
          : m.btn_favorite()}
      >
        {#if favoritesManager.isFavorite(post.id)}
          <Star class="h-4 w-4 fill-amber-400 text-amber-500" />
        {:else}
          <Star
            class="h-4 w-4 text-slate-300 transition hover:text-amber-500 dark:text-slate-600"
          />
        {/if}
      </button>
    </div>
  </div>

  <!-- Address & Distance / Compass direction -->
  <div class="flex flex-wrap items-center gap-2">
    {#if post.address}
      <div
        class="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"
      >
        <MapPin
          class="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
        />
        <span class="truncate">{post.address}</span>
      </div>
    {/if}

    {#if distanceInfo}
      <button
        type="button"
        onclick={handleToggleNavigation}
        class={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-bold shadow-2xs transition-all ${
          geolocationManager.activeWaypoint?.id === post.id
            ? 'border-blue-500 bg-blue-600 text-white shadow-blue-500/30'
            : 'border-blue-200/80 bg-blue-50/80 text-blue-700 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50'
        }`}
        title={geolocationManager.activeWaypoint?.id === post.id
          ? m.nav_stop()
          : m.nav_start()}
      >
        <Navigation
          class={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            geolocationManager.activeWaypoint?.id === post.id
              ? 'text-white'
              : 'text-blue-600 dark:text-blue-400'
          }`}
          style="transform: rotate({distanceInfo.relativeAngle}deg);"
        />
        <span
          >{m.geo_straight_line({ dist: distanceInfo.formattedDistance })}</span
        >
        <span
          class={`text-[10px] font-normal ${
            geolocationManager.activeWaypoint?.id === post.id
              ? 'text-blue-100'
              : 'text-blue-600/80 dark:text-blue-400/80'
          }`}>({m.geo_direction({ cardinal: distanceInfo.cardinal })})</span
        >
        {#if geolocationManager.activeWaypoint?.id === post.id}
          <span
            class="py-0.2 ml-0.5 rounded bg-blue-700 px-1 text-[9px] text-white"
          >
            {m.nav_active()}
          </span>
        {/if}
      </button>
    {/if}
  </div>

  <!-- Notes & Details -->
  {#if post.note}
    <p
      class="rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed whitespace-pre-wrap text-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
    >
      {post.note}
    </p>
  {/if}

  <!-- Source URL and reference links with trust badge -->
  {#if post.source_url && sourceTrustBadge}
    <div
      class="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-800/80"
    >
      <span class="shrink-0 text-slate-400 dark:text-slate-500">情報源:</span>
      <a
        href={post.source_url}
        target="_blank"
        rel="noopener noreferrer"
        class={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold transition hover:opacity-80 ${sourceTrustBadge.color}`}
      >
        <span>{sourceTrustBadge.icon}</span>
        <span>{sourceTrustBadge.label}</span>
        <ExternalLink class="ml-0.5 h-2.5 w-2.5" />
      </a>
      <span class="truncate text-[10px] text-slate-400 dark:text-slate-500"
        >{sourceTrustBadge.host}</span
      >
    </div>
  {/if}

  <!-- Dynamic attribute tags (water type, business hours, etc.) -->
  {#if Object.keys(parsedAttrs).length > 0}
    <div class="flex flex-wrap items-center gap-1.5">
      {#each Object.entries(parsedAttrs) as [key, val] (key)}
        {#if typeof val === 'string' || typeof val === 'number'}
          <span
            class="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <span class="mr-1 text-slate-400 dark:text-slate-500">{key}:</span>
            {val}
          </span>
        {:else if Array.isArray(val)}
          {#each val as item, i (i)}
            <span
              class="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
            >
              🏷️ {item}
            </span>
          {/each}
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Voluntary vocabulary tags -->
  {#if parsedTags.length > 0}
    <div class="flex flex-wrap items-center gap-1.5">
      {#each parsedTags as t (t)}
        {#if onSelectTag}
          <button
            type="button"
            onclick={() => onSelectTag?.(t)}
            class="inline-flex cursor-pointer items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50"
          >
            #{t}
          </button>
        {:else}
          <span
            class="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300"
          >
            #{t}
          </span>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Bottom: Verification & status report action bar -->
  <div
    class="mt-auto flex flex-col items-stretch justify-between gap-2 border-t border-slate-100 pt-2.5 sm:flex-row sm:items-center dark:border-slate-800"
  >
    <!-- Accuracy & local verification button -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={handleVerify}
        disabled={isVerifiedByMe || isVerifying}
        class={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold shadow-2xs transition ${
          isVerifiedByMe
            ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
            : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
        }`}
        title="この情報が現在も有効であることを支持します"
      >
        {#if isVerifiedByMe}
          <Check class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>{m.btn_verified()} ({verificationCount})</span>
        {:else}
          <ThumbsUp class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span>{m.btn_verify()} ({verificationCount})</span>
        {/if}
      </button>

      {#if lastVerifiedAt}
        <span class="text-[10px] text-slate-400">
          {m.verified_time({ time: formatRelativeTime(lastVerifiedAt) })}
        </span>
      {/if}
    </div>

    <!-- Action buttons (Edit, Delete, Report status) -->
    <div class="flex flex-wrap items-center gap-1.5 self-end sm:self-auto">
      {#if isAuthorOrAdmin}
        <button
          type="button"
          onclick={() => onEditPost?.(post)}
          class="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          title="この投稿を編集"
        >
          <Edit3 class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span>{m.btn_edit()}</span>
        </button>

        <button
          type="button"
          onclick={() => {
            if (confirm(`「${post.title}」を削除してもよろしいですか？`)) {
              onDeletePost?.(post.id);
            }
          }}
          class="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-600 shadow-2xs transition hover:border-rose-300 hover:bg-rose-50 dark:border-rose-900/50 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
          title="この投稿を削除"
        >
          <Trash2 class="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
          <span>{m.btn_delete()}</span>
        </button>
      {/if}

      <!-- Evacuation Navigation Guide button -->
      {#if post.lat && post.lng}
        <button
          type="button"
          onclick={handleToggleNavigation}
          class={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold shadow-2xs transition-all active:scale-95 ${
            geolocationManager.activeWaypoint?.id === post.id
              ? 'bg-blue-600 text-white shadow-blue-500/20 hover:bg-blue-700'
              : 'border border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60'
          }`}
          title={geolocationManager.activeWaypoint?.id === post.id
            ? m.nav_stop()
            : m.nav_start()}
        >
          <Navigation
            class={`h-3.5 w-3.5 ${
              geolocationManager.activeWaypoint?.id === post.id
                ? 'animate-pulse text-white'
                : 'text-blue-600 dark:text-blue-400'
            }`}
          />
          <span>
            {geolocationManager.activeWaypoint?.id === post.id
              ? m.nav_active()
              : m.nav_start()}
          </span>
        </button>
      {/if}

      <!-- Contact button -->
      <button
        type="button"
        onclick={() => onContactPost?.(post)}
        class="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title="この投稿について管理者や投稿者に連絡"
      >
        <MessageSquareLock
          class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
        />
        <span>{m.btn_contact()}</span>
      </button>

      <!-- QR Share button -->
      <button
        type="button"
        onclick={() => onOpenQrShare?.(post)}
        class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        title={m.qr_share_title()}
        aria-label={m.qr_share_title()}
      >
        <QrCode class="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
        <span>{m.qr_share_btn()}</span>
      </button>

      <!-- Add comment / Micro-update toggle button -->
      <button
        type="button"
        onclick={handleToggleUpdatesTimeline}
        aria-expanded={showUpdatesTimeline}
        aria-controls="updates-timeline-{post.id}"
        class={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-2xs transition ${
          showUpdatesTimeline
            ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
        }`}
        title="現場の最新状況を追記・履歴を確認"
      >
        <MessageSquareText
          class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
        />
        <span>{m.card_comment_btn()}</span>
        {#if showUpdatesTimeline}
          <ChevronUp class="h-3 w-3 text-slate-400" />
        {:else}
          <ChevronDown class="h-3 w-3 text-slate-400" />
        {/if}
      </button>

      <!-- Report status button -->
      <button
        type="button"
        onclick={() => onOpenUpdateStatus(post)}
        class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <RefreshCw class="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />

        <span>{m.btn_report_status()}</span>
      </button>
    </div>
  </div>

  <!-- Micro-updates & History Accordion -->
  {#if showUpdatesTimeline}
    <div
      id="updates-timeline-{post.id}"
      class="animate-in fade-in mt-3 flex flex-col gap-2.5 rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-xs duration-200 dark:border-blue-900/40 dark:bg-slate-800/80"
    >
      <div
        class="flex items-center justify-between font-bold text-slate-700 dark:text-slate-200"
      >
        <span class="flex items-center gap-1.5">
          <Clock class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          {m.card_history_title()}
        </span>
        {#if noteSubmitSuccess}
          <span
            class="text-xs font-bold text-emerald-600 dark:text-emerald-400"
          >
            ✓ {m.card_comment_success()}
          </span>
        {/if}
      </div>

      <!-- Micro-update input form (Anyone can add factual updates) -->
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void handleSubmitUpdateNote();
        }}
        class="flex items-center gap-1.5"
      >
        <input
          type="text"
          bind:value={newUpdateNote}
          placeholder={m.card_comment_placeholder()}
          disabled={isSubmittingNote}
          class="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 shadow-2xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
        />
        <button
          type="submit"
          disabled={!newUpdateNote.trim() || isSubmittingNote}
          class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700 disabled:opacity-50"
        >
          <Send class="h-3 w-3" />
          <span>{isSubmittingNote ? '...' : m.card_comment_submit()}</span>
        </button>
      </form>

      <!-- History timeline items -->
      {#if isLoadingUpdates}
        <div class="flex items-center justify-center py-4 text-slate-400">
          <RefreshCw class="h-4 w-4 animate-spin text-blue-600" />
        </div>
      {:else if updatesList.length > 0}
        <div class="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1">
          {#each updatesList as item (item.id)}
            <div
              class="flex items-start justify-between gap-2 rounded-lg border border-slate-200/60 bg-white/80 p-2 text-[11px] dark:border-slate-700/60 dark:bg-slate-900/60"
            >
              <div class="flex-1 leading-snug">
                {#if item.note}
                  <span class="font-medium text-slate-800 dark:text-slate-200">
                    {item.note}
                  </span>
                {:else}
                  <span class="text-slate-500 dark:text-slate-400">
                    ステータスを「{item.status_label || item.status}」に変更
                  </span>
                {/if}
              </div>
              <div
                class="flex shrink-0 items-center gap-1 text-[10px] text-slate-400"
              >
                <span>{item.status_label || item.status}</span>
                <span>•</span>
                <span>{formatRelativeTime(item.created_at)}</span>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="py-2 text-center text-[11px] text-slate-400">
          まだ追記がありません。現場の状況を追記してみましょう。
        </p>
      {/if}
    </div>
  {/if}
</article>

<!-- Image zoom modal -->
{#if showImageModal && post.image_url}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- Backdrop overlay -->
    <button
      type="button"
      onclick={() => {
        showImageModal = false;
      }}
      class="fixed inset-0 cursor-pointer border-none bg-black/80 backdrop-blur-sm transition-opacity"
      aria-label="モーダルを閉じる"
    ></button>

    <!-- Modal content -->
    <div
      class="relative z-10 flex max-h-[90vh] max-w-3xl flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="写真拡大表示"
    >
      <div
        class="flex items-center justify-between bg-slate-800 p-3 text-white"
      >
        <span class="truncate pr-4 text-xs font-bold">{post.title} の写真</span>
        <button
          type="button"
          onclick={() => {
            showImageModal = false;
          }}
          class="cursor-pointer rounded-lg p-1 text-slate-400 transition hover:text-white"
        >
          <X class="h-5 w-5" />
        </button>
      </div>
      <div class="flex items-center justify-center overflow-auto bg-black p-2">
        <img
          src={post.image_url}
          alt={post.title}
          class="max-h-[75vh] max-w-full rounded object-contain"
        />
      </div>
      {#if parsedImageMeta?.c2pa?.hasC2pa}
        <div
          class="flex items-center gap-1.5 border-t border-slate-700 bg-slate-800 p-3 text-xs font-bold text-emerald-400"
        >
          <ShieldCheck class="h-4 w-4 text-emerald-400" />
          <span
            >C2PA コンテンツ来歴・真正性認証済み ({parsedImageMeta.c2pa
              .claimGenerator || '真正カメラ署名'})</span
          >
        </div>
      {/if}
    </div>
  </div>
{/if}
