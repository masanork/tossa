import { describe, expect, it, vi } from 'vitest';
import {
  buildDrillEnvironment,
  classifyDrillFailure,
  listR2Objects,
  selectLatestBackup,
} from '../scripts/backup-scheduled-drill.mjs';
import {
  buildFailureProof,
  buildRecoveryProof,
  recoveryProofKey,
  validateProofKey,
  validateRecoveryProof,
} from '../scripts/recovery-proof.mjs';

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
const counts = Object.fromEntries(tables.map((table) => [table, 0]));
const checkedAt = '2026-10-08T04:17:00.123Z';
const id = '0123456789abcdef0123456789abcdef';

function validDrillReport() {
  return {
    format: 'tossa-production-recovery-report-v1',
    archiveKeySha256: 'a'.repeat(64),
    archiveSha256: 'b'.repeat(64),
    archiveBytes: 35_472,
    archiveTimestamp: '2026-10-08T03:00:00.000Z',
    totalRecords: 0,
    tableCounts: counts,
    valueComparison: 'full',
    checks: {
      v2Archive: 'ok',
      freshness: 'ok',
      restoreBackupValidation: 'ok',
      localTableCounts: 'ok',
      foreignKeyCheck: 'ok',
      quickCheck: 'ok',
    },
    timingsMs: { r2Download: 100, restoreAndVerify: 200, total: 300 },
  };
}

describe('scheduled recovery proof contract', () => {
  it('passes the explicit account ID to the remote drill child only', () => {
    const remoteEnv = {
      CLOUDFLARE_API_TOKEN: 'token',
      WRANGLER_LOG_PATH: '/private/tmp/wrangler.log',
    };
    expect(buildDrillEnvironment(remoteEnv, 'a'.repeat(32))).toEqual({
      ...remoteEnv,
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    });
    expect(remoteEnv).not.toHaveProperty('CLOUDFLARE_ACCOUNT_ID');
    expect(() => buildDrillEnvironment(remoteEnv, 'invalid')).toThrow(
      /valid account ID/u
    );
  });

  it('classifies child failures without returning captured output', () => {
    expect(
      classifyDrillFailure({
        status: 1,
        stdout: '',
        stderr:
          'whoami --json --account failed; Wrangler output was suppressed.',
      })
    ).toBe('recovery_child_auth_failed');
    expect(
      classifyDrillFailure({
        status: 1,
        stdout: '',
        stderr: 'R2 object download failed',
      })
    ).toBe('recovery_child_archive_failed');
    expect(classifyDrillFailure({ error: { code: 'ETIMEDOUT' } })).toBe(
      'recovery_child_timeout_or_spawn_failed'
    );
  });

  it('uses a timestamp-sortable unique key matching checkedAt', () => {
    const key = recoveryProofKey(checkedAt, id);
    expect(key).toBe(
      'recovery-checks/tossa_recovery_2026-10-08T04-17-00-123Z_0123456789abcdef0123456789abcdef.json'
    );
    expect(validateProofKey(key)).toBe(checkedAt);
    expect(
      validateProofKey(key.replace('recovery-checks/', 'recovery-checks/../'))
    ).toBeUndefined();
  });

  it('emits only allowlisted successful recovery values and validates strictly', () => {
    const proof = buildRecoveryProof(validDrillReport(), checkedAt);
    const key = recoveryProofKey(checkedAt, id);
    expect(validateRecoveryProof(proof, key)).toBe(true);
    expect(JSON.stringify(proof)).not.toContain('backups/');
    expect(proof.tableCounts).toEqual(counts);
    expect(() =>
      validateRecoveryProof({ ...proof, pii: 'should fail' }, key)
    ).toThrow(/strict validation/u);
    expect(() =>
      buildRecoveryProof(
        { ...validDrillReport(), valueComparison: 'counts-only' },
        checkedAt
      )
    ).toThrow(/strict validation/u);
  });

  it('represents failed attempts with a static code and no free-form error text', () => {
    const proof = buildFailureProof(checkedAt, 'recovery_drill_failed');
    expect(validateRecoveryProof(proof, recoveryProofKey(checkedAt, id))).toBe(
      true
    );
    expect(() =>
      buildFailureProof(checkedAt, 'some raw secret or error')
    ).toThrow(/failure code/u);
  });

  it('selects the newest valid backup and fails closed on a newest oversized archive', () => {
    const older =
      'backups/tossa_backup_2026-10-08T02-00-00-000Z_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json';
    const newer =
      'backups/tossa_backup_2026-10-08T03-00-00-000Z_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json';
    const now = Date.parse('2026-10-08T04:00:00.000Z');
    expect(
      selectLatestBackup(
        [
          { key: older, size: 100 },
          { key: newer, size: 200 },
        ],
        now
      ).key
    ).toBe(newer);
    expect(() =>
      selectLatestBackup(
        [
          { key: older, size: 100 },
          { key: newer, size: 100 * 1024 * 1024 + 1 },
        ],
        now
      )
    ).toThrow(/100 MiB/u);
    expect(() =>
      selectLatestBackup(
        [{ key: older, size: 100 }],
        Date.parse('2026-10-09T05:00:00.000Z')
      )
    ).toThrow(/26-hour/u);
    expect(() => selectLatestBackup([])).toThrow(/empty/u);
    expect(() => selectLatestBackup([{ name: older, size: 100 }])).toThrow(
      /keys/u
    );
    expect(() =>
      selectLatestBackup([{ key: 'recovery-checks/example.json', size: 100 }])
    ).toThrow(/backup prefix/u);
    expect(() =>
      selectLatestBackup([{ key: 'backups/legacy.json', size: 100 }])
    ).toThrow(/required format/u);
  });

  it('bounds Cloudflare API pagination and follows cursors without exposing errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [{ key: 'a' }],
            result_info: { is_truncated: true, cursor: 'c1' },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [{ key: 'b' }],
            result_info: { is_truncated: false },
          })
        )
      );
    const objects = await listR2Objects({
      accountId: 'a'.repeat(32),
      apiToken: 'secret',
      prefix: 'backups/',
      fetchImpl,
    });
    expect(objects).toEqual([{ key: 'a' }, { key: 'b' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('cursor=c1');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer secret'
    );
    const unsafeFetch = vi.fn();
    await expect(
      listR2Objects({
        accountId: 'a'.repeat(32),
        apiToken: 'secret',
        fetchImpl: unsafeFetch,
      })
    ).rejects.toThrow(/approved object prefix/u);
    expect(unsafeFetch).not.toHaveBeenCalled();
  });
});
