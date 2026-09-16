<!-- web/src/lib/PushModal.svelte -->
<script lang="ts">
  import { swipeDown } from './swipeToDismiss';
  import { pushManager } from './pushManager.svelte';
  import * as m from '../paraglide/messages.js';
  import {
    Bell,
    BellOff,
    BellRing,
    CheckCircle2,
    AlertCircle,
    Send,
    MapPin,
    ShieldAlert,
    Radio,
    X,
    Flame,
    Home,
    MessageSquareLock,
    Loader2,
  } from '@lucide/svelte';

  interface Props {
    isTop?: boolean;
    zIndex?: number;
    availableAreas: string[];
    token: string | null;
    onClose: () => void;
  }

  const {
    isTop = true,
    zIndex = 50,
    availableAreas,
    token,
    onClose,
  }: Props = $props();

  let testSuccess = $state(false);
  let isSendingTest = $state(false);

  const alertTypeOptions = [
    {
      id: 'emergency',
      label: m.push_type_emergency(),
      icon: Flame,
      color: 'text-red-500',
    },
    {
      id: 'evacuation',
      label: m.push_type_evacuation(),
      icon: Home,
      color: 'text-amber-500',
    },
    {
      id: 'status',
      label: m.push_type_status(),
      icon: Radio,
      color: 'text-blue-500',
    },
    {
      id: 'messages',
      label: m.push_type_messages(),
      icon: MessageSquareLock,
      color: 'text-indigo-500',
    },
  ];

  async function handleToggleSubscribe() {
    testSuccess = false;
    if (pushManager.isSubscribed) {
      await pushManager.unsubscribe();
    } else {
      await pushManager.subscribe(token);
    }
  }

  async function handleSendTest() {
    testSuccess = false;
    isSendingTest = true;
    const ok = await pushManager.sendTest(token);
    isSendingTest = false;
    if (ok) {
      testSuccess = true;
      setTimeout(() => {
        testSuccess = false;
      }, 5000);
    }
  }

  function handleToggleType(typeId: string) {
    let current = [...pushManager.alertTypes];
    if (current.includes(typeId)) {
      // Don't allow deselecting all types
      if (current.length > 1) {
        current = current.filter((t) => t !== typeId);
      }
    } else {
      current.push(typeId);
    }
    pushManager.setAlertTypes(current, token);
  }

  function handleAreaChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    pushManager.setArea(target.value, token);
  }
</script>

<!-- Backdrop with multi-modal stack support -->
<div
  class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200"
  style="z-index: {zIndex};"
  onclick={onClose}
  role="presentation"
></div>

<!-- Modal Dialog / Mobile Bottom Sheet -->
<div
  class="fixed inset-x-0 bottom-0 max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border-t border-slate-200 bg-white p-6 shadow-2xl transition-all duration-300 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border dark:border-slate-800 dark:bg-slate-900 {isTop
    ? 'opacity-100'
    : 'pointer-events-none opacity-80'}"
  style="z-index: {zIndex + 1};"
  inert={!isTop}
  use:swipeDown={onClose}
  role="dialog"
  aria-labelledby="push-modal-title"
>
  <!-- Mobile drag handle indicator -->
  <div
    class="mx-auto -mt-2 mb-4 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
  ></div>

  <!-- Header -->
  <div
    class="mb-5 flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800"
  >
    <div class="flex items-center gap-2.5">
      <div
        class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
      >
        {#if pushManager.isSubscribed}
          <BellRing class="h-5 w-5" />
        {:else}
          <Bell class="h-5 w-5" />
        {/if}
      </div>
      <div>
        <h2
          id="push-modal-title"
          class="text-base font-bold text-slate-900 sm:text-lg dark:text-white"
        >
          {m.push_modal_title()}
        </h2>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          RFC 8291 / 8292 Web Push
        </p>
      </div>
    </div>
    <button
      type="button"
      onclick={onClose}
      class="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      aria-label="閉じる"
    >
      <X class="h-5 w-5" />
    </button>
  </div>

  <p
    class="mb-5 text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-300"
  >
    {m.push_modal_desc()}
  </p>

  {#if !pushManager.supported}
    <!-- Unsupported Browser Banner -->
    <div
      class="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p class="font-bold">{m.push_unsupported()}</p>
        <p class="mt-1 opacity-80">
          iOSの場合は「ホーム画面に追加」を行うことでWeb
          Push通知が利用可能になります。
        </p>
      </div>
    </div>
  {:else}
    <!-- Status & Toggle Card -->
    <div
      class="mb-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4.5 dark:border-slate-800 dark:bg-slate-800/50"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          {#if pushManager.permission === 'denied'}
            <div
              class="flex h-3 w-3 rounded-full bg-red-500 ring-4 ring-red-500/20"
            ></div>
            <span class="text-xs font-bold text-red-600 dark:text-red-400">
              {m.push_status_blocked()}
            </span>
          {:else if pushManager.isSubscribed}
            <div
              class="flex h-3 w-3 animate-pulse rounded-full bg-emerald-500 ring-4 ring-emerald-500/20"
            ></div>
            <span
              class="text-xs font-bold text-emerald-600 dark:text-emerald-400"
            >
              {m.push_status_active()}
            </span>
          {:else}
            <div class="flex h-3 w-3 rounded-full bg-slate-400"></div>
            <span
              class="text-xs font-semibold text-slate-500 dark:text-slate-400"
            >
              {m.push_status_inactive()}
            </span>
          {/if}
        </div>

        {#if pushManager.permission !== 'denied'}
          <button
            type="button"
            disabled={pushManager.isLoading}
            onclick={handleToggleSubscribe}
            class={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-xs transition-all active:scale-95 disabled:opacity-50 ${
              pushManager.isSubscribed
                ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-red-600 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 dark:hover:text-red-400'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700'
            }`}
          >
            {#if pushManager.isLoading}
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
              <span>処理中...</span>
            {:else if pushManager.isSubscribed}
              <BellOff class="h-3.5 w-3.5" />
              <span>{m.push_disable_btn()}</span>
            {:else}
              <BellRing class="h-3.5 w-3.5" />
              <span>{m.push_enable_btn()}</span>
            {/if}
          </button>
        {/if}
      </div>

      {#if pushManager.permission === 'denied'}
        <p class="mt-3 text-xs text-red-600 dark:text-red-400">
          ※
          ブラウザのサイト設定から「通知」の許可を「許可」に変更した上で再読み込みしてください。
        </p>
      {/if}

      {#if pushManager.errorMessage}
        <p class="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">
          {pushManager.errorMessage}
        </p>
      {/if}
    </div>

    {#if pushManager.isSubscribed}
      <!-- Preference Settings -->
      <div class="space-y-4">
        <!-- Area Filter -->
        <div>
          <label
            for="push-area-select"
            class="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            <MapPin class="h-3.5 w-3.5 text-blue-600" />
            <span>{m.push_pref_area()}</span>
          </label>
          <select
            id="push-area-select"
            value={pushManager.area}
            onchange={handleAreaChange}
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-2xs focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="">{m.all_areas()}（制限なし）</option>
            {#each availableAreas as area (area)}
              <option value={area}>{area}</option>
            {/each}
          </select>
        </div>

        <!-- Alert Categories -->
        <div>
          <div
            class="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            <ShieldAlert class="h-3.5 w-3.5 text-amber-500" />
            <span>{m.push_pref_types()}</span>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {#each alertTypeOptions as opt (opt.id)}
              {@const isSelected = pushManager.alertTypes.includes(opt.id)}
              <button
                type="button"
                onclick={() => handleToggleType(opt.id)}
                class={`flex cursor-pointer items-center justify-between rounded-xl border p-2.5 text-left text-xs transition ${
                  isSelected
                    ? 'border-blue-500/50 bg-blue-50/50 font-bold text-blue-900 dark:border-blue-700/50 dark:bg-blue-950/40 dark:text-blue-200'
                    : 'border-slate-200 bg-white text-slate-600 opacity-60 hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                <div class="flex items-center gap-2">
                  <opt.icon class={`h-4 w-4 shrink-0 ${opt.color}`} />
                  <span class="truncate">{opt.label}</span>
                </div>
                <div
                  class={`flex h-4 w-4 items-center justify-center rounded-md border ${
                    isSelected
                      ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {#if isSelected}
                    <CheckCircle2 class="h-3 w-3" />
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        </div>

        <!-- Test Notification Button -->
        <div class="pt-3">
          <button
            type="button"
            disabled={isSendingTest}
            onclick={handleSendTest}
            class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-blue-600 active:scale-98 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {#if isSendingTest}
              <Loader2 class="h-3.5 w-3.5 animate-spin text-blue-600" />
              <span>送信中...</span>
            {:else}
              <Send class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>{m.push_test_btn()}</span>
            {/if}
          </button>

          {#if testSuccess}
            <div
              class="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <CheckCircle2 class="h-3.5 w-3.5 shrink-0" />
              <span>{m.push_test_success()}</span>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Footer Close -->
  <div
    class="mt-6 flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800"
  >
    <button
      type="button"
      onclick={onClose}
      class="cursor-pointer rounded-xl bg-slate-100 px-5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {m.btn_cancel()}
    </button>
  </div>
</div>
