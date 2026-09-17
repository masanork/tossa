// test/fontSize.test.ts: Unit Tests for Accessible Font Scaling
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FONT_SCALE_OPTIONS,
  fontSizeManager,
} from '../web/src/lib/fontSize.svelte';

describe('FONT_SCALE_OPTIONS', () => {
  it('defines normal, large, and xlarge scaling options', () => {
    const ids = FONT_SCALE_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(['normal', 'large', 'xlarge']);

    for (const opt of FONT_SCALE_OPTIONS) {
      expect(opt.labelJa).toBeTruthy();
      expect(opt.labelEn).toBeTruthy();
      expect(opt.labelEasy).toBeTruthy();
      expect(opt.scalePercent).toBeTruthy();
    }
  });
});

describe('FontSizeManager', () => {
  let storageMock: Record<string, string>;
  let classListSet: Set<string>;

  beforeEach(() => {
    storageMock = {};
    classListSet = new Set();

    const mockLocalStorage = {
      getItem: (key: string) => storageMock[key] ?? null,
      setItem: (key: string, val: string) => {
        storageMock[key] = val;
      },
      removeItem: (key: string) => {
        delete storageMock[key];
      },
    };

    (globalThis as any).localStorage = mockLocalStorage;
    (globalThis as any).window = {
      localStorage: mockLocalStorage,
    };

    (globalThis as any).document = {
      documentElement: {
        classList: {
          add: (...cls: string[]) => cls.forEach((c) => classListSet.add(c)),
          remove: (...cls: string[]) =>
            cls.forEach((c) => classListSet.delete(c)),
          contains: (c: string) => classListSet.has(c),
        },
      },
    };
  });

  it('sets and persists font scale in localStorage', () => {
    fontSizeManager.setScale('large');
    expect(fontSizeManager.scale).toBe('large');
    expect(storageMock['tossa_font_scale']).toBe('large');
    expect(classListSet.has('text-scale-large')).toBe(true);
    expect(classListSet.has('text-scale-normal')).toBe(false);

    fontSizeManager.setScale('xlarge');
    expect(fontSizeManager.scale).toBe('xlarge');
    expect(storageMock['tossa_font_scale']).toBe('xlarge');
    expect(classListSet.has('text-scale-xlarge')).toBe(true);
    expect(classListSet.has('text-scale-large')).toBe(false);
  });

  it('cycles through scales: normal -> large -> xlarge -> normal', () => {
    fontSizeManager.setScale('normal');
    expect(fontSizeManager.scale).toBe('normal');

    fontSizeManager.cycleScale();
    expect(fontSizeManager.scale).toBe('large');

    fontSizeManager.cycleScale();
    expect(fontSizeManager.scale).toBe('xlarge');

    fontSizeManager.cycleScale();
    expect(fontSizeManager.scale).toBe('normal');
  });
});
