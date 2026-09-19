// web/src/lib/seedTags.ts: Default tag chips for peacetime vs disaster
import type { TagCount } from './types';

export const PEACETIME_SEED_TAGS = ['お店', 'イベント'] as const;
export const DISASTER_SEED_TAGS = [
  '避難所',
  '給水',
  '炊き出し',
  '断水',
  '停電',
] as const;

export type OperationMode = 'normal' | 'disaster';

export function seedTagsForMode(mode: OperationMode): readonly string[] {
  return mode === 'disaster' ? DISASTER_SEED_TAGS : PEACETIME_SEED_TAGS;
}

/** Seed chips first (count 0 if unused), then organic tags not in the seed list. */
export function mergeVocabularyWithSeeds(
  vocabulary: TagCount[],
  mode: OperationMode
): TagCount[] {
  const seeds = seedTagsForMode(mode);
  const seedSet = new Set<string>(seeds);
  const byName = new Map(vocabulary.map((t) => [t.name, t]));
  const seedRows: TagCount[] = seeds.map(
    (name) => byName.get(name) ?? { name, count: 0 }
  );
  const rest = vocabulary.filter((t) => !seedSet.has(t.name));
  return [...seedRows, ...rest];
}
