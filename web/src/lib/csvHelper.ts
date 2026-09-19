// web/src/lib/csvHelper.ts: RFC 4180 Compliant CSV/TSV Parser & Heuristic Column Mapping with UTF-8 / Shift_JIS Auto-Detection

export interface CsvParsedData {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export type ColumnField =
  | 'title'
  | 'area'
  | 'address'
  | 'category'
  | 'lat'
  | 'lng'
  | 'currentStatus'
  | 'note'
  | 'url';

export type ColumnMapping = Record<ColumnField, number | null>;

export interface NormalizedImportPost {
  title: string;
  area: string;
  address?: string;
  categoryName?: string;
  lat?: number | null;
  lng?: number | null;
  currentStatus: string;
  statusLabel: string;
  note?: string;
  url?: string;
}

/**
 * Parse CSV or TSV text adhering to RFC 4180 standard.
 * Supports multi-line cells, escaped quotes (""), and auto-detects delimiter (, or \t).
 */
export function parseCsv(text: string): CsvParsedData {
  // Strip UTF-8 BOM if present
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  // Detect delimiter (, vs \t vs ;)
  const firstLine = cleanText.split(/\r\n|\r|\n/)[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;

  let delimiter = ',';
  if (tabCount > commaCount && tabCount > semiCount) {
    delimiter = '\t';
  } else if (semiCount > commaCount && semiCount > tabCount) {
    delimiter = ';';
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;
  const len = cleanText.length;

  while (i < len) {
    const char = cleanText[i];
    const nextChar = i + 1 < len ? cleanText[i + 1] : '';

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped double quote
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // End of quoted cell
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        // Any character inside quotes (including \r, \n, delimiters)
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        // Start of quoted cell
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        // End of cell
        currentRow.push(currentCell.trim());
        currentCell = '';
        i++;
        continue;
      } else if (char === '\r') {
        // Carriage return: handle CRLF or CR
        currentRow.push(currentCell.trim());
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
        if (nextChar === '\n') {
          i += 2;
        } else {
          i++;
        }
        continue;
      } else if (char === '\n') {
        // End of line
        currentRow.push(currentCell.trim());
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentCell += char;
        i++;
      }
    }
  }

  // Push last cell & row if not empty
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  // Filter out trailing empty rows
  const cleanRows = rows.filter((r) => r.some((c) => c.trim().length > 0));

  const firstHeaderRow = cleanRows[0];
  if (!firstHeaderRow) {
    return { headers: [], rows: [], delimiter };
  }

  const headers = firstHeaderRow.map((h) => h.trim());
  const bodyRows = cleanRows.slice(1);

  return {
    headers,
    rows: bodyRows,
    delimiter,
  };
}

/**
 * Heuristically infer column mapping based on standard Japanese and English open data headers.
 */
export function inferColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    title: null,
    area: null,
    address: null,
    category: null,
    lat: null,
    lng: null,
    currentStatus: null,
    note: null,
    url: null,
  };

  const cleanHeaders = headers.map((h) =>
    h
      .toLowerCase()
      .replace(/[\s_()（）[\]【】]/g, '')
  );

  const patterns: Record<ColumnField, RegExp[]> = {
    title: [
      /^(施設名|施設名称|避難所名|拠点名|タイトル|名称|名前|name|title|facilityname|sheltername)$/i,
      /(施設名|避難所名|拠点名|タイトル)/i,
    ],
    area: [
      /^(市区町村|市区町村名|市町村|地区|地区名|地域|エリア|自治体|city|area|district)$/i,
      /(市区町村|市町村|地区|地域|エリア)/i,
    ],
    address: [
      /^(所在地|住所|詳細住所|施設所在地|address|location)$/i,
      /(所在地|住所)/i,
    ],
    category: [
      /^(種別|区分|カテゴリ|施設種別|避難所種別|分類|category|type)$/i,
      /(種別|区分|カテゴリ)/i,
    ],
    lat: [
      /^(緯度|lat|latitude|y|緯度10進法)$/i,
      /(緯度|latitude)/i,
    ],
    lng: [
      /^(経度|lng|lon|longitude|x|経度10進法)$/i,
      /(経度|longitude)/i,
    ],
    currentStatus: [
      /^(開設状況|状況|ステータス|状態|開設|営業状況|受入状況|status|condition|state)$/i,
      /(開設状況|受入状況|ステータス)/i,
    ],
    note: [
      /^(備考|補足|詳細|メモ|連絡先|電話番号|定員|収容定員|note|remarks|description)$/i,
      /(備考|補足|メモ|連絡先)/i,
    ],
    url: [
      /^(url|リンク|ホームページ|ウェブサイト|情報源|sourceurl|link|website)$/i,
      /(url|ホームページ|リンク)/i,
    ],
  };

  const assignedIndices = new Set<number>();

  for (const field of Object.keys(patterns) as ColumnField[]) {
    const fieldPatterns = patterns[field];
    for (const pattern of fieldPatterns) {
      const idx = cleanHeaders.findIndex(
        (h, i) => !assignedIndices.has(i) && pattern.test(h)
      );
      if (idx !== -1) {
        mapping[field] = idx;
        assignedIndices.add(idx);
        break;
      }
    }
  }

  return mapping;
}

/**
 * Normalizes a status string into standard tossa status codes & labels.
 */
export function normalizeStatus(rawStatus?: string | null): {
  code: string;
  label: string;
} {
  if (!rawStatus) {
    return { code: 'available', label: '開設中' };
  }

  const s = rawStatus.trim().toLowerCase();

  // Available / Open
  if (
    /^(開設|開設中|開所|利用可能|利用可|営業中|通常営業|受付中|〇|○|open|available)$/i.test(
      s
    )
  ) {
    return { code: 'available', label: '開設中' };
  }

  // Crowded / Limited
  if (
    /^(混雑|やや混雑|残りわずか|受入制限|定員間近|要確認|crowded|limited|warning)$/i.test(
      s
    )
  ) {
    return { code: 'crowded', label: '混雑' };
  }

  // Closed / Inactive
  if (
    /^(閉鎖|閉鎖中|閉所|休止|休館|中止|配布終了|満員|終了|未開設|準備中|×|closed|danger)$/i.test(
      s
    )
  ) {
    return { code: 'closed', label: '閉鎖中' };
  }

  // Default: keep the label as-is, code as available
  return { code: 'available', label: rawStatus.trim() };
}

/**
 * Transforms parsed CSV rows into normalized post objects based on mapping.
 */
export function normalizeRows(
  rows: string[][],
  mapping: ColumnMapping,
  defaultArea = ''
): { valid: NormalizedImportPost[]; errors: { row: number; reason: string }[] } {
  const valid: NormalizedImportPost[] = [];
  const errors: { row: number; reason: string }[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 for 0-index, +1 for header line

    const getVal = (field: ColumnField): string => {
      const colIdx = mapping[field];
      if (colIdx === null || colIdx === undefined || colIdx >= row.length) {
        return '';
      }
      return (row[colIdx] || '').trim();
    };

    const title = getVal('title');
    let area = getVal('area') || defaultArea;
    const address = getVal('address') || undefined;
    const categoryName = getVal('category') || undefined;
    const rawLat = getVal('lat');
    const rawLng = getVal('lng');
    const rawStatus = getVal('currentStatus');
    const note = getVal('note') || undefined;
    const url = getVal('url') || undefined;

    if (!title) {
      errors.push({ row: rowNum, reason: '施設名・タイトルが空です' });
      return;
    }

    if (!area) {
      area = '地域未設定';
    }

    let lat: number | null = null;
    let lng: number | null = null;

    if (rawLat) {
      const parsedLat = parseFloat(rawLat);
      if (!isNaN(parsedLat) && parsedLat >= -90 && parsedLat <= 90) {
        lat = parsedLat;
      }
    }

    if (rawLng) {
      const parsedLng = parseFloat(rawLng);
      if (!isNaN(parsedLng) && parsedLng >= -180 && parsedLng <= 180) {
        lng = parsedLng;
      }
    }

    const { code, label } = normalizeStatus(rawStatus);

    valid.push({
      title,
      area,
      address,
      categoryName,
      lat,
      lng,
      currentStatus: code,
      statusLabel: label,
      note,
      url,
    });
  });

  return { valid, errors };
}

/**
 * Reads a File object from input, auto-detecting UTF-8 vs Shift_JIS (standard in Japanese Excel).
 */
export async function readFileAsText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  // Try decoding with UTF-8 first (fatal: true throws if invalid UTF-8 bytes encountered)
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(buffer);
  } catch {
    // If UTF-8 fails, fallback to Shift_JIS / Windows-31J
    try {
      const sjisDecoder = new TextDecoder('shift-jis');
      return sjisDecoder.decode(buffer);
    } catch {
      // Final fallback to standard non-fatal UTF-8
      const fallbackDecoder = new TextDecoder('utf-8');
      return fallbackDecoder.decode(buffer);
    }
  }
}

/**
 * Generates a template CSV string for disaster shelter / lifeline datasets.
 */
export function generateSampleCsv(): string {
  return `避難所名称,市区町村名,施設所在地,施設種別,開設状況,緯度,経度,備考,ホームページURL
桜山小学校体育館,熊本市中央区,熊本市中央区桜山1-1-1,避難所,開設中,32.8031,130.7082,体育館開放中。授乳室・バリアフリートイレあり,https://example.com/shelter1
東部総合区民センター,熊本市東区,熊本市東区東町2-3-4,避難所,混雑,32.8125,130.7241,収容定員間近。ペット同伴スペースは満員,https://example.com/shelter2
中央公園給水ステーション,熊本市中央区,熊本市中央区中央公園3,給水,開設中,32.7989,130.7015,給水中（8:00〜18:00）。ポリタンク持参推奨,https://example.com/water1
西部ふれあい会館,熊本市西区,熊本市西区西町4-5-6,避難所,閉鎖中,32.7850,130.6890,安全確認のため一時閉鎖中,https://example.com/shelter3`;
}
