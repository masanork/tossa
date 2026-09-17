// test/myPosts.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getMyPostIds,
  recordMyPost,
  isMyPost,
  removeMyPost,
} from '../web/src/lib/myPosts';

describe('myPosts client storage module', () => {
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

  it('records and checks authored post IDs in localStorage', () => {
    expect(isMyPost('post-1')).toBe(false);
    expect(getMyPostIds().size).toBe(0);

    recordMyPost('post-1');
    expect(isMyPost('post-1')).toBe(true);
    expect(getMyPostIds().has('post-1')).toBe(true);

    recordMyPost('post-2');
    expect(isMyPost('post-2')).toBe(true);
    expect(getMyPostIds().size).toBe(2);

    // Duplicate records should not duplicate
    recordMyPost('post-1');
    expect(getMyPostIds().size).toBe(2);
  });

  it('removes post IDs correctly', () => {
    recordMyPost('post-1');
    recordMyPost('post-2');
    expect(isMyPost('post-1')).toBe(true);

    removeMyPost('post-1');
    expect(isMyPost('post-1')).toBe(false);
    expect(isMyPost('post-2')).toBe(true);
  });

  it('handles empty or null inputs gracefully', () => {
    recordMyPost('');
    expect(getMyPostIds().size).toBe(0);
    expect(isMyPost('')).toBe(false);
  });
});
