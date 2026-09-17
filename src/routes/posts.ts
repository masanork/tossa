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
} from '../db/queries';
import { logAccess, getClientIp } from '../middleware/deviceCookie';
import { verifySessionToken } from '../auth/session';
import { broadcastPushNotification } from '../services/push';

type PostsVariables = { deviceSessionId: string };

export const postsRoute = new Hono<{
  Bindings: Bindings;
  Variables: PostsVariables;
}>();

/** Get optional Passkey session without rejecting anonymous requests */
async function getOptionalSession(c: any) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  return await verifySessionToken(token, c.env.JWT_SECRET);
}

// GET /api/posts/tags/vocabulary (Tag vocabulary list)
postsRoute.get('/tags/vocabulary', async (c) => {
  const tags = await getVocabularyTags(c.env.DB, 40);
  c.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
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
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 50;
  const offset = c.req.query('offset')
    ? parseInt(c.req.query('offset')!, 10)
    : 0;
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

  const result = await getPosts(c.env.DB, {
    categoryId,
    area,
    status,
    search,
    tag,
    ids,
    authorId,
    authorCookieId,
    limit,
    offset,
  });

  // Attach is_owner based on device cookie, Passkey user session, or admin
  const posts = result.posts.map((post: any) => ({
    ...post,
    is_owner: !!(
      (deviceId &&
        post.author_cookie_id &&
        post.author_cookie_id === deviceId) ||
      (session && post.author_id && post.author_id === session.userId) ||
      session?.role === 'admin'
    ),
  }));

  // Disallow caching because response includes request-specific is_owner flag
  c.header('Cache-Control', 'no-store');

  return c.json({
    success: true,
    posts,
    total: result.total,
    limit,
    offset,
  });
});

// GET /api/posts/:id
postsRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const post = await getPostById(c.env.DB, id);

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const history = await getStatusUpdatesByPostId(c.env.DB, id);
  const deviceId = c.get('deviceSessionId') || null;

  c.header('Cache-Control', 'no-store');

  return c.json({
    success: true,
    post: {
      ...post,
      is_owner: !!(
        deviceId &&
        (post as any).author_cookie_id &&
        (post as any).author_cookie_id === deviceId
      ),
    },
    history,
  });
});

// POST /api/posts - Create new post (Cookie or Passkey authenticated)
postsRoute.post('/', async (c) => {
  const session = await getOptionalSession(c);
  const deviceId = c.get('deviceSessionId'); // Set by deviceCookie middleware

  const body = await c.req.json();
  if (!body.title || !body.area || !body.currentStatus) {
    return c.json(
      {
        success: false,
        error: 'Missing required fields (title, area, currentStatus)',
      },
      400
    );
  }

  const postId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  await createPost(c.env.DB, {
    id: postId,
    authorId: session?.userId || null,
    authorCookieId: deviceId || null,
    categoryId: body.categoryId,
    title: body.title,
    area: body.area,
    address: body.address,
    lat: body.lat ? parseFloat(body.lat) : undefined,
    lng: body.lng ? parseFloat(body.lng) : undefined,
    currentStatus: body.currentStatus,
    statusLabel: body.statusLabel || body.currentStatus,
    note: body.note,
    url: body.url,
    sourceUrl: body.sourceUrl,
    imageUrl: body.imageUrl,
    imageMeta: body.imageMeta,
    attributes: body.attributes,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    isVerified: !!session, // Posts made with authenticated Passkey receive verified status
    reporterName: body.reporterName || session?.username || null,
  });

  // Access log
  const ip = getClientIp(c.req.raw);
  const ua = c.req.header('User-Agent') || '';
  await logAccess(
    c.env.DB,
    'post_created',
    deviceId || null,
    session?.userId || null,
    ip,
    ua,
    { postId }
  );

  // Trigger push broadcast for emergency / evacuation posts
  const postTags: string[] = Array.isArray(body.tags) ? body.tags : [];
  const isEmergencyPost =
    postTags.some((t: string) =>
      ['#避難所', '#給水', '#救急', '#緊急', '避難所', '給水所'].includes(t)
    ) ||
    body.currentStatus === 'closed' ||
    body.currentStatus === 'danger';

  if (isEmergencyPost) {
    broadcastPushNotification(c.env, {
      title: `【防災情報】${body.area} ${body.title}`,
      body: `${body.statusLabel || body.currentStatus}: ${body.note || '最新情報を確認してください'}`,
      url: `/?post=${postId}`,
      area: body.area,
      alertType: 'evacuation',
    }).catch((err) => console.error('[push] post broadcast failed:', err));
  }

  return c.json(
    {
      success: true,
      id: postId,
      message: 'Post created successfully',
      hasPasskey: !!session,
    },
    201
  );
});

// PUT /api/posts/:id - Update post (Cookie owner, Passkey author, or Admin)
postsRoute.put('/:id', async (c) => {
  const session = await getOptionalSession(c);
  const deviceId = c.get('deviceSessionId') || null;

  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId);
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
  const isAdmin = session?.role === 'admin';

  if (!isCookieOwner && !isPasskeyAuthor && !isAdmin) {
    return c.json(
      { success: false, error: 'You can only edit your own posts' },
      403
    );
  }

  const body = await c.req.json();

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
    imageUrl: body.imageUrl,
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
  const post = await getPostById(c.env.DB, postId);
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
  const isAdmin = session?.role === 'admin';

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

  return c.json({
    success: true,
    message: 'Post deleted successfully',
  });
});

// POST /api/posts/:id/status - Micro-update (One-tap status update)
postsRoute.post('/:id/status', async (c) => {
  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId);

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

  await updatePostStatus(c.env.DB, postId, status, statusLabel, note, ipHash);

  // Trigger push broadcast for status change
  if (
    body.status === 'closed' ||
    body.status === 'danger' ||
    body.status === 'available'
  ) {
    broadcastPushNotification(c.env, {
      title: `【状況更新】${post.area} ${post.title}`,
      body: `状況: ${body.statusLabel}${body.note ? ' - ' + body.note : ''}`,
      url: `/?post=${postId}`,
      area: post.area,
      alertType: 'status',
    }).catch((err) => console.error('[push] status broadcast failed:', err));
  }

  return c.json({
    success: true,
    message: 'Status updated successfully',
  });
});

// POST /api/posts/:id/verify - Community on-site verification
postsRoute.post('/:id/verify', async (c) => {
  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId);

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
