// web/src/lib/favorites.svelte.ts: Local bookmark / favorites state manager
const STORAGE_KEY = 'tossa_favorites';

function loadInitialFavorites(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export class FavoritesManager {
  favorites = $state<string[]>(loadInitialFavorites());

  isFavorite(postId: string): boolean {
    return this.favorites.includes(postId);
  }

  toggle(postId: string): boolean {
    if (this.isFavorite(postId)) {
      this.remove(postId);
      return false;
    } else {
      this.add(postId);
      return true;
    }
  }

  add(postId: string): void {
    if (!postId || this.favorites.includes(postId)) return;
    this.favorites = [postId, ...this.favorites];
    this.save();
  }

  remove(postId: string): void {
    if (!postId) return;
    this.favorites = this.favorites.filter((id) => id !== postId);
    this.save();
  }

  clear(): void {
    this.favorites = [];
    this.save();
  }

  get count(): number {
    return this.favorites.length;
  }

  private save(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.favorites));
    } catch (err) {
      console.warn('Failed to save favorites to localStorage:', err);
    }
  }
}

export const favoritesManager = new FavoritesManager();
