import type { BackupRecord } from './types';

/** Use the server's check time so a misconfigured device clock cannot hide a delay. */
export function backupHealth(backups: BackupRecord[], checkedAt?: string) {
  const latest = backups[0];
  const snapshotTime = Date.parse(latest?.snapshotAt ?? latest?.uploaded ?? '');
  const checked = Date.parse(checkedAt ?? '');
  if (!latest) return { state: 'empty' as const };
  if (
    !Number.isFinite(snapshotTime) ||
    !Number.isFinite(checked) ||
    snapshotTime > checked
  )
    return { state: 'unknown' as const };
  const ageHours = (checked - snapshotTime) / 3_600_000;
  return {
    state: ageHours >= 26 ? ('overdue' as const) : ('recent' as const),
    ageHours,
  };
}
