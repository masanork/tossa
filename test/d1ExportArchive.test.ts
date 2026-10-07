import { describe, expect, it } from 'vitest';
import {
  buildD1ExecuteArgs,
  buildWranglerEnv,
  requireQueryOutageAcknowledgement,
} from '../scripts/d1-export-archive.mjs';

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

  it('passes only the explicit API token to remote Wrangler and strips it locally', () => {
    const source = {
      PATH: '/usr/bin',
      CLOUDFLARE_API_TOKEN: 'secret-token',
      CLOUDFLARE_ACCOUNT_ID: 'wrong-account',
      CF_API_TOKEN: 'legacy-token',
    };
    expect(
      buildWranglerEnv(source, '/tmp/wrangler.log', { remoteAuth: true })
    ).toMatchObject({
      PATH: '/usr/bin',
      CLOUDFLARE_API_TOKEN: 'secret-token',
      WRANGLER_LOG_PATH: '/tmp/wrangler.log',
    });
    const localEnv = buildWranglerEnv(source, '/tmp/local-wrangler.log');
    expect(localEnv).not.toHaveProperty('CLOUDFLARE_API_TOKEN');
    expect(localEnv).not.toHaveProperty('CLOUDFLARE_ACCOUNT_ID');
    expect(localEnv).not.toHaveProperty('CF_API_TOKEN');
  });

  it('requires explicit acknowledgment of temporary D1 query unavailability', () => {
    expect(() => requireQueryOutageAcknowledgement(true)).not.toThrow();
    expect(() => requireQueryOutageAcknowledgement(false)).toThrow(
      /allow-query-outage/u
    );
  });
});
