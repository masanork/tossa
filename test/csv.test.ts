// test/csv.test.ts: Unit Tests for RFC 4180 CSV/TSV Parser & Heuristic Column Mapping
import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  inferColumnMapping,
  normalizeStatus,
  normalizeRows,
} from '../src/utils/csv';

describe('CSV/TSV Parser (RFC 4180)', () => {
  it('parses standard comma-separated values', () => {
    const csv = 'title,area,lat,lng\n避難所A,中央区,32.8,130.7\n給水所B,東区,32.7,130.6';
    const result = parseCsv(csv);

    expect(result.delimiter).toBe(',');
    expect(result.headers).toEqual(['title', 'area', 'lat', 'lng']);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]).toEqual(['避難所A', '中央区', '32.8', '130.7']);
    expect(result.rows[1]).toEqual(['給水所B', '東区', '32.7', '130.6']);
  });

  it('parses tab-separated values (TSV)', () => {
    const tsv = '施設名\t地区\t緯度\t経度\n市立体育館\t北区\t32.81\t130.71';
    const result = parseCsv(tsv);

    expect(result.delimiter).toBe('\t');
    expect(result.headers).toEqual(['施設名', '地区', '緯度', '経度']);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]).toEqual(['市立体育館', '北区', '32.81', '130.71']);
  });

  it('handles quotes, commas within cells, and escaped quotes ("")', () => {
    const csv = 'title,note\n"中央コミュニティセンター, 第1会場","""非常用""発電機あり, 備蓄水500本"';
    const result = parseCsv(csv);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0][0]).toBe('中央コミュニティセンター, 第1会場');
    expect(result.rows[0][1]).toBe('"非常用"発電機あり, 備蓄水500本');
  });

  it('handles multiline cells enclosed in quotes', () => {
    const csv = 'title,note\n"市民病院","1F: 受付\n2F: 救護所\n3F: 待機室"\n"文化会館","駐車場あり"';
    const result = parseCsv(csv);

    expect(result.rows.length).toBe(2);
    expect(result.rows[0][1]).toBe('1F: 受付\n2F: 救護所\n3F: 待機室');
    expect(result.rows[1][0]).toBe('文化会館');
  });

  it('strips UTF-8 BOM correctly', () => {
    const bomCsv = '\uFEFF施設名,市区町村\n桜小学校,南区';
    const result = parseCsv(bomCsv);

    expect(result.headers[0]).toBe('施設名');
    expect(result.rows.length).toBe(1);
  });

  it('skips trailing empty lines', () => {
    const csv = 'title,area\nA,B\n\n   \n\n';
    const result = parseCsv(csv);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0]).toEqual(['A', 'B']);
  });
});

describe('Heuristic Column Mapping', () => {
  it('infers Japanese open data headers automatically', () => {
    const headers = [
      '避難所名称',
      '市区町村名',
      '施設所在地',
      '施設種別',
      '緯度（10進法）',
      '経度（10進法）',
      '開設状況',
      '備考・収容定員',
      'ホームページURL',
    ];

    const mapping = inferColumnMapping(headers);

    expect(mapping.title).toBe(0);
    expect(mapping.area).toBe(1);
    expect(mapping.address).toBe(2);
    expect(mapping.category).toBe(3);
    expect(mapping.lat).toBe(4);
    expect(mapping.lng).toBe(5);
    expect(mapping.currentStatus).toBe(6);
    expect(mapping.note).toBe(7);
    expect(mapping.url).toBe(8);
  });

  it('infers English headers correctly', () => {
    const headers = ['FacilityName', 'City', 'Address', 'Latitude', 'Longitude', 'State'];
    const mapping = inferColumnMapping(headers);

    expect(mapping.title).toBe(0);
    expect(mapping.area).toBe(1);
    expect(mapping.address).toBe(2);
    expect(mapping.lat).toBe(3);
    expect(mapping.lng).toBe(4);
    expect(mapping.currentStatus).toBe(5);
  });
});

describe('Status Normalization', () => {
  it('normalizes common Japanese status keywords', () => {
    expect(normalizeStatus('開設中').code).toBe('available');
    expect(normalizeStatus('開所').code).toBe('available');
    expect(normalizeStatus('利用可能').code).toBe('available');
    expect(normalizeStatus('〇').code).toBe('available');

    expect(normalizeStatus('混雑').code).toBe('crowded');
    expect(normalizeStatus('定員間近').code).toBe('crowded');

    expect(normalizeStatus('閉鎖').code).toBe('closed');
    expect(normalizeStatus('休止').code).toBe('closed');
    expect(normalizeStatus('満員').code).toBe('closed');
    expect(normalizeStatus('未開設').code).toBe('closed');

    expect(normalizeStatus(undefined).code).toBe('available');
  });
});

describe('Row Normalization', () => {
  it('transforms rows into structured posts and detects missing titles', () => {
    const rows = [
      ['第一小学校', '中央区', '中央1-1', '32.8', '130.7', '開設中'],
      ['', '中央区', '中央1-2', '32.8', '130.7', '開設中'], // Empty title
      ['給水所C', '東区', '東2-3', 'invalid_lat', '130.8', '混雑'],
    ];

    const mapping = {
      title: 0,
      area: 1,
      address: 2,
      lat: 3,
      lng: 4,
      currentStatus: 5,
      category: null,
      note: null,
      url: null,
    };

    const { valid, errors } = normalizeRows(rows, mapping, '熊本市');

    expect(valid.length).toBe(2);
    expect(errors.length).toBe(1);
    expect(errors[0].row).toBe(3); // line 3 (index 1 + 2)

    expect(valid[0].title).toBe('第一小学校');
    expect(valid[0].lat).toBe(32.8);
    expect(valid[0].lng).toBe(130.7);
    expect(valid[0].currentStatus).toBe('available');

    expect(valid[1].title).toBe('給水所C');
    expect(valid[1].lat).toBeNull(); // invalid lat falls back to null
    expect(valid[1].lng).toBe(130.8);
    expect(valid[1].currentStatus).toBe('crowded');
  });
});
