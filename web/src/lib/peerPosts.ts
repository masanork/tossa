// web/src/lib/peerPosts.ts: Persistent Offline Peer Post Storage & Merging
import type { Post } from './types';

const STORAGE_KEY = 'tossa_peer_posts';

/**
 * Retrieves all peer-relayed posts stored in local device storage.
 */
export function getPeerPosts(): Post[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persists the list of peer posts to local device storage.
 */
function savePeerPostsList(posts: Post[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Saves or updates a peer-relayed post into local storage.
 * Returns whether the post was newly saved or updated, or if an equal/newer version already exists.
 */
export function savePeerPost(post: Post): { saved: boolean; isNew: boolean } {
  const current = getPeerPosts();
  const existingIdx = current.findIndex((p) => p.id === post.id);

  if (existingIdx === -1) {
    current.unshift(post);
    savePeerPostsList(current);
    return { saved: true, isNew: true };
  }

  const existing = current[existingIdx];
  if (!existing) {
    current.unshift(post);
    savePeerPostsList(current);
    return { saved: true, isNew: true };
  }

  const existingTime = new Date(
    existing.updated_at || existing.created_at
  ).getTime();
  const incomingTime = new Date(post.updated_at || post.created_at).getTime();

  if (incomingTime > existingTime) {
    current[existingIdx] = post;
    savePeerPostsList(current);
    return { saved: true, isNew: false };
  }

  return { saved: false, isNew: false };
}

/**
 * Removes a specific peer post from local storage.
 */
export function removePeerPost(id: string): void {
  const current = getPeerPosts();
  const filtered = current.filter((p) => p.id !== id);
  savePeerPostsList(filtered);
}

/**
 * Clears all peer posts from local storage.
 */
export function clearPeerPosts(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore error
  }
}

/**
 * Checks if a given post ID originates from local peer storage.
 */
export function isPeerPostId(id: string): boolean {
  const current = getPeerPosts();
  return current.some((p) => p.id === id);
}

/**
 * Merges server posts with local peer posts, deduplicating by ID and keeping the newest version.
 */
export function mergePostsWithPeer(
  serverPosts: Post[],
  peerPosts: Post[]
): Post[] {
  const postMap = new Map<string, Post>();

  // 1. Add server posts
  for (const post of serverPosts) {
    postMap.set(post.id, post);
  }

  // 2. Merge or override with peer posts if peer post is newer or absent
  for (const peer of peerPosts) {
    const peerWithFlag: Post = { ...peer, is_peer: true };
    const existing = postMap.get(peer.id);
    if (!existing) {
      postMap.set(peer.id, peerWithFlag);
    } else {
      const existingTime = new Date(
        existing.updated_at || existing.created_at
      ).getTime();
      const peerTime = new Date(peer.updated_at || peer.created_at).getTime();
      if (peerTime > existingTime) {
        postMap.set(peer.id, peerWithFlag);
      }
    }
  }

  // 3. Return as array sorted by created_at / updated_at descending
  return Array.from(postMap.values()).sort((a, b) => {
    const timeA = new Date(a.created_at || a.updated_at).getTime();
    const timeB = new Date(b.created_at || b.updated_at).getTime();
    return timeB - timeA;
  });
}
