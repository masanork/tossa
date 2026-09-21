<!-- web/src/lib/VocabularyFilter.svelte: Organic vocabulary tag filter bar -->
<script lang="ts">
  import type { TagCount } from './types';
  import { X } from '@lucide/svelte';
  import { m, i18n } from './i18n.svelte';
  import { getTagDisplay } from './tagDictionary';

  interface Props {
    tags: TagCount[];
    selectedTag: string | null;
    totalCount: number;
    onSelectTag: (tag: string | null) => void;
  }

  const { tags, selectedTag, totalCount, onSelectTag }: Props = $props();
</script>

<div class="no-scrollbar w-full overflow-x-auto px-4 py-2.5">
  <div class="mx-auto flex max-w-4xl min-w-max items-center gap-2">
    <!-- "All" button -->
    <button
      type="button"
      onclick={() => onSelectTag(null)}
      class={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold shadow-xs transition-all ${
        selectedTag === null
          ? 'bg-slate-900 text-white shadow-sm ring-2 ring-slate-900 ring-offset-1 dark:bg-white dark:text-slate-950 dark:ring-white dark:ring-offset-slate-900'
          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <span>🌐</span>
      <span>{m.tag_filter_all()}</span>
      {#if totalCount > 0}
        <span
          class={`py-0.2 rounded-full px-1.5 text-[10px] ${
            selectedTag === null
              ? 'bg-slate-700 text-slate-200 dark:bg-slate-200 dark:text-slate-800'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {totalCount}
        </span>
      {/if}
    </button>

    {#each tags as t (t.name)}
      {@const tagInfo = getTagDisplay(t.name, i18n.current)}
      <button
        type="button"
        onclick={() => onSelectTag(selectedTag === t.name ? null : t.name)}
        title={tagInfo.tooltip}
        class={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold shadow-xs transition-all ${
          selectedTag === t.name
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900'
            : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800'
        }`}
      >
        <span>#{tagInfo.displayName}</span>
        {#if tagInfo.badgeSub}
          <span
            class={`text-[10px] font-normal ${
              selectedTag === t.name
                ? 'text-blue-200'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            ({tagInfo.badgeSub})
          </span>
        {/if}
        {#if t.count > 0}
          <span
            class={`py-0.2 rounded-full px-1.5 text-[10px] ${
              selectedTag === t.name
                ? 'bg-blue-800 text-blue-100'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t.count}
          </span>
        {/if}
        {#if selectedTag === t.name}
          <X class="ml-0.5 h-3.5 w-3.5 text-blue-200" />
        {/if}
      </button>
    {/each}
  </div>
</div>
