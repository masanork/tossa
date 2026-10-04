// web/src/lib/offlineQueue.ts: IndexedDB-backed offline outbox
import { createPost, updatePostStatus } from './api';
import { recordMyPost } from './myPosts';
import { assertOutboxStorageCompatible } from './outboxCompatibility';

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

export class OfflineQueueStorageError extends Error {
  constructor(readonly reason: 'quota' | 'unavailable') {
    super(
      reason === 'quota'
        ? '端末の保存容量が不足しています。添付画像は容量を多く使います。既存の未送信データは保持されています。空き容量を確保し、この画面の入力を残したまま再試行してください。'
        : '端末に保存できません。ブラウザの保存設定と空き容量を確認してください。既存の未送信データは保持されており、入力内容はこの画面に残っています。'
    );
    this.name = 'OfflineQueueStorageError';
  }
}

export class OfflineQueueCorruptError extends Error {
  constructor() {
    super(
      '未送信データを読み取れません。保存内容は変更していません。まず保存データを書き出してから復旧してください。'
    );
    this.name = 'OfflineQueueCorruptError';
  }
}

export class OfflineQueueLegacyMutationError extends Error {
  constructor() {
    super(
      '別の古い画面が未送信データを変更しました。すべてのTossa画面を閉じてから再起動し、書き出したデータを確認して復旧してください。送信と変更は一時停止しています。'
    );
    this.name = 'OfflineQueueLegacyMutationError';
  }
}

export function isOfflineQueueStorageError(
  error: unknown
): error is OfflineQueueStorageError {
  return error instanceof OfflineQueueStorageError;
}

const LEGACY_STORAGE_KEY = 'tossa_offline_outbox';
const DB_NAME = 'tossa-offline-outbox';
const DB_VERSION = 1;
const ITEMS_STORE = 'items';
const META_STORE = 'meta';
const TOMBSTONES_STORE = 'tombstones';
const MIGRATION_META_KEY = 'legacy-migration';
export const OFFLINE_QUEUE_CHANGE_EVENT = 'offline-queue-change';
const BROADCAST_CHANNEL_NAME = 'tossa-offline-outbox';

interface MigrationMeta {
  key: typeof MIGRATION_META_KEY;
  /** Non-null only until the captured legacy value has been removed. */
  sourceRaw: string | null;
  sourceIds: string[];
}

interface Tombstone {
  id: string;
  deletedAt: string;
}

type QueueBackend = 'idb' | null;
let backend: QueueBackend = null;
let dbPromise: Promise<IDBDatabase> | null = null;
let activeFlush: Promise<{ succeeded: number; failed: number }> | null = null;

const queueChannel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    : null;
if (queueChannel && typeof window !== 'undefined') {
  queueChannel.addEventListener('message', (event) => {
    if (event.data?.type === 'changed')
      window.dispatchEvent(new Event(OFFLINE_QUEUE_CHANGE_EVENT));
  });
}

function notifyQueueChanged(): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(OFFLINE_QUEUE_CHANGE_EVENT));
  queueChannel?.postMessage({ type: 'changed' });
}

function isValidQueuedItem(item: any): item is QueuedItem {
  if (
    !item ||
    typeof item.id !== 'string' ||
    !item.id ||
    typeof item.createdAt !== 'string' ||
    !item.data ||
    typeof item.data !== 'object'
  )
    return false;
  if (item.type === 'create_post') {
    if (typeof item.data.title !== 'string') return false;
    return ['area', 'currentStatus', 'statusLabel'].every(
      (key) =>
        item.data[key] === undefined || typeof item.data[key] === 'string'
    );
  }
  if (item.type === 'update_status') {
    return ['postId', 'status', 'statusLabel'].every(
      (key) => typeof item.data[key] === 'string'
    );
  }
  return false;
}

function readLegacyRaw(): string | null {
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    throw new OfflineQueueStorageError('unavailable');
  }
}

/** Returns the untouched serialized outbox so corrupt data can be exported. */
export function getRawOfflineQueue(): string | null {
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Export the untouched legacy bytes, or a JSON snapshot of raw IDB records. */
export async function getOfflineQueueExportRaw(): Promise<string | null> {
  const legacyRaw = getRawOfflineQueue();
  if (legacyRaw !== null) return legacyRaw;
  try {
    await assertOutboxStorageCompatible();
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, 'readonly');
      const request = tx.objectStore(ITEMS_STORE).getAll();
      request.onsuccess = () => resolve(JSON.stringify(request.result));
      request.onerror = () => reject(asStorageError(request.error));
    });
  } catch {
    return null;
  }
}

function parseLegacyQueue(raw: string | null): QueuedItem[] {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    throw new OfflineQueueCorruptError();
  }
  if (!Array.isArray(parsed) || parsed.some((item) => !isValidQueuedItem(item)))
    throw new OfflineQueueCorruptError();
  return parsed;
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new OfflineQueueStorageError('unavailable'));

  dbPromise = new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(asStorageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEMS_STORE))
        db.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META_STORE))
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(TOMBSTONES_STORE))
        db.createObjectStore(TOMBSTONES_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(asStorageError(request.error));
    request.onblocked = () =>
      reject(new OfflineQueueStorageError('unavailable'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function isQuotaFailure(error: unknown): boolean {
  const candidate = error as { name?: string; code?: number } | null;
  return (
    candidate?.name === 'QuotaExceededError' ||
    candidate?.code === 22 ||
    candidate?.code === 1014
  );
}

function asStorageError(error: unknown): OfflineQueueStorageError {
  return new OfflineQueueStorageError(
    isQuotaFailure(error) ? 'quota' : 'unavailable'
  );
}

function updateMigrationMeta(
  db: IDBDatabase,
  update: (meta: MigrationMeta) => MigrationMeta
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    const request = store.get(MIGRATION_META_KEY);
    let failure: unknown;
    request.onsuccess = () => {
      const current = request.result as MigrationMeta | undefined;
      if (!current) {
        failure = new OfflineQueueCorruptError();
        tx.abort();
        return;
      }
      store.put(update(current));
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure || asStorageError(tx.error));
    tx.onerror = (event) => {
      failure ??= asStorageError(
        (event.target as IDBRequest | null)?.error || tx.error
      );
    };
  });
}

async function clearLegacyAfterCommit(
  db: IDBDatabase,
  expectedRaw: string | null
): Promise<void> {
  if (expectedRaw !== null) {
    const current = readLegacyRaw();
    if (current !== expectedRaw && current !== null)
      throw new OfflineQueueLegacyMutationError();
    if (current === expectedRaw) {
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // Keeping the original is safer than failing a committed IDB migration.
        return;
      }
    }
  }
  if (readLegacyRaw() !== null) return;
  try {
    await updateMigrationMeta(db, (meta) => ({ ...meta, sourceRaw: null }));
  } catch {
    // The next operation retries this cleanup. Item data is already committed.
  }
}

/**
 * IndexedDB readwrite transactions serialize mutations across tabs. Migration
 * copies the legacy array and its marker atomically, then removes the source
 * only after commit and only when it still matches the captured value.
 */
async function migrateLegacyQueue(db: IDBDatabase): Promise<void> {
  const raw = readLegacyRaw();

  let cleanupRaw: string | null | undefined;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ITEMS_STORE, META_STORE], 'readwrite');
    const items = tx.objectStore(ITEMS_STORE);
    const meta = tx.objectStore(META_STORE);
    let failure: unknown;
    const request = meta.get(MIGRATION_META_KEY);
    request.onsuccess = () => {
      const current = request.result as MigrationMeta | undefined;
      if (current) {
        if (raw !== null && raw !== current.sourceRaw) {
          if (current.sourceRaw === null && readLegacyRaw() === null) {
            // A concurrent tab completed migration and removed the source
            // after this tab captured it but before its transaction began.
            cleanupRaw = undefined;
          } else {
            failure = new OfflineQueueLegacyMutationError();
            tx.abort();
          }
          return;
        }
        if (current.sourceRaw !== null && raw === null) {
          meta.put({ ...current, sourceRaw: null });
          cleanupRaw = undefined;
          return;
        }
        cleanupRaw = raw !== null ? current.sourceRaw : undefined;
        return;
      }

      let legacy: QueuedItem[];
      try {
        legacy = parseLegacyQueue(raw);
      } catch (error) {
        failure = error;
        tx.abort();
        return;
      }
      for (const item of legacy) items.put(item);
      const marker: MigrationMeta = {
        key: MIGRATION_META_KEY,
        sourceRaw: raw,
        sourceIds: legacy.map((item) => item.id),
      };
      meta.put(marker);
      cleanupRaw = raw;
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure || asStorageError(tx.error));
    tx.onerror = () => reject(failure || asStorageError(tx.error));
  });

  if (cleanupRaw !== undefined) await clearLegacyAfterCommit(db, cleanupRaw);
  const afterCleanup = readLegacyRaw();
  if (afterCleanup !== null && afterCleanup !== cleanupRaw)
    throw new OfflineQueueLegacyMutationError();
}

async function getBackend(): Promise<IDBDatabase> {
  await assertOutboxStorageCompatible();
  if (backend === 'idb') {
    const db = await openDatabase();
    await migrateLegacyQueue(db);
    return db;
  }

  const db = await openDatabase();
  await migrateLegacyQueue(db);
  backend = 'idb';
  return db;
}

function validateIdbQueue(queue: unknown): QueuedItem[] {
  if (!Array.isArray(queue) || queue.some((item) => !isValidQueuedItem(item)))
    throw new OfflineQueueCorruptError();
  return queue;
}

async function readIdbQueue(db: IDBDatabase): Promise<QueuedItem[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, 'readonly');
    const request = tx.objectStore(ITEMS_STORE).getAll();
    let result: QueuedItem[] = [];
    let failure: unknown;
    request.onsuccess = () => {
      try {
        result = validateIdbQueue(request.result);
      } catch (error) {
        failure = error;
      }
    };
    tx.oncomplete = () => (failure ? reject(failure) : resolve(result));
    tx.onerror = (event) => {
      failure ??= asStorageError(
        (event.target as IDBRequest | null)?.error || tx.error
      );
    };
    tx.onabort = () => reject(failure || asStorageError(tx.error));
  });
}

async function readQueuedItem(id: string): Promise<QueuedItem | undefined> {
  const db = await getBackend();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, 'readonly');
    const request = tx.objectStore(ITEMS_STORE).get(id);
    let result: QueuedItem | undefined;
    let failure: unknown;
    request.onsuccess = () => {
      if (request.result === undefined) return;
      if (!isValidQueuedItem(request.result)) {
        failure = new OfflineQueueCorruptError();
        return;
      }
      result = request.result;
    };
    tx.oncomplete = () => (failure ? reject(failure) : resolve(result));
    tx.onabort = () => reject(failure || asStorageError(tx.error));
    tx.onerror = (event) => {
      failure ??= asStorageError(
        (event.target as IDBRequest | null)?.error || tx.error
      );
    };
  });
}

async function addQueueItem(item: QueuedItem): Promise<QueuedItem> {
  const db = await getBackend();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([ITEMS_STORE, TOMBSTONES_STORE], 'readwrite');
    const items = tx.objectStore(ITEMS_STORE);
    const tombstones = tx.objectStore(TOMBSTONES_STORE);
    const existing = items.get(item.id);
    const tombstone = tombstones.get(item.id);
    let result = item;
    let failure: unknown;
    let ready = 0;
    const apply = () => {
      if (++ready !== 2) return;
      const current = existing.result as QueuedItem | undefined;
      if (current) {
        result = current;
        return;
      }
      if (tombstone.result) return;
      try {
        items.put(item);
      } catch (error) {
        failure = asStorageError(error);
        tx.abort();
      }
    };
    existing.onsuccess = apply;
    tombstone.onsuccess = apply;
    tx.oncomplete = () => {
      notifyQueueChanged();
      resolve(result);
    };
    tx.onabort = () => reject(failure || asStorageError(tx.error));
    tx.onerror = (event) => {
      failure ??= asStorageError(
        (event.target as IDBRequest | null)?.error || tx.error
      );
    };
  });
}

export async function getOfflineQueue(): Promise<QueuedItem[]> {
  const db = await getBackend();
  return readIdbQueue(db);
}

export async function removeQueuedItem(id: string): Promise<void> {
  const db = await getBackend();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ITEMS_STORE, TOMBSTONES_STORE], 'readwrite');
    tx.objectStore(ITEMS_STORE).delete(id);
    tx.objectStore(TOMBSTONES_STORE).put({
      id,
      deletedAt: new Date().toISOString(),
    } satisfies Tombstone);
    tx.oncomplete = () => {
      notifyQueueChanged();
      resolve();
    };
    tx.onabort = () => reject(asStorageError(tx.error));
    tx.onerror = () => reject(asStorageError(tx.error));
  });
}

export async function clearOfflineQueue(): Promise<void> {
  const db = await getBackend();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ITEMS_STORE, TOMBSTONES_STORE], 'readwrite');
    const cursorRequest = tx.objectStore(ITEMS_STORE).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      tx.objectStore(TOMBSTONES_STORE).put({
        id: String(cursor.primaryKey),
        deletedAt: new Date().toISOString(),
      } satisfies Tombstone);
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => {
      notifyQueueChanged();
      resolve();
    };
    tx.onabort = () => reject(asStorageError(tx.error));
    tx.onerror = () => reject(asStorageError(tx.error));
  });
}

function recoverableEntries(raw: string): {
  entries: unknown[];
  unparseable: boolean;
} {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? { entries: parsed, unparseable: false }
      : { entries: [], unparseable: true };
  } catch {
    return { entries: [], unparseable: true };
  }
}

/**
 * Explicitly repairs corrupt or externally changed legacy data after export.
 * Existing IndexedDB items are preserved, and tombstoned IDs are never revived.
 */
export async function recoverOfflineQueue(expectedRaw: string): Promise<{
  recovered: number;
  discarded: number;
  unparseable: boolean;
  preservedExisting: number;
}> {
  await assertOutboxStorageCompatible();
  const currentRaw = readLegacyRaw();
  const recoveringLegacy = currentRaw === expectedRaw;
  if (!recoveringLegacy) {
    const currentIdbRaw = await getIdbRawSnapshot();
    if (currentIdbRaw !== expectedRaw)
      throw new Error(
        '保存データが別タブで更新されました。最新データを書き出し直してください。'
      );
  }
  const parsed = recoverableEntries(expectedRaw);
  const salvage = parsed.entries.filter(isValidQueuedItem);
  const db = await openDatabase();

  const result = await new Promise<{
    recovered: number;
    discarded: number;
    unparseable: boolean;
    preservedExisting: number;
  }>((resolve, reject) => {
    const tx = db.transaction(
      [ITEMS_STORE, META_STORE, TOMBSTONES_STORE],
      'readwrite'
    );
    const itemsStore = tx.objectStore(ITEMS_STORE);
    const metaStore = tx.objectStore(META_STORE);
    const tombstonesStore = tx.objectStore(TOMBSTONES_STORE);
    const allItems = itemsStore.getAll();
    const allItemKeys = itemsStore.getAllKeys();
    const allTombstones = tombstonesStore.getAll();
    const markerRequest = metaStore.get(MIGRATION_META_KEY);
    let ready = 0;
    let failure: unknown;
    let outcome = {
      recovered: 0,
      discarded: 0,
      unparseable: parsed.unparseable,
      preservedExisting: 0,
    };
    const apply = () => {
      if (++ready !== 4) return;
      try {
        const rawItems = Array.isArray(allItems.result) ? allItems.result : [];
        const itemKeys = allItemKeys.result;
        const currentItems = rawItems.filter(isValidQueuedItem);
        for (const [index, invalidItem] of rawItems.entries()) {
          if (!isValidQueuedItem(invalidItem))
            itemsStore.delete(itemKeys[index]!);
        }
        const tombstoneIds = new Set(
          (allTombstones.result as Tombstone[]).map((entry) => entry.id)
        );
        const currentIds = new Set(currentItems.map((entry) => entry.id));
        const marker = markerRequest.result as MigrationMeta | undefined;
        const accepted: QueuedItem[] = [];
        for (const item of salvage) {
          if (tombstoneIds.has(item.id) || currentIds.has(item.id)) continue;
          accepted.push(item);
          currentIds.add(item.id);
        }
        for (const item of accepted) itemsStore.put(item);
        metaStore.put({
          key: MIGRATION_META_KEY,
          sourceRaw: recoveringLegacy
            ? expectedRaw
            : (marker?.sourceRaw ?? null),
          sourceIds: marker?.sourceIds || accepted.map((item) => item.id),
        } satisfies MigrationMeta);
        outcome = {
          recovered: accepted.length,
          discarded: parsed.entries.length - salvage.length,
          unparseable: parsed.unparseable,
          preservedExisting: currentItems.length,
        };
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    allItems.onsuccess = apply;
    allItemKeys.onsuccess = apply;
    allTombstones.onsuccess = apply;
    markerRequest.onsuccess = apply;
    tx.oncomplete = () => resolve(outcome);
    tx.onabort = () => reject(failure || asStorageError(tx.error));
    tx.onerror = () => reject(failure || asStorageError(tx.error));
  });

  if (recoveringLegacy && readLegacyRaw() !== expectedRaw)
    throw new OfflineQueueLegacyMutationError();
  try {
    if (!recoveringLegacy) {
      notifyQueueChanged();
      return result;
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (readLegacyRaw() === null)
      await updateMigrationMeta(db, (meta) => ({ ...meta, sourceRaw: null }));
  } catch {
    // The committed IDB copy and exported source are both retained.
  }
  notifyQueueChanged();
  return result;
}

async function getIdbRawSnapshot(): Promise<string | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ITEMS_STORE, 'readonly');
      const request = tx.objectStore(ITEMS_STORE).getAll();
      request.onsuccess = () => resolve(JSON.stringify(request.result));
      request.onerror = () => reject(asStorageError(request.error));
    });
  } catch {
    return null;
  }
}

export async function enqueuePost(
  postData: QueuedPost['data']
): Promise<QueuedPost> {
  const item: QueuedPost = {
    id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'create_post',
    data: { ...postData, requestId: postData.requestId || crypto.randomUUID() },
    createdAt: new Date().toISOString(),
  };
  return (await addQueueItem(item)) as QueuedPost;
}

export async function enqueueStatusUpdate(
  updateData: QueuedStatusUpdate['data']
): Promise<QueuedStatusUpdate> {
  const item: QueuedStatusUpdate = {
    id: updateData.requestId || crypto.randomUUID(),
    type: 'update_status',
    data: {
      ...updateData,
      observedAt: updateData.observedAt || new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };
  return (await addQueueItem(item)) as QueuedStatusUpdate;
}

export async function getPendingQueueCount(): Promise<number> {
  return (await getOfflineQueue()).length;
}

async function updateItem(
  id: string,
  update: (item: QueuedItem) => QueuedItem
): Promise<void> {
  const db = await getBackend();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, 'readwrite');
    const store = tx.objectStore(ITEMS_STORE);
    const request = store.get(id);
    let failure: unknown;
    request.onsuccess = () => {
      const item = request.result as QueuedItem | undefined;
      if (!item) return;
      if (!isValidQueuedItem(item)) {
        failure = new OfflineQueueCorruptError();
        tx.abort();
        return;
      }
      try {
        store.put(update(item));
      } catch (error) {
        failure = asStorageError(error);
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      notifyQueueChanged();
      resolve();
    };
    tx.onabort = () => reject(failure || asStorageError(tx.error));
    tx.onerror = (event) => {
      failure ??= asStorageError(
        (event.target as IDBRequest | null)?.error || tx.error
      );
    };
  });
}

/** Replays queued items using their stable request IDs. */
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
  const queue = await getOfflineQueue();
  let succeeded = 0;
  let failed = 0;
  for (const item of queue) {
    const currentItem = await readQueuedItem(item.id);
    if (!currentItem) continue;
    if (currentItem.conflict) {
      failed++;
      continue;
    }
    try {
      const res =
        currentItem.type === 'create_post'
          ? await createPost(
              {
                ...currentItem.data,
                requestId: currentItem.data.requestId || currentItem.id,
              },
              token
            )
          : await updatePostStatus(
              currentItem.data.postId,
              currentItem.data.status,
              currentItem.data.statusLabel,
              currentItem.data.note,
              {
                requestId: currentItem.id,
                expectedUpdatedAt: currentItem.data.expectedUpdatedAt,
                observedAt:
                  currentItem.data.observedAt || currentItem.createdAt,
              }
            );
      if (res.success) {
        if (
          currentItem.type === 'create_post' &&
          'id' in res &&
          typeof res.id === 'string'
        )
          recordMyPost(res.id);
        await removeQueuedItem(currentItem.id);
        succeeded++;
      } else {
        failed++;
        await updateItem(currentItem.id, (entry) => ({
          ...entry,
          lastError: res.error || '送信に失敗しました',
          conflict: 'conflict' in res && !!res.conflict,
        }));
      }
    } catch (error) {
      failed++;
      await updateItem(currentItem.id, (entry) => ({
        ...entry,
        lastError: error instanceof Error ? error.message : '通信エラー',
      }));
    }
  }
  return { succeeded, failed };
}
