// src/services/feedSnapshot.ts: KV snapshot of the public post list
import type { Bindings, Post } from '../types';
import { getPosts } from '../db/queries';

export const FEED_SNAPSHOT_KEY = 'feed:public:v1';
const MIN_REFRESH_MS = 3_000;

export interface PublicFeedSnapshot {
  generatedAt: string;
  total: number;
  posts: Post[];
}

export async function readPublicFeedSnapshot(
  env: Bindings
): Promise<PublicFeedSnapshot | null> {
  if (!env.FEED_KV) return null;
  try {
    const raw = await env.FEED_KV.get(FEED_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PublicFeedSnapshot;
  } catch {
    return null;
  }
}

export async function refreshPublicFeedSnapshot(
  env: Bindings,
  options: { force?: boolean } = {}
): Promise<PublicFeedSnapshot | null> {
  if (!env.FEED_KV) return null;

  if (!options.force) {
    const existing = await readPublicFeedSnapshot(env);
    if (existing) {
      const age = Date.now() - Date.parse(existing.generatedAt);
      if (!Number.isNaN(age) && age < MIN_REFRESH_MS) {
        return existing;
      }
    }
  }

  const { posts, total } = await getPosts(env.DB, { limit: 100, offset: 0 });
  const snapshot: PublicFeedSnapshot = {
    generatedAt: new Date().toISOString(),
    total,
    posts,
  };

  try {
    await env.FEED_KV.put(FEED_SNAPSHOT_KEY, JSON.stringify(snapshot), {
      expirationTtl: 60 * 60 * 24,
    });
  } catch (err) {
    console.error('[feedSnapshot] KV put failed:', err);
    return snapshot;
  }

  return snapshot;
}

export function executionCtxOf(c: {
  executionCtx: { waitUntil: (p: Promise<unknown>) => void };
}): { waitUntil: (p: Promise<unknown>) => void } | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

export function scheduleFeedRefresh(
  env: Bindings,
  ctx: { waitUntil: (p: Promise<unknown>) => void } | undefined
): void {
  if (!env.FEED_KV) return;
  const task = refreshPublicFeedSnapshot(env).catch((err) => {
    console.error('[feedSnapshot] refresh failed:', err);
  });
  if (ctx?.waitUntil) {
    ctx.waitUntil(task);
  }
}
