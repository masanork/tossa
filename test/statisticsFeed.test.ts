import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  StatisticsFeedValidationError,
  validateStatisticsFeed,
  type StatisticsFeed,
  type StatisticsRecord,
} from '../src/services/statisticsFeed';

const fixture = JSON.parse(
  readFileSync(
    new URL('../docs/examples/tsudoi-statistics-preview.json', import.meta.url),
    'utf8'
  )
) as StatisticsFeed;
const now = Date.parse('2026-10-05T00:10:00Z');

function copyFeed(): StatisticsFeed {
  return structuredClone(fixture);
}

function expectInvalid(feed: unknown, fixedNow = now): void {
  expect(() => validateStatisticsFeed(feed, fixedNow)).toThrow(
    StatisticsFeedValidationError
  );
}

describe('validateStatisticsFeed', () => {
  it('validates and canonicalizes the aggregate preview fixture', () => {
    const result = validateStatisticsFeed(fixture, now);
    expect(result.format).toBe('tossa-statistics-preview-v1');
    expect(result.generatedAt).toBe('2026-10-05T00:05:00Z');
    expect(result.records.map(({ value, status }) => [status, value])).toEqual([
      ['reported', 43],
      ['reported', 100],
      ['withheld', null],
    ]);
    expect(result.records[0]?.observedAt).toBe('2026-10-05T00:00:00Z');
  });

  it('requires one to one hundred records', () => {
    const empty = copyFeed();
    empty.records = [];
    expectInvalid(empty);

    const tooMany = copyFeed();
    tooMany.records = Array.from({ length: 101 }, (_, index) => ({
      ...tooMany.records[0]!,
      id: `unique-${index}`,
      entity: { ...tooMany.records[0]!.entity, id: `shelter-${index}` },
    }));
    expectInvalid(tooMany);
  });

  it('distinguishes a reported zero from unavailable or withheld values', () => {
    const zero = copyFeed();
    zero.records[0]!.value = 0;
    expect(validateStatisticsFeed(zero, now).records[0]?.value).toBe(0);

    const missingReported = copyFeed();
    missingReported.records[0]!.value = null;
    expectInvalid(missingReported);
    const omittedValue = copyFeed();
    delete (omittedValue.records[0] as Partial<StatisticsRecord>).value;
    expectInvalid(omittedValue);

    const unavailable = copyFeed();
    unavailable.records[0]!.status = 'unavailable';
    unavailable.records[0]!.value = null;
    expect(validateStatisticsFeed(unavailable, now).records[0]).toMatchObject({
      status: 'unavailable',
      value: null,
    });

    unavailable.records[0]!.value = 0;
    expectInvalid(unavailable);
  });

  it('accepts positive safe-integer correction revisions and rejects invalid revisions', () => {
    const corrected = copyFeed();
    corrected.records[0]!.revision = 2;
    expect(validateStatisticsFeed(corrected, now).records[0]?.revision).toBe(2);

    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = copyFeed();
      invalid.records[0]!.revision = revision;
      expectInvalid(invalid);
    }
  });

  it('rejects duplicate record IDs and duplicate entity metric observations', () => {
    const duplicateId = copyFeed();
    duplicateId.records[1]!.id = duplicateId.records[0]!.id;
    expectInvalid(duplicateId);

    const duplicateObservation = copyFeed();
    const record = {
      ...duplicateObservation.records[0]!,
      id: 'corrected-id',
      revision: 2,
    };
    duplicateObservation.records.push(record);
    expectInvalid(duplicateObservation);

    const duplicatePeriod = copyFeed();
    duplicatePeriod.records.push({
      ...duplicatePeriod.records[2]!,
      id: 'same-period-new-observation',
      revision: 2,
      observedAt: '2026-10-05T09:02:00+09:00',
    });
    expectInvalid(duplicatePeriod);
  });

  it('rejects inconsistent labels for the same entity ID', () => {
    const changedLabel = copyFeed();
    changedLabel.records[1]!.entity.label = '別の避難所名';
    expectInvalid(changedLabel);

    const differentKinds = copyFeed();
    differentKinds.records.push({
      ...differentKinds.records[1]!,
      id: 'event-with-reused-id',
      entity: {
        kind: 'event',
        id: 'shelter-001',
        label: '別種別の同一ID',
      },
    });
    expect(validateStatisticsFeed(differentKinds, now).records).toHaveLength(4);
  });

  it('allows distinct time-series observations and canonicalizes equivalent offsets', () => {
    const series = copyFeed();
    const later: StatisticsRecord = {
      ...series.records[0]!,
      id: 'shelter-001-occupancy-later',
      revision: 1,
      observedAt: '2026-10-05T09:01:00+09:00',
      value: 44,
    };
    series.records.push(later);
    expect(validateStatisticsFeed(series, now).records.at(-1)?.value).toBe(44);

    const sameInstant = copyFeed();
    sameInstant.records[1] = {
      ...sameInstant.records[0]!,
      id: 'equivalent-offset-duplicate',
      observedAt: '2026-10-05T00:00:00Z',
    };
    sameInstant.records[1]!.metric = 'current_occupancy';
    expectInvalid(sameInstant);
  });

  it('rejects invalid, unordered, and too-far-future timestamps', () => {
    for (const generatedAt of [
      '2026-02-30T09:05:00+09:00',
      '2026-10-05T09:05:00',
      '2026-10-05T09:05:00+24:00',
    ]) {
      const invalid = copyFeed();
      invalid.generatedAt = generatedAt;
      expectInvalid(invalid);
    }

    const observedAfterGeneration = copyFeed();
    observedAfterGeneration.records[0]!.observedAt =
      '2026-10-05T09:06:00+09:00';
    expectInvalid(observedAfterGeneration);

    const future = copyFeed();
    future.generatedAt = '2026-10-05T09:16:00+09:00';
    expectInvalid(future);

    const beforeFourDigitYear = copyFeed();
    beforeFourDigitYear.generatedAt = '0000-01-01T00:00:00+01:00';
    beforeFourDigitYear.records.forEach(
      (record) => (record.observedAt = '0000-01-01T00:00:00+01:00')
    );
    expectInvalid(beforeFourDigitYear, Date.parse('0000-01-01T00:00:00Z'));

    const afterFourDigitYear = copyFeed();
    afterFourDigitYear.generatedAt = '9999-12-31T23:30:00-01:00';
    const year10000 = new Date(0);
    year10000.setUTCFullYear(10000, 0, 1);
    year10000.setUTCHours(0, 30, 0, 0);
    expectInvalid(afterFourDigitYear, year10000.getTime());
  });

  it('requires strict periods only for period metrics and enforces chronological order', () => {
    const periodRequired = copyFeed();
    periodRequired.records[2]!.period!.start = '2026-10-05T09:01:00+09:00';
    expectInvalid(periodRequired);

    const endAfterObservation = copyFeed();
    endAfterObservation.records[2]!.period!.end = '2026-10-05T09:01:00+09:00';
    expectInvalid(endAfterObservation);

    const forbiddenPeriod = copyFeed();
    forbiddenPeriod.records[0]!.period = {
      start: '2026-10-05T08:00:00+09:00',
      end: '2026-10-05T09:00:00+09:00',
    };
    expectInvalid(forbiddenPeriod);

    const capacityPeriod = copyFeed();
    capacityPeriod.records[1]!.period = {
      start: '2026-10-05T08:00:00+09:00',
      end: '2026-10-05T09:00:00+09:00',
    };
    expectInvalid(capacityPeriod);
  });

  it('enforces metric/entity compatibility and values', () => {
    const wrongEntity = copyFeed();
    wrongEntity.records[0]!.entity.kind = 'event';
    expectInvalid(wrongEntity);

    for (const value of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = copyFeed();
      invalid.records[0]!.value = value;
      expectInvalid(invalid);
    }

    const attendance = copyFeed();
    attendance.records[2]!.metric = 'attendance_total';
    expect(validateStatisticsFeed(attendance, now).records[2]?.metric).toBe(
      'attendance_total'
    );
  });

  it('rejects unknown fields without copying attacker values into the error', () => {
    const extra = copyFeed() as StatisticsFeed & Record<string, unknown>;
    extra.secret = 'private-name@example.com';
    let thrown: unknown;
    try {
      validateStatisticsFeed(extra, now);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StatisticsFeedValidationError);
    expect((thrown as Error).message).toBe(
      '統計フィードに未対応の項目があります。'
    );
    expect((thrown as Error).message).not.toContain('private-name');

    const roster = copyFeed();
    (roster.records[0] as StatisticsRecord & { names?: string[] }).names = [
      'Alice',
    ];
    expectInvalid(roster);
  });

  it('accepts only public HTTPS links without credentials, fragments, or local/private hosts', () => {
    for (const sourceUrl of [
      'http://tsudoi.example.org/public',
      'https://user:password@tsudoi.example.org/public',
      'https://tsudoi.example.org/public#section',
      'https://tsudoi.example.org/public#',
      'https://localhost/public',
      'https://service.localhost/public',
      'https://192.168.1.8/public',
      'https://127.0.0.1/public',
      'https://[::1]/public',
      `https://tsudoi.example.org/${'x'.repeat(2050)}`,
    ]) {
      const invalid = copyFeed();
      invalid.records[0]!.sourceUrl = sourceUrl;
      expectInvalid(invalid);
    }
  });
});
