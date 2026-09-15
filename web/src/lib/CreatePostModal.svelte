<!-- web/src/lib/CreatePostModal.svelte -->
<script lang="ts">
  import type { Category } from './types';
  import { createPost } from './api';
  import { X, Plus, AlertCircle } from '@lucide/svelte';

  interface Props {
    categories: Category[];
    token: string | null;
    onClose: () => void;
    onCreated: () => void;
  }

  let { categories, token, onClose, onCreated }: Props = $props();

  let categoryId = $state('water');
  let title = $state('');
  let area = $state('中央区');

  $effect(() => {
    if (categories.length > 0 && !categories.some(c => c.id === categoryId)) {
      categoryId = categories[0].id;
    }
  });
  let address = $state('');
  let currentStatus = $state('available');
  let statusLabel = $state('受付中 / 利用可能');
  let note = $state('');
  let url = $state('');
  let attrKey = $state('');
  let attrVal = $state('');
  let attributes = $state<Record<string, string>>({});

  let isSubmitting = $state(false);
  let errorMessage = $state('');

  function addAttribute() {
    if (attrKey.trim() && attrVal.trim()) {
      attributes = { ...attributes, [attrKey.trim()]: attrVal.trim() };
      attrKey = '';
      attrVal = '';
    }
  }

  function removeAttribute(key: string) {
    const next = { ...attributes };
    delete next[key];
    attributes = next;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!title.trim() || !area.trim()) {
      errorMessage = '拠点名と地区名は必須です';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      const res = await createPost(
        {
          categoryId,
          title: title.trim(),
          area: area.trim(),
          address: address.trim() || undefined,
          currentStatus,
          statusLabel,
          note: note.trim() || undefined,
          url: url.trim() || undefined,
          attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        },
        token
      );

      if (res.success) {
        onCreated();
        onClose();
      } else {
        errorMessage = res.error || '作成に失敗しました';
      }
    } catch (err: any) {
      errorMessage = err.message || '通信エラーが発生しました';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
  <div class="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
    <!-- ヘッダー -->
    <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
      <h2 class="text-base font-black text-slate-900">＋ 新しい情報を登録する</h2>
      <button
        type="button"
        onclick={onClose}
        class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
      >
        <X class="w-5 h-5" />
      </button>
    </div>

    <!-- フォーム（スクロール可能） -->
    <form onsubmit={handleSubmit} class="p-5 flex flex-col gap-4 overflow-y-auto">
      {#if errorMessage}
        <div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-1.5">
          <AlertCircle class="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      {/if}

      <!-- カテゴリ -->
      <div>
        <label for="post-category" class="block text-xs font-bold text-slate-700 mb-1.5">カテゴリ</label>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {#each categories as cat}
            <button
              type="button"
              onclick={() => { categoryId = cat.id; }}
              class={`px-3 py-2 rounded-xl text-xs font-bold border text-left flex items-center gap-1.5 transition-all cursor-pointer ${
                categoryId === cat.id
                  ? 'border-blue-500 bg-blue-50 text-blue-800 ring-2 ring-blue-400'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span>{cat.icon}</span>
              <span class="truncate">{cat.name}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- 施設・拠点名 -->
      <div>
        <label for="post-title" class="block text-xs font-bold text-slate-700 mb-1">
          施設・拠点名 <span class="text-rose-600">*</span>
        </label>
        <input
          id="post-title"
          type="text"
          bind:value={title}
          placeholder="例: 白川小学校 臨時給水所"
          required
          class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      <!-- エリア & 住所 -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label for="post-area" class="block text-xs font-bold text-slate-700 mb-1">
            地区名 <span class="text-rose-600">*</span>
          </label>
          <input
            id="post-area"
            type="text"
            bind:value={area}
            placeholder="例: 中央区"
            required
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
        <div class="sm:col-span-2">
          <label for="post-address" class="block text-xs font-bold text-slate-700 mb-1">住所・場所の詳細</label>
          <input
            id="post-address"
            type="text"
            bind:value={address}
            placeholder="例: 熊本市中央区新屋敷1丁目 校庭北門付近"
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
      </div>

      <!-- 初期ステータス -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label for="post-status-select" class="block text-xs font-bold text-slate-700 mb-1">初期ステータス</label>
          <select
            id="post-status-select"
            bind:value={currentStatus}
            onchange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val === 'available') statusLabel = '受付中 / 利用可能';
              if (val === 'crowded') statusLabel = '混雑中';
              if (val === 'out_of_stock') statusLabel = '本日分終了';
              if (val === 'open') statusLabel = '営業中';
            }}
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="available">利用可能 / 配布中</option>
            <option value="open">営業中 / 開設中</option>
            <option value="crowded">混雑中</option>
            <option value="out_of_stock">終了 / 完売</option>
          </select>
        </div>
        <div>
          <label for="post-status-label" class="block text-xs font-bold text-slate-700 mb-1">表示ラベル</label>
          <input
            id="post-status-label"
            type="text"
            bind:value={statusLabel}
            placeholder="例: 給水中、時短営業中"
            class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
      </div>

      <!-- 詳細メモ -->
      <div>
        <label for="post-note" class="block text-xs font-bold text-slate-700 mb-1">詳細・補足メモ</label>
        <textarea
          id="post-note"
          bind:value={note}
          rows="3"
          placeholder="持参が必要な物、入場制限、時間帯、連絡先など"
          class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        ></textarea>
      </div>

      <!-- 任意属性タグの追加 -->
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
        <span class="block text-xs font-bold text-slate-700 mb-1">詳細タグ・属性（任意）</span>
        <div class="flex items-center gap-1.5 mb-2">
          <input
            type="text"
            bind:value={attrKey}
            placeholder="項目名 (例: 給水上限)"
            class="w-1/3 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
          />
          <input
            type="text"
            bind:value={attrVal}
            placeholder="内容 (例: 1人20L)"
            class="w-1/2 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
          />
          <button
            type="button"
            onclick={addAttribute}
            class="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-bold text-slate-700 cursor-pointer"
          >
            追加
          </button>
        </div>

        {#if Object.keys(attributes).length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each Object.entries(attributes) as [k, v]}
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 text-[11px]">
                <span>{k}: {v}</span>
                <button type="button" onclick={() => removeAttribute(k)} class="text-slate-400 hover:text-rose-600 font-bold">×</button>
              </span>
            {/each}
          </div>
        {/if}
      </div>

      <!-- フッター -->
      <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
        <button
          type="button"
          onclick={onClose}
          class="px-4 py-2 text-xs font-bold rounded-lg text-slate-600 hover:bg-slate-100 transition cursor-pointer"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          class="px-5 py-2 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-xs transition active:scale-95 cursor-pointer"
        >
          {isSubmitting ? '登録中...' : '情報を登録する'}
        </button>
      </div>
    </form>
  </div>
</div>
