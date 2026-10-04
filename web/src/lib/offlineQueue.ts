// web/src/lib/offlineQueue.ts: Offline Outbox Queue for Disaster Resilience
import { createPost, updatePostStatus } from './api';
import { recordMyPost } from './myPosts';

type CreatePostPayload = Parameters<typeof createPost>[0];

export interface QueuedPost {
  id: string;
  type: 'create_post';
  data: CreatePostPayload;
  createdAt: string;
  lastError?: string;
  conflict?: boolean;
}

export interface QueuedStatusUpdate {
  id: string;
  type: 'update_status';
  data: {
    requestId?: string;
    postId: string;
    status: string;
    statusLabel: string;
    note?: string;
    expectedUpdatedAt?: string;
    observedAt?: string;
  };
  createdAt: string;
  lastError?: string;
  conflict?: boolean;
}

export type QueuedItem = QueuedPost | QueuedStatusUpdate;

const STORAGE_KEY = 'tossa_offline_outbox';

export function getOfflineQueue(): QueuedItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    if (
      !Array.isArray(queue) ||
      queue.some(
        (item) =>
          !item?.id || !['create_post', 'update_status'].includes(item.type)
      )
    )
      throw new Error('Invalid outbox');
    return queue;
  } catch {
    throw new Error(
      '未送信データを読み取れません。ブラウザの保存設定と空き容量を確認してください。'
    );
  }
}

export function removeQueuedItem(id: string): void {
  const queue = getOfflineQueue().filter((item) => item.id !== id);
  saveOfflineQueue(queue);
}

export function clearOfflineQueue(): void {
  saveOfflineQueue([]);
}

function saveOfflineQueue(queue: QueuedItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    throw new Error(
      '端末に保存できませんでした。空き容量を確保してから再試行してください。入力内容はこの画面に残っています。'
    );
  }
}

export function enqueuePost(postData: QueuedPost['data']): QueuedPost {
  const queue = getOfflineQueue();
  const item: QueuedPost = {
    id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'create_post',
    data: { ...postData, requestId: postData.requestId || crypto.randomUUID() },
    createdAt: new Date().toISOString(),
  };
  queue.push(item);
  saveOfflineQueue(queue);
  return item;
}

export function enqueueStatusUpdate(
  updateData: QueuedStatusUpdate['data']
): QueuedStatusUpdate {
  const queue = getOfflineQueue();
  const item: QueuedStatusUpdate = {
    id: updateData.requestId || crypto.randomUUID(),
    type: 'update_status',
    data: {
      ...updateData,
      observedAt: updateData.observedAt || new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };
  queue.push(item);
  saveOfflineQueue(queue);
  return item;
}

export function getPendingQueueCount(): number {
  return getOfflineQueue().length;
}

/**
 * Replays all queued items when connectivity is restored.
 */
let activeFlush: Promise<{ succeeded: number; failed: number }> | null = null;

export function flushOfflineQueue(
  token: string | null
): Promise<{ succeeded: number; failed: number }> {
  if (activeFlush) return activeFlush;
  const run = () => replayQueue(token);
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  activeFlush = (
    locks ? locks.request('tossa-outbox-sync', run) : run()
  ).finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

async function replayQueue(
  token: string | null
): Promise<{ succeeded: number; failed: number }> {
  const queue = getOfflineQueue();
  let succeeded = 0;
  let failed = 0;
  for (const item of queue) {
    // A user can remove an item while earlier requests are in flight.
    if (!getOfflineQueue().some((current) => current.id === item.id)) continue;
    if (item.conflict) {
      failed++;
      continue;
    }
    try {
      const res =
        item.type === 'create_post'
          ? await createPost(
              { ...item.data, requestId: item.data.requestId || item.id },
              token
            )
          : await updatePostStatus(
              item.data.postId,
              item.data.status,
              item.data.statusLabel,
              item.data.note,
              {
                requestId: item.id,
                expectedUpdatedAt: item.data.expectedUpdatedAt,
                observedAt: item.data.observedAt || item.createdAt,
              }
            );
      if (res.success) {
        if (
          item.type === 'create_post' &&
          'id' in res &&
          typeof res.id === 'string'
        )
          recordMyPost(res.id);
        // Remove only the acknowledged item, preserving new items added during sync.
        removeQueuedItem(item.id);
        succeeded++;
      } else {
        failed++;
        const current = getOfflineQueue();
        saveOfflineQueue(
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  lastError: res.error || '送信に失敗しました',
                  conflict: 'conflict' in res && !!res.conflict,
                }
              : entry
          )
        );
      }
    } catch (error) {
      failed++;
      const current = getOfflineQueue();
      saveOfflineQueue(
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                lastError:
                  error instanceof Error ? error.message : '通信エラー',
              }
            : entry
        )
      );
    }
  }
  return { succeeded, failed };
}
