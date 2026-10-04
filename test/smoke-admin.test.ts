import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const scriptPath = resolve(process.cwd(), 'scripts/smoke-admin.mjs');
const fetchFixturePath = resolve(
  process.cwd(),
  'test/fixtures/smoke-admin-fetch.mjs'
);

function runSmoke(mode: 'healthy' | 'unknown-backup-time') {
  return spawnSync(
    process.execPath,
    ['--import', fetchFixturePath, scriptPath],
    {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        SMOKE_FIXTURE_MODE: mode,
        SMOKE_BASE_URL: 'http://127.0.0.1:43210',
        SMOKE_ADMIN_TOKEN: 'synthetic-primary-token',
        SMOKE_ALT_ADMIN_TOKEN: 'synthetic-alternate-token',
        SMOKE_MODERATOR_TOKEN: '',
      },
    }
  );
}

describe('admin production smoke CLI', () => {
  it('uses only GET requests and accepts legacy backup timestamps via uploaded', () => {
    const result = runSmoke('healthy');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Admin smoke check passed');
    const requests = result.stderr
      .split('\n')
      .filter((line) => line.startsWith('FIXTURE_REQUEST '));
    expect(requests.length).toBeGreaterThan(0);
    expect(
      requests.every((line) => line.startsWith('FIXTURE_REQUEST GET '))
    ).toBe(true);
    expect(result.stdout + result.stderr).not.toContain(
      'synthetic-primary-token'
    );
    expect(result.stdout + result.stderr).not.toContain(
      'synthetic-alternate-token'
    );
  });

  it('fails closed on an unknown backup clock without printing response data', () => {
    const result = runSmoke('unknown-backup-time');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('timestamp invalid');
    expect(result.stderr).not.toContain('not-a-timestamp');
    expect(result.stderr).not.toContain('synthetic-primary-token');
  });
});
