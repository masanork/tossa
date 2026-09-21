<!--
  web/src/lib/DisasterDarkModePrompt.svelte

  One-time prompt shown when the site switches into disaster mode and the user
  is currently on a light theme. Offers to switch to dark mode for OLED/AMOLED
  battery savings, but respects the user's choice and does not nag.
-->
<script lang="ts">
  import { Moon, X } from '@lucide/svelte';
  import { themeManager } from './theme.svelte';
  import { m } from './i18n.svelte';

  interface Props {
    isDisaster: boolean;
  }

  const { isDisaster }: Props = $props();

  const STORAGE_LAST_MODE_KEY = 'tossa_last_operation_mode';
  const STORAGE_DISMISSED_KEY = 'tossa_disaster_dark_prompt_dismissed';

  function readLastMode(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_LAST_MODE_KEY);
  }

  function writeLastMode(mode: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_LAST_MODE_KEY, mode);
  }

  function isExplicitlyDismissed(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_DISMISSED_KEY) === '1';
  }

  function markDismissed(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_DISMISSED_KEY, '1');
  }

  let visible = $state(false);

  $effect(() => {
    const lastMode = readLastMode();
    const enteringDisaster = isDisaster && lastMode !== 'disaster';
    const shouldShow =
      enteringDisaster &&
      themeManager.resolvedTheme === 'light' &&
      !isExplicitlyDismissed();

    if (shouldShow) {
      visible = true;
    }

    // Always remember the latest seen mode so we can detect re-entry.
    if (isDisaster) {
      writeLastMode('disaster');
    } else if (lastMode === 'disaster') {
      writeLastMode('normal');
    }
  });

  function switchToDark() {
    themeManager.setTheme('dark');
    visible = false;
  }

  function dismiss() {
    markDismissed();
    visible = false;
  }
</script>

{#if visible}
  <div
    role="status"
    aria-live="polite"
    class="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
  >
    <Moon
      class="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300"
      aria-hidden="true"
    />
    <div class="min-w-0 flex-1">
      <p class="font-bold">{m.disaster_dark_prompt_title()}</p>
      <p class="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
        {m.disaster_dark_prompt_desc()}
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={switchToDark}
          class="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
        >
          {m.disaster_dark_prompt_switch()}
        </button>
        <button
          type="button"
          onclick={dismiss}
          class="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
        >
          {m.disaster_dark_prompt_keep()}
        </button>
      </div>
    </div>
    <button
      type="button"
      onclick={dismiss}
      class="shrink-0 rounded-md p-1 text-amber-700 transition hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
      aria-label={m.btn_close()}
    >
      <X class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
{/if}
