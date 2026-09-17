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

// JSON-LD Context definition (Open Disaster Data compatible)
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

// GET /api/feed.json (Public Open Data GeoJSON-LD Feed)
// Open for external GIS applications, local authorities, and federated sites
federationRoute.get('/feed.json', async (c) => {
  const settings = await getSystemSettings(c.env.DB);
  const features = await exportAllPostsForFederation(c.env.DB);

  return new Response(
    JSON.stringify({
      '@context': GEOJSON_LD_CONTEXT,
      type: 'FeatureCollection',
      generator: 'tossa-federation-v1',
      siteTitle: settings.site_title || 'tossa',
      defaultArea: settings.default_area || '',
      exportedAt: new Date().toISOString(),
      totalFeatures: features.length,
      features,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/geo+json; charset=utf-8',
        'Cache-Control': 'no-cache',
        'CDN-Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    }
  );
});

// GET /api/federation/export (Archive & Migration export)
federationRoute.get('/export', async (c) => {
  const settings = await getSystemSettings(c.env.DB);
  const features = await exportAllPostsForFederation(c.env.DB);

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `tossa-backup-${dateStr}.geojson`;

  return new Response(
    JSON.stringify({
      '@context': GEOJSON_LD_CONTEXT,
      type: 'FeatureCollection',
      generator: 'tossa-federation-v1',
      siteTitle: settings.site_title || 'tossa',
      defaultArea: settings.default_area || '',
      exportedAt: new Date().toISOString(),
      totalFeatures: features.length,
      features,
    }),
    {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/geo+json; charset=utf-8',
        'Cache-Control': 'no-cache',
        'CDN-Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    }
  );
});

// POST /api/federation/import (Federate and synchronize with external sites)
// 1. Accepts GeoJSON body directly, or
// 2. Accepts remoteUrl and fetches /api/feed.json to merge
federationRoute.post('/import', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json(
      { success: false, error: 'Admin or moderator authorization required' },
      401
    );
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || (session.role !== 'admin' && session.role !== 'moderator')) {
    return c.json({ success: false, error: 'Permission denied' }, 403);
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
    // Remove trailing slash
    targetUrl = targetUrl.replace(/\/$/, '');

    // Try feed.json or export endpoint
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
            error: `Failed to fetch from remote site (HTTP ${res.status}): ${feedUrl}`,
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
            error: 'Invalid remote data format (missing features array)',
          },
          400
        );
      }

      featuresToImport = feedData.features;
    } catch (err: any) {
      return c.json(
        {
          success: false,
          error: `Remote site communication error: ${err.message}`,
        },
        500
      );
    }
  } else if (body.features && Array.isArray(body.features)) {
    featuresToImport = body.features;
  } else {
    return c.json(
      {
        success: false,
        error: 'Either features array or remoteUrl is required',
      },
      400
    );
  }

  const stats = await importFederatedPosts(c.env.DB, featuresToImport);

  return c.json({
    success: true,
    message: `Synchronization complete: ${stats.added} added, ${stats.updated} updated, ${stats.skipped} skipped`,
    stats,
  });
});
