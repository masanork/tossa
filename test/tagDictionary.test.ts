// test/tagDictionary.test.ts: Tests for tag multilingual dictionary
import { describe, it, expect } from 'vitest';
import { getTagDisplay } from '../web/src/lib/tagDictionary';
import { mergeVocabularyWithSeeds } from '../web/src/lib/seedTags';

describe('tagDictionary', () => {
  it('translates common disaster tags to English', () => {
    const water = getTagDisplay('給水', 'en');
    expect(water.raw).toBe('給水');
    expect(water.displayName).toBe('Water Station');
    expect(water.badgeSub).toBe('給水');
    expect(water.isTranslated).toBe(true);

    const shelter = getTagDisplay('避難所', 'en');
    expect(shelter.displayName).toBe('Shelter');

    const food = getTagDisplay('炊き出し', 'en');
    expect(food.displayName).toBe('Food Distribution');

    const pet = getTagDisplay('ペット可', 'en');
    expect(pet.displayName).toBe('Pets Allowed');
  });

  it('translates common tags to Easy Japanese (やさしい日本語)', () => {
    const water = getTagDisplay('給水', 'ja-easy');
    expect(water.displayName).toBe('みず (給水)');
    expect(water.isTranslated).toBe(true);

    const shelter = getTagDisplay('避難所', 'ja-easy');
    expect(shelter.displayName).toBe('ひなんじょ');

    const food = getTagDisplay('炊き出し', 'ja-easy');
    expect(food.displayName).toBe('ごはん・たべもの');
  });

  it('preserves Japanese standard tags for ja', () => {
    const water = getTagDisplay('給水', 'ja');
    expect(water.displayName).toBe('給水');
    expect(water.badgeSub).toBeUndefined();

    const shelter = getTagDisplay('避難所', 'ja');
    expect(shelter.displayName).toBe('避難所');
  });

  it('gracefully handles unknown folksonomy tags', () => {
    const custom = getTagDisplay('桜山第二小学校', 'en');
    expect(custom.raw).toBe('桜山第二小学校');
    expect(custom.displayName).toBe('桜山第二小学校');
    expect(custom.isTranslated).toBe(false);
    expect(custom.badgeSub).toBeUndefined();
    expect(custom.tooltip).toBe('#桜山第二小学校');
  });

  it('handles empty input safely', () => {
    const empty = getTagDisplay('  ', 'en');
    expect(empty.raw).toBe('');
    expect(empty.displayName).toBe('');
    expect(empty.isTranslated).toBe(false);
  });
});

describe('seed tag chips', () => {
  it('puts peacetime seeds first even when unused', () => {
    const merged = mergeVocabularyWithSeeds(
      [{ name: 'ペット可', count: 3 }],
      'normal'
    );
    expect(merged.map((t) => t.name)).toEqual(['お店', 'イベント', 'ペット可']);
    expect(merged[0]?.count).toBe(0);
  });

  it('puts disaster seeds first and keeps organic tags after', () => {
    const merged = mergeVocabularyWithSeeds(
      [
        { name: '給水', count: 12 },
        { name: 'ペット可', count: 2 },
      ],
      'disaster'
    );
    expect(merged.map((t) => t.name)).toEqual([
      '避難所',
      '給水',
      '炊き出し',
      '断水',
      '停電',
      'ペット可',
    ]);
    expect(merged.find((t) => t.name === '給水')?.count).toBe(12);
  });
});
