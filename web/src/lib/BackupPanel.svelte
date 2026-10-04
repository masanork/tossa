<script lang="ts">
  import { onMount } from 'svelte';
  import {
    X,
    Check,
    AlertCircle,
    Database,
    Download,
    RefreshCw,
    FileText,
  } from '@lucide/svelte';
  import { triggerBackupApi, fetchBackupsApi, downloadBackupApi } from './api';
  import type { BackupRecord, BackupResult } from './types';
  const { token }: { token: string } = $props();
  // Backup state
  let backups = $state<BackupRecord[]>([]);
  let isLoadingBackups = $state(false);
  let isTriggeringBackup = $state(false);
  let backupStatusMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  let lastBackupResult = $state<BackupResult | null>(null);
  let downloading = $state<string | null>(null);

  async function download(key: string) {
    if (downloading) return;
    downloading = key;
    try {
      const blob = await downloadBackupApi(token, key);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = key.replace('backups/', '');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      backupStatusMessage = {
        type: 'error',
        text:
          cause instanceof Error ? cause.message : 'ダウンロードに失敗しました',
      };
    } finally {
      downloading = null;
    }
  }

  async function loadBackups() {
    if (!token) return;
    isLoadingBackups = true;
    try {
      const res = await fetchBackupsApi(token);
      if (res.success && res.backups) {
        backups = res.backups;
      } else {
        backupStatusMessage = {
          type: 'error',
          text: res.error || '一覧を取得できませんでした',
        };
      }
    } catch (err: any) {
      backupStatusMessage = {
        type: 'error',
        text: err?.message || '一覧を取得できませんでした',
      };
    } finally {
      isLoadingBackups = false;
    }
  }

  async function handleTriggerBackup() {
    if (!token || isTriggeringBackup) return;
    isTriggeringBackup = true;
    backupStatusMessage = null;
    try {
      const res = await triggerBackupApi(token);
      if (res.success) {
        lastBackupResult = res;
        const count = res.metadata?.totalRecords ?? 0;
        backupStatusMessage = {
          type: 'success',
          text: `D1データベースのバックアップが完了しました（合計 ${count} 件）`,
        };
        await loadBackups();
      } else {
        backupStatusMessage = {
          type: 'error',
          text: res.error || 'バックアップの実行に失敗しました',
        };
      }
    } catch (err: any) {
      backupStatusMessage = {
        type: 'error',
        text: err?.message || '通信エラーが発生しました',
      };
    } finally {
      isTriggeringBackup = false;
    }
  }

  onMount(() => {
    void loadBackups();
  });
</script>

<div class="flex flex-col gap-4">
  <!-- Backup Status Alert -->
  {#if backupStatusMessage}
    <div
      class={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
        backupStatusMessage.type === 'success'
          ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'border-red-200 bg-red-50/80 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
      }`}
    >
      {#if backupStatusMessage.type === 'success'}
        <Check
          class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        />
      {:else}
        <AlertCircle class="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
      {/if}
      <div class="flex-1 font-medium">
        {backupStatusMessage.text}
      </div>
      <button
        type="button"
        onclick={() => {
          backupStatusMessage = null;
        }}
        class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
    <!-- Left: 5 columns on desktop (Cron status & manual trigger) -->
    <div class="flex flex-col gap-4 lg:col-span-5">
      <!-- Automatic Cron Backup Info Box -->
      <div
        class="rounded-xl border border-blue-200/80 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/30"
      >
        <div
          class="flex items-center gap-2 text-xs font-bold text-blue-900 dark:text-blue-300"
        >
          <Database class="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span>D1 自動バックアップ稼働状況</span>
        </div>
        <p
          class="mt-2 text-[11px] leading-relaxed text-blue-800/80 dark:text-blue-300/80"
        >
          Cloudflare Cron Triggers により、<strong
            >毎日 12:00 JST (03:00 UTC)</strong
          >
          に全テーブル（投稿、ユーザー、設定、ステータス履歴等）を自動で JSON ダンプし、非公開の専用
          Cloudflare R2（<code>backups/</code>）に保存します（最新 30
          世代を自動保持）。
        </p>
      </div>

      <!-- Manual Backup Trigger Action -->
      <div
        class="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div>
          <h4 class="text-xs font-bold text-slate-800 dark:text-slate-200">
            手動即時バックアップ
          </h4>
          <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            メンテナンス前や災害対応の区切りに、現在の全データを R2
            に直ちに退避・スナップショット保存します。
          </p>
        </div>

        <button
          type="button"
          onclick={handleTriggerBackup}
          disabled={isTriggeringBackup}
          class="mt-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
        >
          {#if isTriggeringBackup}
            <RefreshCw class="h-3.5 w-3.5 animate-spin" />
            <span>バックアップ生成中...</span>
          {:else}
            <Download class="h-3.5 w-3.5" />
            <span>今すぐバックアップ実行</span>
          {/if}
        </button>

        {#if lastBackupResult && lastBackupResult.metadata}
          <div
            class="mt-2 border-t border-slate-100 pt-2.5 dark:border-slate-800"
          >
            <div
              class="text-[11px] font-bold text-slate-700 dark:text-slate-300"
            >
              直前のバックアップ結果（計 {lastBackupResult.metadata
                .totalRecords} 件）:
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              {#each Object.entries(lastBackupResult.metadata.tableCounts) as [table, count] (table)}
                <span
                  class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <span>{table}:</span>
                  <span class="font-bold">{count}</span>
                </span>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Right: 7 columns on desktop (Stored Backups List) -->
    <div
      class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-7 dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <FileText class="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <h4 class="text-xs font-bold text-slate-800 dark:text-slate-200">
            R2 保存済みバックアップ一覧 ({backups.length} 件)
          </h4>
        </div>
        <button
          type="button"
          onclick={loadBackups}
          disabled={isLoadingBackups}
          class="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <RefreshCw
            class={`h-3 w-3 ${isLoadingBackups ? 'animate-spin' : ''}`}
          />
          <span>再読込</span>
        </button>
      </div>

      {#if isLoadingBackups}
        <div
          class="flex items-center justify-center py-10 text-xs text-slate-400"
        >
          <RefreshCw class="mr-2 h-4 w-4 animate-spin" />
          <span>一覧を取得中...</span>
        </div>
      {:else if backups.length === 0}
        <div
          class="rounded-lg bg-slate-50 py-10 text-center text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400"
        >
          保存されているバックアップはありません（専用バックアップ保存先が未設定、または初回実行前）
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr
                class="border-b border-slate-200 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400"
              >
                <th class="pb-2 font-bold">ファイル名</th>
                <th class="pb-2 font-bold">作成日時</th>
                <th class="pb-2 text-right font-bold">総件数</th>
                <th class="pb-2 text-right font-bold">サイズ</th>
                <th class="pb-2 text-right font-bold">保存</th>
              </tr>
            </thead>
            <tbody
              class="divide-y divide-slate-100 font-mono text-[11px] dark:divide-slate-800/60"
            >
              {#each backups as b (b.key)}
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td
                    class="py-2.5 font-medium text-slate-800 dark:text-slate-200"
                  >
                    {b.key.replace('backups/', '')}
                  </td>
                  <td class="py-2.5 text-slate-500 dark:text-slate-400">
                    {b.uploaded
                      ? new Date(b.uploaded).toLocaleString('ja-JP')
                      : '-'}
                  </td>
                  <td
                    class="py-2.5 text-right text-slate-700 dark:text-slate-300"
                  >
                    {b.totalRecords !== undefined
                      ? `${b.totalRecords} 件`
                      : '-'}
                  </td>
                  <td
                    class="py-2.5 text-right text-slate-500 dark:text-slate-400"
                  >
                    {(b.size / 1024).toFixed(1)} KB
                  </td>
                  <td class="py-2.5 text-right">
                    <button
                      type="button"
                      disabled={downloading !== null}
                      onclick={() => download(b.key)}
                      aria-label={`${b.key.replace('backups/', '')}をダウンロード`}
                      class="rounded border border-slate-400 px-2 py-1 text-slate-800 disabled:opacity-50 dark:text-slate-100"
                    >
                      {downloading === b.key ? '取得中...' : 'ダウンロード'}
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
</div>
