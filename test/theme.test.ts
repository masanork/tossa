// test/theme.test.ts: Unit Tests for Dark Mode & High-Contrast Theme State
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeManager, THEME_OPTIONS } from '../web/src/lib/theme.svelte';

describe('THEME_OPTIONS Constant', () => {
  it('defines all four supported theme options', () => {
    const modes = THEME_OPTIONS.map((o) => o.mode);
    expect(modes).toEqual(['system', 'light', 'dark', 'contrast']);

    for (const opt of THEME_OPTIONS) {
      expect(opt.label).toBeTruthy();
      expect(opt.shortLabel).toBeTruthy();
      expect(opt.icon).toBeTruthy();
    }
  });
});

describe('ThemeManager', () => {
  let originalWindow: typeof globalThis.window;
  let originalDocument: typeof globalThis.document;
  let originalLocalStorage: typeof globalThis.localStorage;

  let storageMock: Record<string, string>;
  let classListSet: Set<string>;
  let metaAttributes: Record<string, string>;
  let mediaQueryListeners: Array<() => void>;
  let mediaQueryMatches: boolean;

  beforeEach(() => {
    storageMock = {};
    classListSet = new Set();
    metaAttributes = { content: '#2563eb' };
    mediaQueryListeners = [];
    mediaQueryMatches = false;

    // Mock localStorage
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

    // Mock document
    const mockDocument = {
      documentElement: {
        classList: {
          add: (...cls: string[]) => {
            cls.forEach((c) => classListSet.add(c));
          },
          remove: (...cls: string[]) => {
            cls.forEach((c) => classListSet.delete(c));
          },
          contains: (c: string) => classListSet.has(c),
        },
      },
      querySelector: (selector: string) => {
        if (selector === 'meta[name="theme-color"]') {
          return {
            getAttribute: (attr: string) => metaAttributes[attr] ?? null,
            setAttribute: (attr: string, val: string) => {
              metaAttributes[attr] = val;
            },
          };
        }
        return null;
      },
    };

    // Mock window
    const mockWindow = {
      localStorage: mockLocalStorage,
      matchMedia: vi.fn((query: string) => ({
        matches: mediaQueryMatches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, listener: () => void) => {
          if (event === 'change') {
            mediaQueryListeners.push(listener);
          }
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    };

    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
    originalLocalStorage = (globalThis as any).localStorage;

    (globalThis as any).window = mockWindow;
    (globalThis as any).document = mockDocument;
    (globalThis as any).localStorage = mockLocalStorage;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it('initializes to system mode and applies light theme by default when OS is light', () => {
    const manager = new ThemeManager();
    expect(manager.mode).toBe('system');
    expect(manager.resolvedTheme).toBe('light');
    expect(classListSet.has('dark')).toBe(false);
    expect(classListSet.has('contrast')).toBe(false);
    expect(metaAttributes.content).toBe('#2563eb');
  });

  it('restores saved theme preference from localStorage on construction', () => {
    storageMock['tossa_theme'] = 'dark';
    const manager = new ThemeManager();
    expect(manager.mode).toBe('dark');
    expect(manager.resolvedTheme).toBe('dark');
    expect(classListSet.has('dark')).toBe(true);
    expect(classListSet.has('contrast')).toBe(false);
    expect(metaAttributes.content).toBe('#090d16');
  });

  it('sets dark mode, persists to storage, and updates DOM & meta theme-color', () => {
    const manager = new ThemeManager();
    manager.setTheme('dark');

    expect(manager.mode).toBe('dark');
    expect(manager.resolvedTheme).toBe('dark');
    expect(storageMock['tossa_theme']).toBe('dark');
    expect(classListSet.has('dark')).toBe(true);
    expect(classListSet.has('contrast')).toBe(false);
    expect(metaAttributes.content).toBe('#090d16');
  });

  it('sets contrast mode with both dark and contrast classes, and black meta color', () => {
    const manager = new ThemeManager();
    manager.setTheme('contrast');

    expect(manager.mode).toBe('contrast');
    expect(manager.resolvedTheme).toBe('contrast');
    expect(storageMock['tossa_theme']).toBe('contrast');
    expect(classListSet.has('dark')).toBe(true);
    expect(classListSet.has('contrast')).toBe(true);
    expect(metaAttributes.content).toBe('#000000');
  });

  it('switches back to light mode cleanly removing dark and contrast classes', () => {
    const manager = new ThemeManager();
    manager.setTheme('contrast');
    expect(classListSet.has('dark')).toBe(true);

    manager.setTheme('light');
    expect(manager.mode).toBe('light');
    expect(manager.resolvedTheme).toBe('light');
    expect(classListSet.has('dark')).toBe(false);
    expect(classListSet.has('contrast')).toBe(false);
    expect(metaAttributes.content).toBe('#2563eb');
  });

  it('cycles through theme modes in sequence: light -> dark -> contrast -> system', () => {
    const manager = new ThemeManager();
    manager.setTheme('light');

    manager.cycleTheme();
    expect(manager.mode).toBe('dark');

    manager.cycleTheme();
    expect(manager.mode).toBe('contrast');

    manager.cycleTheme();
    expect(manager.mode).toBe('system');

    manager.cycleTheme();
    expect(manager.mode).toBe('light');
  });
});
