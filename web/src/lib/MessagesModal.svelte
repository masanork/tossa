<!-- web/src/lib/MessagesModal.svelte: E2EE Secure Messaging Panel -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
    onClose: () => void;
  }

  let { currentUser, token, initialPostId, initialPostTitle, onClose }: Props =
    $props();

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
        throw new Error('E2EE暗号化鍵の取得に失敗しました');
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
      createError = err.message || '暗号化または通信エラーが発生しました';
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
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
  class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs"
>
  <div
    class="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-3xl h-[92vh] sm:h-[88vh] sm:max-h-[720px] shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-150 flex flex-col"
  >
    <!-- Mobile drag handle -->
    <div
      class="w-10 h-1 bg-slate-300 rounded-full mx-auto my-2 sm:hidden shrink-0"
    ></div>

    <!-- Header -->
    <div
      class="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0"
    >
      <div class="flex items-center gap-2">
        <div
          class="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center"
        >
          <Lock class="w-4 h-4" />
        </div>
        <div>
          <h2
            class="text-sm sm:text-base font-black text-slate-900 flex items-center gap-1.5"
          >
            <span>セキュア連絡（E2EE）</span>
            <span
              class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1"
            >
              <Check class="w-2.5 h-2.5" />
              <span>Passkey PRF 暗号化</span>
            </span>
          </h2>
          <p class="text-[10px] text-slate-500">
            {identityKey?.isPrfDerived
              ? '生体認証（PRF）によるゼロ知識暗号化で通信中'
              : '端末内暗号鍵により保護されています'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
      >
        <X class="w-5 h-5" />
      </button>
    </div>

    <!-- Content body (list or detail) -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 1. New thread creation view -->
      {#if isCreatingThread}
        <div class="flex-1 p-5 overflow-y-auto flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={() => {
                isCreatingThread = false;
              }}
              class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition cursor-pointer"
            >
              <ArrowLeft class="w-4 h-4" />
            </button>
            <h3 class="text-sm font-bold text-slate-800">
              新しいセキュア連絡を作成
            </h3>
          </div>

          {#if createError}
            <div
              class="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-1.5"
            >
              <AlertCircle class="w-4 h-4 shrink-0" />
              <span>{createError}</span>
            </div>
          {/if}

          <!-- Type selection -->
          <div class="flex flex-col gap-1.5">
            <div class="text-xs font-bold text-slate-700">連絡の種別</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onclick={() => {
                  newThreadType = 'inquiry';
                }}
                class={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col gap-1 ${
                  newThreadType === 'inquiry'
                    ? 'bg-blue-50/80 border-blue-500 text-blue-900 ring-2 ring-blue-500/20'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div class="flex items-center gap-1.5 font-bold text-xs">
                  <HelpCircle class="w-4 h-4 text-blue-600" />
                  <span>管理者への相談・問い合わせ</span>
                </div>
                <p class="text-[11px] text-slate-500 leading-tight">
                  すべての管理者が参加でき、個別にサポートや確認を受けられます。
                </p>
              </button>

              {#if currentUser.role === 'admin'}
                <button
                  type="button"
                  onclick={() => {
                    newThreadType = 'admin_chat';
                  }}
                  class={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col gap-1 ${
                    newThreadType === 'admin_chat'
                      ? 'bg-amber-50/80 border-amber-500 text-amber-900 ring-2 ring-amber-500/20'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div class="flex items-center gap-1.5 font-bold text-xs">
                    <Shield class="w-4 h-4 text-amber-600" />
                    <span>管理者同士の打ち合わせ</span>
                  </div>
                  <p class="text-[11px] text-slate-500 leading-tight">
                    管理者のみが参加・閲覧できる非公開スレッドです。
                  </p>
                </button>
              {/if}
            </div>
          </div>

          <!-- Title -->
          <div class="flex flex-col gap-1">
            <label for="thread-title" class="text-xs font-bold text-slate-700"
              >件名・タイトル <span class="text-rose-600">*</span></label
            >
            <input
              id="thread-title"
              type="text"
              bind:value={newThreadTitle}
              placeholder="例: 給水所の開設時間について、物資の受取相談"
              class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <!-- Initial message -->
          <div class="flex flex-col gap-1">
            <label for="first-msg" class="text-xs font-bold text-slate-700"
              >最初のメッセージ（任意）</label
            >
            <textarea
              id="first-msg"
              bind:value={firstMessageText}
              rows="4"
              placeholder="相談内容や要件を具体的に入力してください（E2EEで暗号化されて送信されます）"
              class="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            ></textarea>
          </div>

          <div
            class="mt-auto pt-3 flex items-center justify-end gap-2 border-t border-slate-100"
          >
            <button
              type="button"
              onclick={() => {
                isCreatingThread = false;
              }}
              class="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
            >
              キャンセル
            </button>
            <button
              type="button"
              onclick={handleCreateThread}
              disabled={isSending || !newThreadTitle.trim()}
              class="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <Lock class="w-3.5 h-3.5" />
              <span
                >{isSending
                  ? '暗号化して作成中...'
                  : '暗号化して連絡を開始'}</span
              >
            </button>
          </div>
        </div>

        <!-- 2. Thread detail & chat view -->
      {:else if activeThread}
        <div class="flex-1 flex flex-col h-full overflow-hidden">
          <!-- Thread header -->
          <div
            class="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 shrink-0"
          >
            <div class="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onclick={() => {
                  activeThread = null;
                }}
                class="p-1 rounded-lg text-slate-500 hover:bg-slate-200 transition cursor-pointer shrink-0"
              >
                <ArrowLeft class="w-4 h-4" />
              </button>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <h3
                    class="text-xs sm:text-sm font-bold text-slate-900 truncate"
                  >
                    {activeThread.title}
                  </h3>
                  {#if activeThread.type === 'inquiry'}
                    <span
                      class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 text-blue-800 shrink-0"
                      >問い合わせ</span
                    >
                  {:else if activeThread.type === 'admin_chat'}
                    <span
                      class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 shrink-0"
                      >管理者会議</span
                    >
                  {/if}
                </div>
                <div class="text-[10px] text-slate-400 flex items-center gap-2">
                  <span>参加メンバー ({activeThreadMembers.length}名)</span>
                  <span>•</span>
                  <span>E2EE 暗号化保護</span>
                </div>
              </div>
            </div>

            <!-- Member invite button -->
            <button
              type="button"
              onclick={handleOpenInviteModal}
              class="px-2.5 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg transition cursor-pointer flex items-center gap-1 shrink-0"
              title="このスレッドに管理者やメンバーを招待"
            >
              <UserPlus class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">メンバーを招待</span>
            </button>
          </div>

          <!-- Message list -->
          <div
            class="flex-1 p-4 overflow-y-auto flex flex-col gap-3 bg-slate-50/30"
          >
            {#if isLoadingDetail}
              <div
                class="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2"
              >
                <div
                  class="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"
                ></div>
                <span>暗号化メッセージを復号中...</span>
              </div>
            {:else if decryptedMessages.length === 0}
              <div
                class="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-1.5"
              >
                <Lock class="w-6 h-6 text-slate-300" />
                <span
                  >まだメッセージがありません。最初のメッセージを暗号化送信してください。</span
                >
              </div>
            {:else}
              {#each decryptedMessages as msg (msg.id)}
                <div
                  class={`flex flex-col ${msg.isMine ? 'items-end' : 'items-start'}`}
                >
                  <!-- Sender name & timestamp -->
                  <div
                    class="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-slate-500"
                  >
                    <span class="font-bold text-slate-700"
                      >{msg.sender_display_name || msg.sender_username}</span
                    >
                    {#if msg.sender_role === 'admin'}
                      <span
                        class="text-[9px] px-1 rounded bg-amber-100 text-amber-800 font-semibold"
                        >管理者</span
                      >
                    {/if}
                    <span class="text-[10px] text-slate-400"
                      >{formatTime(msg.created_at)}</span
                    >
                  </div>

                  <!-- Message bubble -->
                  <div
                    class={`max-w-[80%] sm:max-w-md px-3.5 py-2 rounded-2xl text-xs leading-relaxed break-words shadow-2xs whitespace-pre-wrap ${
                      msg.isMine
                        ? 'bg-blue-600 text-white rounded-tr-xs'
                        : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-xs'
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
            class="p-2.5 border-t border-slate-200 bg-white flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              bind:value={newMessageText}
              placeholder="メッセージを入力（E2EE暗号化して送信）..."
              class="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button
              type="submit"
              disabled={isSending || !newMessageText.trim() || !activeThreadKey}
              class="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <Send class="w-4 h-4" />
            </button>
          </form>
        </div>

        <!-- 3. Thread list view -->
      {:else}
        <div class="flex-1 p-4 overflow-y-auto flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold text-slate-700">
              参加中の連絡スレッド ({threads.length}件)
            </div>
            <button
              type="button"
              onclick={() => {
                isCreatingThread = true;
              }}
              class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-xs flex items-center gap-1 cursor-pointer"
            >
              <Plus class="w-3.5 h-3.5" />
              <span>＋ 新しい連絡・問い合わせ</span>
            </button>
          </div>

          {#if isLoadingThreads}
            <div class="py-12 text-center text-slate-400 text-xs">
              スレッドを読み込み中...
            </div>
          {:else if threads.length === 0}
            <div
              class="py-16 text-center bg-slate-50 rounded-2xl border border-slate-200 p-8"
            >
              <MessageSquare class="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <div class="text-sm font-bold text-slate-700 mb-1">
                連絡スレッドがありません
              </div>
              <p class="text-xs text-slate-500 mb-4">
                「＋
                新しい連絡・問い合わせ」から管理者への相談や利用者同士の連絡を開始できます。<br
                />
                メッセージはすべて端末の生体認証（Passkey PRF）で暗号化されます。
              </p>
              <button
                type="button"
                onclick={() => {
                  isCreatingThread = true;
                }}
                class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
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
                  class="p-3.5 rounded-xl border border-slate-200 hover:border-blue-400 bg-white hover:bg-slate-50/80 transition text-left cursor-pointer flex flex-col gap-1.5 shadow-2xs group"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div
                      class="flex items-center gap-1.5 font-bold text-xs text-slate-900 group-hover:text-blue-600 transition truncate"
                    >
                      <span>{t.title}</span>
                    </div>

                    <div class="flex items-center gap-1 shrink-0">
                      {#if t.type === 'inquiry'}
                        <span
                          class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200"
                          >問い合わせ</span
                        >
                      {:else if t.type === 'admin_chat'}
                        <span
                          class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200"
                          >管理者会議</span
                        >
                      {:else}
                        <span
                          class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600"
                          >連絡</span
                        >
                      {/if}
                    </div>
                  </div>

                  <div
                    class="flex items-center justify-between text-[11px] text-slate-400"
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
    class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs"
  >
    <div
      class="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm shadow-xl p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-150"
    >
      <div
        class="w-10 h-1 bg-slate-300 rounded-full mx-auto my-1 sm:hidden shrink-0"
      ></div>
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-bold text-slate-900 flex items-center gap-1.5">
          <UserPlus class="w-4 h-4 text-blue-600" />
          <span>スレッドにメンバーを招待</span>
        </h4>
        <button
          type="button"
          onclick={() => {
            showInviteModal = false;
          }}
          class="text-slate-400 hover:text-slate-600 p-1"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <p class="text-[11px] text-slate-500 leading-tight">
        招待されたメンバーは、あなたの手元にある暗号鍵が相手の公開鍵で安全に共有され、このスレッドの閲覧・発言が可能になります。
      </p>

      {#if inviteError}
        <div
          class="p-2 bg-rose-50 border border-rose-200 text-rose-700 text-[11px] rounded-lg"
        >
          {inviteError}
        </div>
      {/if}

      <div
        class="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl"
      >
        {#if availableUsersToInvite.length === 0}
          <div class="p-4 text-center text-xs text-slate-400">
            招待可能なユーザーがいません
          </div>
        {:else}
          {#each availableUsersToInvite as u (u.id)}
            <div
              class="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50"
            >
              <div class="min-w-0">
                <div
                  class="text-xs font-bold text-slate-800 flex items-center gap-1 truncate"
                >
                  <span>{u.displayName}</span>
                  {#if u.role === 'admin'}
                    <span
                      class="text-[9px] px-1 bg-amber-100 text-amber-800 rounded font-semibold"
                      >管理者</span
                    >
                  {/if}
                </div>
                <div class="text-[10px] text-slate-400">@{u.username}</div>
              </div>

              <button
                type="button"
                onclick={() => handleInviteUser(u)}
                disabled={isInviting}
                class="px-2.5 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition cursor-pointer disabled:opacity-50 shrink-0"
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
