<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from './i18n.svelte';
  import { informationAge } from './informationAge';

  const {
    observedAt,
    confirmedAt,
    maxAgeMinutes = 60,
  }: {
    observedAt?: string | null;
    confirmedAt?: string | null;
    maxAgeMinutes?: number;
  } = $props();
  let now = $state(Date.now());
  const age = $derived(
    informationAge(observedAt, confirmedAt, now, maxAgeMinutes)
  );
  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 60_000);
    return () => clearInterval(timer);
  });
</script>

<div
  class="mb-2 flex flex-col gap-1 text-[11px] text-slate-700 dark:text-slate-300"
>
  <span
    >{m.information_observed({
      time: age.observedTime
        ? new Date(age.observedTime).toLocaleString()
        : m.unknown_time(),
    })}</span
  >
  {#if !confirmedAt}<span>{m.information_unconfirmed()}</span>{/if}
  {#if age.needsRecheck}
    <span
      class="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      >⚠ {m.information_recheck()}</span
    >
  {/if}
</div>
