<!-- web/src/lib/AdminModal.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
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
  } from '@lucide/svelte';

  interface Props {
    settings: SystemSettings;
    user: User | null;
    token: string | null;
    onClose: () => void;
    onAuthSuccess: (user: User, token: string) => void;
    onLogout: () => void;
    onSettingsUpdated: (newSettings: SystemSettings) => void;
  }

  const {
    settings,
    user,
    token,
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
  let activeTab = $state<'settings' | 'federation' | 'users'>('settings');

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
      }
    } catch {
      // ignore
    } finally {
      isLoadingUsers = false;
    }
  }

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
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
  class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs"
>
  <div
    class="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-150 max-h-[92vh] flex flex-col"
  >
    <!-- Mobile drag handle -->
    <div
      class="w-10 h-1 bg-slate-300 rounded-full mx-auto my-2 sm:hidden shrink-0"
    ></div>

    <!-- Header -->
    <div
      class="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0"
    >
      <div class="flex items-center gap-2">
        <KeyRound class="w-4 h-4 text-blue-600" />
        <h2 class="text-base font-black text-slate-900">Passkey 認証・設定</h2>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
      >
        <X class="w-5 h-5" />
      </button>
    </div>

    <div class="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto">
      {#if statusMessage}
        <div
          class={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border border-rose-200 text-rose-800'
          }`}
        >
          {#if statusMessage.type === 'success'}
            <Check class="w-4 h-4 shrink-0 text-emerald-600" />
          {:else}
            <AlertCircle class="w-4 h-4 shrink-0 text-rose-600" />
          {/if}
          <span>{statusMessage.text}</span>
        </div>
      {/if}

      <!-- 1. Unauthenticated state: Passkey Register / Login -->
      {#if !user}
        <div class="flex flex-col gap-3.5">
          {#if isFirstUserSetup}
            <div
              class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2"
            >
              <Crown class="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <span class="font-bold">初回管理者セットアップ:</span>
                <p class="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                  現在システムに管理者が登録されていません。最初にPasskey登録を行った利用者に、自動的にシステム管理者（admin）権限が付与されます。
                </p>
              </div>
            </div>
          {:else}
            <p class="text-xs text-slate-600 leading-relaxed">
              パスワードは不要です。端末の生体認証（Touch ID / Face ID / Windows
              Hello）で即座にログイン・登録できます。認証すると情報の投稿や、自分が投稿した情報の編集・削除が可能です。
            </p>
          {/if}

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label
                for="auth-username"
                class="block text-xs font-bold text-slate-700 mb-1"
              >
                ユーザー名（ID） <span class="text-rose-600">*</span>
              </label>
              <input
                id="auth-username"
                type="text"
                bind:value={username}
                placeholder="例: yamada"
                class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
            <div>
              <label
                for="auth-display-name"
                class="block text-xs font-bold text-slate-700 mb-1"
              >
                表示名・ニックネーム（任意）
              </label>
              <input
                id="auth-display-name"
                type="text"
                bind:value={displayName}
                placeholder="例: 山田太郎"
                class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>

          <div class="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onclick={handlePasskeyLogin}
              disabled={isAuthenticating}
              class="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <KeyRound class="w-4 h-4" />
              <span
                >{isAuthenticating ? '認証中...' : 'Passkey でログイン'}</span
              >
            </button>

            <button
              type="button"
              onclick={handlePasskeyRegister}
              disabled={isAuthenticating || !username.trim()}
              class="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <UserCheck class="w-4 h-4 text-blue-600" />
              <span>Passkey で新規登録</span>
            </button>
          </div>
        </div>

        <!-- 2. Authenticated state -->
      {:else}
        <div class="flex flex-col gap-4">
          <!-- User info badge -->
          <div
            class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between"
          >
            <div class="flex items-center gap-2.5">
              <div
                class="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-black text-sm shadow-xs"
              >
                {user.displayName.charAt(0)}
              </div>
              <div>
                <div
                  class="text-xs font-bold text-slate-900 flex items-center gap-1.5"
                >
                  <span>{user.displayName}</span>
                  {#if user.role === 'admin'}
                    <span
                      class="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300"
                    >
                      <Crown class="w-3 h-3 text-amber-600" />
                      管理者
                    </span>
                  {:else}
                    <span
                      class="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                    >
                      一般ユーザー
                    </span>
                  {/if}
                </div>
                <div class="text-[11px] text-slate-500 font-mono">
                  @{user.username}
                </div>
              </div>
            </div>
            <button
              type="button"
              onclick={onLogout}
              class="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition cursor-pointer flex items-center gap-1 font-medium"
              title="ログアウト"
            >
              <LogOut class="w-3.5 h-3.5" />
              <span>ログアウト</span>
            </button>
          </div>

          <!-- Guide for standard users -->
          {#if user.role !== 'admin'}
            <div
              class="p-4 bg-blue-50/60 rounded-xl border border-blue-100 text-xs text-slate-700 flex flex-col gap-2"
            >
              <div class="font-bold text-blue-900 flex items-center gap-1.5">
                <Shield class="w-4 h-4 text-blue-600" />
                <span>Passkey 認証完了</span>
              </div>
              <p class="leading-relaxed text-[11px] text-slate-600">
                あなたの端末は安全に認証されています。生活情報の投稿や、ご自身が投稿したカードの「✏️
                編集」「🗑️ 削除」が行えます。
              </p>
            </div>

            <!-- Full feature panel for administrators -->
          {:else}
            <!-- Tab navigation -->
            <div
              class="flex items-center border-b border-slate-200 text-xs font-bold gap-1"
            >
              <button
                type="button"
                onclick={() => {
                  activeTab = 'settings';
                }}
                class={`px-3 py-2 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'settings'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Sliders class="w-3.5 h-3.5" />
                <span>地域・告知</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'users';
                }}
                class={`px-3 py-2 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'users'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Users class="w-3.5 h-3.5" />
                <span>メンバー権限委譲</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'federation';
                }}
                class={`px-3 py-2 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'federation'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Network class="w-3.5 h-3.5" />
                <span>データ合流</span>
              </button>
            </div>

            <!-- Tab 1: Region & Announcement settings -->
            {#if activeTab === 'settings'}
              <div class="flex flex-col gap-3.5">
                <!-- Emergency announcement banner -->
                <div>
                  <label
                    for="admin-emergency-banner"
                    class="block text-xs font-bold text-slate-700 mb-1"
                  >
                    緊急告知アナウンス文（全画面最上部に固定表示）
                  </label>
                  <textarea
                    id="admin-emergency-banner"
                    bind:value={emergencyBanner}
                    rows="2"
                    placeholder="例: 台風接近に伴い避難所が開設されています。給水・物資の最新状況を共有してください。（空にすると非表示）"
                    class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  ></textarea>
                </div>

                <!-- Target region / municipality name -->
                <div>
                  <label
                    for="admin-default-area"
                    class="block text-xs font-bold text-slate-700 mb-1"
                  >
                    対象地域・自治体名
                  </label>
                  <input
                    id="admin-default-area"
                    type="text"
                    bind:value={defaultArea}
                    placeholder="例: 高知県高知市、能登地方、〇〇町（空欄時は全域）"
                    class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                  <p class="text-[10px] text-slate-500 mt-1">
                    ※
                    設定するとヘッダーに地域名が表示され、地図の初期表示や住所補完の中心となります。
                  </p>
                </div>

                <!-- Save button -->
                <button
                  type="button"
                  onclick={handleSaveSettings}
                  disabled={isSavingSettings}
                  class="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span
                    >{isSavingSettings ? '保存中...' : '設定を反映する'}</span
                  >
                </button>
              </div>

              <!-- Tab 2: Member role management -->
            {:else if activeTab === 'users'}
              <div class="flex flex-col gap-3">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-700"
                    >登録済みユーザー一覧 ({userList.length}名)</span
                  >
                  <button
                    type="button"
                    onclick={loadUsers}
                    class="text-xs text-blue-600 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <RefreshCw
                      class={`w-3 h-3 ${isLoadingUsers ? 'animate-spin' : ''}`}
                    />
                    <span>再読み込み</span>
                  </button>
                </div>

                {#if roleChangeMessage}
                  <div
                    class={`p-2.5 rounded-lg text-xs font-medium flex items-center gap-2 ${
                      roleChangeMessage.type === 'success'
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border border-rose-200 text-rose-800'
                    }`}
                  >
                    <span>{roleChangeMessage.text}</span>
                  </div>
                {/if}

                <div
                  class="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-slate-50/50"
                >
                  {#if isLoadingUsers}
                    <div class="py-6 text-center text-xs text-slate-400">
                      ユーザー一覧を読み込み中...
                    </div>
                  {:else if userList.length === 0}
                    <div class="py-6 text-center text-xs text-slate-400">
                      ユーザーが見つかりません
                    </div>
                  {:else}
                    {#each userList as u (u.id)}
                      <div
                        class="p-3 flex items-center justify-between gap-2 bg-white hover:bg-slate-50 transition"
                      >
                        <div class="flex items-center gap-2.5 min-w-0">
                          <div
                            class="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0"
                          >
                            {u.displayName
                              ? u.displayName.charAt(0)
                              : u.username.charAt(0)}
                          </div>
                          <div class="min-w-0">
                            <div
                              class="text-xs font-bold text-slate-800 truncate flex items-center gap-1.5"
                            >
                              <span>{u.displayName || u.username}</span>
                              {#if u.id === user.id}
                                <span
                                  class="text-[10px] text-blue-600 font-bold"
                                  >(自分)</span
                                >
                              {/if}
                            </div>
                            <div class="text-[10px] text-slate-400 truncate">
                              @{u.username}
                            </div>
                          </div>
                        </div>

                        <!-- Role badge & update action -->
                        <div class="flex items-center gap-2 shrink-0">
                          {#if u.role === 'admin'}
                            <span
                              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200"
                            >
                              <Crown class="w-3 h-3 text-amber-600" />
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
                                class="px-2 py-1 text-[10px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition cursor-pointer border border-slate-200"
                              >
                                一般に戻す
                              </button>
                            {/if}
                          {:else}
                            <span
                              class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600"
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
                              class="px-2 py-1 text-[10px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition cursor-pointer flex items-center gap-1"
                            >
                              <Crown class="w-2.5 h-2.5 text-amber-600" />
                              <span>管理者に昇格</span>
                            </button>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  {/if}
                </div>
                <p class="text-[10px] text-slate-400">
                  ※
                  管理者権限を持つユーザーは、システム設定の更新、他サイトとのデータ同期、および全投稿の編集・削除が可能です。
                </p>
              </div>

              <!-- Tab 3: Data Federation -->
            {:else if activeTab === 'federation'}
              <div
                class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col gap-2.5"
              >
                <div class="flex items-center justify-between">
                  <div
                    class="flex items-center gap-1.5 text-xs font-bold text-slate-800"
                  >
                    <Network class="w-4 h-4 text-blue-600" />
                    <span>他サイトとの合流・連携 (Federation)</span>
                  </div>
                  <span class="text-[10px] text-slate-500 font-mono"
                    >GeoJSON-LD</span
                  >
                </div>

                <p class="text-[11px] text-slate-500 leading-relaxed">
                  災害時に他チームが立ち上げた tossa
                  や互換サイトと相互にデータを合流・移行できます。
                </p>

                {#if syncMessage}
                  <div
                    class={`text-[11px] p-2.5 rounded-lg flex items-center gap-1.5 ${
                      syncMessage.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    <span>{syncMessage.text}</span>
                  </div>
                {/if}

                <!-- Import from remote site URL -->
                <div class="flex flex-col gap-1.5">
                  <label
                    for="admin-sync-url"
                    class="text-[11px] font-bold text-slate-700"
                  >
                    他サイトと同期（相手の tossa URL を入力）:
                  </label>
                  <div class="flex items-center gap-1.5">
                    <input
                      id="admin-sync-url"
                      type="url"
                      bind:value={remoteSyncUrl}
                      placeholder="例: https://other-tossa.workers.dev"
                      class="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onclick={handleSyncFromRemoteUrl}
                      disabled={isSyncing || !remoteSyncUrl.trim()}
                      class="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-2xs shrink-0 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      <RefreshCw
                        class={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`}
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
                    class="flex-1 py-1.5 px-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs text-center"
                  >
                    <Download class="w-3.5 h-3.5 text-blue-600" />
                    <span>データ出力 (Export)</span>
                  </a>

                  <label
                    class="flex-1 py-1.5 px-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer text-center"
                  >
                    <Upload class="w-3.5 h-3.5 text-indigo-600" />
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
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
