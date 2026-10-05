export type StatisticsEntityKind = 'event' | 'shelter';
export type StatisticsMetric =
  'current_occupancy' | 'capacity' | 'participants_unique' | 'attendance_total';
export type StatisticsRecordStatus = 'reported' | 'unavailable' | 'withheld';

export interface StatisticsEntity {
  kind: StatisticsEntityKind;
  id: string;
  label: string;
}

export interface StatisticsPeriod {
  start: string;
  end: string;
}

export interface StatisticsRecord {
  id: string;
  revision: number;
  entity: StatisticsEntity;
  metric: StatisticsMetric;
  status: StatisticsRecordStatus;
  value: number | null;
  observedAt: string;
  sourceUrl: string;
  period?: StatisticsPeriod;
}

export interface StatisticsFeed {
  format: 'tossa-statistics-preview-v1';
  source: 'tsudoi';
  visibility: 'public_aggregate';
  generatedAt: string;
  records: StatisticsRecord[];
}

export class StatisticsFeedValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatisticsFeedValidationError';
  }
}

const FEED_FORMAT = 'tossa-statistics-preview-v1';
const METRICS = new Set<StatisticsMetric>([
  'current_occupancy',
  'capacity',
  'participants_unique',
  'attendance_total',
]);
const STATUSES = new Set<StatisticsRecordStatus>([
  'reported',
  'unavailable',
  'withheld',
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
// eslint-disable-next-line no-control-regex -- Reject control characters in public labels and URLs.
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const FORMAT_ERROR = '統計フィードの形式が正しくありません。';
const DATE_ERROR = '統計フィードの日時が正しくありません。';
const UNKNOWN_FIELD_ERROR = '統計フィードに未対応の項目があります。';
const DUPLICATE_ERROR = '統計フィードに重複する統計レコードがあります。';

function invalid(message = FORMAT_ERROR): never {
  throw new StatisticsFeedValidationError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowed.has(key)))
    invalid(UNKNOWN_FIELD_ERROR);
  if (required.some((key) => !Object.hasOwn(value, key))) invalid();
}

interface ParsedDateTime {
  canonical: string;
  nanoseconds: bigint;
}

function parseDateTime(value: unknown): ParsedDateTime {
  if (typeof value !== 'string') invalid(DATE_ERROR);
  const match = ISO_PATTERN.exec(value);
  if (!match) invalid(DATE_ERROR);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const zone = match[8]!;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    invalid(DATE_ERROR);

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]!;
  if (day > daysInMonth) invalid(DATE_ERROR);

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11]);
    if (offsetHour > 23 || offsetMinute > 59) invalid(DATE_ERROR);
    offsetMinutes =
      (offsetHour * 60 + offsetMinute) * (match[9] === '+' ? 1 : -1);
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  const epochMilliseconds = local.getTime() - offsetMinutes * 60_000;
  if (!Number.isFinite(epochMilliseconds)) invalid(DATE_ERROR);
  const fractionalNanoseconds = BigInt(fraction.padEnd(9, '0') || '0');
  const nanoseconds =
    BigInt(epochMilliseconds) * 1_000_000n + fractionalNanoseconds;
  const canonicalIso = new Date(epochMilliseconds).toISOString();
  if (!/^\d{4}-/u.test(canonicalIso)) invalid(DATE_ERROR);
  const canonicalSecond = canonicalIso.slice(0, 19);
  const fractionText = fractionalNanoseconds
    .toString()
    .padStart(9, '0')
    .replace(/0+$/u, '');
  return {
    canonical: `${canonicalSecond}${fractionText ? `.${fractionText}` : ''}Z`,
    nanoseconds,
  };
}

function parseUrl(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    CONTROL_PATTERN.test(value) ||
    value.includes('#')
  )
    invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    isPrivateOrLocalHost(url.hostname)
  )
    invalid();
  if (url.href.length > 2048) invalid();
  return url.href;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    return true;

  if (host.startsWith('[') && host.endsWith(']')) {
    const ipv6 = host.slice(1, -1);
    if (
      ipv6 === '::' ||
      ipv6 === '::1' ||
      /^(?:fc|fd)[0-9a-f]{2}:/u.test(ipv6) ||
      /^fe[89ab][0-9a-f]:/u.test(ipv6)
    )
      return true;
    if (ipv6.startsWith('::ffff:')) {
      const mapped = ipv6.slice('::ffff:'.length);
      if (mapped.includes('.')) return isPrivateIpv4(mapped);
      const parts = mapped.split(':');
      if (parts.length !== 2) return true;
      const high = Number.parseInt(parts[0] ?? '', 16);
      const low = Number.parseInt(parts[1] ?? '', 16);
      if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        high < 0 ||
        high > 0xffff ||
        low < 0 ||
        low > 0xffff
      )
        return true;
      return isPrivateIpv4(
        `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
      );
    }
    return false;
  }

  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) && isPrivateIpv4(host);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return true;
  const first = octets[0]!;
  const second = octets[1]!;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function parseEntity(value: unknown): StatisticsEntity {
  if (!isObject(value)) invalid();
  assertKeys(value, ['kind', 'id', 'label']);
  const { kind, id, label } = value;
  if (
    (kind !== 'event' && kind !== 'shelter') ||
    typeof id !== 'string' ||
    !ID_PATTERN.test(id) ||
    typeof label !== 'string' ||
    label.trim().length === 0 ||
    Array.from(label.trim()).length > 120 ||
    CONTROL_PATTERN.test(label)
  )
    invalid();
  return { kind, id, label: label.trim() };
}

function parsePeriod(value: unknown): {
  period: StatisticsPeriod;
  start: bigint;
  end: bigint;
} {
  if (!isObject(value)) invalid();
  assertKeys(value, ['start', 'end']);
  const start = parseDateTime(value.start);
  const end = parseDateTime(value.end);
  if (start.nanoseconds >= end.nanoseconds) invalid(DATE_ERROR);
  return {
    period: { start: start.canonical, end: end.canonical },
    start: start.nanoseconds,
    end: end.nanoseconds,
  };
}

function parseRecord(
  value: unknown,
  generatedAtNs: bigint
): {
  record: StatisticsRecord;
  signature: string;
} {
  if (!isObject(value)) invalid();
  assertKeys(
    value,
    [
      'id',
      'revision',
      'entity',
      'metric',
      'status',
      'value',
      'observedAt',
      'sourceUrl',
    ],
    ['period']
  );
  const id = value.id;
  const revision = value.revision;
  const entity = parseEntity(value.entity);
  const metric = value.metric;
  const status = value.status;
  const rawValue = value.value;
  const observedAt = parseDateTime(value.observedAt);
  const sourceUrl = parseUrl(value.sourceUrl);

  if (
    typeof id !== 'string' ||
    !ID_PATTERN.test(id) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision <= 0 ||
    typeof metric !== 'string' ||
    !METRICS.has(metric as StatisticsMetric) ||
    typeof status !== 'string' ||
    !STATUSES.has(status as StatisticsRecordStatus)
  )
    invalid();
  if (observedAt.nanoseconds > generatedAtNs) invalid(DATE_ERROR);

  let valueNumber: number | null;
  if (status === 'reported') {
    if (
      typeof rawValue !== 'number' ||
      !Number.isSafeInteger(rawValue) ||
      rawValue < 0
    )
      invalid();
    valueNumber = rawValue;
  } else {
    if (rawValue !== null) invalid();
    valueNumber = null;
  }

  let period: StatisticsPeriod | undefined;
  let periodSignature = '';
  if (value.period !== undefined) {
    const parsed = parsePeriod(value.period);
    if (parsed.end > observedAt.nanoseconds) invalid(DATE_ERROR);
    period = parsed.period;
    periodSignature = `${parsed.start}:${parsed.end}`;
  }
  const requiresPeriod =
    metric === 'participants_unique' || metric === 'attendance_total';
  if (requiresPeriod !== Boolean(period)) invalid();
  if (metric === 'current_occupancy' && entity.kind !== 'shelter') invalid();

  const record: StatisticsRecord = {
    id,
    revision,
    entity,
    metric: metric as StatisticsMetric,
    status: status as StatisticsRecordStatus,
    value: valueNumber,
    observedAt: observedAt.canonical,
    sourceUrl,
    ...(period ? { period } : {}),
  };
  return {
    record,
    signature: JSON.stringify([
      entity.kind,
      entity.id,
      metric,
      period ? '' : observedAt.nanoseconds.toString(),
      periodSignature,
    ]),
  };
}

function validateStatisticsFeedInternal(
  input: unknown,
  now = Date.now()
): StatisticsFeed {
  if (!isObject(input)) invalid();
  assertKeys(input, [
    'format',
    'source',
    'visibility',
    'generatedAt',
    'records',
  ]);
  if (
    input.format !== FEED_FORMAT ||
    input.source !== 'tsudoi' ||
    input.visibility !== 'public_aggregate'
  )
    invalid();

  const generatedAt = parseDateTime(input.generatedAt);
  if (
    typeof now !== 'number' ||
    !Number.isFinite(now) ||
    generatedAt.nanoseconds > BigInt(Math.trunc(now + 5 * 60_000)) * 1_000_000n
  )
    invalid(DATE_ERROR);
  if (
    !Array.isArray(input.records) ||
    input.records.length < 1 ||
    input.records.length > 100
  )
    invalid();

  const ids = new Set<string>();
  const signatures = new Set<string>();
  const labels = new Map<string, string>();
  const records: StatisticsRecord[] = [];
  for (const rawRecord of input.records) {
    const parsed = parseRecord(rawRecord, generatedAt.nanoseconds);
    const labelKey = JSON.stringify([
      parsed.record.entity.kind,
      parsed.record.entity.id,
    ]);
    const existingLabel = labels.get(labelKey);
    if (
      existingLabel !== undefined &&
      existingLabel !== parsed.record.entity.label
    )
      invalid(DUPLICATE_ERROR);
    labels.set(labelKey, parsed.record.entity.label);
    if (ids.has(parsed.record.id) || signatures.has(parsed.signature))
      invalid(DUPLICATE_ERROR);
    ids.add(parsed.record.id);
    signatures.add(parsed.signature);
    records.push(parsed.record);
  }

  return {
    format: FEED_FORMAT,
    source: 'tsudoi',
    visibility: 'public_aggregate',
    generatedAt: generatedAt.canonical,
    records,
  };
}

export function validateStatisticsFeed(
  input: unknown,
  now = Date.now()
): StatisticsFeed {
  try {
    return validateStatisticsFeedInternal(input, now);
  } catch (error) {
    if (error instanceof StatisticsFeedValidationError) throw error;
    invalid(FORMAT_ERROR);
  }
}
