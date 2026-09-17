<!-- web/src/lib/AdminModal.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { swipeDown } from './swipeToDismiss';
  import { focusTrap } from './focusTrap';
  import type { SystemSettings, User } from './types';
  import {
    registerPasskey,
    loginPasskey,
    updateSettings,
    importFederationFromUrl,
    importFederationFromFeatures,
    fetchAuthStatus,
    fetchUsers,
    updateUserRole,
    deleteUserApi,
    broadcastPushApi,
    issueApiTokenApi,
  } from './api';
  import {
    X,
    KeyRound,
    Shield,
    LogOut,
    Check,
    AlertCircle,
    Download,
    Upload,
    RefreshCw,
    Network,
    Users,
    Sliders,
    Crown,
    UserCheck,
    Palette,
    BellRing,
    Radio,
    Trash2,
    Bot,
    Copy,
  } from '@lucide/svelte';
  import { themeManager, THEME_OPTIONS } from './theme.svelte';
  import * as m from '../paraglide/messages.js';

  interface Props {
    settings: SystemSettings;
    user: User | null;
    token: string | null;
    isTop?: boolean;
    zIndex?: number;
    onClose: () => void;
    onAuthSuccess: (user: User, token: string) => void;
    onLogout: () => void;
    onSettingsUpdated: (newSettings: SystemSettings) => void;
  }

  const {
    settings,
    user,
    token,
    isTop = true,
    zIndex = 60,
    onClose,
    onAuthSuccess,
    onLogout,
    onSettingsUpdated,
  }: Props = $props();

  let username = $state('');
  let displayName = $state('');
  let isAuthenticating = $state(false);
  let statusMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // First-time setup state
  let isFirstUserSetup = $state(false);

  // Admin tabs
  let activeTab = $state<'settings' | 'federation' | 'users' | 'mcp'>(
    'settings'
  );

  // MCP / API Token state
  let mcpTokenName = $state('Claude / Cursor MCP');
  let isIssuingMcpToken = $state(false);
  let issuedMcpToken = $state<{
    token: string;
    tokenName: string;
    expiresAt: string;
  } | null>(null);
  let isTokenCopied = $state(false);
  let isSnippetCopied = $state(false);
  let mcpTokenError = $state<string | null>(null);

  async function handleIssueMcpToken() {
    if (!token) return;
    isIssuingMcpToken = true;
    mcpTokenError = null;
    isTokenCopied = false;
    try {
      const res = await issueApiTokenApi(
        mcpTokenName.trim() || 'MCP Agent',
        token
      );
      if (res.success && res.token) {
        issuedMcpToken = {
          token: res.token,
          tokenName: res.tokenName || mcpTokenName,
          expiresAt: res.expiresAt || '',
        };
      } else {
        mcpTokenError = res.error || 'トークン発行に失敗しました';
      }
    } catch (err: any) {
      mcpTokenError = err.message || '通信エラーが発生しました';
    } finally {
      isIssuingMcpToken = false;
    }
  }

  async function handleCopyToken() {
    if (!issuedMcpToken) return;
    await navigator.clipboard.writeText(issuedMcpToken.token);
    isTokenCopied = true;
    setTimeout(() => {
      isTokenCopied = false;
    }, 2500);
  }

  async function handleCopySnippet() {
    const origin = window.location.origin;
    const tokenStr = issuedMcpToken
      ? issuedMcpToken.token
      : 'tossa_pat_YOUR_TOKEN';
    const snippet = JSON.stringify(
      {
        mcpServers: {
          tossa: {
            url: `${origin}/mcp`,
            headers: {
              Authorization: `Bearer ${tokenStr}`,
            },
          },
        },
      },
      null,
      2
    );
    await navigator.clipboard.writeText(snippet);
    isSnippetCopied = true;
    setTimeout(() => {
      isSnippetCopied = false;
    }, 2500);
  }

  // Settings form state
  let emergencyBanner = $state('');
  let defaultArea = $state('');
  let isSavingSettings = $state(false);

  // Federation / Migration sync state
  let remoteSyncUrl = $state('');
  let isSyncing = $state(false);
  let syncMessage = $state<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  let fileInput = $state<HTMLInputElement | null>(null);

  // Member management state
  let userList = $state<User[]>([]);
  let isLoadingUsers = $state(false);
  let roleChangeMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Web Push broadcast state
  let broadcastTitle = $state('');
  let broadcastBody = $state('');
  let broadcastArea = $state('');
  let isBroadcasting = $state(false);
  let broadcastResult = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  async function handleBroadcastPush() {
    if (!token || !broadcastTitle || !broadcastBody) return;
    isBroadcasting = true;
    broadcastResult = null;
    const res = await broadcastPushApi(
      {
        title: broadcastTitle,
        body: broadcastBody,
        area: broadcastArea || undefined,
        alertType: 'emergency',
      },
      token
    );
    isBroadcasting = false;
    if (res.success) {
      broadcastResult = {
        type: 'success',
        text: `配信完了: 送信 ${res.result?.sent ?? 0} 件 (失敗: ${res.result?.failed ?? 0} 件)`,
      };
      broadcastTitle = '';
      broadcastBody = '';
    } else {
      broadcastResult = {
        type: 'error',
        text: res.error || 'プッシュ一斉配信に失敗しました',
      };
    }
  }

  $effect(() => {
    emergencyBanner = settings.emergency_banner || '';
    defaultArea = settings.default_area || '';
  });

  onMount(async () => {
    // Initial setup check (whether there are 0 users registered)
    const status = await fetchAuthStatus();
    if (status.success) {
      isFirstUserSetup = status.isFirstUserSetup;
    }

    if (user?.role === 'admin' && token) {
      await loadUsers();
    }
  });

  async function loadUsers() {
    if (!token) return;
    isLoadingUsers = true;
    try {
      const res = await fetchUsers(token);
      if (res.success && res.users) {
        userList = res.users;
      } else if (res.error) {
        roleChangeMessage = { type: 'error', text: res.error };
      }
    } catch {
      // ignore
    } finally {
      isLoadingUsers = false;
    }
  }

  $effect(() => {
    if (
      activeTab === 'users' &&
      token &&
      user?.role === 'admin' &&
      userList.length === 0 &&
      !isLoadingUsers
    ) {
      void loadUsers();
    }
  });

  // Execute Passkey login
  async function handlePasskeyLogin() {
    isAuthenticating = true;
    statusMessage = null;

    try {
      const res = await loginPasskey(username.trim() || undefined);
      if (res.success && res.user && res.token) {
        onAuthSuccess(res.user, res.token);
        statusMessage = {
          type: 'success',
          text: `認証成功: ${res.user.displayName} さんとしてログインしました`,
        };
        if (res.user.role === 'admin') {
          await loadUsers();
        }
      } else {
        statusMessage = {
          type: 'error',
          text: res.error || 'Passkey認証に失敗しました',
        };
      }
    } catch (err: any) {
      statusMessage = {
        type: 'error',
        text: err.message || 'Passkey認証エラーが発生しました',
      };
    } finally {
      isAuthenticating = false;
    }
  }

  // Execute new Passkey registration
  async function handlePasskeyRegister() {
    if (!username.trim()) {
      statusMessage = { type: 'error', text: 'ユーザー名を入力してください' };
      return;
    }

    isAuthenticating = true;
    statusMessage = null;

    try {
      const res = await registerPasskey(
        username.trim(),
        displayName.trim() || undefined
      );
      if (res.success && res.user && res.token) {
        onAuthSuccess(res.user, res.token);
        const roleNotice =
          res.user.role === 'admin'
            ? '（最初の登録者のため管理者権限が付与されました）'
            : '';
        statusMessage = {
          type: 'success',
          text: `Passkey登録完了: ${res.user.displayName} として認証されました${roleNotice}`,
        };
        if (res.user.role === 'admin') {
          await loadUsers();
        }
      } else {
        statusMessage = {
          type: 'error',
          text: res.error || 'Passkey登録に失敗しました',
        };
      }
    } catch (err: any) {
      statusMessage = {
        type: 'error',
        text: err.message || 'Passkey登録エラーが発生しました',
      };
    } finally {
      isAuthenticating = false;
    }
  }

  // Change user role (delegation)
  async function handleUpdateRole(
    targetUserId: string,
    targetUsername: string,
    newRole: 'admin' | 'user'
  ) {
    if (!token) return;
    roleChangeMessage = null;

    try {
      const res = await updateUserRole(targetUserId, newRole, token);
      if (res.success) {
        roleChangeMessage = {
          type: 'success',
          text: `「${targetUsername}」の権限を「${newRole === 'admin' ? '管理者' : '一般ユーザー'}」に変更しました`,
        };
        await loadUsers();
      } else {
        roleChangeMessage = {
          type: 'error',
          text: res.error || '権限の変更に失敗しました',
        };
      }
    } catch (err: any) {
      roleChangeMessage = {
        type: 'error',
        text: err.message || '権限更新エラー',
      };
    }
  }

  // Delete user
  async function handleDeleteUser(
    targetUserId: string,
    targetUsername: string
  ) {
    if (!token) return;
    if (
      !confirm(
        `ユーザー「${targetUsername}」を完全に削除してもよろしいですか？\nこの操作は取り消せません。`
      )
    ) {
      return;
    }

    roleChangeMessage = null;
    try {
      const res = await deleteUserApi(targetUserId, token);
      if (res.success) {
        roleChangeMessage = {
          type: 'success',
          text: res.message || `ユーザー「${targetUsername}」を削除しました`,
        };
        await loadUsers();
      } else {
        roleChangeMessage = {
          type: 'error',
          text: res.error || 'ユーザー削除に失敗しました',
        };
      }
    } catch (err: any) {
      roleChangeMessage = {
        type: 'error',
        text: err.message || 'ユーザー削除エラー',
      };
    }
  }

  // Save system settings
  async function handleSaveSettings() {
    if (!token) return;

    isSavingSettings = true;
    statusMessage = null;

    try {
      const res = await updateSettings(
        {
          emergency_banner: emergencyBanner,
          default_area: defaultArea,
        },
        token
      );

      if (res.success && res.settings) {
        onSettingsUpdated(res.settings);
        statusMessage = { type: 'success', text: 'システム設定を更新しました' };
      } else {
        statusMessage = {
          type: 'error',
          text: res.error || '設定の更新に失敗しました',
        };
      }
    } catch (err: any) {
      statusMessage = { type: 'error', text: err.message || '設定更新エラー' };
    } finally {
      isSavingSettings = false;
    }
  }

  // Import and synchronize data from remote URL
  async function handleSyncFromRemoteUrl() {
    if (!token || !remoteSyncUrl.trim()) return;

    isSyncing = true;
    syncMessage = null;

    try {
      const res = await importFederationFromUrl(remoteSyncUrl.trim(), token);
      if (res.success) {
        syncMessage = {
          type: 'success',
          text: res.message || '同期が完了しました',
        };
        onSettingsUpdated(settings);
      } else {
        syncMessage = {
          type: 'error',
          text: res.error || '同期に失敗しました',
        };
      }
    } catch (err: any) {
      syncMessage = { type: 'error', text: err.message || '通信エラー' };
    } finally {
      isSyncing = false;
    }
  }

  // Import GeoJSON from uploaded file
  async function handleImportFile(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file || !token) return;

    isSyncing = true;
    syncMessage = null;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const features = json.features || (Array.isArray(json) ? json : []);

      if (!features || features.length === 0) {
        syncMessage = {
          type: 'error',
          text: '有効なGeoJSON featureが見つかりませんでした',
        };
        return;
      }

      const res = await importFederationFromFeatures(features, token);
      if (res.success) {
        syncMessage = {
          type: 'success',
          text: res.message || 'インポートが完了しました',
        };
        onSettingsUpdated(settings);
      } else {
        syncMessage = { type: 'error', text: res.error || 'インポート失敗' };
      }
    } catch (err: any) {
      syncMessage = {
        type: 'error',
        text: `ファイル解析エラー: ${err.message}`,
      };
    } finally {
      isSyncing = false;
      if (fileInput) fileInput.value = '';
    }
  }
</script>

<div
  role="presentation"
  style="z-index: {zIndex};"
  inert={!isTop}
  onclick={(e) => {
    if (e.target === e.currentTarget && isTop) onClose();
  }}
  class="fixed inset-0 flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs transition-opacity duration-200 sm:items-center sm:p-4 {isTop
    ? 'opacity-100'
    : 'opacity-80'}"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="admin-modal-title"
    use:focusTrap={{ onEscape: onClose }}
    use:swipeDown={onClose}
    class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-all duration-200 sm:rounded-2xl dark:bg-slate-900 dark:text-slate-100 {isTop
      ? 'scale-100 opacity-100'
      : 'pointer-events-none scale-[0.97] opacity-85'}"
  >
    <!-- Mobile drag handle -->
    <div
      class="mx-auto my-2.5 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
    ></div>

    <!-- Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/80"
    >
      <div class="flex items-center gap-2">
        <KeyRound class="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <h2
          id="admin-modal-title"
          class="text-base font-black text-slate-900 dark:text-white"
        >
          Passkey 認証・設定
        </h2>
      </div>
      <button
        type="button"
        onclick={onClose}
        aria-label="閉じる"
        class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <div class="flex flex-col gap-4 overflow-y-auto p-4 sm:p-5">
      {#if statusMessage}
        <div
          class={`flex items-center gap-2 rounded-xl p-3 text-xs font-medium ${
            statusMessage.type === 'success'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {#if statusMessage.type === 'success'}
            <Check
              class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          {:else}
            <AlertCircle
              class="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
            />
          {/if}
          <span>{statusMessage.text}</span>
        </div>
      {/if}

      <!-- 1. Unauthenticated state: Passkey Register / Login -->
      {#if !user}
        <div class="flex flex-col gap-3.5">
          {#if isFirstUserSetup}
            <div
              class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <Crown
                class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              />
              <div>
                <span class="font-bold">初回管理者セットアップ:</span>
                <p
                  class="mt-0.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300"
                >
                  現在システムに管理者が登録されていません。最初にPasskey登録を行った利用者に、自動的にシステム管理者（admin）権限が付与されます。
                </p>
              </div>
            </div>
          {:else}
            <p
              class="text-xs leading-relaxed text-slate-600 dark:text-slate-400"
            >
              パスワードは不要です。端末の生体認証（Touch ID / Face ID / Windows
              Hello）で即座にログイン・登録できます。認証すると情報の投稿や、自分が投稿した情報の編集・削除が可能です。
            </p>
          {/if}

          <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label
                for="auth-username"
                class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                ユーザー名（ID） <span class="text-rose-600 dark:text-rose-400"
                  >*</span
                >
              </label>
              <input
                id="auth-username"
                type="text"
                bind:value={username}
                placeholder="例: yamada"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
            <div>
              <label
                for="auth-display-name"
                class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                表示名・ニックネーム（任意）
              </label>
              <input
                id="auth-display-name"
                type="text"
                bind:value={displayName}
                placeholder="例: 山田太郎"
                class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
          </div>

          <div class="flex flex-col gap-2 pt-2 sm:flex-row">
            <button
              type="button"
              onclick={handlePasskeyLogin}
              disabled={isAuthenticating}
              class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
            >
              <KeyRound class="h-4 w-4" />
              <span
                >{isAuthenticating ? '認証中...' : 'Passkey でログイン'}</span
              >
            </button>

            <button
              type="button"
              onclick={handlePasskeyRegister}
              disabled={isAuthenticating || !username.trim()}
              class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-800 transition hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <UserCheck class="h-4 w-4 text-blue-600" />
              <span>Passkey で新規登録</span>
            </button>
          </div>
        </div>

        <!-- 2. Authenticated state -->
      {:else}
        <div class="flex flex-col gap-4">
          <!-- User info badge -->
          <div
            class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60"
          >
            <div class="flex items-center gap-2.5">
              <div
                class="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-sm font-black text-white shadow-xs"
              >
                {user.displayName.charAt(0)}
              </div>
              <div>
                <div
                  class="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  <span>{user.displayName}</span>
                  {#if user.role === 'admin'}
                    <span
                      class="py-0.2 inline-flex items-center gap-0.5 rounded-full border border-amber-300 bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    >
                      <Crown
                        class="h-3 w-3 text-amber-600 dark:text-amber-400"
                      />
                      管理者
                    </span>
                  {:else}
                    <span
                      class="py-0.2 inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                    >
                      一般ユーザー
                    </span>
                  {/if}
                </div>
                <div
                  class="font-mono text-[11px] text-slate-500 dark:text-slate-400"
                >
                  @{user.username}
                </div>
              </div>
            </div>
            <button
              type="button"
              onclick={onLogout}
              class="flex cursor-pointer items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
              title="ログアウト"
            >
              <LogOut class="h-3.5 w-3.5" />
              <span>ログアウト</span>
            </button>
          </div>

          <!-- Guide for standard users -->
          {#if user.role !== 'admin'}
            <div
              class="flex flex-col gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-slate-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-slate-300"
            >
              <div
                class="flex items-center gap-1.5 font-bold text-blue-900 dark:text-blue-200"
              >
                <Shield class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Passkey 認証完了</span>
              </div>
              <p
                class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
              >
                あなたの端末は安全に認証されています。生活情報の投稿や、ご自身が投稿したカードの「✏️
                編集」「🗑️ 削除」が行えます。
              </p>
            </div>

            <!-- Standard User: MCP / Agent Token Card -->
            <div
              class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
            >
              <div
                class="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200"
              >
                <Bot class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>AI エージェント連携（MCP）</span>
              </div>
              <p
                class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
              >
                Claude Desktop、Cursor などの AI アシスタントと連携するための
                API トークンを発行できます。
              </p>

              <div>
                <label
                  for="user-mcp-token-name"
                  class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  トークン用途・識別名
                </label>
                <div class="flex gap-2">
                  <input
                    id="user-mcp-token-name"
                    type="text"
                    bind:value={mcpTokenName}
                    placeholder="例: Claude Desktop, Cursor"
                    class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onclick={handleIssueMcpToken}
                    disabled={isIssuingMcpToken}
                    class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    <KeyRound class="h-3.5 w-3.5" />
                    <span
                      >{isIssuingMcpToken
                        ? '発行中...'
                        : 'トークンを発行'}</span
                    >
                  </button>
                </div>
              </div>

              {#if mcpTokenError}
                <div
                  class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                >
                  {mcpTokenError}
                </div>
              {/if}

              {#if issuedMcpToken}
                <div
                  class="flex flex-col gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/40"
                >
                  <div class="flex items-center justify-between">
                    <span
                      class="flex items-center gap-1 text-xs font-bold text-emerald-800 dark:text-emerald-300"
                    >
                      <Check class="h-3.5 w-3.5" />
                      APIトークンを発行しました（有効期限: 1年間）
                    </span>
                  </div>

                  <div class="flex items-center gap-1.5">
                    <input
                      type="text"
                      readonly
                      value={issuedMcpToken.token}
                      class="flex-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800 select-all dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onclick={handleCopyToken}
                      class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                    >
                      {#if isTokenCopied}
                        <Check class="h-3.5 w-3.5" />
                        <span>コピー済</span>
                      {:else}
                        <Copy class="h-3.5 w-3.5" />
                        <span>コピー</span>
                      {/if}
                    </button>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Full feature panel for administrators -->
          {:else}
            <!-- Tab navigation -->
            <div
              class="flex items-center gap-1 border-b border-slate-200 text-xs font-bold dark:border-slate-800"
            >
              <button
                type="button"
                onclick={() => {
                  activeTab = 'settings';
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'settings'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Sliders class="h-3.5 w-3.5" />
                <span>地域・告知</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'users';
                  void loadUsers();
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'users'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Users class="h-3.5 w-3.5" />
                <span>メンバー</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'federation';
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'federation'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Network class="h-3.5 w-3.5" />
                <span>データ合流</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'mcp';
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'mcp'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Bot class="h-3.5 w-3.5" />
                <span>MCP連携</span>
              </button>
            </div>

            <!-- Tab 1: Region & Announcement settings -->
            {#if activeTab === 'settings'}
              <div class="flex flex-col gap-3.5">
                <!-- Emergency announcement banner -->
                <div>
                  <label
                    for="admin-emergency-banner"
                    class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    緊急告知アナウンス文（全画面最上部に固定表示）
                  </label>
                  <textarea
                    id="admin-emergency-banner"
                    bind:value={emergencyBanner}
                    rows="2"
                    placeholder="例: 台風接近に伴い避難所が開設されています。給水・物資の最新状況を共有してください。（空にすると非表示）"
                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  ></textarea>
                </div>

                <!-- Target region / municipality name -->
                <div>
                  <label
                    for="admin-default-area"
                    class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    対象地域・自治体名
                  </label>
                  <input
                    id="admin-default-area"
                    type="text"
                    bind:value={defaultArea}
                    placeholder="例: 高知県高知市、能登地方、〇〇町（空欄時は全域）"
                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  <p
                    class="mt-1 text-[10px] text-slate-500 dark:text-slate-400"
                  >
                    ※
                    設定するとヘッダーに地域名が表示され、地図の初期表示や住所補完の中心となります。
                  </p>
                </div>

                <!-- Save button -->
                <button
                  type="button"
                  onclick={handleSaveSettings}
                  disabled={isSavingSettings}
                  class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <span>
                    {isSavingSettings ? '保存中...' : '設定を反映する'}
                  </span>
                </button>

                <!-- Web Push Emergency Broadcast Section -->
                <div
                  class="mt-4 rounded-xl border border-red-200 bg-red-50/50 p-3.5 dark:border-red-900/40 dark:bg-red-950/20"
                >
                  <div
                    class="mb-2 flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-400"
                  >
                    <Radio class="h-4 w-4" />
                    <span>緊急プッシュ一斉配信 (Web Push Broadcast)</span>
                  </div>
                  <p
                    class="mb-3 text-[11px] text-slate-600 dark:text-slate-400"
                  >
                    購読登録済みの全端末に、画面を閉じていても即座に通知をプッシュ配信します。
                  </p>

                  <div class="space-y-2.5">
                    <div>
                      <input
                        type="text"
                        bind:value={broadcastTitle}
                        placeholder="通知タイトル (例: 【緊急避難】河川水位が警戒水位を超過)"
                        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>
                    <div>
                      <textarea
                        bind:value={broadcastBody}
                        rows="2"
                        placeholder="通知本文 (例: ○○川流域にお住まいの方は、速やかに高台や避難所に避難を開始してください。)"
                        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                      ></textarea>
                    </div>
                    <div>
                      <input
                        type="text"
                        bind:value={broadcastArea}
                        placeholder="対象地域（空欄の場合は全地域に配信）"
                        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={isBroadcasting ||
                        !broadcastTitle ||
                        !broadcastBody}
                      onclick={handleBroadcastPush}
                      class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-red-700 active:scale-98 disabled:opacity-50"
                    >
                      <BellRing class="h-3.5 w-3.5" />
                      <span
                        >{isBroadcasting
                          ? '配信中...'
                          : '緊急プッシュを一斉配信する'}</span
                      >
                    </button>

                    {#if broadcastResult}
                      <div
                        class={`rounded-lg p-2 text-xs font-medium ${
                          broadcastResult.type === 'success'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                        }`}
                      >
                        {broadcastResult.text}
                      </div>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- Tab 2: Member role management -->
            {:else if activeTab === 'users'}
              <div class="flex flex-col gap-3">
                <div class="flex items-center justify-between">
                  <span
                    class="text-xs font-bold text-slate-700 dark:text-slate-300"
                    >メンバー一覧 ({userList.length}名)</span
                  >
                  <button
                    type="button"
                    onclick={loadUsers}
                    class="flex cursor-pointer items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <RefreshCw
                      class={`h-3 w-3 ${isLoadingUsers ? 'animate-spin' : ''}`}
                    />
                    <span>再読み込み</span>
                  </button>
                </div>

                {#if roleChangeMessage}
                  <div
                    class={`flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium ${
                      roleChangeMessage.type === 'success'
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
                    }`}
                  >
                    <span>{roleChangeMessage.text}</span>
                  </div>
                {/if}

                <div
                  class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  {#if isLoadingUsers}
                    <div
                      class="py-6 text-center text-xs text-slate-400 dark:text-slate-500"
                    >
                      ユーザー一覧を読み込み中...
                    </div>
                  {:else if userList.length === 0}
                    <div
                      class="py-6 text-center text-xs text-slate-400 dark:text-slate-500"
                    >
                      ユーザーが見つかりません
                    </div>
                  {:else}
                    {#each userList as u (u.id)}
                      <div
                        class="flex items-center justify-between gap-2 bg-white p-3 transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
                      >
                        <div class="flex min-w-0 items-center gap-2.5">
                          <div
                            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                          >
                            {u.displayName
                              ? u.displayName.charAt(0)
                              : u.username.charAt(0)}
                          </div>
                          <div class="min-w-0">
                            <div
                              class="flex items-center gap-1.5 truncate text-xs font-bold text-slate-800 dark:text-slate-200"
                            >
                              <span>{u.displayName || u.username}</span>
                              {#if u.id === user.id}
                                <span
                                  class="text-[10px] font-bold text-blue-600 dark:text-blue-400"
                                  >(自分)</span
                                >
                              {/if}
                            </div>
                            <div
                              class="truncate text-[10px] text-slate-400 dark:text-slate-500"
                            >
                              @{u.username}
                            </div>
                          </div>
                        </div>

                        <!-- Role badge & update action -->
                        <div class="flex shrink-0 items-center gap-2">
                          {#if u.role === 'admin'}
                            <span
                              class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            >
                              <Crown
                                class="h-3 w-3 text-amber-600 dark:text-amber-400"
                              />
                              管理者
                            </span>
                            {#if u.id !== user.id}
                              <button
                                type="button"
                                onclick={() =>
                                  handleUpdateRole(
                                    u.id,
                                    u.displayName || u.username,
                                    'user'
                                  )}
                                class="cursor-pointer rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                              >
                                一般に戻す
                              </button>
                            {/if}
                          {:else}
                            <span
                              class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            >
                              一般
                            </span>
                            <button
                              type="button"
                              onclick={() =>
                                handleUpdateRole(
                                  u.id,
                                  u.displayName || u.username,
                                  'admin'
                                )}
                              class="flex cursor-pointer items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                            >
                              <Crown
                                class="h-2.5 w-2.5 text-amber-600 dark:text-amber-400"
                              />
                              <span>管理者に昇格</span>
                            </button>
                          {/if}

                          {#if u.id !== user.id}
                            <button
                              type="button"
                              onclick={() =>
                                handleDeleteUser(
                                  u.id,
                                  u.displayName || u.username
                                )}
                              class="flex cursor-pointer items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600 transition hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-900/60"
                              title="アカウントを削除"
                            >
                              <Trash2
                                class="h-2.5 w-2.5 text-rose-600 dark:text-rose-400"
                              />
                              <span>削除</span>
                            </button>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  {/if}
                </div>
                <p class="text-[10px] text-slate-400 dark:text-slate-500">
                  ※
                  管理者権限を持つユーザーは、システム設定の更新、他サイトとのデータ同期、および全投稿の編集・削除が可能です。
                </p>
              </div>

              <!-- Tab 3: Data Federation -->
            {:else if activeTab === 'federation'}
              <div
                class="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/60"
              >
                <div class="flex items-center justify-between">
                  <div
                    class="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200"
                  >
                    <Network class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span>他サイトとの合流・連携 (Federation)</span>
                  </div>
                  <span
                    class="font-mono text-[10px] text-slate-500 dark:text-slate-400"
                    >GeoJSON-LD</span
                  >
                </div>

                <p
                  class="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  災害時に他チームが立ち上げた tossa
                  や互換サイトと相互にデータを合流・移行できます。
                </p>

                {#if syncMessage}
                  <div
                    class={`flex items-center gap-1.5 rounded-lg p-2.5 text-[11px] ${
                      syncMessage.type === 'success'
                        ? 'border border-emerald-200 bg-emerald-50 font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
                    }`}
                  >
                    <span>{syncMessage.text}</span>
                  </div>
                {/if}

                <!-- Import from remote site URL -->
                <div class="flex flex-col gap-1.5">
                  <label
                    for="admin-sync-url"
                    class="text-[11px] font-bold text-slate-700 dark:text-slate-300"
                  >
                    他サイトと同期（相手の tossa URL を入力）:
                  </label>
                  <div class="flex items-center gap-1.5">
                    <input
                      id="admin-sync-url"
                      type="url"
                      bind:value={remoteSyncUrl}
                      placeholder="例: https://other-tossa.workers.dev"
                      class="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onclick={handleSyncFromRemoteUrl}
                      disabled={isSyncing || !remoteSyncUrl.trim()}
                      class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
                    >
                      <RefreshCw
                        class={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`}
                      />
                      <span>{isSyncing ? '同期中...' : '合流・同期'}</span>
                    </button>
                  </div>
                </div>

                <!-- Export & file import -->
                <div class="flex items-center gap-2 pt-1">
                  <a
                    href="/api/federation/export"
                    download
                    class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Download
                      class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
                    />
                    <span>データ出力 (Export)</span>
                  </a>

                  <label
                    class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Upload
                      class="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400"
                    />
                    <span>ファイル取込 (Import)</span>
                    <input
                      type="file"
                      accept=".json,.geojson"
                      bind:this={fileInput}
                      onchange={handleImportFile}
                      class="hidden"
                    />
                  </label>
                </div>
              </div>
            {/if}

            <!-- Tab 4: MCP / Agent Integration -->
            {#if activeTab === 'mcp'}
              <div class="flex flex-col gap-3.5">
                <div
                  class="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 text-xs text-slate-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-slate-300"
                >
                  <div
                    class="mb-1 flex items-center gap-1.5 font-bold text-blue-900 dark:text-blue-200"
                  >
                    <Bot class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span>AI エージェント連携（MCP）</span>
                  </div>
                  <p
                    class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
                  >
                    Claude Desktop、Cursor、Antigravity 等の AI
                    アシスタントから、tossa
                    の生活情報や避難所・給水所データを直接検索・更新できる
                    MCP（Model Context
                    Protocol）エンドポイントが稼働しています。
                  </p>
                </div>

                <!-- Token Generation Card -->
                <div
                  class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <div>
                    <label
                      for="mcp-token-name"
                      class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                    >
                      トークン用途・識別名
                    </label>
                    <div class="flex gap-2">
                      <input
                        id="mcp-token-name"
                        type="text"
                        bind:value={mcpTokenName}
                        placeholder="例: Claude Desktop, Cursor"
                        class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onclick={handleIssueMcpToken}
                        disabled={isIssuingMcpToken}
                        class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700 disabled:opacity-50"
                      >
                        <KeyRound class="h-3.5 w-3.5" />
                        <span
                          >{isIssuingMcpToken
                            ? '発行中...'
                            : 'トークンを発行'}</span
                        >
                      </button>
                    </div>
                  </div>

                  {#if mcpTokenError}
                    <div
                      class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                    >
                      {mcpTokenError}
                    </div>
                  {/if}

                  {#if issuedMcpToken}
                    <div
                      class="flex flex-col gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/40"
                    >
                      <div class="flex items-center justify-between">
                        <span
                          class="flex items-center gap-1 text-xs font-bold text-emerald-800 dark:text-emerald-300"
                        >
                          <Check class="h-3.5 w-3.5" />
                          APIトークンを発行しました（有効期限: 1年間）
                        </span>
                        <span
                          class="text-[10px] text-slate-500 dark:text-slate-400"
                        >
                          {issuedMcpToken.tokenName}
                        </span>
                      </div>

                      <div class="flex items-center gap-1.5">
                        <input
                          type="text"
                          readonly
                          value={issuedMcpToken.token}
                          class="flex-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800 select-all dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          onclick={handleCopyToken}
                          class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                        >
                          {#if isTokenCopied}
                            <Check class="h-3.5 w-3.5" />
                            <span>コピー済</span>
                          {:else}
                            <Copy class="h-3.5 w-3.5" />
                            <span>コピー</span>
                          {/if}
                        </button>
                      </div>

                      <p class="text-[10px] text-slate-500 dark:text-slate-400">
                        ※
                        トークンは再表示されません。安全な場所に保存してエージェントの設定ファイルに設定してください。
                      </p>
                    </div>
                  {/if}

                  <!-- Setup Configuration Guide -->
                  <div
                    class="flex flex-col gap-1.5 border-t border-slate-200/80 pt-2.5 dark:border-slate-700/60"
                  >
                    <div class="flex items-center justify-between">
                      <span
                        class="text-xs font-bold text-slate-700 dark:text-slate-300"
                      >
                        Claude Desktop / Cursor 設定スニペット
                      </span>
                      <button
                        type="button"
                        onclick={handleCopySnippet}
                        class="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {#if isSnippetCopied}
                          <Check class="h-3 w-3" />
                          <span>設定JSONをコピー済</span>
                        {:else}
                          <Copy class="h-3 w-3" />
                          <span>設定JSONをコピー</span>
                        {/if}
                      </button>
                    </div>

                    <pre
                      class="overflow-x-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] leading-snug text-slate-200"><code
                        >{`{
  "mcpServers": {
    "tossa": {
      "url": "${typeof window !== 'undefined' ? window.location.origin : ''}/mcp"${
        issuedMcpToken
          ? `,\n      "headers": {\n        "Authorization": "Bearer ${issuedMcpToken.token}"\n      }`
          : ''
      }
    }
  }
}`}</code
                      ></pre>
                  </div>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      <!-- Theme & Power Saving Setting -->
      <div
        class="mt-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-800/60"
      >
        <div class="mb-2 flex items-center justify-between">
          <div
            class="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200"
          >
            <Palette class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>{m.theme_title()}</span>
          </div>
          <span class="text-[11px] text-slate-500 dark:text-slate-400">
            {THEME_OPTIONS.find((t) => t.mode === themeManager.mode)?.label}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {#each THEME_OPTIONS as opt (opt.mode)}
            <button
              type="button"
              onclick={() => themeManager.setTheme(opt.mode)}
              class={`flex cursor-pointer flex-col items-center justify-center rounded-lg border p-2 text-center transition ${
                themeManager.mode === opt.mode
                  ? 'border-blue-500 bg-blue-50/80 font-bold text-blue-700 ring-2 ring-blue-500/20 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <span class="text-sm">{opt.icon}</span>
              <span class="mt-0.5 text-[11px]">{opt.shortLabel}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
