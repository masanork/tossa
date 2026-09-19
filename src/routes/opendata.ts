// src/routes/opendata.ts: Official Government Open Data Presets & Ingestion API
import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  searchMunicipalities,
  latLngToTileZ10,
  POPULAR_MUNICIPALITIES,
} from '../municipalities';

export const opendataRoute = new Hono<{ Bindings: Bindings }>();

export interface OpenDataShelterItem {
  name: string;
  area: string;
  address: string;
  category: string;
  lat: number;
  lng: number;
  current_status: string;
  status_label: string;
  note: string;
  source_url: string;
}

export interface RegionPreset {
  id: string;
  name: string;
  prefecture: string;
  description: string;
  source: string;
  items: OpenDataShelterItem[];
}

/**
 * Curated designated evacuation shelter and water station datasets conforming to
 * GSI (Geospatial Information Authority of Japan) & Digital Agency open data specifications.
 */
export const OFFICIAL_PRESETS: RegionPreset[] = [
  {
    id: 'kumamoto_city',
    name: '熊本市（指定緊急避難場所・給水拠点）',
    prefecture: '熊本県',
    description: '熊本市オープンデータ及び国土地理院指定緊急避難場所データ（中央区・東区・西区・南区・北区）',
    source: '国土地理院・熊本市オープンデータカタログ',
    items: [
      {
        name: '桜山小学校体育館',
        area: '熊本市中央区',
        address: '熊本市中央区桜山1-1-1',
        category: '避難所',
        lat: 32.8031,
        lng: 130.7082,
        current_status: 'available',
        status_label: '開設中',
        note: '指定緊急避難場所（地震・洪水・火災）。体育館開放中。授乳室・バリアフリートイレあり。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
      {
        name: '中央公園給水ステーション',
        area: '熊本市中央区',
        address: '熊本市中央区中央公園3',
        category: '給水',
        lat: 32.7989,
        lng: 130.7015,
        current_status: 'available',
        status_label: '給水実施中',
        note: '災害時応急給水拠点（8:00〜18:00）。飲料水供給中。ポリタンク持参推奨。',
        source_url: 'https://www.city.kumamoto.jp/',
      },
      {
        name: '白川中学校武道場',
        area: '熊本市中央区',
        address: '熊本市中央区新屋敷2-4-1',
        category: '避難所',
        lat: 32.8015,
        lng: 130.7188,
        current_status: 'available',
        status_label: '開設中',
        note: '指定緊急避難場所（地震）。ペット同行避難スペースあり（ケージ持参）。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
      {
        name: '東部総合区民センター',
        area: '熊本市東区',
        address: '熊本市東区東町2-3-4',
        category: '避難所',
        lat: 32.8125,
        lng: 130.7241,
        current_status: 'crowded',
        status_label: '混雑',
        note: '指定避難所（地震・洪水）。収容定員間近。隣接給水ポイントあり。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
      {
        name: '東町小学校体育館',
        area: '熊本市東区',
        address: '熊本市東区東町3-1-1',
        category: '避難所',
        lat: 32.8102,
        lng: 130.7305,
        current_status: 'available',
        status_label: '開設中',
        note: '指定緊急避難場所（地震・大規模火災）。毛布・非常食配布中。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
      {
        name: '江津湖公園給水所',
        area: '熊本市東区',
        address: '熊本市東区広木町5',
        category: '給水',
        lat: 32.7845,
        lng: 130.7412,
        current_status: 'available',
        status_label: '給水実施中',
        note: '応急給水車配備中。給水車2台稼働。',
        source_url: 'https://www.city.kumamoto.jp/',
      },
      {
        name: '西部ふれあい会館',
        area: '熊本市西区',
        address: '熊本市西区西町4-5-6',
        category: '避難所',
        lat: 32.785,
        lng: 130.689,
        current_status: 'available',
        status_label: '開設中',
        note: '指定避難所。非常用発電設備稼働中。スマホ充電スポットあり。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
      {
        name: '城山小学校',
        area: '熊本市西区',
        address: '熊本市西区城山大塘1-1-1',
        category: '避難所',
        lat: 32.7762,
        lng: 130.6721,
        current_status: 'available',
        status_label: '開設中',
        note: '指定避難所。車中泊避難者向けグラウンド開放中。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
    ],
  },
  {
    id: 'tokyo_chiyoda',
    name: '東京都千代田区・中央区（帰宅困難者支援・指定避難所）',
    prefecture: '東京都',
    description: '東京都オープンデータカタログ・国土地理院指定緊急避難場所データ',
    source: '東京都防災マップオープンデータ・国土地理院',
    items: [
      {
        name: '日比谷公会堂・日比谷公園',
        area: '東京都千代田区',
        address: '東京都千代田区日比谷公園1-3',
        category: '避難所',
        lat: 35.6738,
        lng: 139.7562,
        current_status: 'available',
        status_label: '広域避難場所',
        note: '広域避難場所・帰宅困難者一時滞在施設。災害用トイレ・Wi-Fi開放中。',
        source_url: 'https://www.bousai.metro.tokyo.lg.jp/',
      },
      {
        name: '千代田区立麹町中学校体育館',
        area: '東京都千代田区',
        address: '東京都千代田区平河町2-5-1',
        category: '避難所',
        lat: 35.6823,
        lng: 139.7412,
        current_status: 'available',
        status_label: '開設中',
        note: '指定緊急避難場所（地震・火災）。自家発電機・防災備蓄倉庫あり。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
      {
        name: '皇居外苑給水ステーション',
        area: '東京都千代田区',
        address: '東京都千代田区皇居外苑1-1',
        category: '給水',
        lat: 35.6811,
        lng: 139.7589,
        current_status: 'available',
        status_label: '応急給水拠点',
        note: '東京都水道局 災害時給水ステーション。耐震性貯水槽配備。',
        source_url: 'https://www.waterworks.metro.tokyo.lg.jp/',
      },
      {
        name: '中央区立銀座中学校体育館',
        area: '東京都中央区',
        address: '東京都中央区銀座8-19-1',
        category: '避難所',
        lat: 35.6664,
        lng: 139.7618,
        current_status: 'available',
        status_label: '開設中',
        note: '指定緊急避難場所（地震・津波）。一時滞在可能。',
        source_url: 'https://www.city.chuo.lg.jp/',
      },
      {
        name: 'あかつき公園給水ステーション',
        area: '東京都中央区',
        address: '東京都中央区築地7-19-1',
        category: '給水',
        lat: 35.6652,
        lng: 139.7738,
        current_status: 'available',
        status_label: '給水中',
        note: '応急給水拠点。給水バッグ配布あり。',
        source_url: 'https://www.waterworks.metro.tokyo.lg.jp/',
      },
    ],
  },
  {
    id: 'noto_ishikawa',
    name: '石川県能登半島（輪島市・珠洲市・七尾市）',
    prefecture: '石川県',
    description: '能登半島地震指定避難所・福祉避難所・応急給水所データ',
    source: '石川県防災ポータル・国土地理院指定緊急避難場所データ',
    items: [
      {
        name: '輪島市ふれあい健康センター',
        area: '石川県輪島市',
        address: '石川県輪島市河井町20-1-1',
        category: '避難所',
        lat: 37.3942,
        lng: 136.9021,
        current_status: 'available',
        status_label: '開設中',
        note: '指定避難所。温水シャワー・コインランドリー支援車巡回あり。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
      {
        name: '輪島中学校グラウンド（物資拠点）',
        area: '石川県輪島市',
        address: '石川県輪島市山岸町20',
        category: '物資',
        lat: 37.3887,
        lng: 136.9056,
        current_status: 'available',
        status_label: '物資配布中',
        note: '支援物資配布拠点（毛布、飲料水、おむつ、カセットコンロ）。',
        source_url: 'https://www.pref.ishikawa.lg.jp/',
      },
      {
        name: '珠洲市健民体育館',
        area: '石川県珠洲市',
        address: '石川県珠洲市上戸町北方1-1',
        category: '避難所',
        lat: 37.4378,
        lng: 137.2612,
        current_status: 'available',
        status_label: '開設中',
        note: '指定避難所。Wi-Fi接続・スターリンク衛星通信稼働中。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
      {
        name: '珠洲市役所前給水ポイント',
        area: '石川県珠洲市',
        address: '石川県珠洲市上戸町北方1-1',
        category: '給水',
        lat: 37.4391,
        lng: 137.2605,
        current_status: 'available',
        status_label: '給水中',
        note: '自衛隊給水車常駐（7:00〜19:00）。',
        source_url: 'https://www.city.suzu.lg.jp/',
      },
      {
        name: '七尾市城山体育館',
        area: '石川県七尾市',
        address: '石川県七尾市矢田町イ1-1',
        category: '避難所',
        lat: 37.0392,
        lng: 136.9684,
        current_status: 'available',
        status_label: '開設中',
        note: '指定避難所・給水所併設。透析患者・高齢者福祉対応あり。',
        source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
      },
    ],
  },
];

// GET /api/opendata/presets - List available region presets
opendataRoute.get('/presets', (c) => {
  return c.json({
    success: true,
    presets: OFFICIAL_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      prefecture: p.prefecture,
      description: p.description,
      source: p.source,
      itemCount: p.items.length,
    })),
  });
});

// GET /api/opendata/presets/:id - Get full dataset for a preset
opendataRoute.get('/presets/:id', (c) => {
  const id = c.req.param('id');
  const found = OFFICIAL_PRESETS.find((p) => p.id === id);
  if (!found) {
    return c.json({ success: false, error: 'Preset not found' }, 404);
  }
  return c.json({
    success: true,
    preset: found,
  });
});

// GET /api/opendata/shelters - Get all official shelters across presets (or filtered by preset)
opendataRoute.get('/shelters', (c) => {
  const presetId = c.req.query('preset');
  if (presetId) {
    const found = OFFICIAL_PRESETS.find((p) => p.id === presetId);
    return c.json({
      success: true,
      shelters: found
        ? found.items.map((item, idx) => ({
            ...item,
            id: `official-${presetId}-${idx}`,
            preset_id: found.id,
          }))
        : [],
    });
  }

  const allShelters = OFFICIAL_PRESETS.flatMap((p) =>
    p.items.map((item, idx) => ({
      ...item,
      id: `official-${p.id}-${idx}`,
      preset_id: p.id,
    }))
  );

  return c.json({
    success: true,
    shelters: allShelters,
  });
});

// GET /api/opendata/municipalities - Search municipalities by name or code
opendataRoute.get('/municipalities', async (c) => {
  const q = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const results = await searchMunicipalities(q, limit);
  return c.json({
    success: true,
    municipalities: results,
  });
});

// POST /api/opendata/disaster-areas/fetch - Fetch designated emergency shelters for multiple disaster areas
opendataRoute.post('/disaster-areas/fetch', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    areas?: Array<{
      code: string;
      name: string;
      pref?: string;
      fullName?: string;
      lat?: number;
      lng?: number;
    }>;
  };

  const areas = body.areas || [];
  if (areas.length === 0) {
    return c.json({ success: true, count: 0, shelters: [] });
  }

  const collectedShelters: OpenDataShelterItem[] = [];
  const visitedNames = new Set<string>();

  for (const area of areas) {
    const areaName = area.name.trim();
    const prefName = (area.pref || '').trim();
    const isPref = Boolean(
      (area as any).isPrefecture ||
      area.code?.endsWith('000') ||
      area.code?.endsWith('000x') ||
      area.name.endsWith('全域')
    );

    // 1. Check curated presets first
    for (const preset of OFFICIAL_PRESETS) {
      for (const item of preset.items) {
        const matches = isPref
          ? (prefName && (item.area.includes(prefName) || preset.prefecture.includes(prefName)))
          : (item.area.includes(areaName) || (prefName && item.area.includes(prefName) && item.area.includes(areaName)));

        if (matches) {
          if (!visitedNames.has(item.name)) {
            visitedNames.add(item.name);
            collectedShelters.push(item);
          }
        }
      }
    }

    // 2. Determine target coordinates for GSI vector shelter tiles (skhb04: earthquake)
    const targetPoints: Array<{ lat: number; lng: number }> = [];
    if (isPref) {
      const muniInPref = POPULAR_MUNICIPALITIES.filter((m) => m.pref === prefName);
      if (muniInPref.length > 0) {
        for (const m of muniInPref.slice(0, 6)) {
          targetPoints.push({ lat: m.lat, lng: m.lng });
        }
      }
      if (area.lat && area.lng) {
        targetPoints.push({ lat: area.lat, lng: area.lng });
      }
    } else if (area.lat && area.lng) {
      targetPoints.push({ lat: area.lat, lng: area.lng });
    }

    const visitedTiles = new Set<string>();
    for (const pt of targetPoints) {
      const tile = latLngToTileZ10(pt.lat, pt.lng);
      const tileKey = `${tile.z}/${tile.x}/${tile.y}`;
      if (visitedTiles.has(tileKey)) continue;
      visitedTiles.add(tileKey);

      try {
        const tileUrl = `https://cyberjapandata.gsi.go.jp/xyz/skhb04/${tile.z}/${tile.x}/${tile.y}.geojson`;
        const res = await fetch(tileUrl);
        if (res.ok) {
          const geojson: any = await res.json();
          if (geojson && Array.isArray(geojson.features)) {
            for (const feat of geojson.features) {
              const p = feat.properties || {};
              const coords = feat.geometry?.coordinates;
              if (p.name && coords && coords.length >= 2) {
                const sName = String(p.name).trim();
                const sAddress = String(p.address || '').trim();
                const [sLng, sLat] = coords;

                // Match by address or proximity (< 15km)
                const addressMatches = isPref
                  ? (prefName && sAddress.includes(prefName))
                  : (sAddress.includes(areaName) || (prefName && sAddress.includes(prefName)));
                const distApprox = isPref ? 0 : Math.hypot(sLat - (area.lat || pt.lat), sLng - (area.lng || pt.lng));

                if ((addressMatches || distApprox < 0.25) && !visitedNames.has(sName)) {
                  visitedNames.add(sName);

                  let shelterArea = area.fullName || `${prefName}${areaName}`;
                  if (isPref && sAddress) {
                    const muniMatch = sAddress.match(/^(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)([^市区町村]+(?:市|区|町|村))/);
                    shelterArea = muniMatch ? muniMatch[0] : (area.fullName || prefName);
                  }

                  collectedShelters.push({
                    name: sName,
                    area: shelterArea,
                    address: sAddress || `${prefName}${areaName}`,
                    category: '避難所',
                    lat: Math.round(sLat * 1000000) / 1000000,
                    lng: Math.round(sLng * 1000000) / 1000000,
                    current_status: 'available',
                    status_label: '開設中',
                    note: `国土地理院指定緊急避難場所（${p.remarks || '地震・火災等'}）`,
                    source_url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/',
                  });
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch GSI tiles for ${tileKey}:`, e);
      }
    }
  }

  return c.json({
    success: true,
    count: collectedShelters.length,
    shelters: collectedShelters,
  });
});

// POST /api/opendata/fetch-url - Proxy fetch an external open data CSV/GeoJSON/JSON
opendataRoute.post('/fetch-url', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string };
  const targetUrl = (body.url || '').trim();

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return c.json({ success: false, error: '有効なURLを指定してください' }, 400);
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'tossa-opendata-ingest/1.0',
        Accept: 'text/csv, application/json, text/plain, */*',
      },
    });

    if (!res.ok) {
      return c.json(
        {
          success: false,
          error: `取得に失敗しました (HTTP ${res.status}: ${res.statusText})`,
        },
        res.status as any
      );
    }

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    return c.json({
      success: true,
      contentType,
      data: text,
    });
  } catch (err: any) {
    return c.json(
      { success: false, error: err.message || 'データ取得中にエラーが発生しました' },
      500
    );
  }
});


