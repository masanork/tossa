// src/routes/federation.ts: Federation, Migration & Open Data Feed
import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  exportAllPostsForFederation,
  importFederatedPosts,
  getSystemSettings,
  type FederatedGeoJSONFeature,
} from '../db/queries';
import { verifySessionToken } from '../auth/session';

export const federationRoute = new Hono<{ Bindings: Bindings }>();

// JSON-LD コンテキスト定義（オープンディザスタデータ互換）
const GEOJSON_LD_CONTEXT = [
  'https://geojson.org/geojson-ld/geojson-context.jsonld',
  {
    tossa: 'https://tossa.dev/schema#',
    currentStatus: 'tossa:currentStatus',
    statusLabel: 'tossa:statusLabel',
    sourceUrl: 'tossa:sourceUrl',
    imageMeta: 'tossa:imageMeta',
    verificationCount: 'tossa:verificationCount',
    statusHistory: 'tossa:statusHistory',
  },
];

// GET /api/feed.json (公開オープンデータ・GeoJSON-LD フィード)
// 誰でも、外部のGISアプリや自治体、他サイトから購読・集約可能
federationRoute.get('/feed.json', async (c) => {
  const settings = await getSystemSettings(c.env.DB);
  const features = await exportAllPostsForFederation(c.env.DB);

  c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
  c.header('Content-Type', 'application/geo+json; charset=utf-8');

  return c.json({
    '@context': GEOJSON_LD_CONTEXT,
    type: 'FeatureCollection',
    generator: 'tossa-federation-v1',
    siteTitle: settings.site_title || 'tossa',
    defaultArea: settings.default_area || '',
    exportedAt: new Date().toISOString(),
    totalFeatures: features.length,
    features,
  });
});

// GET /api/federation/export (アーカイブ・移行用エクスポート)
federationRoute.get('/export', async (c) => {
  const settings = await getSystemSettings(c.env.DB);
  const features = await exportAllPostsForFederation(c.env.DB);

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `tossa-backup-${dateStr}.geojson`;

  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  c.header('Content-Type', 'application/geo+json; charset=utf-8');

  return c.json({
    '@context': GEOJSON_LD_CONTEXT,
    type: 'FeatureCollection',
    generator: 'tossa-federation-v1',
    siteTitle: settings.site_title || 'tossa',
    defaultArea: settings.default_area || '',
    exportedAt: new Date().toISOString(),
    totalFeatures: features.length,
    features,
  });
});

// POST /api/federation/import (他サイトと合流・同期)
// 1. 直接 GeoJSON ボディを受け取る
// 2. または remoteUrl を受け取り、相手サーバーから /api/feed.json をフェッチしてマージ
federationRoute.post('/import', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: '管理者認証が必要です' }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return c.json({ success: false, error: '権限がありません' }, 403);
  }

  const body = await c.req.json<{
    features?: FederatedGeoJSONFeature[];
    remoteUrl?: string;
  }>();

  let featuresToImport: FederatedGeoJSONFeature[];

  if (body.remoteUrl) {
    let targetUrl = body.remoteUrl.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }
    // 末尾スラッシュ除去
    targetUrl = targetUrl.replace(/\/$/, '');

    // feed.json または export エンドポイントを試行
    const feedUrl = targetUrl.endsWith('/api/feed.json')
      ? targetUrl
      : `${targetUrl}/api/feed.json`;

    try {
      const res = await fetch(feedUrl, {
        headers: { Accept: 'application/geo+json, application/json' },
      });

      if (!res.ok) {
        return c.json(
          {
            success: false,
            error: `相手サイトからの取得に失敗しました (HTTP ${res.status}): ${feedUrl}`,
          },
          400
        );
      }

      const feedData = await res.json<{
        features?: FederatedGeoJSONFeature[];
      }>();
      if (!feedData.features || !Array.isArray(feedData.features)) {
        return c.json(
          {
            success: false,
            error:
              '相手サイトのデータ形式が不正です (features配列が見つかりません)',
          },
          400
        );
      }

      featuresToImport = feedData.features;
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: `相手サイトとの通信エラー: ${err.message}`,
        },
        500
      );
    }
  } else if (body.features && Array.isArray(body.features)) {
    featuresToImport = body.features;
  } else {
    return c.json(
      { success: false, error: 'features配列またはremoteUrlの指定が必要です' },
      400
    );
  }

  const stats = await importFederatedPosts(c.env.DB, featuresToImport);

  return c.json({
    success: true,
    message: `同期完了: ${stats.added} 件を新規追加、${stats.updated} 件を最新状態に更新しました（${stats.skipped} 件スキップ）`,
    stats,
  });
});
