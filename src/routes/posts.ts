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

type PostsVariables = { deviceSessionId: string };

export const postsRoute = new Hono<{ Bindings: Bindings; Variables: PostsVariables }>();

/** Passkeyセッションを任意取得（未ログインでもエラーにしない） */
async function getOptionalSession(c: any) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  return await verifySessionToken(token, c.env.JWT_SECRET);
}

// GET /api/posts/tags/vocabulary (ボキャブラリ一覧)
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
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 50;
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : 0;
  const deviceId = c.get('deviceSessionId') || null;

  const result = await getPosts(c.env.DB, {
    categoryId,
    area,
    status,
    search,
    tag,
    limit,
    offset,
  });

  // 端末Cookieに基づいて is_owner を付与（サーバー側照合）
  const posts = result.posts.map((post: any) => ({
    ...post,
    is_owner: !!(deviceId && post.author_cookie_id && post.author_cookie_id === deviceId),
  }));

  // is_owner 含むためキャッシュ不可
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
      is_owner: !!(deviceId && (post as any).author_cookie_id && (post as any).author_cookie_id === deviceId),
    },
    history,
  });
});

// POST /api/posts - 新規投稿（Cookie または Passkey 認証）
postsRoute.post('/', async (c) => {
  const session = await getOptionalSession(c);
  const deviceId = c.get('deviceSessionId'); // ミドルウェアが必ず設定

  const body = await c.req.json();
  if (!body.title || !body.area || !body.currentStatus) {
    return c.json({ success: false, error: 'Missing required fields (title, area, currentStatus)' }, 400);
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
    isVerified: !!session, // Passkey認証済みの投稿を公式確認扱い
    reporterName: body.reporterName || session?.username || null,
  });

  // アクセスログ
  const ip = getClientIp(c.req.raw);
  const ua = c.req.header('User-Agent') || '';
  await logAccess(c.env.DB, 'post_created', deviceId || null, session?.userId || null, ip, ua, { postId });

  return c.json({
    success: true,
    id: postId,
    message: 'Post created successfully',
    hasPasskey: !!session,
  }, 201);
});

// PUT /api/posts/:id - 投稿編集（Cookie所有者、Passkey投稿者、または管理者）
postsRoute.put('/:id', async (c) => {
  const session = await getOptionalSession(c);
  const deviceId = c.get('deviceSessionId') || null;

  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId);
  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  // 権限チェック（優先順位: 管理者 > Passkey本人 > Cookie本人）
  const isCookieOwner = !!(deviceId && (post as any).author_cookie_id && (post as any).author_cookie_id === deviceId);
  const isPasskeyAuthor = !!(session && post.author_id && post.author_id === session.userId);
  const isAdmin = session?.role === 'admin';

  if (!isCookieOwner && !isPasskeyAuthor && !isAdmin) {
    return c.json({ success: false, error: '自分が投稿した情報のみ編集できます' }, 403);
  }

  const body = await c.req.json();

  await updatePost(c.env.DB, postId, {
    title: body.title,
    area: body.area,
    address: body.address,
    lat: body.lat !== undefined ? (body.lat !== null ? parseFloat(body.lat) : null) : undefined,
    lng: body.lng !== undefined ? (body.lng !== null ? parseFloat(body.lng) : null) : undefined,
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
  await logAccess(c.env.DB, 'post_updated', deviceId, session?.userId || null, ip, ua, { postId });

  return c.json({
    success: true,
    message: 'Post updated successfully',
  });
});

// DELETE /api/posts/:id - 投稿削除（Cookie所有者、Passkey投稿者、または管理者）
postsRoute.delete('/:id', async (c) => {
  const session = await getOptionalSession(c);
  const deviceId = c.get('deviceSessionId') || null;

  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId);
  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const isCookieOwner = !!(deviceId && (post as any).author_cookie_id && (post as any).author_cookie_id === deviceId);
  const isPasskeyAuthor = !!(session && post.author_id && post.author_id === session.userId);
  const isAdmin = session?.role === 'admin';

  if (!isCookieOwner && !isPasskeyAuthor && !isAdmin) {
    return c.json({ success: false, error: '自分が投稿した情報のみ削除できます' }, 403);
  }

  await deletePost(c.env.DB, postId);

  const ip = getClientIp(c.req.raw);
  const ua = c.req.header('User-Agent') || '';
  await logAccess(c.env.DB, 'post_deleted', deviceId, session?.userId || null, ip, ua, { postId });

  return c.json({
    success: true,
    message: 'Post deleted successfully',
  });
});

// POST /api/posts/:id/status - マイクロアップデート（1タップ状況更新）
postsRoute.post('/:id/status', async (c) => {
  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId);

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const body = await c.req.json();
  if (!body.status || !body.statusLabel) {
    return c.json({ success: false, error: 'Status and statusLabel are required' }, 400);
  }

  // IPアドレスからハッシュ値を生成（プライバシー保護とスパム防止の最小ハッシュ）
  const clientIp = c.req.header('cf-connecting-ip') || 'unknown';
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(clientIp));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const ipHash = hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');

  await updatePostStatus(
    c.env.DB,
    postId,
    body.status,
    body.statusLabel,
    body.note || null,
    ipHash
  );

  return c.json({
    success: true,
    message: 'Status updated successfully',
  });
});

// POST /api/posts/:id/verify - 情報の正確性・現地確認（コミュニティ支持）
postsRoute.post('/:id/verify', async (c) => {
  const postId = c.req.param('id');
  const post = await getPostById(c.env.DB, postId);

  if (!post) {
    return c.json({ success: false, error: 'Post not found' }, 404);
  }

  const clientIp = c.req.header('cf-connecting-ip') || 'unknown';
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(clientIp));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const ipHash = hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');

  const result = await verifyPost(c.env.DB, postId, ipHash);

  return c.json({
    success: true,
    message: 'Post verified successfully',
    verificationCount: result.verificationCount,
    lastVerifiedAt: result.lastVerifiedAt,
  });
});
