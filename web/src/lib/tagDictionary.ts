// web/src/lib/tagDictionary.ts: Multi-lingual mapping and display helper for organic community tags

export interface TagDisplayInfo {
  /** Original tag name used as database/filter key */
  raw: string;
  /** Localized display label suitable for current language */
  displayName: string;
  /** Optional secondary subtitle/original hint (e.g. '給水' when viewed in English) */
  badgeSub?: string;
  /** Whether this tag was resolved via the localized dictionary */
  isTranslated: boolean;
  /** Accessible description / tooltip */
  tooltip: string;
}

interface TagDefinition {
  /** Match regex or exact lowercase keywords */
  patterns: RegExp;
  translations: {
    en: string;
    'ja-easy': string;
    ja?: string;
  };
}

/**
 * Curated dictionary of essential disaster relief, community living, and facility tags.
 * Community-generated folksonomy retains raw keys for query integrity, while presenting
 * localized semantic meaning for multilingual users (English / やさしい日本語).
 */
export const TAG_DICTIONARY: TagDefinition[] = [
  // Water & Lifeline
  {
    patterns: /^(断水|水が出ない|断水中)$/i,
    translations: {
      en: 'Water Outage',
      'ja-easy': 'みずが でない',
      ja: '断水',
    },
  },
  {
    patterns: /^(停電|電気が止まった|停電中)$/i,
    translations: {
      en: 'Power Outage',
      'ja-easy': 'でんきが とまった',
      ja: '停電',
    },
  },
  {
    patterns: /^(お店|店舗|商店|ショップ)$/i,
    translations: {
      en: 'Shop',
      'ja-easy': 'おみせ',
      ja: 'お店',
    },
  },
  {
    patterns: /^(給水|給水所|みず|飲料水|水)$/i,
    translations: {
      en: 'Water Station',
      'ja-easy': 'みず (給水)',
      ja: '給水',
    },
  },
  {
    patterns: /^(避難所|避難場所|一次避難|指定避難所|ひなんじょ)$/i,
    translations: {
      en: 'Shelter',
      'ja-easy': 'ひなんじょ',
      ja: '避難所',
    },
  },
  {
    patterns: /^(ペット可|ペット同伴|ペット同行|ペットOK|ペット)$/i,
    translations: {
      en: 'Pets Allowed',
      'ja-easy': 'ペットといっしょ',
      ja: 'ペット可',
    },
  },
  {
    patterns: /^(炊き出し|食料配布|食事配布|食料|ごはん|弁当|非常食)$/i,
    translations: {
      en: 'Food Distribution',
      'ja-easy': 'ごはん・たべもの',
      ja: '炊き出し',
    },
  },
  {
    patterns:
      /^(充電|電源|スマホ充電|携帯充電|コンセント|モバイルバッテリー)$/i,
    translations: {
      en: 'Phone Charging',
      'ja-easy': 'じゅうでん・でんき',
      ja: '充電',
    },
  },
  {
    patterns: /^(wi[-]?fi|フリーwifi|公衆無線lan|通信|電波|00000japan)$/i,
    translations: {
      en: 'Free Wi-Fi',
      'ja-easy': 'Wi-Fi (ネット)',
      ja: 'Wi-Fi',
    },
  },
  {
    patterns: /^(トイレ|仮設トイレ|多目的トイレ|バリアフリートイレ|お手洗い)$/i,
    translations: {
      en: 'Restroom / Toilet',
      'ja-easy': 'トイレ',
      ja: 'トイレ',
    },
  },
  {
    patterns: /^(風呂|お風呂|シャワー|入浴|銭湯|温泉|温水)$/i,
    translations: {
      en: 'Bath / Shower',
      'ja-easy': 'おふろ・シャワー',
      ja: '入浴・風呂',
    },
  },
  {
    patterns: /^(救護所|救護|病院|医療|救急|診療|クリニック)$/i,
    translations: {
      en: 'Medical / First Aid',
      'ja-easy': 'びょういん・くすり',
      ja: '医療・救護',
    },
  },
  {
    patterns: /^(透析|人工透析|透析対応)$/i,
    translations: {
      en: 'Dialysis Support',
      'ja-easy': 'とうせき (ちのそうじ)',
      ja: '人工透析',
    },
  },
  {
    patterns: /^(支援物資|物資|物資配布|救援物資|毛布|タオル)$/i,
    translations: {
      en: 'Relief Supplies',
      'ja-easy': 'しえんぶっし (くばるもの)',
      ja: '支援物資',
    },
  },
  {
    patterns: /^(ガソリン|給油|スタンド|燃料|軽油)$/i,
    translations: {
      en: 'Gas Station / Fuel',
      'ja-easy': 'ガソリン',
      ja: 'ガソリン',
    },
  },
  {
    patterns: /^(赤ちゃん|授乳|授乳室|オムツ|おむつ|ミルク|離乳食)$/i,
    translations: {
      en: 'Nursing & Baby Care',
      'ja-easy': 'あかちゃん・ミルク',
      ja: '授乳・赤ちゃん',
    },
  },
  {
    patterns: /^(バリアフリー|車椅子|車いす|スロープ|エレベーター)$/i,
    translations: {
      en: 'Accessible / Wheelchair',
      'ja-easy': 'くるまいす・だんさなし',
      ja: 'バリアフリー',
    },
  },
  {
    patterns: /^(ボランティア|ボランティア受付|災害ボランティア)$/i,
    translations: {
      en: 'Volunteer Center',
      'ja-easy': 'ボランティア (てつだい)',
      ja: 'ボランティア',
    },
  },
  // Normal community / town living
  {
    patterns: /^(カフェ|喫茶|coffee|cafe)$/i,
    translations: {
      en: 'Cafe',
      'ja-easy': 'カフェ',
      ja: 'カフェ',
    },
  },
  {
    patterns: /^(イベント|祭り|まつり|バザー|ワークショップ)$/i,
    translations: {
      en: 'Event / Festival',
      'ja-easy': 'イベント・おまつり',
      ja: 'イベント',
    },
  },
  {
    patterns: /^(コワーキング|作業場所|フリースペース|自習室)$/i,
    translations: {
      en: 'Coworking / Workspace',
      'ja-easy': 'さぎょうする ばしょ',
      ja: 'コワーキング',
    },
  },
  {
    patterns: /^(駐車場|パーキング|コインパーキング|駐輪場)$/i,
    translations: {
      en: 'Parking',
      'ja-easy': 'ちゅうしゃじょう',
      ja: '駐車場',
    },
  },
];

/**
 * Returns localized presentation information for a tag name based on the current locale.
 * Always preserves raw tag for query filtering.
 */
export function getTagDisplay(rawTag: string, lang: string): TagDisplayInfo {
  const normalized = rawTag.trim();
  if (!normalized) {
    return {
      raw: '',
      displayName: '',
      isTranslated: false,
      tooltip: '',
    };
  }

  // Find matching dictionary entry
  const found = TAG_DICTIONARY.find((def) => def.patterns.test(normalized));

  if (!found) {
    // Folksonomy tag without custom mapping -> display raw
    return {
      raw: normalized,
      displayName: normalized,
      isTranslated: false,
      tooltip: `#${normalized}`,
    };
  }

  if (lang === 'en') {
    const enLabel = found.translations.en;
    const isDifferent = enLabel.toLowerCase() !== normalized.toLowerCase();
    return {
      raw: normalized,
      displayName: enLabel,
      badgeSub: isDifferent ? normalized : undefined,
      isTranslated: true,
      tooltip: isDifferent
        ? `#${enLabel} (Original: #${normalized})`
        : `#${enLabel}`,
    };
  }

  if (lang === 'ja-easy') {
    const easyLabel = found.translations['ja-easy'];
    return {
      raw: normalized,
      displayName: easyLabel,
      isTranslated: true,
      tooltip: `#${easyLabel}`,
    };
  }

  // Default 'ja'
  return {
    raw: normalized,
    displayName: found.translations.ja || normalized,
    isTranslated: false,
    tooltip: `#${normalized}`,
  };
}
