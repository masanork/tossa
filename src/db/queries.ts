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
    attributes?: Record<string, unknown>;
    tags?: string[];
    isVerified?: boolean;
    reporterName?: string;
  }
): Promise<void> {
  const attrJson = post.attributes ? JSON.stringify(post.attributes) : '{}';
  const tagsJson = post.tags && post.tags.length > 0 ? JSON.stringify(post.tags) : '[]';

  await db
    .prepare(
      `INSERT INTO posts (
        id, category_id, title, area, address, lat, lng,
        current_status, status_label, note, url, attributes, tags, is_verified, reporter_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
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
