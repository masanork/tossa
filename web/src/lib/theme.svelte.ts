// web/src/lib/theme.svelte.ts: Svelte 5 Reactive Theme State (Light / Dark / High-Contrast / System)

export type ThemeMode = 'light' | 'dark' | 'contrast' | 'system';

export interface ThemeOption {
  mode: ThemeMode;
  label: string;
  shortLabel: string;
  icon: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { mode: 'system', label: '自動 (端末連動)', shortLabel: '自動', icon: '💻' },
  { mode: 'light', label: 'ライト (標準)', shortLabel: '昼間', icon: '☀️' },
  {
    mode: 'dark',
    label: 'ダーク (停電・省電力・夜間)',
    shortLabel: '夜間',
    icon: '🌙',
  },
  {
    mode: 'contrast',
    label: 'ハイコントラスト (黒白・屋外)',
    shortLabel: '明瞭',
    icon: '⚡',
  },
];

export class ThemeManager {
  mode = $state<ThemeMode>('system');
  resolvedTheme = $state<'light' | 'dark' | 'contrast'>('light');

  private mediaQuery: MediaQueryList | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tossa_theme') as ThemeMode | null;
      if (
        saved &&
        (saved === 'light' ||
          saved === 'dark' ||
          saved === 'contrast' ||
          saved === 'system')
      ) {
        this.mode = saved;
      }

      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', () => {
        if (this.mode === 'system') {
          this.applyTheme();
        }
      });

      this.applyTheme();
    }
  }

  setTheme(newMode: ThemeMode): void {
    this.mode = newMode;
    if (typeof window !== 'undefined') {
      localStorage.setItem('tossa_theme', newMode);
      this.applyTheme();
    }
  }

  cycleTheme(): void {
    const cycle: ThemeMode[] = ['light', 'dark', 'contrast', 'system'];
    const idx = cycle.indexOf(this.mode);
    const next = cycle[(idx + 1) % cycle.length] ?? 'light';
    this.setTheme(next);
  }

  private applyTheme(): void {
    if (typeof document === 'undefined') return;

    let target: 'light' | 'dark' | 'contrast';

    if (this.mode === 'system') {
      target = this.mediaQuery?.matches ? 'dark' : 'light';
    } else {
      target = this.mode;
    }

    this.resolvedTheme = target;
    const root = document.documentElement;

    root.classList.remove('dark', 'contrast');

    if (target === 'dark') {
      root.classList.add('dark');
    } else if (target === 'contrast') {
      // Add both dark and contrast classes so dark utilities and contrast utilities apply
      root.classList.add('dark', 'contrast');
    }

    // Update meta theme-color for mobile browser address bar / notch area
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      if (target === 'contrast') {
        metaThemeColor.setAttribute('content', '#000000');
      } else if (target === 'dark') {
        metaThemeColor.setAttribute('content', '#090d16');
      } else {
        metaThemeColor.setAttribute('content', '#2563eb');
      }
    }
  }
}

export const themeManager = new ThemeManager();
