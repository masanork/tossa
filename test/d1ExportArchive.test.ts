import { describe, expect, it } from 'vitest';
import { buildD1ExecuteArgs } from '../scripts/d1-export-archive.mjs';

describe('d1-export-archive Wrangler routing', () => {
  it('uses remote mode for source inventory and never attaches local persistence', () => {
    expect(
      buildD1ExecuteArgs(
        'production-db',
        '/tmp/remote.wrangler.toml',
        "SELECT name FROM sqlite_master WHERE type = 'table';",
        { remote: true, persistTo: '/tmp/local-state' }
      )
    ).toEqual([
      'd1',
      'execute',
      'production-db',
      '--remote',
      '--json',
      '--command',
      "SELECT name FROM sqlite_master WHERE type = 'table';",
      '--config',
      '/tmp/remote.wrangler.toml',
    ]);
  });

  it('uses local mode and isolated persistence for restore verification', () => {
    expect(
      buildD1ExecuteArgs(
        'restore-db',
        '/tmp/local.wrangler.toml',
        'PRAGMA quick_check;',
        { persistTo: '/tmp/restore-state' }
      )
    ).toEqual([
      'd1',
      'execute',
      'restore-db',
      '--local',
      '--json',
      '--command',
      'PRAGMA quick_check;',
      '--config',
      '/tmp/local.wrangler.toml',
      '--persist-to',
      '/tmp/restore-state',
    ]);
  });
});
