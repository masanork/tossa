// web/src/lib/i18n.svelte.ts: Svelte 5 reactive i18n state wrapper around Paraglide JS
import {
  setLocale as setParaglideLocale,
  isLocale,
  type Locale,
} from '../paraglide/runtime.js';
import * as paraglideMessages from '../paraglide/messages.js';

export interface LanguageOption {
  code: Locale;
  label: string;
  shortLabel: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'ja', label: '日本語 (標準)', shortLabel: '日本語', flag: '🇯🇵' },
  {
    code: 'ja-easy',
    label: 'やさしい にほんご',
    shortLabel: 'やさしい',
    flag: '🌸',
  },
  { code: 'en', label: 'English', shortLabel: 'EN', flag: '🇺🇸' },
];

class I18nState {
  current = $state<Locale>('ja');

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tossa_locale');
      if (saved && isLocale(saved)) {
        this.current = saved;
      } else {
        const nav = (navigator.language || '').toLowerCase();
        if (nav.startsWith('en')) {
          this.current = 'en';
        } else {
          this.current = 'ja';
        }
      }
      try {
        void setParaglideLocale(this.current, { reload: false });
        this.updateHtmlLang(this.current);
      } catch {}
    }
  }

  private updateHtmlLang(lang: Locale) {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'ja-easy' ? 'ja' : lang;
    }
  }

  setLanguage(lang: Locale) {
    this.current = lang;
    this.updateHtmlLang(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('tossa_locale', lang);
      try {
        void setParaglideLocale(lang, { reload: false });
      } catch {}
    }
  }

  /**
   * Returns localized status label for status codes (available, crowded, closed, etc.)
   * In Japanese, respects the custom status_label if provided.
   */
  translateStatus(statusCode: string, fallbackLabel?: string): string {
    // Read reactive locale state
    const _lang = this.current;
    const trimmed = fallbackLabel?.trim();
    if (this.current === 'ja' && trimmed) {
      return trimmed;
    }
    switch (statusCode) {
      case 'available':
      case 'open':
        return m.status_available();
      case 'crowded':
        return m.status_crowded();
      case 'few':
      case 'low_stock':
        return m.status_few();
      case 'closed':
      case 'danger':
      case 'out_of_stock':
        return m.status_closed();
      case 'unknown':
        return m.status_unknown();
      default:
        return trimmed || statusCode;
    }
  }
}

export const i18n = new I18nState();

// Svelte 5 reactive Proxy for Paraglide messages: automatically subscribes callers to i18n.current
export const m = new Proxy(paraglideMessages, {
  get(target: any, prop: string | symbol, receiver: any) {
    const orig = Reflect.get(target, prop, receiver);
    if (typeof orig === 'function') {
      return (...args: any[]) => {
        void i18n.current;
        return orig(...args);
      };
    }
    return orig;
  },
}) as typeof paraglideMessages;
