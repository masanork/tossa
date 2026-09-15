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
} from '../db/queries';
import { createSessionToken, verifySessionToken } from '../auth/session';

export const authRoute = new Hono<{ Bindings: Bindings }>();

// 1. パスキー登録オプション取得 (POST /api/auth/register-options)
authRoute.post('/register-options', async (c) => {
  const body = await c.req.json<{ username: string }>();
  if (!body.username) {
    return c.json({ success: false, error: 'Username is required' }, 400);
  }

  let user = await getUserByUsername(c.env.DB, body.username);

  // ユーザーが存在しない場合、初期ユーザーとして作成を許可（またはシードされたadmin）
  if (!user) {
    // 最初のユーザーまたは指定ユーザーを自動作成
    const newId = `user_${Date.now()}`;
    await c.env.DB.prepare(
      'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
    )
      .bind(newId, body.username, body.username, 'admin')
      .run();

    user = await getUserById(c.env.DB, newId);
  }

  if (!user) {
    return c.json({ success: false, error: 'Failed to find or create user' }, 500);
  }

  const existingCreds = await getUserCredentials(c.env.DB, user.id);
  const options = await createRegOptions(c.env, user, existingCreds);

  return c.json({ success: true, options });
});

// 2. パスキー登録レスポンス検証 (POST /api/auth/verify-registration)
authRoute.post('/verify-registration', async (c) => {
  const body = await c.req.json<{ username: string; response: any }>();
  if (!body.username || !body.response) {
    return c.json({ success: false, error: 'Username and response are required' }, 400);
  }

  const user = await getUserByUsername(c.env.DB, body.username);
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
    user = await getUserByUsername(c.env.DB, body.username);
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

  // response.id (credentialId) からユーザーを逆引き（または指定されたusername）
  let user: User | null = null;
  if (body.username) {
    user = await getUserByUsername(c.env.DB, body.username);
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
