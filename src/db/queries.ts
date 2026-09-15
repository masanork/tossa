// src/db/queries.ts: Database access layer for Cloudflare D1
import type { Category, Post, StatusUpdate, SystemSetting, User, Credential, TagCount } from '../types';

export async function getSystemSettings(db: D1Database): Promise<Record<string, string>> {
  const result = await db.prepare('SELECT key, value FROM system_settings').all<SystemSetting>();
  const settings: Record<string, string> = {};
  for (const row of result.results || []) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function updateSystemSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime("now"))')
    .bind(key, value)
    .run();
}

export async function getCategories(db: D1Database): Promise<Category[]> {
  const query = 'SELECT * FROM categories ORDER BY sort_order ASC, name ASC';
  const result = await db.prepare(query).all<Category>();
  return result.results || [];
}

export async function getPosts(
  db: D1Database,
  filter: {
    categoryId?: string;
    area?: string;
    status?: string;
    search?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ posts: Post[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.categoryId) {
    conditions.push('p.category_id = ?');
    params.push(filter.categoryId);
  }

  if (filter.area) {
    conditions.push('p.area = ?');
    params.push(filter.area);
  }

  if (filter.status) {
    conditions.push('p.current_status = ?');
    params.push(filter.status);
  }

  if (filter.tag) {
    conditions.push('EXISTS (SELECT 1 FROM json_each(p.tags) WHERE value = ?)');
    params.push(filter.tag);
  }

  if (filter.search) {
    conditions.push('(p.title LIKE ? OR p.note LIKE ? OR p.address LIKE ?)');
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count
  const countQuery = `SELECT COUNT(*) as count FROM posts p ${whereClause}`;
  const countStmt = db.prepare(countQuery);
  const countRes = await (params.length > 0 ? countStmt.bind(...params) : countStmt).first<{ count: number }>();
  const total = countRes?.count || 0;

  // List
  const limit = Math.min(filter.limit || 50, 100);
  const offset = filter.offset || 0;

  const listQuery = `
    SELECT 
      p.*,
      c.name as category_name,
      c.icon as category_icon,
      c.color as category_color
    FROM posts p
    LEFT JOIN categories c ON p.category_id = c.id
    ${whereClause}
    ORDER BY p.updated_at DESC
    LIMIT ? OFFSET ?
  `;

  const listParams = [...params, limit, offset];
  const listRes = await db.prepare(listQuery).bind(...listParams).all<Post>();

  return {
    posts: listRes.results || [],
    total,
  };
}

export async function getPostById(db: D1Database, id: string): Promise<Post | null> {
  const query = `
    SELECT 
      p.*,
      c.name as category_name,
      c.icon as category_icon,
      c.color as category_color
    FROM posts p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `;
  return await db.prepare(query).bind(id).first<Post>();
}

export async function getStatusUpdatesByPostId(db: D1Database, postId: string): Promise<StatusUpdate[]> {
  const result = await db
    .prepare('SELECT * FROM status_updates WHERE post_id = ? ORDER BY created_at DESC LIMIT 20')
    .bind(postId)
    .all<StatusUpdate>();
  return result.results || [];
}

export async function createPost(
  db: D1Database,
  post: {
    id: string;
    categoryId?: string;
    title: string;
    area: string;
    address?: string;
    lat?: number;
    lng?: number;
    currentStatus: string;
    statusLabel: string;
    note?: string;
    url?: string;
    sourceUrl?: string;
    imageUrl?: string;
    imageMeta?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    tags?: string[];
    isVerified?: boolean;
    reporterName?: string;
  }
): Promise<void> {
  const attrJson = post.attributes ? JSON.stringify(post.attributes) : '{}';
  const tagsJson = post.tags && post.tags.length > 0 ? JSON.stringify(post.tags) : '[]';
  const imageMetaJson = post.imageMeta ? JSON.stringify(post.imageMeta) : '{}';

  await db
    .prepare(
      `INSERT INTO posts (
        id, category_id, title, area, address, lat, lng,
        current_status, status_label, note, url, source_url, image_url, image_meta,
        attributes, tags, is_verified, reporter_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      post.id,
      post.categoryId || 'general',
      post.title,
      post.area,
      post.address || null,
      post.lat || null,
      post.lng || null,
      post.currentStatus,
      post.statusLabel,
      post.note || null,
      post.url || null,
      post.sourceUrl || null,
      post.imageUrl || null,
      imageMetaJson,
      attrJson,
      tagsJson,
      post.isVerified ? 1 : 0,
      post.reporterName || null
    )
    .run();

  // 初期ステータス履歴も1件作成
  await db
    .prepare(
      `INSERT INTO status_updates (id, post_id, status, status_label, note, reporter_ip_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `update_${crypto.randomUUID()}`,
      post.id,
      post.currentStatus,
      post.statusLabel,
      post.note || '新規登録',
      'initial'
    )
    .run();
}

// 自発的に成長するボキャブラリ（直近のアクティビティ・出現頻度順に集計）
export async function getVocabularyTags(db: D1Database, limit = 40): Promise<TagCount[]> {
  try {
    const query = `
      SELECT j.value as name, COUNT(*) as count, MAX(p.updated_at) as last_updated
      FROM posts p, json_each(p.tags) j
      WHERE j.value IS NOT NULL AND trim(j.value) != ''
      GROUP BY j.value
      ORDER BY last_updated DESC, count DESC
      LIMIT ?
    `;
    const result = await db.prepare(query).bind(limit).all<TagCount>();
    return result.results || [];
  } catch (err) {
    // tags カラム未作成時などのフォールバック
    return [];
  }
}

export async function updatePostStatus(
  db: D1Database,
  postId: string,
  status: string,
  statusLabel: string,
  note: string | null,
  ipHash: string | null
): Promise<void> {
  // 1. posts テーブルのステータスと updated_at を更新
  await db
    .prepare(
      `UPDATE posts 
       SET current_status = ?, status_label = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(status, statusLabel, postId)
    .run();

  // 2. status_updates に履歴追加
  await db
    .prepare(
      `INSERT INTO status_updates (id, post_id, status, status_label, note, reporter_ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(`update_${crypto.randomUUID()}`, postId, status, statusLabel, note, ipHash)
    .run();
}

// 情報の正確性・現地確認（コミュニティによる信頼性検証）
export async function verifyPost(
  db: D1Database,
  postId: string,
  reporterIpHash?: string
): Promise<{ verificationCount: number; lastVerifiedAt: string }> {
  // 1. verification ログ追加
  await db
    .prepare(
      `INSERT INTO post_verifications (id, post_id, reporter_ip_hash, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    )
    .bind(`verif_${crypto.randomUUID()}`, postId, reporterIpHash || null)
    .run();

  // 2. posts のカウントと最終確認時刻を更新
  await db
    .prepare(
      `UPDATE posts
       SET verification_count = verification_count + 1,
           last_verified_at = datetime('now')
       WHERE id = ?`
    )
    .bind(postId)
    .run();

  const row = await db
    .prepare('SELECT verification_count, last_verified_at FROM posts WHERE id = ?')
    .bind(postId)
    .first<{ verification_count: number; last_verified_at: string }>();

  return {
    verificationCount: row?.verification_count || 1,
    lastVerifiedAt: row?.last_verified_at || new Date().toISOString(),
  };
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  return await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  return await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
}

export async function getUserCredentials(db: D1Database, userId: string): Promise<Credential[]> {
  const res = await db.prepare('SELECT * FROM credentials WHERE user_id = ?').bind(userId).all<Credential>();
  return res.results || [];
}

// ================= Federation & Migration Functions =================

export interface FederatedGeoJSONFeature {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  } | null;
  properties: {
    title: string;
    area: string;
    address?: string | null;
    currentStatus: string;
    statusLabel: string;
    note?: string | null;
    url?: string | null;
    sourceUrl?: string | null;
    imageUrl?: string | null;
    imageMeta?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    tags?: string[];
    verificationCount?: number;
    lastVerifiedAt?: string | null;
    isVerified?: number;
    reporterName?: string | null;
    createdAt: string;
    updatedAt: string;
    statusHistory?: Array<{
      status: string;
      statusLabel: string;
      note?: string | null;
      createdAt: string;
    }>;
  };
}

/**
 * 全投稿およびステータス履歴を GeoJSON-LD 互換の FeatureCollection 形式でエクスポート
 */
export async function exportAllPostsForFederation(
  db: D1Database
): Promise<FederatedGeoJSONFeature[]> {
  const postsRes = await db
    .prepare('SELECT * FROM posts ORDER BY updated_at DESC')
    .all<Post>();
  const posts = postsRes.results || [];

  const historyRes = await db
    .prepare('SELECT * FROM status_updates ORDER BY created_at ASC')
    .all<StatusUpdate>();
  const allHistory = historyRes.results || [];

  // postId ごとに履歴をグループ化
  const historyMap = new Map<string, StatusUpdate[]>();
  for (const h of allHistory) {
    const list = historyMap.get(h.post_id) || [];
    list.push(h);
    historyMap.set(h.post_id, list);
  }

  return posts.map((p) => {
    let parsedAttrs: Record<string, unknown> = {};
    try {
      if (p.attributes) parsedAttrs = JSON.parse(p.attributes);
    } catch {
      // ignore
    }

    let parsedTags: string[] = [];
    try {
      if (p.tags) parsedTags = JSON.parse(p.tags);
    } catch {
      // ignore
    }

    let parsedImageMeta: Record<string, unknown> = {};
    try {
      if (p.image_meta) parsedImageMeta = JSON.parse(p.image_meta);
    } catch {
      // ignore
    }

    const histories = historyMap.get(p.id) || [];

    return {
      type: 'Feature',
      id: p.id,
      geometry:
        p.lat !== null && p.lng !== null
          ? {
              type: 'Point',
              coordinates: [p.lng, p.lat], // GeoJSON standard: [longitude, latitude]
            }
          : null,
      properties: {
        title: p.title,
        area: p.area,
        address: p.address,
        currentStatus: p.current_status,
        statusLabel: p.status_label,
        note: p.note,
        url: p.url,
        sourceUrl: p.source_url,
        imageUrl: p.image_url,
        imageMeta: parsedImageMeta,
        attributes: parsedAttrs,
        tags: parsedTags,
        verificationCount: p.verification_count || 0,
        lastVerifiedAt: p.last_verified_at,
        isVerified: p.is_verified,
        reporterName: p.reporter_name,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        statusHistory: histories.map((h) => ({
          status: h.status,
          statusLabel: h.status_label,
          note: h.note,
          createdAt: h.created_at,
        })),
      },
    };
  });
}

/**
 * 外部サイトの GeoJSON Feature 配列を受け取り、ローカルDBへマージ・重複排除インポート
 */
export async function importFederatedPosts(
  db: D1Database,
  features: FederatedGeoJSONFeature[]
): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const feature of features) {
    if (!feature.id || !feature.properties?.title || !feature.properties?.area) {
      skipped++;
      continue;
    }

    const props = feature.properties;
    const lat = feature.geometry?.coordinates ? feature.geometry.coordinates[1] : null;
    const lng = feature.geometry?.coordinates ? feature.geometry.coordinates[0] : null;

    const existing = await db
      .prepare('SELECT id, updated_at FROM posts WHERE id = ?')
      .bind(feature.id)
      .first<{ id: string; updated_at: string }>();

    const attrJson = props.attributes ? JSON.stringify(props.attributes) : '{}';
    const tagsJson = props.tags && props.tags.length > 0 ? JSON.stringify(props.tags) : '[]';
    const imageMetaJson = props.imageMeta ? JSON.stringify(props.imageMeta) : '{}';

    if (existing) {
      // 既存レコードがある場合: 相手の updatedAt の方が新しい場合のみ上書き更新
      const localTime = new Date(existing.updated_at).getTime();
      const remoteTime = new Date(props.updatedAt).getTime();

      if (remoteTime > localTime) {
        await db
          .prepare(
            `UPDATE posts SET
              title = ?, area = ?, address = ?, lat = ?, lng = ?,
              current_status = ?, status_label = ?, note = ?, url = ?, source_url = ?,
              image_url = COALESCE(?, image_url),
              image_meta = ?, attributes = ?, tags = ?,
              verification_count = MAX(verification_count, ?),
              last_verified_at = COALESCE(?, last_verified_at),
              is_verified = MAX(is_verified, ?),
              updated_at = ?
             WHERE id = ?`
          )
          .bind(
            props.title,
            props.area,
            props.address || null,
            lat,
            lng,
            props.currentStatus,
            props.statusLabel,
            props.note || null,
            props.url || null,
            props.sourceUrl || null,
            props.imageUrl || null,
            imageMetaJson,
            attrJson,
            tagsJson,
            props.verificationCount || 0,
            props.lastVerifiedAt || null,
            props.isVerified ? 1 : 0,
            props.updatedAt,
            feature.id
          )
          .run();
        updated++;
      } else {
        skipped++;
      }
    } else {
      // 新規レコードとして INSERT
      await db
        .prepare(
          `INSERT INTO posts (
            id, category_id, title, area, address, lat, lng,
            current_status, status_label, note, url, source_url, image_url, image_meta,
            verification_count, last_verified_at, attributes, tags, is_verified, reporter_name,
            created_at, updated_at
          ) VALUES (?, 'general', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          feature.id,
          props.title,
          props.area,
          props.address || null,
          lat,
          lng,
          props.currentStatus,
          props.statusLabel,
          props.note || null,
          props.url || null,
          props.sourceUrl || null,
          props.imageUrl || null,
          imageMetaJson,
          props.verificationCount || 0,
          props.lastVerifiedAt || null,
          attrJson,
          tagsJson,
          props.isVerified ? 1 : 0,
          props.reporterName || null,
          props.createdAt,
          props.updatedAt
        )
        .run();
      added++;
    }

    // ステータス履歴のマージ
    if (props.statusHistory && props.statusHistory.length > 0) {
      for (const h of props.statusHistory) {
        // 同一 post_id かつ同一日時の履歴がなければ追加
        const histExists = await db
          .prepare('SELECT id FROM status_updates WHERE post_id = ? AND created_at = ?')
          .bind(feature.id, h.createdAt)
          .first();

        if (!histExists) {
          await db
            .prepare(
              `INSERT INTO status_updates (id, post_id, status, status_label, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(
              `update_${crypto.randomUUID()}`,
              feature.id,
              h.status,
              h.statusLabel,
              h.note || null,
              h.createdAt
            )
            .run();
        }
      }
    }
  }

  return { added, updated, skipped };
}
