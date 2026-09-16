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
import { notifyThreadMembers } from '../services/push';

export const threadsRoute = new Hono<{ Bindings: Bindings }>();

// Authentication helper
async function getAuthenticatedUser(c: any) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  return await verifySessionToken(token, c.env.JWT_SECRET);
}

// 1. Register or update own E2EE public key (PUT /api/threads/public-key)
threadsRoute.put('/public-key', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
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

// 2. Query public keys of users (GET /api/threads/public-keys)
// Used to find public keys of administrators or specific users to create/invite to threads
threadsRoute.get('/public-keys', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
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

// 3. List threads joined by current user (GET /api/threads)
threadsRoute.get('/', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  const threads = await getUserThreads(c.env.DB, session.userId);

  return c.json({
    success: true,
    threads,
  });
});

// 4. Create new E2EE thread (POST /api/threads)
threadsRoute.post('/', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
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

  // Admin chat is restricted to administrators
  if (body.type === 'admin_chat' && session.role !== 'admin') {
    return c.json(
      {
        success: false,
        error: 'Only administrators can create admin chat threads',
      },
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

// 5. Get thread details & message history (GET /api/threads/:id)
threadsRoute.get('/:id', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  const threadId = c.req.param('id');
  const isMember = await isThreadMember(c.env.DB, threadId, session.userId);
  if (!isMember) {
    return c.json(
      { success: false, error: 'Access denied to this thread' },
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

// 6. Send encrypted message (POST /api/threads/:id/messages)
threadsRoute.post('/:id/messages', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  const threadId = c.req.param('id');
  const isMember = await isThreadMember(c.env.DB, threadId, session.userId);
  if (!isMember) {
    return c.json(
      { success: false, error: 'Posting permission denied for this thread' },
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

  // Privacy-preserving push notification to other thread members
  getThreadById(c.env.DB, threadId, session.userId)
    .then((thread) => {
      if (thread) {
        notifyThreadMembers(
          c.env,
          threadId,
          session.userId,
          thread.title
        ).catch((err) => console.error('[push] thread notify error:', err));
      }
    })
    .catch(() => {});

  return c.json(
    {
      success: true,
      id: messageId,
      message: 'Message sent successfully',
    },
    201
  );
});

// 7. Invite new participant / moderator to thread (POST /api/threads/:id/members)
threadsRoute.post('/:id/members', async (c) => {
  const session = await getAuthenticatedUser(c);
  if (!session) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  const threadId = c.req.param('id');
  const isMember = await isThreadMember(c.env.DB, threadId, session.userId);
  if (!isMember) {
    return c.json(
      { success: false, error: 'Invitation permission denied for this thread' },
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
