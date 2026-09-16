// src/db/queries.ts: Database access layer for Cloudflare D1
import type {
  Category,
  Post,
  StatusUpdate,
  SystemSetting,
  User,
  Credential,
  TagCount,
  Thread,
  ThreadMember,
  EncryptedMessage,
  ThreadType,
} from '../types';

export async function getSystemSettings(
  db: D1Database
): Promise<Record<string, string>> {
  const result = await db
    .prepare('SELECT key, value FROM system_settings')
    .all<SystemSetting>();
  const settings: Record<string, string> = {};
  for (const row of result.results || []) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function updateSystemSetting(
  db: D1Database,
  key: string,
  value: string
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    )
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

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count
  const countQuery = `SELECT COUNT(*) as count FROM posts p ${whereClause}`;
  const countStmt = db.prepare(countQuery);
  const countRes = await (
    params.length > 0 ? countStmt.bind(...params) : countStmt
  ).first<{ count: number }>();
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
  const listRes = await db
    .prepare(listQuery)
    .bind(...listParams)
    .all<Post>();

  return {
    posts: listRes.results || [],
    total,
  };
}

export async function getPostById(
  db: D1Database,
  id: string
): Promise<Post | null> {
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

export async function getStatusUpdatesByPostId(
  db: D1Database,
  postId: string
): Promise<StatusUpdate[]> {
  const result = await db
    .prepare(
      'SELECT * FROM status_updates WHERE post_id = ? ORDER BY created_at DESC LIMIT 20'
    )
    .bind(postId)
    .all<StatusUpdate>();
  return result.results || [];
}

export async function createPost(
  db: D1Database,
  post: {
    id: string;
    authorId?: string | null;
    authorCookieId?: string | null;
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
    reporterName?: string | null;
  }
): Promise<void> {
  const attrJson = post.attributes ? JSON.stringify(post.attributes) : '{}';
  const tagsJson =
    post.tags && post.tags.length > 0 ? JSON.stringify(post.tags) : '[]';
  const imageMetaJson = post.imageMeta ? JSON.stringify(post.imageMeta) : '{}';

  await db
    .prepare(
      `INSERT INTO posts (
        id, author_id, author_cookie_id, category_id, title, area, address, lat, lng,
        current_status, status_label, note, url, source_url, image_url, image_meta,
        attributes, tags, is_verified, reporter_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      post.id,
      post.authorId || null,
      post.authorCookieId || null,
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

  // Create initial status update record
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
      post.note || 'Initial registration',
      'initial'
    )
    .run();
}

export async function updatePost(
  db: D1Database,
  id: string,
  post: {
    title?: string;
    area?: string;
    address?: string;
    lat?: number | null;
    lng?: number | null;
    currentStatus?: string;
    statusLabel?: string;
    note?: string | null;
    url?: string | null;
    sourceUrl?: string | null;
    imageUrl?: string | null;
    imageMeta?: Record<string, unknown> | null;
    attributes?: Record<string, unknown> | null;
    tags?: string[] | null;
  }
): Promise<void> {
  const existing = await getPostById(db, id);
  if (!existing) {
    throw new Error('Post not found');
  }

  const updatedTitle = post.title !== undefined ? post.title : existing.title;
  const updatedArea = post.area !== undefined ? post.area : existing.area;
  const updatedAddress =
    post.address !== undefined ? post.address : existing.address;
  const updatedLat = post.lat !== undefined ? post.lat : existing.lat;
  const updatedLng = post.lng !== undefined ? post.lng : existing.lng;
  const updatedStatus =
    post.currentStatus !== undefined
      ? post.currentStatus
      : existing.current_status;
  const updatedStatusLabel =
    post.statusLabel !== undefined ? post.statusLabel : existing.status_label;
  const updatedNote = post.note !== undefined ? post.note : existing.note;
  const updatedUrl = post.url !== undefined ? post.url : existing.url;
  const updatedSourceUrl =
    post.sourceUrl !== undefined ? post.sourceUrl : existing.source_url;
  const updatedImageUrl =
    post.imageUrl !== undefined ? post.imageUrl : existing.image_url;

  const updatedImageMeta =
    post.imageMeta !== undefined
      ? post.imageMeta
        ? JSON.stringify(post.imageMeta)
        : '{}'
      : existing.image_meta;

  const updatedAttrs =
    post.attributes !== undefined
      ? post.attributes
        ? JSON.stringify(post.attributes)
        : '{}'
      : existing.attributes;

  const updatedTags =
    post.tags !== undefined
      ? post.tags
        ? JSON.stringify(post.tags)
        : '[]'
      : existing.tags;

  await db
    .prepare(
      `UPDATE posts SET
        title = ?, area = ?, address = ?, lat = ?, lng = ?,
        current_status = ?, status_label = ?, note = ?, url = ?, source_url = ?,
        image_url = ?, image_meta = ?, attributes = ?, tags = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      updatedTitle,
      updatedArea,
      updatedAddress || null,
      updatedLat || null,
      updatedLng || null,
      updatedStatus,
      updatedStatusLabel,
      updatedNote || null,
      updatedUrl || null,
      updatedSourceUrl || null,
      updatedImageUrl || null,
      updatedImageMeta || '{}',
      updatedAttrs || '{}',
      updatedTags || '[]',
      id
    )
    .run();
}

export async function deletePost(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('DELETE FROM status_updates WHERE post_id = ?')
    .bind(id)
    .run();
  await db
    .prepare('DELETE FROM post_verifications WHERE post_id = ?')
    .bind(id)
    .run();
  await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
}

// Spontaneously evolving tag vocabulary (ranked by recent activity & frequency)
export async function getVocabularyTags(
  db: D1Database,
  limit = 40
): Promise<TagCount[]> {
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
  } catch {
    // Fallback if tags column is unavailable
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
  // 1. Update post current status and timestamp
  await db
    .prepare(
      `UPDATE posts 
       SET current_status = ?, status_label = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(status, statusLabel, postId)
    .run();

  // 2. Append history record
  await db
    .prepare(
      `INSERT INTO status_updates (id, post_id, status, status_label, note, reporter_ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      `update_${crypto.randomUUID()}`,
      postId,
      status,
      statusLabel,
      note,
      ipHash
    )
    .run();
}

// On-site community verification (trust endorsement)
export async function verifyPost(
  db: D1Database,
  postId: string,
  reporterIpHash?: string
): Promise<{ verificationCount: number; lastVerifiedAt: string }> {
  // 1. Insert verification record
  await db
    .prepare(
      `INSERT INTO post_verifications (id, post_id, reporter_ip_hash, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    )
    .bind(`verif_${crypto.randomUUID()}`, postId, reporterIpHash || null)
    .run();

  // 2. Update post verification count and timestamp
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
    .prepare(
      'SELECT verification_count, last_verified_at FROM posts WHERE id = ?'
    )
    .bind(postId)
    .first<{ verification_count: number; last_verified_at: string }>();

  return {
    verificationCount: row?.verification_count || 1,
    lastVerifiedAt: row?.last_verified_at || new Date().toISOString(),
  };
}

export async function getUserByUsername(
  db: D1Database,
  username: string
): Promise<User | null> {
  return await db
    .prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first<User>();
}

export async function getUserById(
  db: D1Database,
  id: string
): Promise<User | null> {
  return await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<User>();
}

export async function getUserCredentials(
  db: D1Database,
  userId: string
): Promise<Credential[]> {
  const res = await db
    .prepare('SELECT * FROM credentials WHERE user_id = ?')
    .bind(userId)
    .all<Credential>();
  return res.results || [];
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM users')
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getAllUsers(db: D1Database): Promise<Omit<User, ''>[]> {
  const res = await db
    .prepare(
      'SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at ASC'
    )
    .all<User>();
  return res.results || [];
}

export async function updateUserRole(
  db: D1Database,
  userId: string,
  role: 'admin' | 'moderator' | 'user'
): Promise<void> {
  await db
    .prepare('UPDATE users SET role = ? WHERE id = ?')
    .bind(role, userId)
    .run();
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
 * Export all posts and status history as GeoJSON-LD FeatureCollection
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

  // Group status updates by postId
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
 * Merge and deduplicate external GeoJSON features into local database
 */
export async function importFederatedPosts(
  db: D1Database,
  features: FederatedGeoJSONFeature[]
): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const feature of features) {
    if (
      !feature.id ||
      !feature.properties?.title ||
      !feature.properties?.area
    ) {
      skipped++;
      continue;
    }

    const props = feature.properties;
    const lat = feature.geometry?.coordinates
      ? feature.geometry.coordinates[1]
      : null;
    const lng = feature.geometry?.coordinates
      ? feature.geometry.coordinates[0]
      : null;

    const existing = await db
      .prepare('SELECT id, updated_at FROM posts WHERE id = ?')
      .bind(feature.id)
      .first<{ id: string; updated_at: string }>();

    const attrJson = props.attributes ? JSON.stringify(props.attributes) : '{}';
    const tagsJson =
      props.tags && props.tags.length > 0 ? JSON.stringify(props.tags) : '[]';
    const imageMetaJson = props.imageMeta
      ? JSON.stringify(props.imageMeta)
      : '{}';

    if (existing) {
      // If record exists, update only if remote updatedAt is newer
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
      // Insert as new record
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

    // Merge status update history
    if (props.statusHistory && props.statusHistory.length > 0) {
      for (const h of props.statusHistory) {
        // Append if not already present with same post_id and timestamp
        const histExists = await db
          .prepare(
            'SELECT id FROM status_updates WHERE post_id = ? AND created_at = ?'
          )
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

// ================= E2EE Messaging Database Layer =================

export async function updateUserPublicKey(
  db: D1Database,
  userId: string,
  publicKey: string
): Promise<void> {
  await db
    .prepare('UPDATE users SET e2ee_public_key = ? WHERE id = ?')
    .bind(publicKey, userId)
    .run();
}

export async function getUsersPublicKeys(
  db: D1Database,
  filter?: { userIds?: string[]; role?: string }
): Promise<
  Array<
    Pick<User, 'id' | 'username' | 'display_name' | 'role' | 'e2ee_public_key'>
  >
> {
  const conditions: string[] = ['e2ee_public_key IS NOT NULL'];
  const params: unknown[] = [];

  if (filter?.role) {
    conditions.push('role = ?');
    params.push(filter.role);
  }

  if (filter?.userIds && filter.userIds.length > 0) {
    const placeholders = filter.userIds.map(() => '?').join(',');
    conditions.push(`id IN (${placeholders})`);
    params.push(...filter.userIds);
  }

  const query = `
    SELECT id, username, display_name, role, e2ee_public_key
    FROM users
    WHERE ${conditions.join(' AND ')}
    ORDER BY role ASC, display_name ASC
  `;

  const res = await db
    .prepare(query)
    .bind(...params)
    .all<any>();
  return res.results || [];
}

export async function createThread(
  db: D1Database,
  thread: {
    id: string;
    title: string;
    type: ThreadType;
    postId?: string | null;
    createdBy: string;
  },
  initialMembers: Array<{
    userId: string;
    encryptedThreadKey: string;
    ephemeralPublicKey: string;
    role?: 'owner' | 'member';
  }>
): Promise<void> {
  // 1. Create thread
  await db
    .prepare(
      `INSERT INTO threads (id, title, type, post_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      thread.id,
      thread.title,
      thread.type,
      thread.postId || null,
      thread.createdBy
    )
    .run();

  // 2. Register initial members and encrypted key envelopes
  for (const m of initialMembers) {
    await db
      .prepare(
        `INSERT INTO thread_members (id, thread_id, user_id, encrypted_thread_key, ephemeral_public_key, key_sender_id, role, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(
        `member_${crypto.randomUUID()}`,
        thread.id,
        m.userId,
        m.encryptedThreadKey,
        m.ephemeralPublicKey,
        thread.createdBy,
        m.role || (m.userId === thread.createdBy ? 'owner' : 'member')
      )
      .run();
  }
}

export async function getUserThreads(
  db: D1Database,
  userId: string
): Promise<Thread[]> {
  const query = `
    SELECT 
      t.*,
      p.title as post_title,
      u.display_name as creator_name,
      tm.encrypted_thread_key as my_encrypted_thread_key,
      tm.ephemeral_public_key as my_ephemeral_public_key,
      (SELECT COUNT(*) FROM thread_members WHERE thread_id = t.id) as member_count,
      (SELECT MAX(created_at) FROM messages WHERE thread_id = t.id) as last_message_at
    FROM threads t
    INNER JOIN thread_members tm ON t.id = tm.thread_id AND tm.user_id = ?
    LEFT JOIN posts p ON t.post_id = p.id
    LEFT JOIN users u ON t.created_by = u.id
    ORDER BY t.updated_at DESC
  `;

  const res = await db.prepare(query).bind(userId).all<Thread>();
  return res.results || [];
}

export async function getThreadById(
  db: D1Database,
  threadId: string,
  userId: string
): Promise<Thread | null> {
  const query = `
    SELECT 
      t.*,
      p.title as post_title,
      u.display_name as creator_name,
      tm.encrypted_thread_key as my_encrypted_thread_key,
      tm.ephemeral_public_key as my_ephemeral_public_key,
      (SELECT COUNT(*) FROM thread_members WHERE thread_id = t.id) as member_count,
      (SELECT MAX(created_at) FROM messages WHERE thread_id = t.id) as last_message_at
    FROM threads t
    INNER JOIN thread_members tm ON t.id = tm.thread_id AND tm.user_id = ?
    LEFT JOIN posts p ON t.post_id = p.id
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.id = ?
    LIMIT 1
  `;

  return await db.prepare(query).bind(userId, threadId).first<Thread>();
}

export async function isThreadMember(
  db: D1Database,
  threadId: string,
  userId: string
): Promise<boolean> {
  const res = await db
    .prepare(
      'SELECT id FROM thread_members WHERE thread_id = ? AND user_id = ? LIMIT 1'
    )
    .bind(threadId, userId)
    .first();
  return !!res;
}

export async function getThreadMembers(
  db: D1Database,
  threadId: string
): Promise<ThreadMember[]> {
  const query = `
    SELECT 
      tm.*,
      u.username,
      u.display_name,
      u.role as user_role,
      u.e2ee_public_key
    FROM thread_members tm
    LEFT JOIN users u ON tm.user_id = u.id
    WHERE tm.thread_id = ?
    ORDER BY tm.joined_at ASC
  `;

  const res = await db.prepare(query).bind(threadId).all<ThreadMember>();
  return res.results || [];
}

export async function addThreadMember(
  db: D1Database,
  member: {
    threadId: string;
    userId: string;
    encryptedThreadKey: string;
    ephemeralPublicKey: string;
    keySenderId?: string;
    role?: 'owner' | 'member';
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO thread_members (id, thread_id, user_id, encrypted_thread_key, ephemeral_public_key, key_sender_id, role, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      `member_${crypto.randomUUID()}`,
      member.threadId,
      member.userId,
      member.encryptedThreadKey,
      member.ephemeralPublicKey,
      member.keySenderId || null,
      member.role || 'member'
    )
    .run();
}

export async function createMessage(
  db: D1Database,
  message: {
    id: string;
    threadId: string;
    senderId: string;
    ciphertext: string;
    iv: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO messages (id, thread_id, sender_id, ciphertext, iv, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      message.id,
      message.threadId,
      message.senderId,
      message.ciphertext,
      message.iv
    )
    .run();

  // Update thread updated_at timestamp
  await db
    .prepare("UPDATE threads SET updated_at = datetime('now') WHERE id = ?")
    .bind(message.threadId)
    .run();
}

export async function getThreadMessages(
  db: D1Database,
  threadId: string,
  limit = 100
): Promise<EncryptedMessage[]> {
  const query = `
    SELECT 
      m.id,
      m.thread_id,
      m.sender_id,
      m.ciphertext,
      m.iv,
      m.created_at,
      u.username as sender_username,
      u.display_name as sender_display_name,
      u.role as sender_role
    FROM messages m
    LEFT JOIN users u ON m.sender_id = u.id
    WHERE m.thread_id = ?
    ORDER BY m.created_at ASC
    LIMIT ?
  `;

  const res = await db
    .prepare(query)
    .bind(threadId, limit)
    .all<EncryptedMessage>();
  return res.results || [];
}

// ================= Device Sessions & Access Logs =================

/** Link device session to Passkey user (N:N) */
export async function linkDeviceToUser(
  db: D1Database,
  deviceSessionId: string,
  userId: string
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO device_user_links (device_session_id, user_id) VALUES (?, ?)'
    )
    .bind(deviceSessionId, userId)
    .run();
}

/** List users linked to a device session */
export async function getDeviceUsers(
  db: D1Database,
  deviceSessionId: string
): Promise<{ user_id: string; linked_at: string }[]> {
  const res = await db
    .prepare(
      'SELECT user_id, linked_at FROM device_user_links WHERE device_session_id = ? ORDER BY linked_at DESC'
    )
    .bind(deviceSessionId)
    .all<{ user_id: string; linked_at: string }>();
  return res.results;
}

/** Retrieve device session access logs (compliance & audit requests) */
export async function getAccessLogsByDevice(
  db: D1Database,
  deviceSessionId: string,
  limit = 200
): Promise<
  {
    event_type: string;
    ip_address: string | null;
    user_agent: string | null;
    metadata: string | null;
    created_at: string;
  }[]
> {
  const res = await db
    .prepare(
      'SELECT event_type, ip_address, user_agent, metadata, created_at FROM access_logs WHERE device_session_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .bind(deviceSessionId, limit)
    .all<{
      event_type: string;
      ip_address: string | null;
      user_agent: string | null;
      metadata: string | null;
      created_at: string;
    }>();
  return res.results;
}

/** Retrieve user access logs (compliance & audit requests) */
export async function getAccessLogsByUser(
  db: D1Database,
  userId: string,
  limit = 200
): Promise<
  {
    event_type: string;
    ip_address: string | null;
    device_session_id: string | null;
    metadata: string | null;
    created_at: string;
  }[]
> {
  const res = await db
    .prepare(
      'SELECT event_type, ip_address, device_session_id, metadata, created_at FROM access_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .bind(userId, limit)
    .all<{
      event_type: string;
      ip_address: string | null;
      device_session_id: string | null;
      metadata: string | null;
      created_at: string;
    }>();
  return res.results;
}
