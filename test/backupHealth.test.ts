import { describe, expect, it } from 'vitest';
import { backupHealth } from '../web/src/lib/backupHealth';

describe('backup delay monitoring', () => {
  const checkedAt = '2026-10-05T05:00:00Z';
  const stored = (uploaded: string) => [{ key: 'backup', size: 10, uploaded }];

  it('uses the server check time and warns at the daily operating threshold', () => {
    expect(backupHealth(stored('2026-10-04T03:00:00Z'), checkedAt)).toEqual({
      state: 'overdue',
      ageHours: 26,
    });
    expect(backupHealth(stored('2026-10-04T03:01:00Z'), checkedAt).state).toBe(
      'recent'
    );
  });

  it('distinguishes an empty bucket from unavailable or inconsistent timestamps', () => {
    expect(backupHealth([], checkedAt).state).toBe('empty');
    expect(backupHealth(stored('2026-10-04T03:00:00Z')).state).toBe('unknown');
    expect(backupHealth(stored('invalid'), checkedAt).state).toBe('unknown');
    expect(backupHealth(stored('2026-10-06T03:00:00Z'), checkedAt).state).toBe(
      'unknown'
    );
  });

  it('measures source data age even when an old snapshot finishes uploading later', () => {
    expect(
      backupHealth(
        [
          {
            key: 'backup',
            size: 10,
            uploaded: '2026-10-05T04:59:00Z',
            snapshotAt: '2026-10-04T03:00:00Z',
          },
        ],
        checkedAt
      )
    ).toEqual({ state: 'overdue', ageHours: 26 });
  });
});
