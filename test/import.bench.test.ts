import { describe, it } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { importFederatedPosts } from '../src/db/queries';

describe('importFederatedPosts performance', () => {
  it('measures import speed with more records', async () => {
    const { db } = createTestContext();

    const features = [];
    // Increase features and history to better show the N+1 problem
    for (let i = 0; i < 500; i++) {
      const history = [];
      for (let j = 0; j < 5; j++) {
        history.push({
          status: 'open',
          statusLabel: 'Open',
          note: `Note ${j}`,
          createdAt: `2024-01-01T00:00:${j.toString().padStart(2, '0')}Z`,
        });
      }

      features.push({
        type: 'Feature',
        id: `post_${i}`,
        geometry: { type: 'Point', coordinates: [130, 32] },
        properties: {
          title: `Post ${i}`,
          area: 'Area',
          currentStatus: 'open',
          statusLabel: 'Open',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          statusHistory: history,
        },
      });
    }

    const start = performance.now();
    await importFederatedPosts(db, features as any);
    const end = performance.now();

    console.log(`Initial import took ${end - start}ms`);

    const start2 = performance.now();
    await importFederatedPosts(db, features as any);
    const end2 = performance.now();

    console.log(`Second import (all existing) took ${end2 - start2}ms`);
  });
});
