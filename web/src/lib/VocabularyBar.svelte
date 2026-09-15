<!-- web/src/lib/VocabularyBar.svelte: 自発的に成長するボキャブラリ（タグ）バー -->
<script lang="ts">
  import type { TagCount } from './types';
  import { Tag, Sparkles, X } from '@lucide/svelte';

  interface Props {
    tags: TagCount[];
    selectedTag: string | null;
    onSelectTag: (tag: string | null) => void;
  }

  let { tags, selectedTag, onSelectTag }: Props = $props();
</script>

<div class="w-full max-w-4xl mx-auto px-4 py-1.5 mb-1">
  <div class="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
    <div class="flex items-center gap-1 text-[11px] font-bold text-slate-500 shrink-0 select-none">
      <Sparkles class="w-3 h-3 text-amber-500" />
      <span>ボキャブラリ:</span>
    </div>

    {#if tags.length === 0}
      <span class="text-[11px] text-slate-400 italic shrink-0">
        🌱 投稿にタグをつけると、ここに地域のボキャブラリが自発的に成長します
      </span>
    {:else}
      {#each tags as tag (tag.name)}
        <button
          type="button"
          onclick={() => onSelectTag(selectedTag === tag.name ? null : tag.name)}
          class={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-all cursor-pointer flex items-center gap-1 ${
            selectedTag === tag.name
              ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-500/30'
              : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200'
          }`}
        >
          <span>#{tag.name}</span>
          <span class={`text-[10px] px-1 rounded-full ${
            selectedTag === tag.name ? 'bg-blue-700 text-blue-100' : 'bg-slate-100 text-slate-500'
          }`}>
            {tag.count}
          </span>
          {#if selectedTag === tag.name}
            <X class="w-3 h-3 ml-0.5" />
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>
