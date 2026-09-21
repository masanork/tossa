import { expect, test } from 'vitest';
import { createMockD1, loadSchemaSql } from './helpers/mockD1';
import { importCsvPosts } from '../src/db/queries';
import { CsvImportPostInput } from '../src/types';

test('importCsvPosts performance baseline', async () => {
  const db = createMockD1(loadSchemaSql());

  // create some dummy posts
  const posts: CsvImportPostInput[] = [];
  for (let i = 0; i < 2000; i++) {
    posts.push({
      title: `Test Post ${i % 500}`, // Creates duplicates intentionally
      area: `Area ${i % 100}`,
      currentStatus: 'available',
      statusLabel: 'OK',
    });
  }

  // pre-populate db
  await importCsvPosts(db, posts, { updateDuplicates: true });

  // start measuring
  const start = performance.now();
  await importCsvPosts(db, posts, { updateDuplicates: true });
  const end = performance.now();

  console.log(`importCsvPosts baseline: ${end - start} ms`);
});
