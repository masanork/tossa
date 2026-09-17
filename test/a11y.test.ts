// test/a11y.test.ts: Unit tests for Web Accessibility (JIS X 8341-3 / WCAG 2.1/2.2 AA)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { announcer } from '../web/src/lib/announcer.svelte';
import { i18n } from '../web/src/lib/i18n.svelte';
import { focusTrap } from '../web/src/lib/focusTrap';

describe('Accessibility Features', () => {
  describe('Live Region Announcer (WCAG 4.1.3)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      announcer.politeMessage = '';
      announcer.assertiveMessage = '';
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('announces polite messages after brief delay to trigger screen readers', () => {
      announcer.announce('避難所情報が更新されました', 'polite');
      expect(announcer.politeMessage).toBe('');

      vi.advanceTimersByTime(60);
      expect(announcer.politeMessage).toBe('避難所情報が更新されました');

      // Automatically clears after 5 seconds
      vi.advanceTimersByTime(5000);
      expect(announcer.politeMessage).toBe('');
    });

    it('announces assertive messages for emergency notifications', () => {
      announcer.announce('オフラインモードに切り替わりました', 'assertive');
      expect(announcer.assertiveMessage).toBe('');

      vi.advanceTimersByTime(60);
      expect(announcer.assertiveMessage).toBe(
        'オフラインモードに切り替わりました'
      );

      vi.advanceTimersByTime(5000);
      expect(announcer.assertiveMessage).toBe('');
    });

    it('ignores empty announcements', () => {
      announcer.announce('');
      vi.advanceTimersByTime(100);
      expect(announcer.politeMessage).toBe('');
      expect(announcer.assertiveMessage).toBe('');
    });
  });

  describe('HTML Lang Attribute Synchronization (WCAG 3.1.1 / 3.1.2)', () => {
    let mockDoc: { documentElement: { lang: string } };

    beforeEach(() => {
      mockDoc = { documentElement: { lang: 'ja' } };
      (globalThis as any).document = mockDoc;
    });

    afterEach(() => {
      delete (globalThis as any).document;
    });

    it('updates document.documentElement.lang when setting English', () => {
      i18n.setLanguage('en');
      expect(mockDoc.documentElement.lang).toBe('en');
    });

    it('updates document.documentElement.lang when setting Japanese', () => {
      i18n.setLanguage('ja');
      expect(mockDoc.documentElement.lang).toBe('ja');
    });

    it('sets lang to "ja" when choosing Plain Japanese (ja-easy) for proper screen reader TTS', () => {
      i18n.setLanguage('ja-easy');
      expect(mockDoc.documentElement.lang).toBe('ja');
    });
  });

  describe('Focus Trap Action (WAI-ARIA Dialog Pattern)', () => {
    it('initializes and cleans up focusTrap action cleanly without throwing', () => {
      const dummyEl = {
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        contains: () => false,
      } as unknown as HTMLElement;

      const trap = focusTrap(dummyEl);
      expect(dummyEl.addEventListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );

      trap.destroy();
      expect(dummyEl.removeEventListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
    });
  });
});
