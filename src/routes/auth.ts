// src/routes/auth.ts: WebAuthn Passkey Authentication Routes
import { Hono } from 'hono';
import type { Bindings, User } from '../types';
import {
  createRegOptions,
  verifyRegResponse,
  createAuthOptions,
  verifyAuthResponse,
} from '../auth/webauthn';
import {
  getUserByUsername,
  getUserById,
  getUserCredentials,
  countUsers,
  countAdmins,
  getAllUsers,
  updateUserRole,
  linkDeviceToUser,
} from '../db/queries';
import { createSessionToken, verifySessionToken } from '../auth/session';
import { logAccess, getClientIp } from '../middleware/deviceCookie';

type AuthVariables = { deviceSessionId: string };
export const authRoute = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>();

// 0. 認証ステータス・初回セットアップ状況取得 (GET /api/auth/status)
authRoute.get('/status', async (c) => {
  const total = await countUsers(c.env.DB);
  const admins = await countAdmins(c.env.DB);
  return c.json({
    success: true,
    totalUsers: total,
    adminCount: admins,
    isFirstUserSetup: total === 0 || admins === 0,
  });
});

// 1. パスキー登録オプション取得 (POST /api/auth/register-options)
authRoute.post('/register-options', async (c) => {
  const body = await c.req.json<{ username: string; displayName?: string }>();
  if (!body.username) {
    return c.json({ success: false, error: 'Username is required' }, 400);
  }

  const cleanUsername = body.username.trim();
  const displayName = body.displayName?.trim() || cleanUsername;

  let user = await getUserByUsername(c.env.DB, cleanUsername);

  // ユーザーが存在しない場合、新規ユーザーを作成
  // デプロイ後最初の登録者は自動的に 'admin'、2人目以降は 'user'
  if (!user) {
    const totalUsers = await countUsers(c.env.DB);
    const adminCount = await countAdmins(c.env.DB);
    const role: 'admin' | 'user' = (totalUsers === 0 || adminCount === 0) ? 'admin' : 'user';

    const newId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await c.env.DB.prepare(
      'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
    )
      .bind(newId, cleanUsername, displayName, role)
      .run();

    user = await getUserById(c.env.DB, newId);
  }

  if (!user) {
    return c.json({ success: false, error: 'Failed to find or create user' }, 500);
  }

  const existingCreds = await getUserCredentials(c.env.DB, user.id);
  const options = await createRegOptions(c.env, user, existingCreds);

  return c.json({
    success: true,
    options,
    isFirstAdmin: user.role === 'admin',
  });
});

// 2. パスキー登録レスポンス検証 (POST /api/auth/verify-registration)
authRoute.post('/verify-registration', async (c) => {
  const body = await c.req.json<{ username: string; response: any }>();
  if (!body.username || !body.response) {
    return c.json({ success: false, error: 'Username and response are required' }, 400);
  }

  const user = await getUserByUsername(c.env.DB, body.username.trim());
  if (!user) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }

  try {
    const verification = await verifyRegResponse(c.env, user, body.response);

    // 登録成功時にそのままセッショントークンを発行
    const token = await createSessionToken(
      { userId: user.id, username: user.username, role: user.role },
      c.env.JWT_SECRET
    );

    // 端末セッションとPasskeyユーザーを紐付け
    const deviceId: string | undefined = c.get('deviceSessionId');
    if (deviceId) {
      await linkDeviceToUser(c.env.DB, deviceId, user.id);
    }

    // アクセスログ（登録イベント）
    const ip = getClientIp(c.req.raw);
    const ua = c.req.header('User-Agent') || '';
    await logAccess(c.env.DB, 'passkey_register', deviceId || null, user.id, ip, ua, {
      username: user.username,
      role: user.role,
    });

    return c.json({
      success: true,
      verified: verification.verified,
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Registration failed' }, 400);
  }
});

// 3. ログインオプション取得 (POST /api/auth/login-options)
authRoute.post('/login-options', async (c) => {
  const body = await c.req.json<{ username?: string }>().catch(() => ({ username: undefined }));
  let user: User | null = null;

  if (body?.username) {
    user = await getUserByUsername(c.env.DB, body.username.trim());
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
  }

  const options = await createAuthOptions(c.env, user || undefined);

  return c.json({ success: true, options });
});

// 4. ログインレスポンス検証 (POST /api/auth/verify-authentication)
authRoute.post('/verify-authentication', async (c) => {
  const body = await c.req.json<{ username?: string; response: any }>();
  if (!body.response) {
    return c.json({ success: false, error: 'Authentication response required' }, 400);
  }

  let user: User | null = null;
  if (body.username) {
    user = await getUserByUsername(c.env.DB, body.username.trim());
  } else {
    // PasskeyのCredential IDからユーザーを特定
    const cred = await c.env.DB.prepare(
      'SELECT user_id FROM credentials WHERE id = ?'
    )
      .bind(body.response.id)
      .first<{ user_id: string }>();

    if (cred) {
      user = await getUserById(c.env.DB, cred.user_id);
    }
  }

  if (!user) {
    return c.json({ success: false, error: 'User for credential not found' }, 404);
  }

  try {
    const verification = await verifyAuthResponse(c.env, user, body.response);

    const token = await createSessionToken(
      { userId: user.id, username: user.username, role: user.role },
      c.env.JWT_SECRET
    );

    // 端末セッションとPasskeyユーザーを紐付け
    const deviceId: string | undefined = c.get('deviceSessionId');
    if (deviceId) {
      await linkDeviceToUser(c.env.DB, deviceId, user.id);
    }

    // アクセスログ（ログインイベント）
    const ip = getClientIp(c.req.raw);
    const ua = c.req.header('User-Agent') || '';
    await logAccess(c.env.DB, 'passkey_login', deviceId || null, user.id, ip, ua, {
      username: user.username,
      role: user.role,
    });

    return c.json({
      success: true,
      verified: verification.verified,
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Authentication failed' }, 400);
  }
});

// 5. ログイン状態の確認 (GET /api/auth/me)
authRoute.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, authenticated: false }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session) {
    return c.json({ success: false, authenticated: false }, 401);
  }

  const user = await getUserById(c.env.DB, session.userId);
  if (!user) {
    return c.json({ success: false, authenticated: false }, 401);
  }

  return c.json({
    success: true,
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
  });
});

// 6. ユーザー一覧取得 (GET /api/auth/users) - 管理者のみ
authRoute.get('/users', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Authorization required' }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || session.role !== 'admin') {
    return c.json({ success: false, error: 'Admin permission required' }, 403);
  }

  const users = await getAllUsers(c.env.DB);
  return c.json({
    success: true,
    users,
  });
});

// 7. ユーザー権限変更・委譲 (PATCH /api/auth/users/:id/role) - 管理者のみ
authRoute.patch('/users/:id/role', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Authorization required' }, 401);
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session || session.role !== 'admin') {
    return c.json({ success: false, error: 'Admin permission required' }, 403);
  }

  const targetUserId = c.req.param('id');
  const targetUser = await getUserById(c.env.DB, targetUserId);
  if (!targetUser) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }

  const body = await c.req.json<{ role: 'admin' | 'moderator' | 'user' }>();
  if (!['admin', 'moderator', 'user'].includes(body.role)) {
    return c.json({ success: false, error: 'Invalid role' }, 400);
  }

  // 最後の1人の管理者を一般ユーザーに格下げできないように保護
  if (targetUser.role === 'admin' && body.role !== 'admin') {
    const adminCount = await countAdmins(c.env.DB);
    if (adminCount <= 1) {
      return c.json({ success: false, error: '最後の管理者の権限を解除することはできません' }, 400);
    }
  }

  await updateUserRole(c.env.DB, targetUserId, body.role);

  return c.json({
    success: true,
    message: `User ${targetUser.username} role updated to ${body.role}`,
  });
});
