<!-- web/src/lib/AdminModal.svelte -->
<script lang="ts">
  import type { SystemSettings, User } from './types';
  import { registerPasskey, loginPasskey, updateSettings } from './api';
  import { X, KeyRound, ShieldAlert, Sparkles, LogOut, Check, AlertCircle } from '@lucide/svelte';

  interface Props {
    settings: SystemSettings;
    user: User | null;
    token: string | null;
    onClose: () => void;
    onAuthSuccess: (user: User, token: string) => void;
    onLogout: () => void;
    onSettingsUpdated: (newSettings: SystemSettings) => void;
  }

  let {
    settings,
    user,
    token,
    onClose,
    onAuthSuccess,
    onLogout,
    onSettingsUpdated,
  }: Props = $props();

  let username = $state('admin');
  let isAuthenticating = $state(false);
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

  // 設定編集用
  let appMode = $state<'normal' | 'disaster'>('disaster');
  let emergencyBanner = $state('');
  let defaultArea = $state('熊本市');
  let isSavingSettings = $state(false);

  $effect(() => {
    appMode = settings.app_mode || 'disaster';
    emergencyBanner = settings.emergency_banner || '';
    defaultArea = settings.default_area || '熊本市';
  });

  // パスキーログイン実行
  async function handlePasskeyLogin() {
    isAuthenticating = true;
    statusMessage = null;

    try {
      const res = await loginPasskey(username.trim() || undefined);
      if (res.success && res.user && res.token) {
        onAuthSuccess(res.user, res.token);
        statusMessage = { type: 'success', text: `認証成功: ${res.user.displayName} さんとしてログインしました` };
      } else {
        statusMessage = { type: 'error', text: res.error || 'Passkey認証に失敗しました' };
      }
    } catch (err: any) {
      statusMessage = { type: 'error', text: err.message || 'Passkey認証エラーが発生しました' };
    } finally {
      isAuthenticating = false;
    }
  }

  // パスキー新規登録実行
  async function handlePasskeyRegister() {
    if (!username.trim()) {
      statusMessage = { type: 'error', text: 'ユーザー名を入力してください' };
      return;
    }

    isAuthenticating = true;
    statusMessage = null;

    try {
      const res = await registerPasskey(username.trim());
      if (res.success && res.user && res.token) {
        onAuthSuccess(res.user, res.token);
        statusMessage = { type: 'success', text: `Passkey登録完了: ${res.user.displayName} としてログインしました` };
      } else {
        statusMessage = { type: 'error', text: res.error || 'Passkey登録に失敗しました' };
      }
    } catch (err: any) {
      statusMessage = { type: 'error', text: err.message || 'Passkey登録エラーが発生しました' };
    } finally {
      isAuthenticating = false;
    }
  }

  // システム設定保存（モード切替など）
  async function handleSaveSettings() {
    if (!token) return;

    isSavingSettings = true;
    statusMessage = null;

    try {
      const res = await updateSettings(
        {
          app_mode: appMode,
          emergency_banner: emergencyBanner,
          default_area: defaultArea,
        },
        token
      );

      if (res.success && res.settings) {
        onSettingsUpdated(res.settings);
        statusMessage = { type: 'success', text: 'システム設定を更新しました' };
      } else {
        statusMessage = { type: 'error', text: res.error || '設定の更新に失敗しました' };
      }
    } catch (err: any) {
      statusMessage = { type: 'error', text: err.message || '設定更新エラー' };
    } finally {
      isSavingSettings = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
  <div class="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
    <!-- ヘッダー -->
    <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
      <div class="flex items-center gap-2">
        <KeyRound class="w-4 h-4 text-blue-600" />
        <h2 class="text-base font-black text-slate-900">管理者メニュー（Passkey認証）</h2>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
      >
        <X class="w-5 h-5" />
      </button>
    </div>

    <div class="p-5 flex flex-col gap-4">
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

      <!-- 未ログイン状態: Passkey 登録 / ログイン -->
      {#if !user}
        <div class="flex flex-col gap-3">
          <p class="text-xs text-slate-600 leading-relaxed">
            パスワードやメールリンクは不要です。端末の生体認証（Touch ID / Face ID / Windows Hello）で即座にログイン・管理権限を行使できます。
          </p>

          <div>
            <label for="auth-username" class="block text-xs font-bold text-slate-700 mb-1">管理者ユーザー名</label>
            <input
              id="auth-username"
              type="text"
              bind:value={username}
              placeholder="admin"
              class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>

          <div class="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onclick={handlePasskeyLogin}
              disabled={isAuthenticating}
              class="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <KeyRound class="w-4 h-4" />
              <span>{isAuthenticating ? '認証中...' : 'Passkey でログイン'}</span>
            </button>

            <button
              type="button"
              onclick={handlePasskeyRegister}
              disabled={isAuthenticating}
              class="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>この端末を登録</span>
            </button>
          </div>
        </div>

      <!-- ログイン済み状態: モード切替・設定変更 -->
      {:else}
        <div class="flex flex-col gap-4">
          <!-- ユーザー情報バッジ -->
          <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                {user.displayName.charAt(0)}
              </span>
              <div>
                <div class="text-xs font-bold text-slate-900">{user.displayName}</div>
                <div class="text-[11px] text-slate-500">権限: {user.role} (@{user.username})</div>
              </div>
            </div>
            <button
              type="button"
              onclick={onLogout}
              class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
              title="ログアウト"
            >
              <LogOut class="w-4 h-4" />
            </button>
          </div>

          <!-- デュアルユース切り替え（平時 ⇄ 災害時） -->
          <div>
            <span class="block text-xs font-bold text-slate-700 mb-2">稼働モード切り替え</span>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                onclick={() => { appMode = 'disaster'; }}
                class={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                  appMode === 'disaster'
                    ? 'border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-400 font-bold'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div class="flex items-center gap-1.5 text-xs font-bold">
                  <ShieldAlert class="w-4 h-4 text-rose-600" />
                  <span>災害モード</span>
                </div>
                <span class="text-[10px] text-slate-500">給水・避難所・物資を最優先表示</span>
              </button>

              <button
                type="button"
                onclick={() => { appMode = 'normal'; }}
                class={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                  appMode === 'normal'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-400 font-bold'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div class="flex items-center gap-1.5 text-xs font-bold">
                  <Sparkles class="w-4 h-4 text-emerald-600" />
                  <span>平時モード</span>
                </div>
                <span class="text-[10px] text-slate-500">地域店舗・イベント・助け合い表示</span>
              </button>
            </div>
          </div>

          <!-- 緊急告知アナウンス文 -->
          <div>
            <label for="admin-emergency-banner" class="block text-xs font-bold text-slate-700 mb-1">
              緊急告知バー文言（全画面最上部に表示）
            </label>
            <textarea
              id="admin-emergency-banner"
              bind:value={emergencyBanner}
              rows="2"
              placeholder="現在【災害モード】で稼働中です。給水の最新状況を共有してください。"
              class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            ></textarea>
          </div>

          <!-- 保存ボタン -->
          <button
            type="button"
            onclick={handleSaveSettings}
            disabled={isSavingSettings}
            class="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span>{isSavingSettings ? '保存中...' : '設定を反映する'}</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
