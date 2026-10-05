// src/services/feedSnapshot.ts: KV snapshot of the public post list
import type { Bindings, Post } from '../types';
import { getPosts } from '../db/queries';

export const FEED_SNAPSHOT_KEY = 'feed:public:v2';
const MIN_REFRESH_MS = 3_000;
export const FEED_MAX_AGE_MS = 120_000;

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
  options: { force?: boolean; strict?: boolean } = {}
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
    if (options.strict)
      throw new Error('Public feed snapshot could not be stored in KV', {
        cause: err,
      });
    return snapshot;
  }

  return snapshot;
}

/** Production KV writes share the single write consumer, rather than racing
 * across request isolates. Local/no-queue environments refresh synchronously. */
export async function requestPublicFeedRefresh(
  env: Bindings,
  options: { force?: boolean; strict?: boolean } = {}
): Promise<{ queued: boolean }> {
  if (!env.FEED_KV) return { queued: false };
  if (env.WRITE_QUEUE && env.DISABLE_WRITE_BUFFER !== 'true') {
    await env.WRITE_QUEUE.send({
      type: 'refresh_public_feed',
      force: options.force === true,
    });
    return { queued: true };
  }
  await refreshPublicFeedSnapshot(env, options);
  return { queued: false };
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
  c: { executionCtx: { waitUntil: (p: Promise<unknown>) => void } }
) {
  const ctx = executionCtxOf(c);
  if (ctx) {
    ctx.waitUntil(requestPublicFeedRefresh(env));
  } else {
    // Fallback if executionCtx is somehow unavailable
    requestPublicFeedRefresh(env).catch((err) =>
      console.error('[feedSnapshot] scheduled refresh failed:', err)
    );
  }
}
