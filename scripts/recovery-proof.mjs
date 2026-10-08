// Isomorphic schema shared by the scheduled recovery runner and its monitor.
export const PROOF_FORMAT = 'tossa-recovery-proof-v1';
export const PROOF_PREFIX = 'recovery-checks/';
export const RECOVERY_TABLES = Object.freeze([
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
]);
export const MAX_PROOF_BYTES = 16 * 1024;
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

const SUCCESS_FIELDS = [
  'format',
  'status',
  'checkedAt',
  'archiveKeySha256',
  'archiveSha256',
  'archiveBytes',
  'archiveTimestamp',
  'totalRecords',
  'tableCounts',
  'valueComparison',
  'checks',
  'timingsMs',
];
const CHECK_NAMES = [
  'v2Archive',
  'freshness',
  'localTableCounts',
  'foreignKeyCheck',
  'quickCheck',
];
const TIMING_NAMES = ['r2Download', 'restoreAndVerify', 'total'];
const FAILURE_CODES = [
  'archive_discovery_failed',
  'archive_list_request_failed',
  'archive_list_response_invalid',
  'archive_list_pagination_invalid',
  'archive_list_pagination_limit',
  'archive_list_empty',
  'archive_object_key_field_missing',
  'archive_prefix_empty',
  'archive_key_format_invalid',
  'recovery_child_auth_failed',
  'recovery_child_bucket_verification_failed',
  'recovery_child_archive_failed',
  'recovery_child_restore_verification_failed',
  'recovery_child_timeout_or_spawn_failed',
  'archive_latest_size_invalid',
  'archive_latest_oversized',
  'archive_latest_stale',
  'target_bucket_info_failed',
  'target_bucket_privacy_check_failed',
  'recovery_drill_failed',
  'proof_publish_failed',
];
const FAILURE_FIELDS = ['format', 'status', 'checkedAt', 'failureCode'];
const HASH = /^[a-f0-9]{64}$/u;

function exactKeys(value, allowed) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === allowed.length &&
    allowed.every((key) => Object.hasOwn(value, key))
  );
}

function validIso(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

export function recoveryProofKey(checkedAt, id = randomId()) {
  if (!validIso(checkedAt) || !/^[a-f0-9]{32}$/u.test(id))
    throw new Error('Invalid proof timestamp or identifier.');
  const encoded = checkedAt.replace(
    /T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u,
    'T$1-$2-$3-$4Z'
  );
  return `${PROOF_PREFIX}tossa_recovery_${encoded}_${id}.json`;
}

function randomId() {
  // UUID generation is only a convenience for Node callers. Pass an explicit id
  // in runtimes without crypto.randomUUID.
  if (globalThis.crypto?.randomUUID)
    return globalThis.crypto.randomUUID().replaceAll('-', '');
  throw new Error('A proof identifier is required in this runtime.');
}

export function validateProofKey(key) {
  const match =
    /^recovery-checks\/tossa_recovery_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_([a-f0-9]{32})\.json$/u.exec(
      key ?? ''
    );
  if (!match) return undefined;
  const iso = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u,
    'T$1:$2:$3.$4Z'
  );
  return validIso(iso) ? iso : undefined;
}

function validCounts(counts, total) {
  if (
    !exactKeys(counts, RECOVERY_TABLES) ||
    Object.values(counts).some(
      (value) => !Number.isSafeInteger(value) || value < 0
    )
  )
    return false;
  return Object.values(counts).reduce((sum, value) => sum + value, 0) === total;
}

function validChecks(checks) {
  return (
    exactKeys(checks, CHECK_NAMES) &&
    Object.values(checks).every((value) => value === 'ok')
  );
}

function validTimings(timings) {
  return (
    exactKeys(timings, TIMING_NAMES) &&
    Object.values(timings).every(
      (value) => Number.isSafeInteger(value) && value >= 0
    )
  );
}

export function buildRecoveryProof(drillReport, checkedAt) {
  const proof = {
    format: PROOF_FORMAT,
    status: 'success',
    checkedAt,
    archiveKeySha256: drillReport?.archiveKeySha256,
    archiveSha256: drillReport?.archiveSha256,
    archiveBytes: drillReport?.archiveBytes,
    archiveTimestamp: drillReport?.archiveTimestamp,
    totalRecords: drillReport?.totalRecords,
    tableCounts: drillReport?.tableCounts,
    valueComparison: drillReport?.valueComparison,
    checks: {
      v2Archive: drillReport?.checks?.v2Archive,
      freshness: drillReport?.checks?.freshness,
      localTableCounts: drillReport?.checks?.localTableCounts,
      foreignKeyCheck: drillReport?.checks?.foreignKeyCheck,
      quickCheck: drillReport?.checks?.quickCheck,
    },
    timingsMs: {
      r2Download: drillReport?.timingsMs?.r2Download,
      restoreAndVerify: drillReport?.timingsMs?.restoreAndVerify,
      total: drillReport?.timingsMs?.total,
    },
  };
  if (
    drillReport?.format !== 'tossa-production-recovery-report-v1' ||
    !exactKeys(drillReport?.checks, [
      'v2Archive',
      'freshness',
      'restoreBackupValidation',
      'localTableCounts',
      'foreignKeyCheck',
      'quickCheck',
    ]) ||
    Object.values(drillReport.checks).some((value) => value !== 'ok')
  )
    throw new Error(
      'Local recovery report did not pass the required full verification checks.'
    );
  validateRecoveryProof(
    proof,
    recoveryProofKey(checkedAt, '00000000000000000000000000000000')
  );
  return proof;
}

export function buildFailureProof(checkedAt, failureCode) {
  const proof = {
    format: PROOF_FORMAT,
    status: 'failure',
    checkedAt,
    failureCode,
  };
  validateRecoveryProof(
    proof,
    recoveryProofKey(checkedAt, '00000000000000000000000000000000')
  );
  return proof;
}

export function validateRecoveryProof(proof, key) {
  const keyTime = validateProofKey(key);
  if (!keyTime || proof?.format !== PROOF_FORMAT || proof.checkedAt !== keyTime)
    throw new Error('Recovery proof key and checkedAt do not match.');
  if (proof.status === 'failure') {
    if (
      !exactKeys(proof, FAILURE_FIELDS) ||
      !FAILURE_CODES.includes(proof.failureCode)
    )
      throw new Error('Recovery failure code is invalid.');
  } else {
    if (
      !exactKeys(proof, SUCCESS_FIELDS) ||
      proof.status !== 'success' ||
      !HASH.test(proof.archiveKeySha256) ||
      !HASH.test(proof.archiveSha256) ||
      !Number.isSafeInteger(proof.archiveBytes) ||
      proof.archiveBytes <= 0 ||
      proof.archiveBytes > MAX_ARCHIVE_BYTES ||
      !validIso(proof.archiveTimestamp) ||
      Date.parse(proof.checkedAt) - Date.parse(proof.archiveTimestamp) >
        26 * 60 * 60 * 1000 ||
      Date.parse(proof.archiveTimestamp) - Date.parse(proof.checkedAt) >
        5 * 60 * 1000 ||
      !Number.isSafeInteger(proof.totalRecords) ||
      proof.totalRecords < 0 ||
      !validCounts(proof.tableCounts, proof.totalRecords) ||
      proof.valueComparison !== 'full' ||
      !validChecks(proof.checks) ||
      !validTimings(proof.timingsMs)
    )
      throw new Error('Recovery success proof failed strict validation.');
  }
  if (
    new TextEncoder().encode(`${JSON.stringify(proof)}\n`).byteLength >
    MAX_PROOF_BYTES
  )
    throw new Error('Recovery proof exceeds the 16 KiB limit.');
  return true;
}
