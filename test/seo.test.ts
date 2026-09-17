// test/seo.test.ts: Tests for SEO, AI Findability, Discovery Endpoints & SSR Meta Injection
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';

describe('SEO & AI Findability Endpoints', () => {
  it('GET /robots.txt serves standard robot instructions for crawlers & AI bots', async () => {
    const { request } = createTestContext();

    const res = await request('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');

    const text = await res.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Allow: /');
    expect(text).toContain('Disallow: /api/auth/');
    expect(text).toContain('Disallow: /api/threads/');
    expect(text).toContain('Disallow: /api/push/');

    // AI Crawlers
    expect(text).toContain('User-agent: GPTBot');
    expect(text).toContain('User-agent: ChatGPT-User');
    expect(text).toContain('User-agent: OAI-SearchBot');
    expect(text).toContain('User-agent: ClaudeBot');
    expect(text).toContain('User-agent: Claude-Web');
    expect(text).toContain('User-agent: PerplexityBot');
    expect(text).toContain('User-agent: Google-Extended');
    expect(text).toContain('User-agent: Applebot-Extended');

    // Sitemap declaration
    expect(text).toContain('Sitemap:');
    expect(text).toContain('/sitemap.xml');
  });

  it('GET /sitemap.xml dynamically generates sitemap including all active posts', async () => {
    const { request, db } = createTestContext();

    // Insert sample posts
    await db
      .prepare(
        `INSERT INTO posts (id, category_id, title, area, address, lat, lng, current_status, status_label, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'seo_post_1',
        'water',
        'Central Park Water Station',
        'Chuo Ward',
        '1-1 Chuo',
        35.681,
        139.767,
        'available',
        '給水実施中',
        '2026-09-17 08:30:00'
      )
      .run();

    const res = await request('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/xml');

    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );

    // Standard endpoints
    expect(xml).toContain('<loc>http://localhost/</loc>');
    expect(xml).toContain('<loc>http://localhost/llms.txt</loc>');
    expect(xml).toContain('<loc>http://localhost/llms-full.txt</loc>');
    expect(xml).toContain('<loc>http://localhost/feed.xml</loc>');
    expect(xml).toContain('<loc>http://localhost/api/feed.json</loc>');
    expect(xml).toContain('<loc>http://localhost/mcp</loc>');

    // Post deep link
    expect(xml).toContain('<loc>http://localhost/posts/seo_post_1</loc>');
  });

  it('GET /llms.txt serves AI retrieval markdown with metadata and endpoints', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare(
        "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('site_title', 'Tossa Disaster Hub'), ('emergency_banner', '警戒レベル3発令中')"
      )
      .run();

    const res = await request('/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');

    const md = await res.text();
    expect(md).toContain('# Tossa Disaster Hub');
    expect(md).toContain('> 警戒レベル3発令中');
    expect(md).toContain('EMERGENCY ALERT ACTIVE');
    expect(md).toContain('/llms-full.txt');
    expect(md).toContain('/api/feed.json');
    expect(md).toContain('/feed.xml');
    expect(md).toContain('/mcp');
    expect(md).toContain('Status Vocabulary Definitions');
  });

  it('GET /llms-full.txt serves complete live markdown digest of all facilities', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare(
        `INSERT INTO posts (id, category_id, title, area, address, lat, lng, current_status, status_label, note, tags, verification_count, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'full_post_1',
        'shelter',
        'Midtown Evacuation Shelter',
        'Midtown',
        '4-5-6 Civic Road',
        35.658,
        139.741,
        'crowded',
        '混雑中（残り50名）',
        'Blankets and water bottles available. Bring emergency ID.',
        JSON.stringify(['shelter', 'blankets']),
        5,
        1
      )
      .run();

    const res = await request('/llms-full.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');

    const md = await res.text();
    expect(md).toContain('Midtown Evacuation Shelter');
    expect(md).toContain('/posts/full_post_1');
    expect(md).toContain('混雑中（残り50名） (crowded)');
    expect(md).toContain('Area: Midtown');
    expect(md).toContain('Address: 4-5-6 Civic Road');
    expect(md).toContain('Coordinates: 35.658, 139.741');
    expect(md).toContain('#shelter #blankets');
    expect(md).toContain('Community Verifications: 5');
    expect(md).toContain('Official Verified: Yes');
    expect(md).toContain('Blankets and water bottles available.');
  });

  it('GET /feed.xml provides RSS 2.0 with GeoRSS coordinates', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare(
        `INSERT INTO posts (id, category_id, title, area, address, lat, lng, current_status, status_label, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'rss_post_1',
        'medical',
        'East Clinic First Aid',
        'East District',
        '8-9 Health Ave',
        35.7,
        139.8,
        'available',
        '診察中',
        'First aid triage operational.'
      )
      .run();

    const res = await request('/feed.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/rss+xml');

    const xml = await res.text();
    expect(xml).toContain(
      '<rss version="2.0" xmlns:georss="http://www.georss.org/georss"'
    );
    expect(xml).toContain('<title>East Clinic First Aid - 診察中</title>');
    expect(xml).toContain('<link>http://localhost/posts/rss_post_1</link>');
    expect(xml).toContain('<georss:point>35.7 139.8</georss:point>');
    expect(xml).toContain('状況: 診察中');
  });

  it('GET /api/posts.geojson returns GeoJSON feature collection', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare(
        `INSERT INTO posts (id, category_id, title, area, address, lat, lng, current_status, status_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'geojson_post_1',
        'food',
        'Food Bank North',
        'North District',
        '3-2 North St',
        35.75,
        139.72,
        'open',
        '配布中'
      )
      .run();

    const res = await request('/api/posts.geojson');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/geo+json');

    const json = (await res.json()) as {
      type: string;
      features: Array<{ id: string; properties: { title: string } }>;
    };
    expect(json.type).toBe('FeatureCollection');
    expect(json.features.some((f) => f.id === 'geojson_post_1')).toBe(true);
  });
});

describe('SSR Prerendering & Dynamic Meta Injection', () => {
  it('GET / serves HTML with dynamic OpenGraph, Schema.org ItemList, and semantic noscript fallback', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare(
        `INSERT INTO posts (id, category_id, title, area, address, lat, lng, current_status, status_label, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'ssr_root_post',
        'water',
        'Shinjuku Water Station',
        'Shinjuku',
        '2-8-1 Nishi-Shinjuku',
        35.689,
        139.692,
        'available',
        '給水中（常時）',
        'ポリタンク持参推奨'
      )
      .run();

    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');

    const html = await res.text();

    // Head tags
    expect(html).toContain('<title>');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:url" content="http://localhost/"');
    expect(html).toContain('name="twitter:card"');

    // Discovery links
    expect(html).toContain('rel="alternate" type="application/rss+xml"');
    expect(html).toContain('rel="alternate" type="application/geo+json"');
    expect(html).toContain('rel="sitemap"');
    expect(html).toContain('rel="help"');

    // Schema.org JSON-LD
    expect(html).toContain('application/ld+json');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('Shinjuku Water Station');

    // Semantic <noscript> snapshot for non-JS crawlers
    expect(html).toContain('<noscript id="crawler-snapshot">');
    expect(html).toContain('Shinjuku Water Station');
    expect(html).toContain('給水中（常時）');
    expect(html).toContain('Shinjuku');
    expect(html).toContain('ポリタンク持参推奨');
  });

  it('GET / with emergency_banner injects Schema.org SpecialAnnouncement', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare(
        "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('emergency_banner', '台風接近に伴い避難所を開設しました')"
      )
      .run();

    const res = await request('/');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('SpecialAnnouncement');
    expect(html).toContain('台風接近に伴い避難所を開設しました');
    expect(html).toContain('【緊急情報】');
  });

  it('GET /posts/:id renders dynamic post-specific title, OGP, CivicStructure JSON-LD, and noscript', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare(
        `INSERT INTO posts (id, category_id, title, area, address, lat, lng, current_status, status_label, note, image_url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'detail_post_99',
        'supplies',
        'Harajuku Relief Distribution Hub',
        'Shibuya',
        '1-1-1 Jingumae',
        35.67,
        139.702,
        'few',
        '残りわずか（食料・乾電池）',
        '整理券を順次配布しています。',
        'https://example.com/photos/hub.jpg',
        '2026-09-17 10:00:00'
      )
      .run();

    const res = await request('/posts/detail_post_99');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');

    const html = await res.text();

    // Specific title
    expect(html).toContain(
      '【残りわずか（食料・乾電池）】Harajuku Relief Distribution Hub'
    );

    // OpenGraph & Twitter
    expect(html).toContain('content="http://localhost/posts/detail_post_99"');
    expect(html).toContain('content="https://example.com/photos/hub.jpg"');
    expect(html).toContain('content="summary_large_image"');

    // Schema.org CivicStructure
    expect(html).toContain('"@type":"CivicStructure"');
    expect(html).toContain('Harajuku Relief Distribution Hub');
    expect(html).toContain('1-1-1 Jingumae');
    expect(html).toContain('"latitude":35.67');
    expect(html).toContain('"longitude":139.702');

    // Noscript content
    expect(html).toContain('<noscript id="crawler-snapshot">');
    expect(html).toContain('Harajuku Relief Distribution Hub');
    expect(html).toContain('残りわずか（食料・乾電池）');
    expect(html).toContain('1-1-1 Jingumae');
    expect(html).toContain('整理券を順次配布しています。');
    expect(html).toContain('← ホームに戻る');
  });

  it('GET /posts/:id gracefully renders 404/not-found information for non-existent post', async () => {
    const { request } = createTestContext();

    const res = await request('/posts/non_existent_post_xyz');
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('情報が見つかりませんでした');
    expect(html).toContain(
      '指定された施設・投稿 (non_existent_post_xyz) は存在しないか'
    );
    expect(html).toContain('<noscript id="crawler-snapshot">');
  });
});
