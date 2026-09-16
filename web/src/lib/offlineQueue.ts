// web/src/lib/offlineQueue.ts: Offline Outbox Queue for Disaster Resilience
import { createPost, updatePostStatus } from './api';

export type CreatePostPayload = Parameters<typeof createPost>[0];

export interface QueuedPost {
  id: string;
  type: 'create_post';
  data: CreatePostPayload;
  createdAt: string;
}

export interface QueuedStatusUpdate {
  id: string;
  type: 'update_status';
  data: {
    postId: string;
    status: string;
    statusLabel: string;
    note?: string;
  };
  createdAt: string;
}

export type QueuedItem = QueuedPost | QueuedStatusUpdate;

const STORAGE_KEY = 'tossa_offline_outbox';

export function getOfflineQueue(): QueuedItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(queue: QueuedItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore storage quota errors
  }
}

export function enqueuePost(postData: QueuedPost['data']): QueuedPost {
  const queue = getOfflineQueue();
  const item: QueuedPost = {
    id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'create_post',
    data: postData,
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
    id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'update_status',
    data: updateData,
    createdAt: new Date().toISOString(),
  };
  queue.push(item);
  saveOfflineQueue(queue);
  return item;
}

export function removeQueueItem(id: string): void {
  const queue = getOfflineQueue().filter((item) => item.id !== id);
  saveOfflineQueue(queue);
}

export function getPendingQueueCount(): number {
  return getOfflineQueue().length;
}

/**
 * Replays all queued items when connectivity is restored.
 */
export async function flushOfflineQueue(
  token: string | null
): Promise<{ succeeded: number; failed: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  const remaining: QueuedItem[] = [];

  for (const item of queue) {
    try {
      if (item.type === 'create_post') {
        const res = await createPost(item.data, token);
        if (res.success) {
          succeeded++;
        } else {
          failed++;
          remaining.push(item);
        }
      } else if (item.type === 'update_status') {
        const res = await updatePostStatus(
          item.data.postId,
          item.data.status,
          item.data.statusLabel,
          item.data.note
        );
        if (res.success) {
          succeeded++;
        } else {
          failed++;
          remaining.push(item);
        }
      }
    } catch {
      failed++;
      remaining.push(item);
    }
  }

  saveOfflineQueue(remaining);
  return { succeeded, failed };
}
