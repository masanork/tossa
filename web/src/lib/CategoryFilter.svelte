<!-- web/src/lib/CategoryFilter.svelte -->
<script lang="ts">
  import type { Category } from './types';

  interface Props {
    categories: Category[];
    selectedCategory: string | null;
    onSelect: (id: string | null) => void;
  }

  let { categories, selectedCategory, onSelect }: Props = $props();
</script>

<div class="w-full overflow-x-auto no-scrollbar py-2 px-4">
  <div class="flex items-center gap-2 max-w-4xl mx-auto min-w-max">
    <!-- 「すべて」ボタン -->
    <button
      type="button"
      onclick={() => onSelect(null)}
      class={`px-3.5 py-2 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs flex items-center gap-1.5 ${
        selectedCategory === null
          ? 'bg-slate-900 text-white shadow-sm ring-2 ring-slate-900 ring-offset-1'
          : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
      }`}
    >
      <span>🌐</span>
      <span>すべて</span>
    </button>

    <!-- 各カテゴリボタン -->
    {#each categories as cat (cat.id)}
      <button
        type="button"
        onclick={() => onSelect(cat.id)}
        class={`px-3.5 py-2 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs flex items-center gap-1.5 ${
          selectedCategory === cat.id
            ? 'text-white shadow-sm ring-2 ring-offset-1'
            : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
        }`}
        style={selectedCategory === cat.id ? `background-color: ${cat.color}; --tw-ring-color: ${cat.color};` : ''}
      >
        <span class="text-sm leading-none">{cat.icon}</span>
        <span>{cat.name}</span>
      </button>
    {/each}
  </div>
</div>
