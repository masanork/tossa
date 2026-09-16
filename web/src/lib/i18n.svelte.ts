// web/src/lib/i18n.svelte.ts: Svelte 5 reactive i18n state wrapper around Paraglide JS
import {
  setLocale as setParaglideLocale,
  isLocale,
  type Locale,
} from '../paraglide/runtime.js';
import * as m from '../paraglide/messages.js';

export { m };

export interface LanguageOption {
  code: Locale;
  label: string;
  shortLabel: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'ja', label: '日本語 (標準)', shortLabel: '日本語', flag: '🇯🇵' },
  { code: 'ja-easy', label: 'やさしい にほんご', shortLabel: 'やさしい', flag: '🌸' },
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
        setParaglideLocale(this.current, { reload: false });
      } catch {}
    }
  }

  setLanguage(lang: Locale) {
    this.current = lang;
    if (typeof window !== 'undefined') {
      localStorage.setItem('tossa_locale', lang);
      try {
        setParaglideLocale(lang, { reload: false });
      } catch {}
    }
  }

  /**
   * ステータスコード（available, crowded, closed等）の翻訳ラベルを返す
   */
  translateStatus(statusCode: string, fallbackLabel?: string): string {
    // リアクティブに現在の言語を参照
    const _lang = this.current;
    switch (statusCode) {
      case 'available':
        return m.status_available();
      case 'crowded':
        return m.status_crowded();
      case 'few':
        return m.status_few();
      case 'closed':
        return m.status_closed();
      case 'unknown':
        return m.status_unknown();
      default:
        return fallbackLabel || statusCode;
    }
  }
}

export const i18n = new I18nState();
