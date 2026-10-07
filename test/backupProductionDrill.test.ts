import { describe, expect, it } from 'vitest';
import {
  archiveKeyTimestamp,
  requireCompleteValueComparison,
  stableJson,
  validateArchiveKey,
  validateArchiveMetadata,
} from '../scripts/backup-production-drill.mjs';

const tables = [
  'categories',
  'disasters',
  'posts',
  'status_updates',
  'post_verifications',
  'users',
  'credentials',
  'system_settings',
  'threads',
  'thread_members',
  'messages',
  'device_sessions',
  'access_logs',
  'device_user_links',
  'push_subscriptions',
  'mutation_receipts',
  'post_reports',
];

function emptyArchive(timestamp: string) {
  return {
    metadata: {
      version: 2,
      timestamp,
      tableCounts: Object.fromEntries(tables.map((table) => [table, 0])),
      totalRecords: 0,
    },
    data: Object.fromEntries(tables.map((table) => [table, []])),
  };
}

describe('backup-production-drill input validation', () => {
  it('accepts only explicit backup object keys under the expected prefix', () => {
    const key =
      'backups/tossa_backup_2026-10-07T03-00-15-900Z_e05e6afa399a4e1fb0251df6639b7666.json';
    expect(validateArchiveKey(key)).toBe(true);
    expect(archiveKeyTimestamp(key)).toBe('2026-10-07T03:00:15.900Z');
    expect(validateArchiveKey('../backups/tossa_backup_bad.json')).toBe(false);
    expect(validateArchiveKey('backups/other-file.json')).toBe(false);
    expect(
      validateArchiveKey(
        'backups/tossa_backup_2026-10-07T03-00-15-900Z_e05e6afa399a4e1fb0251df6639b7666.json?version=1'
      )
    ).toBe(false);
  });

  it('checks v2 format, exact 17-table inventory, row counts, total and freshness', () => {
    const now = Date.parse('2026-10-07T06:00:00.000Z');
    const archive = emptyArchive('2026-10-07T05:30:00.000Z');
    expect(validateArchiveMetadata(archive, now)).toEqual({
      timestamp: '2026-10-07T05:30:00.000Z',
      ageMs: 30 * 60 * 1000,
      totalRecords: 0,
    });
    expect(() =>
      validateArchiveMetadata(emptyArchive('2026-10-06T03:59:59.999Z'), now)
    ).toThrow(/26-hour/u);
    expect(() =>
      validateArchiveMetadata(emptyArchive('2026-10-07T06:10:00.000Z'), now)
    ).toThrow(/26-hour/u);
    const wrongCount = emptyArchive('2026-10-07T05:30:00.000Z');
    wrongCount.metadata.tableCounts.posts = 1;
    expect(() => validateArchiveMetadata(wrongCount, now)).toThrow(/posts/u);
  });

  it('compares row objects independently of JSON property order', () => {
    expect(stableJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableJson({ a: { c: 3, d: 4 }, b: 2 })
    );
  });

  it('does not accept an incomplete full-value comparison after ENOBUFS', () => {
    expect(() => requireCompleteValueComparison({ code: 'ENOBUFS' })).toThrow(
      /verification is incomplete/u
    );
    expect(() => requireCompleteValueComparison({ code: 'EIO' })).not.toThrow();
  });
});
