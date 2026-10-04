// SQLite datetime values are UTC, although they have no explicit zone suffix.
function utcTime(value?: string | null): number | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

export function informationAge(
  observedAt?: string | null,
  confirmedAt?: string | null,
  now = Date.now(),
  maxAgeMinutes = 60
) {
  const observedTime = utcTime(observedAt);
  const confirmedTime = utcTime(confirmedAt);
  const basis = Math.max(observedTime ?? 0, confirmedTime ?? 0);
  return {
    observedTime,
    needsRecheck:
      !basis || basis > now + 300_000 || now - basis > maxAgeMinutes * 60_000,
  };
}
