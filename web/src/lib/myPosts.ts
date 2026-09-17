// web/src/lib/myPosts.ts: Tracks posts authored on this device in localStorage
// Allows client-side author/ownership verification even when responses are CDN edge-cached.

const STORAGE_KEY = 'tossa_my_posts';
const MAX_STORED_POSTS = 1000;

/**
 * Retrieves the set of post IDs authored on this device.
 */
export function getMyPostIds(): Set<string> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return new Set();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/**
 * Records a post ID as authored by this device.
 */
export function recordMyPost(postId: string): void {
  if (typeof window === 'undefined' || !window.localStorage || !postId) return;
  try {
    const current = Array.from(getMyPostIds());
    if (!current.includes(postId)) {
      current.unshift(postId);
      const trimmed = current.slice(0, MAX_STORED_POSTS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    }
  } catch (err) {
    console.warn('Failed to save my post to localStorage:', err);
  }
}

/**
 * Checks if a post was authored on this device.
 */
export function isMyPost(postId: string): boolean {
  if (!postId) return false;
  return getMyPostIds().has(postId);
}

/**
 * Removes a post ID from the authored list (e.g. after deletion).
 */
export function removeMyPost(postId: string): void {
  if (typeof window === 'undefined' || !window.localStorage || !postId) return;
  try {
    const current = Array.from(getMyPostIds()).filter((id) => id !== postId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn('Failed to remove my post from localStorage:', err);
  }
}
