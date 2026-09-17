<!-- web/src/lib/MessagesModal.svelte: E2EE Secure Messaging Panel -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { swipeDown } from './swipeToDismiss';
  import { focusTrap } from './focusTrap';
  import type {
    User,
    Thread,
    ThreadMember,
    DecryptedMessage,
    ThreadType,
  } from './types';
  import {
    fetchThreads,
    fetchThreadDetail,
    createThreadApi,
    sendMessageApi,
    inviteMemberApi,
    fetchPublicKeys,
    initializeE2eeKeys,
  } from './api';
  import {
    generateThreadKey,
    encryptThreadKeyForUser,
    decryptThreadKey,
    encryptMessage,
    decryptMessage,
    getCurrentIdentityKey,
    type UserIdentityKey,
  } from './e2ee';
  import {
    X,
    Lock,
    Shield,
    UserPlus,
    Send,
    Plus,
    ArrowLeft,
    MessageSquare,
    Check,
    AlertCircle,
    HelpCircle,
  } from '@lucide/svelte';

  interface Props {
    currentUser: User;
    token: string;
    initialPostId?: string;
    initialPostTitle?: string;
    isTop?: boolean;
    zIndex?: number;
    onClose: () => void;
  }

  const {
    currentUser,
    token,
    initialPostId,
    initialPostTitle,
    isTop = true,
    zIndex = 50,
    onClose,
  }: Props = $props();

  // State management
  let threads = $state<Thread[]>([]);
  let activeThread = $state<Thread | null>(null);
  let activeThreadMembers = $state<ThreadMember[]>([]);
  let decryptedMessages = $state<DecryptedMessage[]>([]);
  let activeThreadKey = $state<CryptoKey | null>(null);
  let activeThreadRawKey = $state<Uint8Array | null>(null);

  let isLoadingThreads = $state(true);
  let isLoadingDetail = $state(false);
  let isSending = $state(false);
  let newMessageText = $state('');

  // New thread creation state
  let isCreatingThread = $state(false);
  let newThreadTitle = $state('');
  let newThreadType = $state<ThreadType>('inquiry');
  let firstMessageText = $state('');
  let createError = $state<string | null>(null);

  // Member invite state
  let showInviteModal = $state(false);
  let availableUsersToInvite = $state<
    Array<
      Pick<User, 'id' | 'username' | 'displayName' | 'role' | 'e2ee_public_key'>
    >
  >([]);
  let isInviting = $state(false);
  let inviteError = $state<string | null>(null);

  // E2EE Identity
  let identityKey = $state<UserIdentityKey | null>(getCurrentIdentityKey());
  let pollingTimer: any = null;

  onMount(async () => {
    // 1. Verify and initialize E2EE key
    if (!identityKey) {
      identityKey = await initializeE2eeKeys(undefined, token);
    }

    // 2. Fetch thread list
    await loadThreads();

    // Pre-fill thread creation form if initialPost is present
    if (initialPostId && initialPostTitle) {
      isCreatingThread = true;
      newThreadTitle = `「${initialPostTitle}」に関するお問い合わせ`;
      newThreadType = 'inquiry';
    }

    // 3. Periodic polling (updates active thread every 8s)
    pollingTimer = setInterval(() => {
      if (activeThread && activeThreadKey) {
        pollMessages();
      }
    }, 8000);
  });

  onDestroy(() => {
    if (pollingTimer) clearInterval(pollingTimer);
  });

  // Fetch thread list
  async function loadThreads() {
    isLoadingThreads = true;
    try {
      const res = await fetchThreads(token);
      if (res.success && res.threads) {
        threads = res.threads;
      }
    } catch (e) {
      console.error('Failed to load threads:', e);
    } finally {
      isLoadingThreads = false;
    }
  }

  // Select thread & decrypt
  async function handleSelectThread(thread: Thread) {
    activeThread = thread;
    activeThreadKey = null;
    activeThreadRawKey = null;
    decryptedMessages = [];
    isLoadingDetail = true;

    try {
      const detail = await fetchThreadDetail(thread.id, token);
      if (!detail.success || !detail.thread) {
        alert('スレッドの読み込みに失敗しました');
        return;
      }

      activeThread = detail.thread;
      activeThreadMembers = detail.members || [];

      // Decrypt shared thread key
      if (!identityKey) {
        identityKey = await initializeE2eeKeys(undefined, token);
      }

      if (
        detail.thread.my_encrypted_thread_key &&
        detail.thread.my_ephemeral_public_key &&
        identityKey
      ) {
        const decrypted = await decryptThreadKey(
          detail.thread.my_encrypted_thread_key,
          detail.thread.my_ephemeral_public_key,
          identityKey.privateKey
        );
        activeThreadKey = decrypted.key;
        activeThreadRawKey = decrypted.raw;

        // Decrypt messages
        if (detail.messages) {
          const decryptedList: DecryptedMessage[] = [];
          for (const msg of detail.messages) {
            const text = await decryptMessage(
              msg.ciphertext,
              msg.iv,
              activeThreadKey
            );
            decryptedList.push({
              id: msg.id,
              thread_id: msg.thread_id,
              sender_id: msg.sender_id,
              sender_username: msg.sender_username,
              sender_display_name: msg.sender_display_name,
              sender_role: msg.sender_role,
              text,
              created_at: msg.created_at,
              isMine: msg.sender_id === currentUser.id,
            });
          }
          decryptedMessages = decryptedList;
        }
      }
    } catch (err: any) {
      console.error('Error loading or decrypting thread:', err);
    } finally {
      isLoadingDetail = false;
    }
  }

  // Poll new messages
  async function pollMessages() {
    if (!activeThread || !activeThreadKey) return;
    try {
      const detail = await fetchThreadDetail(activeThread.id, token);
      if (detail.success && detail.messages) {
        const decryptedList: DecryptedMessage[] = [];
        for (const msg of detail.messages) {
          const text = await decryptMessage(
            msg.ciphertext,
            msg.iv,
            activeThreadKey
          );
          decryptedList.push({
            id: msg.id,
            thread_id: msg.thread_id,
            sender_id: msg.sender_id,
            sender_username: msg.sender_username,
            sender_display_name: msg.sender_display_name,
            sender_role: msg.sender_role,
            text,
            created_at: msg.created_at,
            isMine: msg.sender_id === currentUser.id,
          });
        }
        decryptedMessages = decryptedList;
      }
    } catch {
      // ignore
    }
  }

  // Send message
  async function handleSendMessage(e?: Event) {
    if (e) e.preventDefault();
    if (
      !newMessageText.trim() ||
      !activeThread ||
      !activeThreadKey ||
      isSending
    )
      return;

    const textToSend = newMessageText.trim();
    newMessageText = '';
    isSending = true;

    try {
      const encrypted = await encryptMessage(textToSend, activeThreadKey);
      const res = await sendMessageApi(
        activeThread.id,
        encrypted.ciphertext,
        encrypted.iv,
        token
      );
      if (res.success) {
        decryptedMessages = [
          ...decryptedMessages,
          {
            id: res.id || `temp_${Date.now()}`,
            thread_id: activeThread.id,
            sender_id: currentUser.id,
            sender_username: currentUser.username,
            sender_display_name: currentUser.displayName,
            sender_role: currentUser.role,
            text: textToSend,
            created_at: new Date().toISOString(),
            isMine: true,
          },
        ];
      } else {
        alert('メッセージ送信に失敗しました');
      }
    } catch (err: any) {
      alert(`送信エラー: ${err.message}`);
    } finally {
      isSending = false;
    }
  }

  // Create new thread
  async function handleCreateThread() {
    if (!newThreadTitle.trim()) {
      createError = 'タイトルを入力してください';
      return;
    }

    createError = null;
    isSending = true;

    try {
      if (!identityKey) {
        identityKey = await initializeE2eeKeys(undefined, token);
      }
      if (!identityKey) {
        throw new Error('通信鍵の初期化に失敗しました');
      }

      // 1. Generate shared thread key
      const threadKeyObj = await generateThreadKey();

      // 2. Fetch initial members' public keys
      // For inquiry / admin_chat, fetch public keys of all admins
      let recipientUsers: Array<{ id: string; e2ee_public_key: string }> = [];

      if (newThreadType === 'inquiry' || newThreadType === 'admin_chat') {
        const adminsRes = await fetchPublicKeys(token, { role: 'admin' });
        if (adminsRes.success && adminsRes.users) {
          recipientUsers = adminsRes.users.filter(
            (u) => u.e2ee_public_key
          ) as any;
        }
      }

      // Add self (generate enveloped key for self)
      const membersToRegister: Array<{
        userId: string;
        encryptedThreadKey: string;
        ephemeralPublicKey: string;
        role: 'owner' | 'member';
      }> = [];

      // Encrypted thread key for self
      const myWrappedKey = await encryptThreadKeyForUser(
        threadKeyObj.raw,
        identityKey.publicKeyJwk
      );
      membersToRegister.push({
        userId: currentUser.id,
        encryptedThreadKey: myWrappedKey.encryptedThreadKey,
        ephemeralPublicKey: myWrappedKey.ephemeralPublicKey,
        role: 'owner',
      });

      // Encrypted thread key for other members (admins, etc.)
      for (const rec of recipientUsers) {
        if (rec.id === currentUser.id) continue;
        try {
          const pubJwk = JSON.parse(rec.e2ee_public_key);
          const wrapped = await encryptThreadKeyForUser(
            threadKeyObj.raw,
            pubJwk
          );
          membersToRegister.push({
            userId: rec.id,
            encryptedThreadKey: wrapped.encryptedThreadKey,
            ephemeralPublicKey: wrapped.ephemeralPublicKey,
            role: 'member',
          });
        } catch {
          // ignore invalid jwk
        }
      }

      // 3. Call thread creation API
      const res = await createThreadApi(
        {
          title: newThreadTitle.trim(),
          type: newThreadType,
          postId: initialPostId || undefined,
          members: membersToRegister,
        },
        token
      );

      if (res.success && res.id) {
        // Send initial message encrypted if provided
        if (firstMessageText.trim()) {
          const encrypted = await encryptMessage(
            firstMessageText.trim(),
            threadKeyObj.key
          );
          await sendMessageApi(
            res.id,
            encrypted.ciphertext,
            encrypted.iv,
            token
          );
        }

        isCreatingThread = false;
        firstMessageText = '';
        newThreadTitle = '';
        await loadThreads();

        // Open the newly created thread
        const createdThread = threads.find((t) => t.id === res.id);
        if (createdThread) {
          handleSelectThread(createdThread);
        }
      } else {
        createError = res.error || 'スレッド作成に失敗しました';
      }
    } catch (err: any) {
      createError = err.message || '通信エラーが発生しました';
    } finally {
      isSending = false;
    }
  }

  // Open invite modal
  async function handleOpenInviteModal() {
    if (!activeThread) return;
    inviteError = null;
    showInviteModal = true;

    try {
      const res = await fetchPublicKeys(token);
      if (res.success && res.users) {
        const memberIds = new Set(activeThreadMembers.map((m) => m.user_id));
        availableUsersToInvite = res.users.filter(
          (u) => !memberIds.has(u.id) && u.e2ee_public_key
        );
      }
    } catch {
      // ignore
    }
  }

  // Invite member (encrypt decrypted thread key with recipient's public key)
  async function handleInviteUser(
    targetUser: Pick<
      User,
      'id' | 'username' | 'displayName' | 'role' | 'e2ee_public_key'
    >
  ) {
    if (!activeThread || !activeThreadRawKey || !targetUser.e2ee_public_key)
      return;

    isInviting = true;
    inviteError = null;

    try {
      const pubJwk = JSON.parse(targetUser.e2ee_public_key);
      const wrapped = await encryptThreadKeyForUser(activeThreadRawKey, pubJwk);

      const res = await inviteMemberApi(
        activeThread.id,
        {
          userId: targetUser.id,
          encryptedThreadKey: wrapped.encryptedThreadKey,
          ephemeralPublicKey: wrapped.ephemeralPublicKey,
          role: targetUser.role === 'admin' ? 'member' : 'member',
        },
        token
      );

      if (res.success) {
        showInviteModal = false;
        // Refresh member list
        const detail = await fetchThreadDetail(activeThread.id, token);
        if (detail.members) activeThreadMembers = detail.members;
      } else {
        inviteError = res.error || '招待に失敗しました';
      }
    } catch (err: any) {
      inviteError = err.message || '招待処理中にエラーが発生しました';
    } finally {
      isInviting = false;
    }
  }

  function formatTime(dateStr: string): string {
    try {
      const d = new Date(dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`);
      return d.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }
</script>

<div
  role="presentation"
  style="z-index: {zIndex};"
  inert={!isTop}
  onclick={(e) => {
    if (e.target === e.currentTarget && isTop) onClose();
  }}
  class="fixed inset-0 flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs transition-opacity duration-200 sm:items-center sm:p-4 {isTop
    ? 'opacity-100'
    : 'opacity-80'}"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="messages-modal-title"
    use:focusTrap={{ onEscape: onClose }}
    use:swipeDown={onClose}
    class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl transition-all duration-200 sm:h-[88vh] sm:max-h-[720px] sm:rounded-2xl sm:border dark:border-slate-800 dark:bg-slate-900 {isTop
      ? 'scale-100 opacity-100'
      : 'pointer-events-none scale-[0.97] opacity-85'}"
  >
    <!-- Mobile drag handle -->
    <div
      class="mx-auto my-2.5 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
    ></div>

    <!-- Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/80"
    >
      <div class="flex items-center gap-2">
        <div
          class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
        >
          <Lock class="h-4 w-4" />
        </div>
        <div>
          <h2
            id="messages-modal-title"
            class="flex items-center gap-1.5 text-sm font-black text-slate-900 sm:text-base dark:text-slate-100"
          >
            <span>連絡・メッセージ</span>
            <span
              class="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
            >
              <Check class="h-2.5 w-2.5" />
              <span>保護された通信</span>
            </span>
          </h2>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">
            {identityKey?.isPrfDerived
              ? '端末認証により保護されています'
              : '端末認証により保護されています'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onclick={onClose}
        aria-label="閉じる"
        class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <!-- Content body (list or detail) -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 1. New thread creation view -->
      {#if isCreatingThread}
        <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={() => {
                isCreatingThread = false;
              }}
              class="cursor-pointer rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <ArrowLeft class="h-4 w-4" />
            </button>
            <h3 class="text-sm font-bold text-slate-800 dark:text-slate-200">
              新しいセキュア連絡を作成
            </h3>
          </div>

          {#if createError}
            <div
              class="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
            >
              <AlertCircle class="h-4 w-4 shrink-0" />
              <span>{createError}</span>
            </div>
          {/if}

          <!-- Type selection -->
          <div class="flex flex-col gap-1.5">
            <div class="text-xs font-bold text-slate-700 dark:text-slate-300">
              連絡の種別
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onclick={() => {
                  newThreadType = 'inquiry';
                }}
                class={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition ${
                  newThreadType === 'inquiry'
                    ? 'border-blue-500 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <div class="flex items-center gap-1.5 text-xs font-bold">
                  <HelpCircle
                    class="h-4 w-4 text-blue-600 dark:text-blue-400"
                  />
                  <span>管理者への相談・問い合わせ</span>
                </div>
                <p
                  class="text-[11px] leading-tight text-slate-500 dark:text-slate-400"
                >
                  すべての管理者が参加でき、個別にサポートや確認を受けられます。
                </p>
              </button>

              {#if currentUser.role === 'admin'}
                <button
                  type="button"
                  onclick={() => {
                    newThreadType = 'admin_chat';
                  }}
                  class={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition ${
                    newThreadType === 'admin_chat'
                      ? 'border-amber-500 bg-amber-50/80 text-amber-900 ring-2 ring-amber-500/20 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <div class="flex items-center gap-1.5 text-xs font-bold">
                    <Shield
                      class="h-4 w-4 text-amber-600 dark:text-amber-400"
                    />
                    <span>管理者同士の打ち合わせ</span>
                  </div>
                  <p
                    class="text-[11px] leading-tight text-slate-500 dark:text-slate-400"
                  >
                    管理者のみが参加・閲覧できる非公開スレッドです。
                  </p>
                </button>
              {/if}
            </div>
          </div>

          <!-- Title -->
          <div class="flex flex-col gap-1">
            <label
              for="thread-title"
              class="text-xs font-bold text-slate-700 dark:text-slate-300"
              >件名・タイトル <span class="text-rose-600">*</span></label
            >
            <input
              id="thread-title"
              type="text"
              bind:value={newThreadTitle}
              placeholder="例: 給水所の開設時間について、物資の受取相談"
              class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <!-- Initial message -->
          <div class="flex flex-col gap-1">
            <label
              for="first-msg"
              class="text-xs font-bold text-slate-700 dark:text-slate-300"
              >最初のメッセージ（任意）</label
            >
            <textarea
              id="first-msg"
              bind:value={firstMessageText}
              rows="4"
              placeholder="相談内容や要件を具体的に入力してください"
              class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            ></textarea>
          </div>

          <div
            class="mt-auto flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
          >
            <button
              type="button"
              onclick={() => {
                isCreatingThread = false;
              }}
              class="cursor-pointer rounded-lg px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              キャンセル
            </button>
            <button
              type="button"
              onclick={handleCreateThread}
              disabled={isSending || !newThreadTitle.trim()}
              class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
            >
              <Send class="h-3.5 w-3.5" />
              <span>{isSending ? '作成中...' : '連絡を開始'}</span>
            </button>
          </div>
        </div>

        <!-- 2. Thread detail & chat view -->
      {:else if activeThread}
        <div class="flex h-full flex-1 flex-col overflow-hidden">
          <!-- Thread header -->
          <div
            class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/80"
          >
            <div class="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onclick={() => {
                  activeThread = null;
                }}
                class="shrink-0 cursor-pointer rounded-lg p-1 text-slate-500 transition hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ArrowLeft class="h-4 w-4" />
              </button>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <h3
                    class="truncate text-xs font-bold text-slate-900 sm:text-sm dark:text-slate-100"
                  >
                    {activeThread.title}
                  </h3>
                  {#if activeThread.type === 'inquiry'}
                    <span
                      class="py-0.2 shrink-0 rounded bg-blue-100 px-1.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                      >問い合わせ</span
                    >
                  {:else if activeThread.type === 'admin_chat'}
                    <span
                      class="py-0.2 shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      >管理者会議</span
                    >
                  {/if}
                </div>
                <div
                  class="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500"
                >
                  <span>参加メンバー ({activeThreadMembers.length}名)</span>
                  <span>•</span>
                  <span>保護された通信</span>
                </div>
              </div>
            </div>

            <!-- Member invite button -->
            <button
              type="button"
              onclick={handleOpenInviteModal}
              class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-bold text-blue-600 transition hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40"
              title="このスレッドに管理者やメンバーを招待"
            >
              <UserPlus class="h-3.5 w-3.5" />
              <span class="hidden sm:inline">メンバーを招待</span>
            </button>
          </div>

          <!-- Message list -->
          <div
            class="flex flex-1 flex-col gap-3 overflow-y-auto bg-slate-50/30 p-4 dark:bg-slate-950/40"
          >
            {#if isLoadingDetail}
              <div
                class="flex flex-col items-center gap-2 py-12 text-center text-xs text-slate-400 dark:text-slate-500"
              >
                <div
                  class="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                ></div>
                <span>メッセージを読み込み中...</span>
              </div>
            {:else if decryptedMessages.length === 0}
              <div
                class="flex flex-col items-center gap-1.5 py-12 text-center text-xs text-slate-400 dark:text-slate-500"
              >
                <MessageSquare
                  class="h-6 w-6 text-slate-300 dark:text-slate-600"
                />
                <span
                  >まだメッセージがありません。最初のメッセージを送信してください。</span
                >
              </div>
            {:else}
              {#each decryptedMessages as msg (msg.id)}
                <div
                  class={`flex flex-col ${msg.isMine ? 'items-end' : 'items-start'}`}
                >
                  <!-- Sender name & timestamp -->
                  <div
                    class="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-500 dark:text-slate-400"
                  >
                    <span class="font-bold text-slate-700 dark:text-slate-300"
                      >{msg.sender_display_name || msg.sender_username}</span
                    >
                    {#if msg.sender_role === 'admin'}
                      <span
                        class="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        >管理者</span
                      >
                    {/if}
                    <span class="text-[10px] text-slate-400 dark:text-slate-500"
                      >{formatTime(msg.created_at)}</span
                    >
                  </div>

                  <!-- Message bubble -->
                  <div
                    class={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap shadow-2xs sm:max-w-md ${
                      msg.isMine
                        ? 'rounded-tr-xs bg-blue-600 text-white'
                        : 'rounded-tl-xs border border-slate-200/80 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <!-- Message input bar -->
          <form
            onsubmit={handleSendMessage}
            class="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900"
          >
            <input
              type="text"
              bind:value={newMessageText}
              placeholder="メッセージを入力..."
              class="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={isSending || !newMessageText.trim() || !activeThreadKey}
              class="cursor-pointer rounded-xl bg-blue-600 p-2.5 text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
            >
              <Send class="h-4 w-4" />
            </button>
          </form>
        </div>

        <!-- 3. Thread list view -->
      {:else}
        <div class="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold text-slate-700 dark:text-slate-300">
              参加中の連絡スレッド ({threads.length}件)
            </div>
            <button
              type="button"
              onclick={() => {
                isCreatingThread = true;
              }}
              class="flex cursor-pointer items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700"
            >
              <Plus class="h-3.5 w-3.5" />
              <span>＋ 新しい連絡・問い合わせ</span>
            </button>
          </div>

          {#if isLoadingThreads}
            <div
              class="py-12 text-center text-xs text-slate-400 dark:text-slate-500"
            >
              スレッドを読み込み中...
            </div>
          {:else if threads.length === 0}
            <div
              class="rounded-2xl border border-slate-200 bg-slate-50 p-8 py-16 text-center dark:border-slate-800 dark:bg-slate-800/40"
            >
              <MessageSquare
                class="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600"
              />
              <div
                class="mb-1 text-sm font-bold text-slate-700 dark:text-slate-300"
              >
                連絡スレッドがありません
              </div>
              <p class="mb-4 text-xs text-slate-500 dark:text-slate-400">
                「＋
                新しい連絡・問い合わせ」から管理者への相談や利用者同士の連絡を開始できます。<br
                />
                メッセージは端末認証（Passkey）により安全に保護されます。
              </p>
              <button
                type="button"
                onclick={() => {
                  isCreatingThread = true;
                }}
                class="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700"
              >
                ＋ 最初の連絡を始める
              </button>
            </div>
          {:else}
            <div class="flex flex-col gap-2">
              {#each threads as t (t.id)}
                <button
                  type="button"
                  onclick={() => handleSelectThread(t)}
                  class="group flex cursor-pointer flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-2xs transition hover:border-blue-400 hover:bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/70 dark:hover:border-blue-500 dark:hover:bg-slate-800"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div
                      class="flex items-center gap-1.5 truncate text-xs font-bold text-slate-900 transition group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400"
                    >
                      <span>{t.title}</span>
                    </div>

                    <div class="flex shrink-0 items-center gap-1">
                      {#if t.type === 'inquiry'}
                        <span
                          class="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                          >問い合わせ</span
                        >
                      {:else if t.type === 'admin_chat'}
                        <span
                          class="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                          >管理者会議</span
                        >
                      {:else}
                        <span
                          class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                          >連絡</span
                        >
                      {/if}
                    </div>
                  </div>

                  <div
                    class="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500"
                  >
                    <div class="flex items-center gap-2">
                      <span>作成: {t.creator_name || 'ユーザー'}</span>
                      <span>•</span>
                      <span>メンバー: {t.member_count || 1}名</span>
                    </div>
                    {#if t.last_message_at}
                      <span>最終更新: {formatTime(t.last_message_at)}</span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Member invite submodal -->
{#if showInviteModal}
  <div
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) showInviteModal = false;
    }}
    class="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs sm:items-center sm:p-4"
  >
    <div
      class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex w-full max-w-sm flex-col gap-3 rounded-t-2xl border-t border-slate-200 bg-white p-4 shadow-xl duration-150 sm:rounded-2xl sm:border dark:border-slate-800 dark:bg-slate-900"
    >
      <div
        class="mx-auto my-1 h-1 w-10 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
      ></div>
      <div class="flex items-center justify-between">
        <h4
          class="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"
        >
          <UserPlus class="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span>スレッドにメンバーを招待</span>
        </h4>
        <button
          type="button"
          onclick={() => {
            showInviteModal = false;
          }}
          class="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <p class="text-[11px] leading-tight text-slate-500 dark:text-slate-400">
        招待されたメンバーは、このスレッドの安全な閲覧・発言が可能になります。
      </p>

      {#if inviteError}
        <div
          class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
        >
          {inviteError}
        </div>
      {/if}

      <div
        class="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
      >
        {#if availableUsersToInvite.length === 0}
          <div
            class="p-4 text-center text-xs text-slate-400 dark:text-slate-500"
          >
            招待可能なユーザーがいません
          </div>
        {:else}
          {#each availableUsersToInvite as u (u.id)}
            <div
              class="flex items-center justify-between gap-2 p-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <div class="min-w-0">
                <div
                  class="flex items-center gap-1 truncate text-xs font-bold text-slate-800 dark:text-slate-200"
                >
                  <span>{u.displayName}</span>
                  {#if u.role === 'admin'}
                    <span
                      class="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      >管理者</span
                    >
                  {/if}
                </div>
                <div class="text-[10px] text-slate-400 dark:text-slate-500">
                  @{u.username}
                </div>
              </div>

              <button
                type="button"
                onclick={() => handleInviteUser(u)}
                disabled={isInviting}
                class="shrink-0 cursor-pointer rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {isInviting ? '招待中...' : '招待する'}
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
