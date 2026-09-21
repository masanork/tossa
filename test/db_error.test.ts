import { describe, it, expect } from 'vitest';
import { getVocabularyTags } from '../src/db/queries';
import type { D1Database } from '@cloudflare/workers-types';

describe('DB queries error handling', () => {
  it('handles DB errors gracefully and returns empty array', async () => {
    // Mock the D1 database adapter to throw an error (simulating the issue at line 433)
    const mockDbThrowing = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            throw new Error('Simulated D1 error: getPosts error');
          },
        }),
      }),
    } as unknown as D1Database;

    const result = await getVocabularyTags(mockDbThrowing, 10);
    expect(result).toEqual([]); // Fallback to empty array
  });
});
