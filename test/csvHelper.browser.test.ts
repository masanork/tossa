// test/csvHelper.browser.test.ts: Tests for Browser-side CSV File Reading & Sample Generation
import { describe, it, expect } from 'vitest';
import {
  generateSampleCsv,
  parseCsv,
  inferColumnMapping,
  normalizeRows,
  readFileAsText,
} from '../web/src/lib/csvHelper';

describe('CSV Helper (Browser & Client)', () => {
  it('generates a valid disaster shelter sample CSV', () => {
    const sample = generateSampleCsv();
    expect(sample).toContain('避難所名称');
    expect(sample).toContain('桜山小学校体育館');

    const parsed = parseCsv(sample);
    expect(parsed.headers).toContain('避難所名称');
    expect(parsed.rows.length).toBe(4);

    const mapping = inferColumnMapping(parsed.headers);
    expect(mapping.title).toBe(0);
    expect(mapping.area).toBe(1);
    expect(mapping.address).toBe(2);
    expect(mapping.category).toBe(3);
    expect(mapping.currentStatus).toBe(4);
    expect(mapping.lat).toBe(5);
    expect(mapping.lng).toBe(6);

    const { valid, errors } = normalizeRows(parsed.rows, mapping, '熊本市');
    expect(valid.length).toBe(4);
    expect(errors.length).toBe(0);

    expect(valid[0].title).toBe('桜山小学校体育館');
    expect(valid[0].currentStatus).toBe('available');
    expect(valid[0].lat).toBeCloseTo(32.8031);
    expect(valid[0].lng).toBeCloseTo(130.7082);

    expect(valid[1].title).toBe('東部総合区民センター');
    expect(valid[1].currentStatus).toBe('crowded');

    expect(valid[3].title).toBe('西部ふれあい会館');
    expect(valid[3].currentStatus).toBe('closed');
  });

  it('reads File/Blob as text with UTF-8 encoding', async () => {
    const textData = '避難所名称,地域\nテスト避難所,中央区';
    const blob = new Blob([textData], { type: 'text/csv;charset=utf-8' });
    const file = new File([blob], 'test.csv', { type: 'text/csv' });

    const decoded = await readFileAsText(file);
    expect(decoded).toBe(textData);
  });
});
