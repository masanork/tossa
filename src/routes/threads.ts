// src/routes/threads.ts: E2EE Secure Messaging Routes (Threads, Members, Encrypted Messages)
import { Hono } from 'hono';
import type { Bindings, ThreadType } from '../types';
import { verifySessionToken } from '../auth/session';
import {
  getUserThreads,
  getThreadById,
  isThreadMember,
  getThreadMembers,
  createThread,
  addThreadMember,
  createMessage,
  getThreadMessages,
  getUsersPublicKeys,
  updateUserPublicKey,
  getUserById,
} from '../db/queries';

export const threadsRoute = new Hono<{ Bindings: Bindings }>();

// 認証ヘルパー
async function getAuthenticatedUser(c: any) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  return await verifySessionToken(token, c.env.JWT_SECRET);
}

// 1. 自身の公開鍵の登録・更新 (PUT /api/threads/public-key)
threadsRoute.put('/public-key', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const body = await c.req.json<{ publicKey: string }>();
  if (!body.publicKey) {
    return c.json({ success: false, error: 'publicKey is required' }, 400);
  }

  await updateUserPublicKey(c.env.DB, session.userId, body.publicKey);

  return c.json({
    success: true,
    message: 'E2EE public key updated successfully',
  });
});

// 2. ユーザーの公開鍵一覧検索 (GET /api/threads/public-keys)
// 管理者一覧や特定の相手の公開鍵を取得してスレッドを作成・招待するために使用
threadsRoute.get('/public-keys', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const role = c.req.query('role');
  const userIdsParam = c.req.query('ids');
  const userIds = userIdsParam
    ? userIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const users = await getUsersPublicKeys(c.env.DB, { role, userIds });

  return c.json({
    success: true,
    users,
  });
});

// 3. 参加しているスレッド一覧取得 (GET /api/threads)
threadsRoute.get('/', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const threads = await getUserThreads(c.env.DB, session.userId);

  return c.json({
    success: true,
    threads,
  });
});

// 4. 新規E2EEスレッド作成 (POST /api/threads)
threadsRoute.post('/', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const body = await c.req.json<{
    title: string;
    type: ThreadType;
    postId?: string;
    members: Array<{
      userId: string;
      encryptedThreadKey: string;
      ephemeralPublicKey: string;
      role?: 'owner' | 'member';
    }>;
  }>();

  if (!body.title || !body.type || !body.members || body.members.length === 0) {
    return c.json(
      { success: false, error: 'Title, type, and members are required' },
      400
    );
  }

  // 管理者会議（admin_chat）は管理者のみ作成可能
  if (body.type === 'admin_chat' && session.role !== 'admin') {
    return c.json(
      { success: false, error: '管理者会議は管理者のみ作成できます' },
      403
    );
  }

  const threadId = `thread_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  await createThread(
    c.env.DB,
    {
      id: threadId,
      title: body.title.trim(),
      type: body.type,
      postId: body.postId || null,
      createdBy: session.userId,
    },
    body.members
  );

  return c.json(
    {
      success: true,
      id: threadId,
      message: 'Thread created successfully',
    },
    201
  );
});

// 5. スレッド詳細 & メッセージ履歴取得 (GET /api/threads/:id)
threadsRoute.get('/:id', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const threadId = c.req.param('id');
  const isMember = await isThreadMember(c.env.DB, threadId, session.userId);
  if (!isMember) {
    return c.json(
      { success: false, error: 'このスレッドへのアクセス権限がありません' },
      403
    );
  }

  const thread = await getThreadById(c.env.DB, threadId, session.userId);
  if (!thread) {
    return c.json({ success: false, error: 'Thread not found' }, 404);
  }

  const members = await getThreadMembers(c.env.DB, threadId);
  const messages = await getThreadMessages(c.env.DB, threadId, 100);

  return c.json({
    success: true,
    thread,
    members,
    messages,
  });
});

// 6. 暗号化メッセージ送信 (POST /api/threads/:id/messages)
threadsRoute.post('/:id/messages', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const threadId = c.req.param('id');
  const isMember = await isThreadMember(c.env.DB, threadId, session.userId);
  if (!isMember) {
    return c.json(
      { success: false, error: 'このスレッドへの送信権限がありません' },
      403
    );
  }

  const body = await c.req.json<{ ciphertext: string; iv: string }>();
  if (!body.ciphertext || !body.iv) {
    return c.json(
      { success: false, error: 'Ciphertext and IV are required' },
      400
    );
  }

  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  await createMessage(c.env.DB, {
    id: messageId,
    threadId,
    senderId: session.userId,
    ciphertext: body.ciphertext,
    iv: body.iv,
  });

  return c.json(
    {
      success: true,
      id: messageId,
      message: 'Message sent successfully',
    },
    201
  );
});

// 7. スレッドへの新規参加者・管理者招待 (POST /api/threads/:id/members)
threadsRoute.post('/:id/members', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: '認証が必要です' }, 401);
  }

  const threadId = c.req.param('id');
  const isMember = await isThreadMember(c.env.DB, threadId, session.userId);
  if (!isMember) {
    return c.json(
      { success: false, error: 'このスレッドへの招待権限がありません' },
      403
    );
  }

  const body = await c.req.json<{
    userId: string;
    encryptedThreadKey: string;
    ephemeralPublicKey: string;
    role?: 'owner' | 'member';
  }>();

  if (!body.userId || !body.encryptedThreadKey || !body.ephemeralPublicKey) {
    return c.json(
      {
        success: false,
        error:
          'userId, encryptedThreadKey, and ephemeralPublicKey are required',
      },
      400
    );
  }

  const targetUser = await getUserById(c.env.DB, body.userId);
  if (!targetUser) {
    return c.json({ success: false, error: 'Target user not found' }, 404);
  }

  await addThreadMember(c.env.DB, {
    threadId,
    userId: body.userId,
    encryptedThreadKey: body.encryptedThreadKey,
    ephemeralPublicKey: body.ephemeralPublicKey,
    keySenderId: session.userId,
    role: body.role || 'member',
  });

  return c.json({
    success: true,
    message: `User ${targetUser.display_name} invited to thread successfully`,
  });
});
