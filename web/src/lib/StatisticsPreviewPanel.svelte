<script lang="ts">
  import {
    previewTsudoiStatisticsApi,
    type StatisticsPreview,
    type StatisticsPreviewMapping,
  } from './api';
  import sampleFeed from '../../../docs/examples/tsudoi-statistics-preview.json';

  const MAX_FEED_BYTES = 1024 * 1024;
  const { token }: { token: string } = $props();

  let feedText = $state('');
  let mappings = $state<StatisticsPreviewMapping[]>([]);
  let preview = $state<StatisticsPreview | null>(null);
  let errorMessage = $state<string | null>(null);
  let inputError = $state<string | null>(null);
  let isReadingFile = $state(false);
  let isPreviewing = $state(false);
  let generation = 0;
  let previewController: AbortController | null = null;

  function invalidatePreview() {
    generation++;
    previewController?.abort();
    previewController = null;
    preview = null;
    errorMessage = null;
    inputError = null;
    isReadingFile = false;
    isPreviewing = false;
  }

  function handleRawInput() {
    invalidatePreview();
  }

  function addMapping() {
    invalidatePreview();
    mappings = [...mappings, { kind: 'shelter', externalId: '', postId: '' }];
  }

  function removeMapping(index: number) {
    invalidatePreview();
    mappings = mappings.filter((_, itemIndex) => itemIndex !== index);
  }

  async function handleFileChange(event: Event) {
    invalidatePreview();
    const requestGeneration = generation;
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    feedText = '';
    if (file.size > MAX_FEED_BYTES) {
      inputError = 'JSONファイルは1 MiB以下にしてください。';
      return;
    }

    isReadingFile = true;
    try {
      const bytes = await file.arrayBuffer();
      if (requestGeneration !== generation) return;
      if (bytes.byteLength > MAX_FEED_BYTES) {
        inputError = 'JSONファイルは1 MiB以下にしてください。';
        return;
      }
      const text = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: false,
      }).decode(bytes);
      JSON.parse(text);
      feedText = text;
    } catch {
      if (requestGeneration === generation) {
        inputError =
          'UTF-8のJSONを読み取れません。文字コードと形式を確認してください。';
      }
    } finally {
      if (requestGeneration === generation) isReadingFile = false;
    }
  }

  function loadSample() {
    invalidatePreview();
    feedText = JSON.stringify(sampleFeed, null, 2);
    mappings = [];
  }

  async function runPreview() {
    invalidatePreview();
    const requestGeneration = generation;
    const sourceText = feedText;
    const mappingSnapshot = mappings.map((mapping) => ({
      kind: mapping.kind,
      externalId: mapping.externalId.trim(),
      postId: mapping.postId.trim(),
    }));
    if (!sourceText.trim()) {
      inputError = '公開データのJSONを読み込んでください。';
      return;
    }
    if (new TextEncoder().encode(sourceText).byteLength > MAX_FEED_BYTES) {
      inputError = 'JSONファイルは1 MiB以下にしてください。';
      return;
    }

    let feed: unknown;
    try {
      feed = JSON.parse(sourceText);
    } catch {
      inputError = 'JSONを解析できません。形式を確認してください。';
      return;
    }
    if (
      mappingSnapshot.some((mapping) => !mapping.externalId || !mapping.postId)
    ) {
      inputError = '対応付けには外部IDと投稿IDの両方を入力してください。';
      return;
    }

    const controller = new AbortController();
    previewController = controller;
    isPreviewing = true;
    const result = await previewTsudoiStatisticsApi(
      token,
      feed,
      mappingSnapshot,
      controller.signal
    );
    if (requestGeneration !== generation) return;
    isPreviewing = false;
    previewController = null;
    if (result.success) preview = result.preview;
    else errorMessage = result.error;
  }

  function formatDate(value: string): string {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleString('ja-JP')
      : '日時不明';
  }

  function formatValue(value: number | null, status: string): string {
    if (status === 'withheld') return '非公開';
    if (status === 'unavailable') return '取得できません';
    return value === null ? '値なし' : `${value.toLocaleString('ja-JP')}人`;
  }

  function metricLabel(metric: string): string {
    switch (metric) {
      case 'current_occupancy':
        return '現在滞在人数';
      case 'capacity':
        return '定員';
      case 'participants_unique':
        return '期間内の実人数';
      case 'attendance_total':
        return '期間内の延べ人数';
      default:
        return '未対応の指標';
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'reported':
        return '集計値';
      case 'unavailable':
        return '未取得';
      case 'withheld':
        return '非公開';
      default:
        return '不明';
    }
  }
</script>

<section
  class="flex flex-col gap-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20"
  aria-labelledby="tsudoi-preview-title"
>
  <div>
    <h3
      id="tsudoi-preview-title"
      class="text-sm font-bold text-slate-900 dark:text-slate-100"
    >
      つどい統計データのプレビュー
    </h3>
    <p class="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
      公開データだけを使い、受け入れ形式の統計JSONを確認します。このプレビューは保存されず、現地の投稿も変更しません。
    </p>
    <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
      これはtossaの暫定受け入れ形式です。表示する値や出典は提供元の申告内容です。サンプルは架空の集計データです。
    </p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <label
      class="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    >
      JSONファイルを選択（最大1 MiB）
      <input
        type="file"
        accept="application/json,.json"
        class="sr-only"
        aria-label="統計JSONファイルを選択"
        onchange={handleFileChange}
      />
    </label>
    <button
      type="button"
      class="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      onclick={loadSample}
    >
      サンプルJSONを読み込む
    </button>
    {#if isReadingFile}<span class="text-xs text-slate-500" role="status"
        >読み込み中...</span
      >{/if}
  </div>

  <label
    class="flex flex-col gap-1 text-xs font-bold text-slate-700 dark:text-slate-300"
  >
    公開統計JSON
    <textarea
      bind:value={feedText}
      oninput={handleRawInput}
      rows="9"
      spellcheck="false"
      aria-label="公開統計JSON"
      placeholder="JSONファイルを選択するか、公開データのJSONを貼り付けてください"
      class="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-[11px] font-normal text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    ></textarea>
    <span class="font-normal text-slate-500"
      >{new TextEncoder().encode(feedText).byteLength.toLocaleString('ja-JP')} / 1,048,576
      bytes</span
    >
  </label>

  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="text-xs font-bold text-slate-800 dark:text-slate-200">
        既存投稿への手動対応付け
      </h4>
      <button
        type="button"
        class="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        onclick={addMapping}
      >
        対応付けを追加
      </button>
    </div>
    <p class="text-[11px] text-slate-500 dark:text-slate-400">
      種別と外部IDに対し、対応するtossa投稿IDを指定します。対応付けはこのプレビューリクエスト内だけで使われます。
    </p>
    {#each mappings as mapping, index (index)}
      <div
        class="grid grid-cols-1 items-end gap-2 rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-[110px_1fr_1fr_auto] dark:border-slate-700 dark:bg-slate-900"
      >
        <label
          class="flex flex-col gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300"
        >
          種別
          <select
            bind:value={mapping.kind}
            oninput={handleRawInput}
            aria-label={`対応付け ${index + 1} の種別`}
            class="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="shelter">避難所</option>
            <option value="event">イベント</option>
          </select>
        </label>
        <label
          class="flex flex-col gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300"
        >
          外部ID
          <input
            bind:value={mapping.externalId}
            oninput={handleRawInput}
            aria-label={`対応付け ${index + 1} の外部ID`}
            class="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <label
          class="flex flex-col gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300"
        >
          tossa投稿ID
          <input
            bind:value={mapping.postId}
            oninput={handleRawInput}
            aria-label={`対応付け ${index + 1} の投稿ID`}
            class="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <button
          type="button"
          class="cursor-pointer rounded-md px-2 py-1.5 text-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
          aria-label={`対応付け ${index + 1} を削除`}
          onclick={() => removeMapping(index)}>削除</button
        >
      </div>
    {:else}
      <p
        class="rounded-lg border border-dashed border-slate-300 p-3 text-[11px] text-slate-500 dark:border-slate-700"
      >
        対応付けがない統計対象は「未対応」としてプレビューに表示します。
      </p>
    {/each}
  </div>

  {#if inputError}
    <p
      class="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
      role="alert"
    >
      {inputError}
    </p>
  {/if}
  {#if errorMessage}
    <p
      class="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"
      role="alert"
    >
      {errorMessage}
    </p>
  {/if}

  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onclick={runPreview}
      disabled={isPreviewing || isReadingFile || !feedText.trim()}
      class="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPreviewing ? 'プレビュー中...' : '統計プレビューを作成'}
    </button>
    <span class="text-[11px] text-slate-500 dark:text-slate-400"
      >実行してもデータは保存されず、投稿も変更されません。</span
    >
  </div>

  {#if preview}
    <div
      class="flex flex-col gap-3 border-t border-indigo-200 pt-4 dark:border-indigo-900/60"
      aria-live="polite"
    >
      <div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <div class="rounded-lg bg-white p-2 dark:bg-slate-900">
          <span class="block text-[10px] text-slate-500">生成元</span><strong
            >つどい</strong
          >
        </div>
        <div class="rounded-lg bg-white p-2 dark:bg-slate-900">
          <span class="block text-[10px] text-slate-500">統計レコード</span
          ><strong>{preview.recordCount}</strong>
        </div>
        <div class="rounded-lg bg-white p-2 dark:bg-slate-900">
          <span class="block text-[10px] text-slate-500">対象</span><strong
            >{preview.entityCount}</strong
          >
        </div>
        <div class="rounded-lg bg-white p-2 dark:bg-slate-900">
          <span class="block text-[10px] text-slate-500">未対応対象</span
          ><strong>{preview.unmappedEntityCount}</strong>
        </div>
      </div>
      <div class="text-[11px] text-slate-600 dark:text-slate-300">
        確認時刻: {formatDate(preview.checkedAt)} ・ データ生成時刻: {formatDate(
          preview.generatedAt
        )}
      </div>
      {#if preview.warnings.length}
        <div
          class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <h4 class="mb-1 font-bold">確認事項</h4>
          <ul class="list-disc space-y-1 pl-4">
            {#each preview.warnings as warning, index (index)}<li>
                {warning}
              </li>{/each}
          </ul>
        </div>
      {/if}
      <div class="flex flex-col gap-2">
        {#each preview.records as record (record.id)}
          <article
            class="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 class="font-bold text-slate-900 dark:text-slate-100">
                  {record.entity.label}
                </h4>
                <p class="mt-0.5 text-[10px] text-slate-500">
                  {record.entity.kind === 'shelter' ? '避難所' : 'イベント'} / {record
                    .entity.id}
                </p>
              </div>
              {#if record.targetPost}
                <span
                  class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                  >対応済み: {record.targetPost.title}</span
                >
              {:else}
                <span
                  class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                  >未対応</span
                >
              {/if}
            </div>
            <dl
              class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3"
            >
              <div>
                <dt class="text-slate-500">指標</dt>
                <dd>{metricLabel(record.metric)}</dd>
              </div>
              <div>
                <dt class="text-slate-500">状態 / 値</dt>
                <dd>
                  {statusLabel(record.status)} / {formatValue(
                    record.value,
                    record.status
                  )}
                </dd>
              </div>
              <div>
                <dt class="text-slate-500">観測時刻</dt>
                <dd>{formatDate(record.observedAt)}</dd>
              </div>
              <div>
                <dt class="text-slate-500">版</dt>
                <dd>版{record.revision}</dd>
              </div>
              {#if record.period}<div>
                  <dt class="text-slate-500">期間</dt>
                  <dd>
                    {formatDate(record.period.start)} – {formatDate(
                      record.period.end
                    )}
                  </dd>
                </div>{/if}
            </dl>
            <a
              href={record.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-2 inline-block text-[10px] break-all text-blue-700 underline dark:text-blue-300"
              >出典を確認</a
            >
          </article>
        {/each}
      </div>
      <p class="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
        これは確認用のプレビューです。統計値は保存されず、既存投稿や公開ページも変更されていません。
      </p>
    </div>
  {/if}
</section>
