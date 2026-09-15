// src/routes/posts.ts: Posts and status update API routes
import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  getPosts,
  getPostById,
  getStatusUpdatesByPostId,
  createPost,
  updatePostStatus,
  getVocabularyTags,
} from '../db/queries';
import { verifySessionToken } from '../auth/session';

export const postsRoute = new Hono<{ Bindings: Bindings }>();

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

  const result = await getPosts(c.env.DB, {
    categoryId,
    area,
    status,
    search,
    tag,
    limit,
    offset,
  });

  // 10秒キャッシュ + 20秒バックグラウンド更新（D1負荷を95%遮断しつつ最新性を保持）
  c.header('Cache-Control', 'public, max-age=10, stale-while-revalidate=20');

  return c.json({
    success: true,
    posts: result.posts,
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

  c.header('Cache-Control', 'public, max-age=5, stale-while-revalidate=15');

  return c.json({
    success: true,
    post,
    history,
  });
});

// POST /api/posts - 新規投稿
postsRoute.post('/', async (c) => {
  const body = await c.req.json();

  if (!body.title || !body.area || !body.currentStatus) {
    return c.json({ success: false, error: 'Missing required fields (title, area, currentStatus)' }, 400);
  }

  // ログインユーザーの場合は検証フラグ等を設定可能
  let isVerified = false;
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    const session = await verifySessionToken(token, c.env.JWT_SECRET);
    if (session) {
      isVerified = true;
    }
  }

  const postId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  await createPost(c.env.DB, {
    id: postId,
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
    attributes: body.attributes,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    isVerified,
    reporterName: body.reporterName,
  });

  return c.json({
    success: true,
    id: postId,
    message: 'Post created successfully',
  }, 201);
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
