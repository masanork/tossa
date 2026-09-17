// web/src/lib/fontSize.svelte.ts
export type FontScale = 'normal' | 'large' | 'xlarge';

const FONT_SCALE_KEY = 'tossa_font_scale';

export const FONT_SCALE_OPTIONS: {
  id: FontScale;
  labelJa: string;
  labelEn: string;
  labelEasy: string;
  scalePercent: string;
}[] = [
  {
    id: 'normal',
    labelJa: '標準',
    labelEn: 'Standard',
    labelEasy: 'ふつう',
    scalePercent: '100%',
  },
  {
    id: 'large',
    labelJa: '大',
    labelEn: 'Large',
    labelEasy: 'おおきい',
    scalePercent: '115%',
  },
  {
    id: 'xlarge',
    labelJa: '特大',
    labelEn: 'X-Large',
    labelEasy: 'とても おおきい',
    scalePercent: '130%',
  },
];

class FontSizeManager {
  scale = $state<FontScale>('normal');

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(FONT_SCALE_KEY) as FontScale | null;
      if (
        saved &&
        (saved === 'normal' || saved === 'large' || saved === 'xlarge')
      ) {
        this.scale = saved;
      }
      this.applyClass();
    }
  }

  setScale(newScale: FontScale) {
    this.scale = newScale;
    if (typeof window !== 'undefined') {
      localStorage.setItem(FONT_SCALE_KEY, newScale);
      this.applyClass();
    }
  }

  cycleScale() {
    const next: Record<FontScale, FontScale> = {
      normal: 'large',
      large: 'xlarge',
      xlarge: 'normal',
    };
    this.setScale(next[this.scale]);
  }

  private applyClass() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove(
      'text-scale-normal',
      'text-scale-large',
      'text-scale-xlarge'
    );
    root.classList.add(`text-scale-${this.scale}`);
  }
}

export const fontSizeManager = new FontSizeManager();
