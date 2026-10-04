<script lang="ts">
  import { onMount } from 'svelte';
  import {
    readDeviceStorageStatus,
    requestPersistentDeviceStorage,
    type DeviceStorageStatus,
  } from './deviceStorage';

  let status = $state<DeviceStorageStatus>({ persistence: 'unknown' });
  let requesting = $state(false);
  let result = $state<string | null>(null);

  function megabytes(value: number): string {
    return (value / (1024 * 1024)).toLocaleString('ja-JP', {
      maximumFractionDigits: 1,
    });
  }

  async function refresh() {
    status = await readDeviceStorageStatus();
  }

  async function request() {
    requesting = true;
    const granted = await requestPersistentDeviceStorage();
    result = granted
      ? '端末保存の保護が許可されました。'
      : '保護は許可されませんでした。未送信データの保存と送信は引き続き利用できます。';
    await refresh();
    requesting = false;
  }

  onMount(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('offline-queue-change', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('offline-queue-change', refresh);
    };
  });
</script>

<details
  class="mt-3 rounded-lg border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
>
  <summary class="cursor-pointer font-medium">端末保存の状態</summary>
  <div class="mt-2 space-y-2">
    <p>
      {#if status.persistence === 'persistent'}
        自動削除を減らす保護: 許可済み
      {:else if status.persistence === 'temporary'}
        自動削除を減らす保護: 未許可
      {:else if status.persistence === 'unsupported'}
        このブラウザーは保存の保護に対応していません。
      {:else}
        保存の保護状態を確認できません。
      {/if}
    </p>
    {#if status.usageBytes !== undefined && status.quotaBytes !== undefined}
      <p>
        このサイトの使用量（概算）: {megabytes(status.usageBytes)} MB /
        {megabytes(status.quotaBytes)} MB
      </p>
    {/if}
    {#if status.persistence === 'temporary'}
      <button
        type="button"
        class="rounded border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-50 dark:border-slate-600"
        disabled={requesting}
        onclick={request}
      >
        {requesting ? '確認中…' : '端末保存の保護をリクエスト'}
      </button>
    {/if}
    {#if result}<p role="status">{result}</p>{/if}
    <p>
      保護されても、サイトデータの削除や端末の故障では未送信データを失います。通信が戻ったら送信してください。
    </p>
  </div>
</details>
