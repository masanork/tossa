// src/routes/posts.ts: Posts and status update API routes
import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  getPosts,
  getPostById,
  getStatusUpdatesByPostId,
  createPost,
  updatePost,
  deletePost,
  updatePostStatus,
  verifyPost,
  getVocabularyTags,
  getUserById,
} from '../db/queries';
import { logAccess, getClientIp } from '../middleware/deviceCookie';
import { verifySessionToken } from '../auth/session';
import { broadcastPushNotification } from '../services/push';
import { persistImageToR2 } from './images';
import {
  enqueuePostCreation,
  enqueueStatusUpdate,
} from '../services/writeBuffer';
import {
  readPublicFeedSnapshot,
  scheduleFeedRefresh,
  executionCtxOf,
  FEED_MAX_AGE_MS,
} from '../services/feedSnapshot';
import { renderOgpSvg } from '../ogp';

type PostsVariables = { deviceSessionId: string };

export const postsRoute = new Hono<{
  Bindings: Bindings;
  Variables: PostsVariables;
}>();

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

async function operationFor(c: any, requestId: unknown, payload: unknown) {
  if (requestId === undefined) return undefined;
  if (
    typeof requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)
  )
    throw new Error('Invalid requestId');
  const id = `op_${await hash(`${c.get('deviceSessionId')}:${requestId}`)}`;
  return {
    id,
    payloadHash: await hash(JSON.stringify({ path: c.req.path, payload })),
  };
}

/** Get optional Passkey session without rejecting anonymous requests */
async function getOptionalSession(c: any) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session) return null;
  const user = await getUserById(c.env.DB, session.userId);
  return user ? { ...session, role: user.role } : null;
}

// GET /api/posts/tags/vocabulary (Tag vocabulary list)
postsRoute.get('/tags/vocabulary', async (c) => {
  const tags = await getVocabularyTags(c.env.DB, 40);
  c.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  return c.json({
    success: true,
    tags,
  });
});

// GET /api/posts
postsRoute.get('/', async (c) => {
  const categoryId = c.req.query('category');
  const area = c.req.query('area');
  const status = c.req.query('status');
  const search = c.req.query('q');
  const tag = c.req.query('tag');
  const mine = c.req.query('mine');
  const idsParam = c.req.query('ids');
  const limit = Number(c.req.query('limit') ?? 50);
  const offset = Number(c.req.query('offset') ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  )
    return c.json({ success: false, error: 'Invalid pagination' }, 400);
  const bboxRaw = c.req.query('bbox');
  let bbox: [number, number, number, number] | undefined;
  if (bboxRaw !== undefined) {
    const pieces = bboxRaw.split(',');
    const values = pieces.map(Number);
    if (
      values.length !== 4 ||
      pieces.some((v) => !v.trim()) ||
      values.some((v) => !Number.isFinite(v)) ||
      values[0]! < -180 ||
      values[0]! > 180 ||
      values[2]! < -180 ||
      values[2]! > 180 ||
      values[1]! < -90 ||
      values[3]! > 90 ||
      values[1]! > values[3]!
    )
      return c.json({ success: false, error: 'Invalid bbox' }, 400);
    bbox = values as [number, number, number, number];
  }
  const nearLat = c.req.query('lat');
  const nearLng = c.req.query('lng');
  let near: { lat: number; lng: number } | undefined;
  if (nearLat !== undefined || nearLng !== undefined) {
    const lat = Number(nearLat),
      lng = Number(nearLng);
    if (
      nearLat === undefined ||
      nearLng === undefined ||
      !nearLat.trim() ||
      !nearLng.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      return c.json({ success: false, error: 'Invalid location' }, 400);
    near = { lat, lng };
  }
  const deviceId = c.get('deviceSessionId') || null;
  const session = await getOptionalSession(c);

  let ids: string[] | undefined = undefined;
  if (idsParam !== undefined) {
    ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (ids.length === 0) {
      c.header('Cache-Control', 'no-store');
      return c.json({
        success: true,
        posts: [],
        total: 0,
        limit,
        offset,
      });
    }
  }

  let authorId: string | undefined = undefined;
  let authorCookieId: string | undefined = undefined;

  if (mine === 'true') {
    if (!session?.userId && !deviceId) {
      c.header('Cache-Control', 'no-store');
      return c.json({
        success: true,
        posts: [],
        total: 0,
        limit,
        offset,
      });
    }
    authorId = session?.userId;
    authorCookieId = deviceId || undefined;
  }

  const isPrivateList = mine === 'true';
  const skipEdgeCache =
    isPrivateList ||
    !!near ||
    c.req.query('_t') !== undefined ||
    c.env.DISABLE_WRITE_BUFFER === 'true';

  if (!skipEdgeCache) {
    try {
      const cacheUrl = new URL(c.req.url);
      cacheUrl.searchParams.delete('_t');
      cacheUrl.searchParams.set('_cache_version', '2');
      const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Cache API unavailable (tests / local) — fall through to D1
    }
  }

  const unfilteredPublic =
    !isPrivateList &&
    !categoryId &&
    !area &&
    !status &&
    !search &&
    !tag &&
    !ids &&
    !bbox &&
    !near &&
    offset === 0;

  if (unfilteredPublic && !skipEdgeCache) {
    const snapshot = await readPublicFeedSnapshot(c.env);
    if (
      snapshot &&
      Number.isFinite(Date.parse(snapshot.generatedAt)) &&
      Date.now() - Date.parse(snapshot.generatedAt) >= 0 &&
      Date.now() - Date.parse(snapshot.generatedAt) <= FEED_MAX_AGE_MS
    ) {
      const capped = Math.min(Math.max(limit || 50, 1), 100);
      const payload = {
        success: true,
        posts: snapshot.posts.slice(0, capped),
        total: snapshot.total,
        limit: capped,
        offset: 0,
      };
      const response = new Response(JSON.stringify(payload), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control':
            'public, max-age=15, s-maxage=15, stale-while-revalidate=60',
          'X-Feed-Source': 'kv',
          'X-Data-As-Of': snapshot.generatedAt,
        },
      });
      try {
        const cacheUrl = new URL(c.req.url);
        cacheUrl.searchParams.delete('_t');
        cacheUrl.searchParams.set('_cache_version', '2');
        executionCtxOf(c)?.waitUntil(
          caches.default.put(
            new Request(cacheUrl.toString(), { method: 'GET' }),
            response.clone()
          )
        );
      } catch {
        /* ignore */
      }
      const age = Date.now() - Date.parse(snapshot.generatedAt);
      if (
        age > 60_000 &&
        (!c.env.WRITE_QUEUE || c.env.DISABLE_WRITE_BUFFER === 'true')
      ) {
        scheduleFeedRefresh(c.env, c as any);
      }
      return response;
    }
  }

  const result = await getPosts(c.env.DB, {
    categoryId,
    area,
    status,
    search,
    tag,
    ids,
    authorId,
    authorCookieId,
    bbox,
    near,
    limit,
    offset,
  });

  // Public lists omit is_owner so Cookie headers do not fragment the edge cache.
  // The client already treats localStorage ownership (isMyPost) as equivalent.
  // Production refreshes on writes and the minute cron. A cold read must not
  // enqueue one refresh per viewer and crowd out actual mutations.
  if (
    unfilteredPublic &&
    (!c.env.WRITE_QUEUE || c.env.DISABLE_WRITE_BUFFER === 'true')
  ) {
    scheduleFeedRefresh(c.env, c as any);
  }

  const posts = isPrivateList
    ? result.posts.map((post: any) => ({
        ...post,
        is_owner: !!(
          (deviceId &&
            post.author_cookie_id &&
            post.author_cookie_id === deviceId) ||
          (session && post.author_id && post.author_id === session.userId) ||
          session?.role === 'admin'
        ),
      }))
    : result.posts;

  if (skipEdgeCache) {
    c.header('Cache-Control', isPrivateList ? 'private, no-store' : 'no-store');
    c.header('X-Feed-Source', 'd1');
    return c.json({
      success: true,
      posts,
      total: result.total,
      limit,
      offset,
    });
  }

  const payload = {
    success: true,
    posts,
    total: result.total,
    limit,
    offset,
  };
  const response = new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control':
        'public, max-age=15, s-maxage=15, stale-while-revalidate=60',
      'X-Feed-Source': 'd1',
    },
  });

  try {
    const cacheUrl = new URL(c.req.url);
    cacheUrl.searchParams.delete('_t');
    cacheUrl.searchParams.set('_cache_version', '2');
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    executionCtxOf(c)?.waitUntil(
      caches.default.put(cacheKey, response.clone())
    );
  } catch {
    // ignore cache put failures
  }

  return response;
});

// GET /api/posts/:id
postsRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const post = await getPostById(c.env.DB, id, true);

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const { author_cookie_id: _cookie, ...publicPost } = post;
  const history = await getStatusUpdatesByPostId(c.env.DB, id);
  const deviceId = c.get('deviceSessionId') || null;

  c.header('Cache-Control', 'private, no-store');

  return c.json({
    success: true,
    post: {
      ...publicPost,
      is_owner: !!(
        deviceId &&
        (post as any).author_cookie_id &&
        (post as any).author_cookie_id === deviceId
      ),
    },
    history,
  });
});

// GET /api/posts/:id/ogp.svg - Dynamic vector OGP banner with QR code
postsRoute.get('/:id/ogp.svg', async (c) => {
  const id = c.req.param('id');
  const post = await getPostById(c.env.DB, id, true);
  if (!post) {
    return c.text('Post not found', 404);
  }

  const origin = c.env.EXPECTED_ORIGIN || new URL(c.req.url).origin;
  const svg = await renderOgpSvg(post, origin);

  c.header('Content-Type', 'image/svg+xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300');
  return c.body(svg);
});

// POST /api/posts - Create new post (Cookie or Passkey authenticated)
postsRoute.post('/', async (c) => {
  const session = await getOptionalSession(c);
  const deviceId = c.get('deviceSessionId'); // Set by deviceCookie middleware

  const body = await c.req.json();
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return c.json(
      {
        success: false,
        error: 'Missing required field (title)',
      },
      400
    );
  }

  let operation;
  try {
    operation = await operationFor(c, body.requestId, body);
  } catch {
    return c.json({ success: false, error: 'Invalid requestId' }, 400);
  }
  const postId = operation
    ? `post_${operation.id}`
    : `post_${crypto.randomUUID()}`;
  if (operation) {
    const receipt = await c.env.DB.prepare(
      'SELECT payload_hash FROM mutation_receipts WHERE id = ?'
    )
      .bind(operation.id)
      .first<{ payload_hash: string }>();
    if (receipt) {
      if (receipt.payload_hash !== operation.payloadHash)
        return c.json(
          {
            success: false,
            error: 'Request ID already used with different data',
          },
          409
        );
      return c.json(
        { success: true, id: postId, buffered: false, duplicate: true },
        200
      );
    }
  }

  if (
    body.observedAt !== undefined &&
    (typeof body.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(body.observedAt)) ||
      Date.parse(body.observedAt) > Date.now() + 300_000)
  )
    return c.json({ success: false, error: 'Invalid observation time' }, 400);

  for (const [field, bound] of [
    ['lat', 90],
    ['lng', 180],
  ] as const) {
    if (
      body[field] !== undefined &&
      body[field] !== null &&
      (!Number.isFinite(Number(body[field])) ||
        Math.abs(Number(body[field])) > bound)
    )
      return c.json({ success: false, error: 'Invalid coordinates' }, 400);
  }

  // Persist image to Cloudflare R2 if configured, stripping heavy Base64 from D1
  const storedImageUrl = await persistImageToR2(
    c.env.IMAGES_BUCKET,
    body.imageUrl,
    postId
  );

  const postData = {
    id: postId,
    authorId: session?.userId || null,
    authorCookieId: deviceId || null,
    categoryId: body.categoryId,
    title: body.title.trim(),
    area: typeof body.area === 'string' ? body.area.trim() : '',
    address: body.address,
    lat: body.lat != null ? Number(body.lat) : undefined,
    lng: body.lng != null ? Number(body.lng) : undefined,
    currentStatus: body.currentStatus || 'available',
    statusLabel: body.statusLabel || body.currentStatus || 'お知らせ',
    note: body.note,
    url: body.url,
    sourceUrl: body.sourceUrl,
    imageUrl: storedImageUrl ?? undefined,
    imageMeta: body.imageMeta,
    attributes: body.attributes,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    isVerified: false,
    reporterName: body.reporterName || session?.username || null,
    operation,
    observedAt:
      typeof body.observedAt === 'string'
        ? body.observedAt
        : new Date().toISOString(),
  };

  const ip = getClientIp(c.req.raw);
  const ua = c.req.header('User-Agent') || '';
  const accessLog = {
    ip,
    ua,
    deviceId: deviceId || null,
    userId: session?.userId || null,
  };

  // Trigger push broadcast for emergency / evacuation posts
  const postTags: string[] = Array.isArray(body.tags) ? body.tags : [];
  const isEmergencyPost =
    postTags.some((t: string) =>
      ['#避難所', '#給水', '#救急', '#緊急', '避難所', '給水所'].includes(t)
    ) ||
    body.currentStatus === 'closed' ||
    body.currentStatus === 'danger';

  const pushBroadcast = isEmergencyPost
    ? {
        title: `【防災情報】${body.area} ${body.title}`,
        body: `${body.statusLabel || body.currentStatus}: ${body.note || '最新情報を確認してください'}`,
        url: `/?post=${postId}`,
        area: body.area,
        alertType: 'evacuation' as const,
      }
    : undefined;

  // Try async write buffer via Cloudflare Queues
  const enqueueResult = await enqueuePostCreation(c.env, {
    type: 'create_post',
    post: {
      ...postData,
      imageMeta: postData.imageMeta
        ? JSON.stringify(postData.imageMeta)
        : undefined,
      attributes: postData.attributes
        ? JSON.stringify(postData.attributes)
        : undefined,
    },
    accessLog,
    pushBroadcast,
  });

  if (enqueueResult === 'unavailable') {
    c.header('Cache-Control', 'no-store');
    c.header('Retry-After', '30');
    return c.json(
      {
        success: false,
        retryable: true,
        error:
          '現在、投稿を安全に受け付けられません。入力内容を端末に保存し、30秒ほど待ってから再送してください。',
      },
      503
    );
  }
  const enqueued = enqueueResult === 'queued';

  if (!enqueued) {
    // Synchronous write fallback (local/dev/testing)
    const created = await createPost(c.env.DB, postData);
    if (!created)
      return c.json(
        { success: true, id: postId, duplicate: true, buffered: false },
        200
      );
    await logAccess(
      c.env.DB,
      'post_created',
      deviceId || null,
      session?.userId || null,
      ip,
      ua,
      { postId }
    );
    if (pushBroadcast) {
      await broadcastPushNotification(c.env, pushBroadcast).catch((err) =>
        console.error('[push] post broadcast failed:', err)
      );
    }
  }

  if (!enqueued) scheduleFeedRefresh(c.env, c as any);

  return c.json(
    {
      success: true,
      id: postId,
      message: enqueued
        ? 'Post accepted and queued for writing'
        : 'Post created successfully',
      buffered: enqueued,
      hasPasskey: !!session,
      isVerified: postData.isVerified,
    },
    201
  );
});

// PUT /api/posts/:id - Update post (Cookie owner, Passkey author, or Admin)
postsRoute.put('/:id', async (c) => {
  const session = await getOptionalSession(c);
  const deviceId = c.get('deviceSessionId') || null;

  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId, true);
  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  // Authorization check (Priority: Admin > Passkey Author > Cookie Owner)
  const isCookieOwner = !!(
    deviceId &&
    (post as any).author_cookie_id &&
    (post as any).author_cookie_id === deviceId
  );
  const isPasskeyAuthor = !!(
    session &&
    post.author_id &&
    post.author_id === session.userId
  );
  const isAdmin = session?.role === 'admin' || session?.role === 'moderator';

  if (!isCookieOwner && !isPasskeyAuthor && !isAdmin) {
    return c.json(
      { success: false, error: 'You can only edit your own posts' },
      403
    );
  }

  const body = await c.req.json();

  let storedImageUrl = body.imageUrl;
  if (
    c.env.IMAGES_BUCKET &&
    body.imageUrl &&
    typeof body.imageUrl === 'string' &&
    body.imageUrl.startsWith('data:')
  ) {
    storedImageUrl = await persistImageToR2(
      c.env.IMAGES_BUCKET,
      body.imageUrl,
      postId
    );
  }

  await updatePost(c.env.DB, postId, {
    title: body.title,
    area: body.area,
    address: body.address,
    lat:
      body.lat !== undefined
        ? body.lat !== null
          ? parseFloat(body.lat)
          : null
        : undefined,
    lng:
      body.lng !== undefined
        ? body.lng !== null
          ? parseFloat(body.lng)
          : null
        : undefined,
    currentStatus: body.currentStatus,
    statusLabel: body.statusLabel,
    note: body.note,
    url: body.url,
    sourceUrl: body.sourceUrl,
    imageUrl: storedImageUrl,
    imageMeta: body.imageMeta,
    attributes: body.attributes,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
  });

  const ip = getClientIp(c.req.raw);
  const ua = c.req.header('User-Agent') || '';
  await logAccess(
    c.env.DB,
    'post_updated',
    deviceId,
    session?.userId || null,
    ip,
    ua,
    { postId }
  );

  scheduleFeedRefresh(c.env, c as any);

  return c.json({
    success: true,
    message: 'Post updated successfully',
  });
});

// DELETE /api/posts/:id - Delete post (Cookie owner, Passkey author, or Admin)
postsRoute.delete('/:id', async (c) => {
  const session = await getOptionalSession(c);
  const deviceId = c.get('deviceSessionId') || null;

  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId, true);
  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const isCookieOwner = !!(
    deviceId &&
    (post as any).author_cookie_id &&
    (post as any).author_cookie_id === deviceId
  );
  const isPasskeyAuthor = !!(
    session &&
    post.author_id &&
    post.author_id === session.userId
  );
  const isAdmin = session?.role === 'admin' || session?.role === 'moderator';

  if (!isCookieOwner && !isPasskeyAuthor && !isAdmin) {
    return c.json(
      { success: false, error: 'You can only delete your own posts' },
      403
    );
  }

  await deletePost(c.env.DB, postId);

  const ip = getClientIp(c.req.raw);
  const ua = c.req.header('User-Agent') || '';
  await logAccess(
    c.env.DB,
    'post_deleted',
    deviceId,
    session?.userId || null,
    ip,
    ua,
    { postId }
  );

  scheduleFeedRefresh(c.env, c as any);

  return c.json({
    success: true,
    message: 'Post deleted successfully',
  });
});

// POST /api/posts/:id/status - Micro-update (One-tap status update)
postsRoute.post('/:id/status', async (c) => {
  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId, true);

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const body = await c.req.json();
  const status = body.status || post.current_status;
  const statusLabel =
    body.statusLabel || (body.status ? body.status : post.status_label);
  const note = body.note ? String(body.note).trim() : null;

  if (!body.status && !note) {
    return c.json({ success: false, error: 'Status or note is required' }, 400);
  }

  let operation;
  try {
    operation = await operationFor(c, body.requestId, body);
  } catch {
    return c.json({ success: false, error: 'Invalid requestId' }, 400);
  }
  if (
    body.observedAt !== undefined &&
    (typeof body.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(body.observedAt)) ||
      Date.parse(body.observedAt) > Date.now() + 300_000)
  ) {
    return c.json({ success: false, error: 'Invalid observation time' }, 400);
  }
  if (
    body.expectedUpdatedAt !== undefined &&
    typeof body.expectedUpdatedAt !== 'string'
  )
    return c.json({ success: false, error: 'Invalid version' }, 400);
  const options = {
    operationId: operation?.id || `update_${crypto.randomUUID()}`,
    payloadHash: operation?.payloadHash,
    expectedUpdatedAt: body.expectedUpdatedAt,
    observedAt: body.observedAt || new Date().toISOString(),
    noteOnly: !body.status,
  };

  // Generate anonymized hash from IP for spam rate limiting and privacy
  const clientIp = c.req.header('cf-connecting-ip') || 'unknown';
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(clientIp)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const ipHash = hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const pushBroadcast =
    body.status === 'closed' ||
    body.status === 'danger' ||
    body.status === 'available'
      ? {
          title: `【状況更新】${post.area} ${post.title}`,
          body: `状況: ${statusLabel}${note ? ' - ' + note : ''}`,
          url: `/?post=${postId}`,
          area: post.area,
          alertType: 'status' as const,
        }
      : undefined;

  const enqueueResult =
    body.expectedUpdatedAt === undefined
      ? await enqueueStatusUpdate(c.env, {
          type: 'update_status',
          postId,
          status,
          statusLabel,
          note,
          ipHash,
          pushBroadcast,
          ...options,
        })
      : 'sync';

  if (enqueueResult === 'unavailable') {
    c.header('Cache-Control', 'no-store');
    c.header('Retry-After', '30');
    return c.json(
      {
        success: false,
        retryable: true,
        error:
          '現在、更新を安全に受け付けられません。入力内容を端末に保存し、30秒ほど待ってから再送してください。',
      },
      503
    );
  }
  const enqueued = enqueueResult === 'queued';

  if (!enqueued) {
    const result = await updatePostStatus(
      c.env.DB,
      postId,
      status,
      statusLabel,
      note,
      ipHash,
      options
    );
    if (result === 'conflict')
      return c.json(
        {
          success: false,
          conflict: true,
          error:
            '他の人が状況を更新しました。最新情報を確認してから再報告してください。',
        },
        409
      );
    if (result === 'applied' && pushBroadcast) {
      await broadcastPushNotification(c.env, pushBroadcast).catch((err) =>
        console.error('[push] status broadcast failed:', err)
      );
    }
  }

  if (!enqueued) scheduleFeedRefresh(c.env, c as any);

  return c.json({
    success: true,
    message: enqueued
      ? 'Status update accepted and queued for writing'
      : 'Status updated successfully',
    buffered: enqueued,
  });
});

// Explicit content confirmation by a current administrator or moderator.
postsRoute.post('/:id/official-verification', async (c) => {
  const session = await getOptionalSession(c);
  if (!session || !['admin', 'moderator'].includes(session.role))
    return c.json({ success: false, error: 'Forbidden' }, 403);
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ success: false, error: 'Post not found' }, 404);
  const body = await c.req.json<{ expectedUpdatedAt: string }>();
  const result = await c.env.DB.prepare(
    'UPDATE posts SET is_verified = 1 WHERE id = ? AND updated_at = ?'
  )
    .bind(post.id, body.expectedUpdatedAt)
    .run();
  if (!result.meta.changes)
    return c.json(
      {
        success: false,
        error: '投稿が更新されました。内容を再確認してください。',
      },
      409
    );
  await logAccess(
    c.env.DB,
    'post_official_verified',
    c.get('deviceSessionId') || null,
    session.userId,
    getClientIp(c.req.raw),
    c.req.header('User-Agent') || '',
    { postId: post.id }
  );
  scheduleFeedRefresh(c.env, c as any);
  return c.json({ success: true });
});

// POST /api/posts/:id/verify - Community on-site verification
postsRoute.post('/:id/verify', async (c) => {
  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId, true);

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const clientIp = c.req.header('cf-connecting-ip') || 'unknown';
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(clientIp)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const ipHash = hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const result = await verifyPost(c.env.DB, postId, ipHash);

  return c.json({
    success: true,
    message: 'Post verified successfully',
    verificationCount: result.verificationCount,
    lastVerifiedAt: result.lastVerifiedAt,
  });
});

// A report does not change the public status. Moderators review it explicitly.
postsRoute.post('/:id/report', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ success: false, error: 'Post not found' }, 404);
  const body = await c.req.json<{ reason: string; note?: string }>();
  if (
    !['outdated', 'incorrect', 'spam', 'privacy'].includes(body.reason) ||
    (body.note !== undefined &&
      (typeof body.note !== 'string' || body.note.length > 2000))
  )
    return c.json({ success: false, error: 'Invalid report' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO post_reports (id,post_id,post_title,device_cookie_id,reason,note)
    VALUES (?,?,?,?,?,?) ON CONFLICT(post_id,device_cookie_id) DO NOTHING`
  )
    .bind(
      `report_${crypto.randomUUID()}`,
      post.id,
      post.title,
      c.get('deviceSessionId'),
      body.reason,
      body.note?.trim() || ''
    )
    .run();
  return c.json({ success: true }, 201);
});

postsRoute.get('/reports/moderation', async (c) => {
  const session = await getOptionalSession(c);
  if (!session || !['admin', 'moderator'].includes(session.role))
    return c.json({ success: false, error: 'Forbidden' }, 403);
  const offset = Number(c.req.query('offset') || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000)
    return c.json({ success: false, error: 'Invalid offset' }, 400);
  const reports = await c.env.DB.prepare(
    `SELECT id,post_id,post_title,reason,note,status,created_at FROM post_reports WHERE status='open' ORDER BY created_at,id LIMIT 50 OFFSET ?`
  )
    .bind(offset)
    .all();
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM post_reports WHERE status='open'"
  ).first<{ total: number }>();
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    success: true,
    reports: reports.results,
    total: count?.total || 0,
  });
});

postsRoute.post('/reports/:reportId/resolve', async (c) => {
  const session = await getOptionalSession(c);
  if (!session || !['admin', 'moderator'].includes(session.role))
    return c.json({ success: false, error: 'Forbidden' }, 403);
  const body = await c.req.json<{ resolution: string }>();
  if (
    typeof body.resolution !== 'string' ||
    !body.resolution.trim() ||
    body.resolution.length > 2000
  )
    return c.json(
      { success: false, error: 'Record the review and action taken' },
      400
    );
  const result = await c.env.DB.prepare(
    "UPDATE post_reports SET status='resolved',resolution=?,resolved_by=?,resolved_at=datetime('now') WHERE id=? AND status='open'"
  )
    .bind(body.resolution.trim(), session.userId, c.req.param('reportId'))
    .run();
  if (!result.meta.changes)
    return c.json(
      { success: false, error: 'Report not found or already resolved' },
      409
    );
  await logAccess(
    c.env.DB,
    'report_resolved',
    c.get('deviceSessionId') || null,
    session.userId,
    getClientIp(c.req.raw),
    c.req.header('User-Agent') || '',
    { reportId: c.req.param('reportId') }
  );
  return c.json({ success: true });
});
