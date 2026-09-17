// test/favorites.test.ts: Unit tests for FavoritesManager (localStorage bookmark manager)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FavoritesManager } from '../web/src/lib/favorites.svelte';

describe('FavoritesManager', () => {
  let originalWindow: typeof globalThis.window;
  let originalLocalStorage: typeof globalThis.localStorage;
  let storageMock: Record<string, string>;

  beforeEach(() => {
    storageMock = {};

    const mockLocalStorage = {
      getItem: (key: string) => storageMock[key] ?? null,
      setItem: (key: string, val: string) => {
        storageMock[key] = val;
      },
      removeItem: (key: string) => {
        delete storageMock[key];
      },
      clear: () => {
        storageMock = {};
      },
      length: 0,
      key: () => null,
    };

    originalWindow = (globalThis as any).window;
    originalLocalStorage = (globalThis as any).localStorage;

    (globalThis as any).window = { localStorage: mockLocalStorage };
    (globalThis as any).localStorage = mockLocalStorage;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it('initializes with empty favorites by default', () => {
    const manager = new FavoritesManager();
    expect(manager.favorites).toEqual([]);
    expect(manager.count).toBe(0);
    expect(manager.isFavorite('post_1')).toBe(false);
  });

  it('restores stored favorites from localStorage on initialization', () => {
    storageMock['tossa_favorites'] = JSON.stringify(['post_a', 'post_b']);
    const manager = new FavoritesManager();
    expect(manager.favorites).toEqual(['post_a', 'post_b']);
    expect(manager.count).toBe(2);
    expect(manager.isFavorite('post_a')).toBe(true);
    expect(manager.isFavorite('post_c')).toBe(false);
  });

  it('adds a favorite and persists to localStorage', () => {
    const manager = new FavoritesManager();
    manager.add('post_100');
    expect(manager.isFavorite('post_100')).toBe(true);
    expect(manager.count).toBe(1);
    expect(storageMock['tossa_favorites']).toBe(JSON.stringify(['post_100']));

    // Adding duplicate does not add again
    manager.add('post_100');
    expect(manager.count).toBe(1);
  });

  it('removes a favorite and updates localStorage', () => {
    storageMock['tossa_favorites'] = JSON.stringify(['post_1', 'post_2']);
    const manager = new FavoritesManager();
    manager.remove('post_1');
    expect(manager.isFavorite('post_1')).toBe(false);
    expect(manager.isFavorite('post_2')).toBe(true);
    expect(manager.count).toBe(1);
    expect(storageMock['tossa_favorites']).toBe(JSON.stringify(['post_2']));
  });

  it('toggles a favorite between added and removed', () => {
    const manager = new FavoritesManager();
    const added = manager.toggle('post_xyz');
    expect(added).toBe(true);
    expect(manager.isFavorite('post_xyz')).toBe(true);

    const removed = manager.toggle('post_xyz');
    expect(removed).toBe(false);
    expect(manager.isFavorite('post_xyz')).toBe(false);
  });

  it('clears all favorites', () => {
    storageMock['tossa_favorites'] = JSON.stringify(['post_1', 'post_2']);
    const manager = new FavoritesManager();
    manager.clear();
    expect(manager.count).toBe(0);
    expect(storageMock['tossa_favorites']).toBe('[]');
  });
});
