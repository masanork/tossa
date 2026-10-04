<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchPostReports, resolvePostReport, type PostReport } from './api';
  const { token }: { token: string } = $props();
  let reports = $state<PostReport[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let selected = $state<string | null>(null);
  let resolution = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  const reasons: Record<string, string> = {
    outdated: '情報が古い',
    incorrect: '内容が違う',
    spam: '迷惑な投稿',
    privacy: '個人情報',
  };
  async function load() {
    error = null;
    try {
      const result = await fetchPostReports(token, offset);
      if (!result.success)
        throw new Error(result.error || '通報一覧を取得できません');
      reports = result.reports || [];
      total = result.total || 0;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '通信エラー';
    }
  }
  async function resolve(event: Event) {
    event.preventDefault();
    if (!selected || busy) return;
    busy = true;
    error = null;
    try {
      const result = await resolvePostReport(selected, resolution, token);
      if (!result.success)
        throw new Error(result.error || '対応結果を保存できません');
      selected = null;
      resolution = '';
      offset = 0;
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '通信エラー';
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    void load();
  });
</script>

<section
  class="flex flex-col gap-3 text-sm text-slate-800 dark:text-slate-100"
  aria-label="通報の確認と対応"
>
  <p>
    未対応の通報: {total} 件。内容を確認し、必要な訂正・削除を行ってから対応結果を記録してください。
  </p>
  {#if error}<p role="alert" class="text-red-700 dark:text-red-300">
      {error}
    </p>{/if}
  <button
    type="button"
    onclick={load}
    class="self-start rounded border border-slate-400 px-3 py-1">再読込</button
  >
  {#each reports as report (report.id)}
    <article
      class="rounded-xl border border-slate-300 p-3 dark:border-slate-700"
    >
      <h4 class="font-bold">{report.post_title}</h4>
      <p class="mt-1">
        {reasons[report.reason] || report.reason} · {report.created_at} UTC
      </p>
      {#if report.note}<p class="mt-2 whitespace-pre-wrap">
          {report.note}
        </p>{/if}
      {#if report.post_id}<a
          href={`/posts/${report.post_id}`}
          class="mt-2 inline-block text-blue-700 underline dark:text-blue-300"
          >投稿を開いて確認・訂正する</a
        >{:else}<p>投稿は削除済みです。</p>{/if}
      <button
        type="button"
        onclick={() => {
          selected = report.id;
          resolution = '';
        }}
        class="ml-3 rounded border border-slate-400 px-3 py-1"
        >対応結果を記録</button
      >
      {#if selected === report.id}
        <form onsubmit={resolve} class="mt-3 flex flex-col gap-2">
          <label
            >確認した内容・実施した対応<textarea
              required
              maxlength="2000"
              bind:value={resolution}
              class="mt-1 w-full rounded border border-slate-400 bg-white p-2 text-slate-900 dark:bg-slate-900 dark:text-slate-100"
            ></textarea></label
          >
          <button
            type="submit"
            disabled={busy}
            class="self-start rounded bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50"
            >対応済みにする</button
          >
        </form>
      {/if}
    </article>
  {/each}
  <div class="flex gap-3">
    {#if offset > 0}<button
        type="button"
        onclick={() => {
          offset = Math.max(0, offset - 50);
          void load();
        }}
        class="rounded border border-slate-400 px-3 py-1">前へ</button
      >{/if}
    {#if offset + reports.length < total}<button
        type="button"
        onclick={() => {
          offset += 50;
          void load();
        }}
        class="rounded border border-slate-400 px-3 py-1">次へ</button
      >{/if}
  </div>
</section>
