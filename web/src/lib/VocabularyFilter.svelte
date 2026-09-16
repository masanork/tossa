<!-- web/src/lib/VocabularyFilter.svelte: Organic vocabulary tag filter bar -->
<script lang="ts">
  import type { TagCount } from './types';
  import { Sparkles, X } from '@lucide/svelte';

  interface Props {
    tags: TagCount[];
    selectedTag: string | null;
    totalCount: number;
    onSelectTag: (tag: string | null) => void;
  }

  const { tags, selectedTag, totalCount, onSelectTag }: Props = $props();
</script>

<div class="w-full overflow-x-auto no-scrollbar py-2.5 px-4">
  <div class="flex items-center gap-2 max-w-4xl mx-auto min-w-max">
    <!-- "All" button -->
    <button
      type="button"
      onclick={() => onSelectTag(null)}
      class={`px-4 py-2 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs flex items-center gap-1.5 ${
        selectedTag === null
          ? 'bg-slate-900 text-white shadow-sm ring-2 ring-slate-900 ring-offset-1'
          : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
      }`}
    >
      <span>🌐</span>
      <span>すべて</span>
      {#if totalCount > 0}
        <span
          class={`text-[10px] px-1.5 py-0.2 rounded-full ${
            selectedTag === null
              ? 'bg-slate-700 text-slate-200'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {totalCount}
        </span>
      {/if}
    </button>

    <!-- Organic vocabulary tags derived from community posts -->
    {#if tags.length === 0}
      <div
        class="flex items-center gap-1.5 text-xs text-slate-400 pl-2 select-none"
      >
        <Sparkles class="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span>投稿にタグをつけると、ここにフィルターが自発的に並びます</span>
      </div>
    {:else}
      {#each tags as t (t.name)}
        <button
          type="button"
          onclick={() => onSelectTag(selectedTag === t.name ? null : t.name)}
          class={`px-3.5 py-2 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs flex items-center gap-1.5 ${
            selectedTag === t.name
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md ring-2 ring-blue-500 ring-offset-1'
              : 'bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-300 border border-slate-200'
          }`}
        >
          <span>#{t.name}</span>
          <span
            class={`text-[10px] px-1.5 py-0.2 rounded-full ${
              selectedTag === t.name
                ? 'bg-blue-800 text-blue-100'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t.count}
          </span>
          {#if selectedTag === t.name}
            <X class="w-3.5 h-3.5 ml-0.5 text-blue-200" />
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>
