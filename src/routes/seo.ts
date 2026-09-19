// src/routes/seo.ts: SEO, AI Findability, Discovery Endpoints & SSR Dynamic Metadata
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Bindings, Post } from '../types';
import {
  getSystemSettings,
  getPosts,
  getPostById,
  exportAllPostsForFederation,
} from '../db/queries';

export const seoRoute = new Hono<{ Bindings: Bindings }>();

/** Helper to escape special HTML characters */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Helper to escape XML characters */
export function escapeXml(str: string): string {
  return escapeHtml(str);
}

/** Safely serialize JSON for embedding in <script type="application/ld+json"> */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** Determine base origin from request or env */
export function getOrigin(c: Context<{ Bindings: Bindings }>): string {
  if (c.env.EXPECTED_ORIGIN) {
    return c.env.EXPECTED_ORIGIN.replace(/\/+$/, '');
  }
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

/** Parse post tags safely */
function parseTags(tags: string | string[] | null | undefined): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// 1. GET /robots.txt
// --------------------------------------------------------------------------
seoRoute.get('/robots.txt', (c) => {
  const origin = getOrigin(c);
  const robots = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/auth/',
    'Disallow: /api/threads/',
    'Disallow: /api/push/',
    '',
    '# AI Search & Retrieval Crawlers',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    '',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    '',
    'User-agent: Claude-Web',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    'User-agent: Applebot-Extended',
    'Allow: /',
    '',
    'User-agent: Amazonbot',
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
  ].join('\n');

  return new Response(robots, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
});

// --------------------------------------------------------------------------
// 2. GET /sitemap.xml
// --------------------------------------------------------------------------
seoRoute.get('/sitemap.xml', async (c) => {
  const origin = getOrigin(c);
  const { posts } = await getPosts(c.env.DB, { limit: 200 });

  const now = new Date().toISOString();
  let latestPostDate = now;
  if (posts.length > 0 && posts[0]?.updated_at) {
    latestPostDate = new Date(posts[0].updated_at).toISOString();
  }

  const urls: Array<{
    loc: string;
    lastmod?: string;
    changefreq: string;
    priority: string;
  }> = [
    {
      loc: `${origin}/`,
      lastmod: latestPostDate,
      changefreq: 'always',
      priority: '1.0',
    },
    {
      loc: `${origin}/llms.txt`,
      lastmod: latestPostDate,
      changefreq: 'hourly',
      priority: '0.9',
    },
    {
      loc: `${origin}/llms-full.txt`,
      lastmod: latestPostDate,
      changefreq: 'always',
      priority: '0.9',
    },
    {
      loc: `${origin}/feed.xml`,
      lastmod: latestPostDate,
      changefreq: 'always',
      priority: '0.8',
    },
    {
      loc: `${origin}/api/feed.json`,
      lastmod: latestPostDate,
      changefreq: 'always',
      priority: '0.8',
    },
    { loc: `${origin}/mcp`, changefreq: 'daily', priority: '0.7' },
  ];

  for (const post of posts) {
    let postMod = now;
    if (post.updated_at) {
      try {
        postMod = new Date(post.updated_at).toISOString();
      } catch {
        postMod = now;
      }
    }
    urls.push({
      loc: `${origin}/posts/${post.id}`,
      lastmod: postMod,
      changefreq: 'hourly',
      priority: '0.8',
    });
  }

  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) =>
      [
        '  <url>',
        `    <loc>${escapeXml(u.loc)}</loc>`,
        u.lastmod ? `    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : '',
        `    <changefreq>${u.changefreq}</changefreq>`,
        `    <priority>${u.priority}</priority>`,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n')
    ),
    '</urlset>',
  ].join('\n');

  return new Response(sitemapXml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
});

// --------------------------------------------------------------------------
// 3. GET /llms.txt (AI Retrieval Context Standard)
// --------------------------------------------------------------------------
seoRoute.get('/llms.txt', async (c) => {
  const origin = getOrigin(c);
  const settings = await getSystemSettings(c.env.DB);
  const siteTitle = settings.site_title || 'tossa';
  const emergencyBanner = settings.emergency_banner || '';
  const defaultArea = settings.default_area || '';
  const { total } = await getPosts(c.env.DB, { limit: 1 });

  const markdown = [
    `# ${siteTitle}`,
    '',
    `> ${emergencyBanner || '地域の状況を迅速に共有・確認できる超軽量情報プラットフォーム'}`,
    '',
    '## Overview',
    siteTitle +
      ' is an ultra-lightweight, resilient local communication and disaster assistance platform designed for both daily life and disaster emergencies. It provides real-time, verified status of facilities (water stations, shelters, stores, supply hubs, medical aid, power outlets).',
    '',
    '## Current System Status',
    `- Site Title: ${siteTitle}`,
    `- Operation Mode: ${emergencyBanner ? '🚨 EMERGENCY ALERT ACTIVE' : '✅ NORMAL OPERATIONS'}`,
    emergencyBanner ? `- Active Emergency Banner: ${emergencyBanner}` : '',
    defaultArea ? `- Default Service Area: ${defaultArea}` : '',
    `- Total Tracked Facilities: ${total}`,
    `- Last Checked: ${new Date().toISOString()}`,
    '',
    '## Machine-Readable Data Endpoints for AI & Crawlers',
    `- [Full Facilities Text Digest](${origin}/llms-full.txt): Complete, up-to-the-minute markdown digest of all facilities, status, addresses, and GPS coordinates. Optimized for LLM RAG & context ingestion.`,
    `- [Open Data GeoJSON-LD Feed](${origin}/api/feed.json): Standard GeoJSON FeatureCollection with disaster-context LD schemas for GIS and mapping engines.`,
    `- [GeoRSS Feed](${origin}/feed.xml): RSS 2.0 with geographic point extensions (georss:point).`,
    `- [Model Context Protocol (MCP)](${origin}/mcp): Streamable HTTP / Server-Sent Events endpoint for autonomous AI agents.`,
    `- [REST API: Posts](${origin}/api/posts): Query facilities by coordinates, area, tags, or keyword query.`,
    '',
    '## Status Vocabulary Definitions',
    '- `available` / `open`: 利用可能 / 通常営業 / 開設中 (Facility is open, resources available)',
    '- `crowded` / `few` / `low_stock`: 混雑 / 残りわずか (High wait time or limited supplies remaining)',
    '- `closed` / `danger` / `out_of_stock`: 休止 / 危険 / 配布終了 (Temporarily closed, danger present, or exhausted)',
    '- `unknown`: 状況不明・確認中 (Status unconfirmed or awaiting field verification)',
    '',
    '## Verification System',
    'Posts can be verified by local administrators (official checkmark) and community peers via tamper-evident device sessions and WebAuthn signatures.',
  ]
    .filter(Boolean)
    .join('\n');

  return new Response(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
});

// --------------------------------------------------------------------------
// 4. GET /llms-full.txt (Live Markdown Digest of All Facilities)
// --------------------------------------------------------------------------
seoRoute.get('/llms-full.txt', async (c) => {
  const origin = getOrigin(c);
  const settings = await getSystemSettings(c.env.DB);
  const siteTitle = settings.site_title || 'tossa';
  const emergencyBanner = settings.emergency_banner || '';
  const { posts } = await getPosts(c.env.DB, { limit: 200 });

  const lines: string[] = [
    `# ${siteTitle} - 施設・支援状況リアルタイム一覧 (Live Digest)`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Total Active Facilities: ${posts.length}`,
  ];

  if (emergencyBanner) {
    lines.push('');
    lines.push(
      `> ⚠️ 【緊急発表 / EMERGENCY ANNOUNCEMENT】: ${emergencyBanner}`
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  for (const post of posts) {
    const tags = parseTags(post.tags);
    const tagString =
      tags.length > 0 ? tags.map((t) => `#${t}`).join(' ') : 'None';
    const statusText = post.status_label
      ? `${post.status_label} (${post.current_status})`
      : post.current_status;

    lines.push(`## ${post.title}`);
    lines.push(`- URL: ${origin}/posts/${post.id}`);
    lines.push(`- Status: ${statusText}`);
    lines.push(`- Area: ${post.area}`);
    if (post.address) lines.push(`- Address: ${post.address}`);
    if (post.lat !== null && post.lng !== null) {
      lines.push(`- Coordinates: ${post.lat}, ${post.lng}`);
    }
    if (post.category_name) lines.push(`- Category: ${post.category_name}`);
    lines.push(`- Tags: ${tagString}`);
    lines.push(`- Community Verifications: ${post.verification_count}`);
    if (post.is_verified === 1) lines.push('- Official Verified: Yes');
    if (post.note) lines.push(`- Details: ${post.note}`);
    lines.push(`- Last Updated: ${post.updated_at}`);
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=120, stale-while-revalidate=600',
    },
  });
});

// --------------------------------------------------------------------------
// 5. GET /feed.xml (RSS 2.0 with GeoRSS)
// --------------------------------------------------------------------------
seoRoute.get('/feed.xml', async (c) => {
  const origin = getOrigin(c);
  const settings = await getSystemSettings(c.env.DB);
  const siteTitle = settings.site_title || 'tossa';
  const siteDescription =
    settings.emergency_banner ||
    '地域の状況を迅速に共有・確認できる超軽量情報プラットフォーム';
  const { posts } = await getPosts(c.env.DB, { limit: 50 });

  const items = posts.map((post) => {
    const tags = parseTags(post.tags);
    const pubDate = post.updated_at
      ? new Date(post.updated_at).toUTCString()
      : new Date().toUTCString();
    const statusLabel = post.status_label || post.current_status;
    const desc = [
      `状況: ${statusLabel}`,
      `地域: ${post.area}`,
      post.address ? `住所: ${post.address}` : '',
      post.note ? `詳細: ${post.note}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    return [
      '    <item>',
      `      <title>${escapeXml(post.title)} - ${escapeXml(statusLabel)}</title>`,
      `      <link>${origin}/posts/${escapeXml(post.id)}</link>`,
      `      <guid isPermaLink="true">${origin}/posts/${escapeXml(post.id)}</guid>`,
      `      <pubDate>${pubDate}</pubDate>`,
      `      <description><![CDATA[${desc}]]></description>`,
      post.category_name
        ? `      <category>${escapeXml(post.category_name)}</category>`
        : '',
      ...tags.map((t) => `      <category>${escapeXml(t)}</category>`),
      post.lat !== null && post.lng !== null
        ? `      <georss:point>${post.lat} ${post.lng}</georss:point>`
        : '',
      '    </item>',
    ]
      .filter(Boolean)
      .join('\n');
  });

  const rss = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:georss="http://www.georss.org/georss" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(siteTitle)}</title>`,
    `    <link>${origin}</link>`,
    `    <description>${escapeXml(siteDescription)}</description>`,
    '    <language>ja</language>',
    `    <atom:link href="${origin}/feed.xml" rel="self" type="application/rss+xml" />`,
    items.join('\n'),
    '  </channel>',
    '</rss>',
  ].join('\n');

  return new Response(rss, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=120, stale-while-revalidate=600',
    },
  });
});

// --------------------------------------------------------------------------
// 6. GET /api/posts.geojson (Alias / Forward to GeoJSON feed)
// --------------------------------------------------------------------------
seoRoute.get('/api/posts.geojson', async (c) => {
  const settings = await getSystemSettings(c.env.DB);
  const features = await exportAllPostsForFederation(c.env.DB);

  return new Response(
    JSON.stringify({
      type: 'FeatureCollection',
      generator: 'tossa-seo-geojson',
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
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=60',
      },
    }
  );
});

// --------------------------------------------------------------------------
// 7. HTML Prerendering & Dynamic Meta Injection (SSR) for / and /posts/:id
// --------------------------------------------------------------------------

const FALLBACK_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>tossa</title>
    <meta name="description" content="tossa - 地域の状況を迅速に共有・確認できる超軽量情報プラットフォーム" />
  </head>
  <body class="min-h-screen bg-slate-50 text-slate-900">
    <div id="app"></div>
  </body>
</html>`;

/**
 * Fetch base index.html from c.env.ASSETS or use fallback HTML
 */
async function getBaseHtml(
  c: Context<{ Bindings: Bindings }>
): Promise<string> {
  if (c.env.ASSETS) {
    try {
      const assetUrl = new URL('/', c.req.url);
      const assetRes = await c.env.ASSETS.fetch(new Request(assetUrl));
      if (assetRes.ok) {
        return await assetRes.text();
      }
    } catch {
      // Fallback
    }
  }
  return FALLBACK_HTML;
}

/**
 * Render HTML with dynamic Title, Meta Description, OGP, Twitter Cards, Schema.org JSON-LD & Semantic <noscript>
 */
export async function renderHtmlWithSeo(
  c: Context<{ Bindings: Bindings }>,
  targetPostId?: string
): Promise<Response> {
  const origin = getOrigin(c);
  const settings = await getSystemSettings(c.env.DB);
  const siteTitle = settings.site_title || 'tossa';
  const emergencyBanner = settings.emergency_banner || '';
  const baseHtml = await getBaseHtml(c);

  let title = `${siteTitle} - 地域の状況を迅速に共有・確認できる超軽量情報プラットフォーム`;
  let description =
    emergencyBanner ||
    '地域の施設・給水所・避難所・店舗の最新状況をリアルタイムに共有・確認できる超軽量情報プラットフォームです。';
  let pageUrl = `${origin}/`;
  let imageUrl = `${origin}/favicon.svg`;
  let post: Post | null = null;
  let jsonLd: Record<string, unknown>;
  let noscriptContent: string;

  if (targetPostId) {
    post = await getPostById(c.env.DB, targetPostId);
    pageUrl = `${origin}/posts/${targetPostId}`;

    if (post) {
      const statusText = post.status_label || post.current_status;
      title = `【${statusText}】${post.title} | ${siteTitle}`;
      const descParts = [
        post.area,
        post.address,
        `状況: ${statusText}`,
        post.note,
      ].filter(Boolean);
      if (post.image_url) {
        imageUrl = post.image_url.startsWith('http')
          ? post.image_url
          : `${origin}${post.image_url}`;
      } else {
        imageUrl = `${origin}/api/posts/${post.id}/ogp.svg`;
      }

      // Schema.org entity for single post
      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'CivicStructure',
        '@id': pageUrl,
        name: post.title,
        description: `${statusText} - ${post.note || post.title}`,
        url: pageUrl,
        dateModified: post.updated_at,
        ...(post.address
          ? {
              address: {
                '@type': 'PostalAddress',
                streetAddress: post.address,
                addressLocality: post.area,
              },
            }
          : {}),
        ...(post.lat !== null && post.lng !== null
          ? {
              geo: {
                '@type': 'GeoCoordinates',
                latitude: post.lat,
                longitude: post.lng,
              },
            }
          : {}),
      };

      noscriptContent = `
<main style="max-width: 800px; margin: 2rem auto; padding: 1rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6;">
  <nav style="margin-bottom: 1rem;"><a href="/" style="color: #2563eb; text-decoration: none;">← ホームに戻る</a></nav>
  <article style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="display: inline-block; background: #2563eb; color: #fff; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: bold; font-size: 0.875rem; margin-bottom: 0.75rem;">
      ${escapeHtml(statusText)}
    </div>
    <h1 style="font-size: 1.75rem; margin-top: 0; margin-bottom: 0.5rem; color: #0f172a;">${escapeHtml(post.title)}</h1>
    <p style="color: #475569; margin: 0.25rem 0;"><strong>地域:</strong> ${escapeHtml(post.area)}</p>
    ${post.address ? `<p style="color: #475569; margin: 0.25rem 0;"><strong>住所:</strong> ${escapeHtml(post.address)}</p>` : ''}
    ${post.lat !== null && post.lng !== null ? `<p style="color: #475569; margin: 0.25rem 0;"><strong>座標:</strong> ${post.lat}, ${post.lng}</p>` : ''}
    ${post.note ? `<div style="margin-top: 1rem; padding: 1rem; background: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9;"><p style="margin: 0; color: #334155;">${escapeHtml(post.note)}</p></div>` : ''}
    <p style="margin-top: 1.5rem; font-size: 0.75rem; color: #94a3b8;">最終更新: ${post.updated_at}</p>
  </article>
</main>`;
    } else {
      title = `情報が見つかりませんでした | ${siteTitle}`;
      description = `指定された施設・投稿 (${targetPostId}) は存在しないか、削除された可能性があります。`;
      jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        url: pageUrl,
      };
      noscriptContent = `
<main style="max-width: 800px; margin: 2rem auto; padding: 1rem; font-family: sans-serif;">
  <p><a href="/">← ホームに戻る</a></p>
  <h1>投稿が見つかりませんでした</h1>
  <p>${escapeHtml(description)}</p>
</main>`;
    }
  } else {
    // Root page /
    const { posts } = await getPosts(c.env.DB, { limit: 25 });
    if (emergencyBanner) {
      title = `【緊急情報】${siteTitle} - ${emergencyBanner.slice(0, 30)}`;
    }

    const items = posts.map((p, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      item: {
        '@type': 'CivicStructure',
        name: p.title,
        url: `${origin}/posts/${p.id}`,
        description: p.note || p.status_label || p.current_status,
        ...(p.address
          ? {
              address: {
                '@type': 'PostalAddress',
                streetAddress: p.address,
                addressLocality: p.area,
              },
            }
          : {}),
        ...(p.lat !== null && p.lng !== null
          ? {
              geo: {
                '@type': 'GeoCoordinates',
                latitude: p.lat,
                longitude: p.lng,
              },
            }
          : {}),
      },
    }));

    jsonLd = emergencyBanner
      ? {
          '@context': 'https://schema.org',
          '@type': 'SpecialAnnouncement',
          name: siteTitle,
          text: emergencyBanner,
          datePosted: new Date().toISOString(),
          url: origin,
          spatialCoverage: settings.default_area || undefined,
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `${siteTitle} - 施設・支援状況`,
          itemListElement: items,
        };

    const postItemsHtml = posts
      .map((p) => {
        const statusLabel = p.status_label || p.current_status;
        return `
    <li style="margin-bottom: 1.25rem; padding-bottom: 1.25rem; border-bottom: 1px solid #e2e8f0;">
      <h3 style="margin: 0 0 0.25rem 0; font-size: 1.15rem;">
        <a href="/posts/${escapeHtml(p.id)}" style="color: #0f172a; text-decoration: underline;">${escapeHtml(p.title)}</a>
        <span style="display: inline-block; margin-left: 0.5rem; background: #e0e7ff; color: #3730a3; padding: 0.1rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">${escapeHtml(statusLabel)}</span>
      </h3>
      <p style="margin: 0.25rem 0; color: #475569; font-size: 0.875rem;">地域: ${escapeHtml(p.area)}${p.address ? ` | 住所: ${escapeHtml(p.address)}` : ''}</p>
      ${p.note ? `<p style="margin: 0.25rem 0; color: #334155; font-size: 0.9rem;">${escapeHtml(p.note)}</p>` : ''}
      <small style="color: #94a3b8; font-size: 0.75rem;">最終更新: ${p.updated_at}</small>
    </li>`;
      })
      .join('');

    noscriptContent = `
<main style="max-width: 800px; margin: 2rem auto; padding: 1rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6;">
  <header style="margin-bottom: 1.5rem;">
    <h1 style="font-size: 2rem; color: #0f172a; margin-bottom: 0.5rem;">${escapeHtml(siteTitle)}</h1>
    <p style="color: #475569; margin: 0;">${escapeHtml(description)}</p>
  </header>
  ${
    emergencyBanner
      ? `<div style="background: #fef2f2; border: 1px solid #f87171; border-left: 4px solid #dc2626; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; color: #991b1b;">
          <strong>🚨 緊急連絡:</strong> ${escapeHtml(emergencyBanner)}
        </div>`
      : ''
  }
  <section>
    <h2 style="font-size: 1.25rem; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 1rem;">最新の施設・支援状況</h2>
    <ul style="list-style: none; padding: 0; margin: 0;">
      ${postItemsHtml}
    </ul>
  </section>
</main>`;
  }

  // Generate injection tags
  const tagsToInject = [
    `<link rel="canonical" href="${escapeHtml(pageUrl)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteTitle)}" />`,
    `<meta property="og:type" content="${targetPostId ? 'article' : 'website'}" />`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    `<link rel="alternate" type="application/rss+xml" title="${escapeXml(siteTitle)} RSS Feed" href="${origin}/feed.xml" />`,
    `<link rel="alternate" type="application/geo+json" title="${escapeXml(siteTitle)} GeoJSON-LD" href="${origin}/api/feed.json" />`,
    `<link rel="sitemap" type="application/xml" title="Sitemap" href="${origin}/sitemap.xml" />`,
    `<link rel="help" type="text/markdown" title="AI / LLM Context" href="${origin}/llms.txt" />`,
    `<script type="application/ld+json">${safeJsonLd(jsonLd)}</script>`,
  ].join('\n    ');

  let transformed = baseHtml;

  // Replace <title>...</title>
  if (/<title>.*?<\/title>/i.test(transformed)) {
    transformed = transformed.replace(
      /<title>.*?<\/title>/i,
      `<title>${escapeHtml(title)}</title>`
    );
  }

  // Replace <meta name="description" ...>
  if (/<meta\s+name=["']description["'][^>]*>/i.test(transformed)) {
    transformed = transformed.replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      `<meta name="description" content="${escapeHtml(description)}" />`
    );
  }

  // Inject meta tags before </head>
  if (transformed.includes('</head>')) {
    transformed = transformed.replace(
      '</head>',
      `    ${tagsToInject}\n  </head>`
    );
  } else {
    transformed = `${tagsToInject}\n${transformed}`;
  }

  // Inject <noscript> snapshot inside <body>
  const noscriptTag = `<noscript id="crawler-snapshot">${noscriptContent}</noscript>`;
  if (transformed.includes('<div id="app"></div>')) {
    transformed = transformed.replace(
      '<div id="app"></div>',
      `${noscriptTag}\n    <div id="app"></div>`
    );
  } else if (transformed.includes('</body>')) {
    transformed = transformed.replace('</body>', `  ${noscriptTag}\n</body>`);
  } else {
    transformed = `${transformed}\n${noscriptTag}`;
  }

  return new Response(transformed, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=15, stale-while-revalidate=60',
    },
  });
}

// --------------------------------------------------------------------------
// 8. SSR Web Route Handlers
// --------------------------------------------------------------------------
seoRoute.get('/', async (c) => {
  return renderHtmlWithSeo(c);
});

seoRoute.get('/posts/:id', async (c) => {
  const id = c.req.param('id');
  return renderHtmlWithSeo(c, id);
});
