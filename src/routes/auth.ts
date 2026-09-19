// src/routes/auth.ts: WebAuthn Passkey Authentication Routes
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
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
  deleteUser,
  linkDeviceToUser,
} from '../db/queries';
import {
  createSessionToken,
  verifySessionToken,
  createApiToken,
} from '../auth/session';
import { logAccess, getClientIp } from '../middleware/deviceCookie';

const CHALLENGE_COOKIE_OPTIONS = {
  path: '/api/auth',
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  maxAge: 300, // 5 minutes
};

type AuthVariables = { deviceSessionId: string };
export const authRoute = new Hono<{
  Bindings: Bindings;
  Variables: AuthVariables;
}>();

// 0. Get authentication and bootstrap status (GET /api/auth/status)
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

// 1. Get Passkey registration options (POST /api/auth/register-options)
authRoute.post('/register-options', async (c) => {
  const body = await c.req.json<{ username: string; displayName?: string }>();
  if (!body.username) {
    return c.json({ success: false, error: 'Username is required' }, 400);
  }

  const cleanUsername = body.username.trim();
  const displayName = body.displayName?.trim() || cleanUsername;

  let user = await getUserByUsername(c.env.DB, cleanUsername);

  // If user does not exist, create a new record.
  // The first user registered after deployment automatically receives 'admin' role; subsequent users get 'user'
  if (!user) {
    const totalUsers = await countUsers(c.env.DB);
    const adminCount = await countAdmins(c.env.DB);
    const role: 'admin' | 'user' =
      totalUsers === 0 || adminCount === 0 ? 'admin' : 'user';

    const newId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await c.env.DB.prepare(
      'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
    )
      .bind(newId, cleanUsername, displayName, role)
      .run();

    user = await getUserById(c.env.DB, newId);
  }

  if (!user) {
    return c.json(
      { success: false, error: 'Failed to find or create user' },
      500
    );
  }

  const existingCreds = await getUserCredentials(c.env.DB, user.id);
  const options = await createRegOptions(c.env, user, existingCreds);

  setCookie(
    c,
    'tossa_reg_challenge',
    options.challenge,
    CHALLENGE_COOKIE_OPTIONS
  );

  return c.json({
    success: true,
    options,
    isFirstAdmin: user.role === 'admin',
  });
});

// 2. Verify Passkey registration response (POST /api/auth/verify-registration)
authRoute.post('/verify-registration', async (c) => {
  const body = await c.req.json<{ username: string; response: any }>();
  if (!body.username || !body.response) {
    return c.json(
      { success: false, error: 'Username and response are required' },
      400
    );
  }

  const user = await getUserByUsername(c.env.DB, body.username.trim());
  if (!user) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }

  const cookieChallenge = getCookie(c, 'tossa_reg_challenge');

  try {
    const verification = await verifyRegResponse(
      c.env,
      user,
      body.response,
      cookieChallenge
    );
    deleteCookie(c, 'tossa_reg_challenge', { path: '/api/auth' });

    // Issue session token upon successful registration
    const token = await createSessionToken(
      { userId: user.id, username: user.username, role: user.role },
      c.env.JWT_SECRET
    );

    // Link device session to Passkey user (N:N)
    const deviceId: string | undefined = c.get('deviceSessionId');
    if (deviceId) {
      await linkDeviceToUser(c.env.DB, deviceId, user.id);
    }

    // Access log (registration event)
    const ip = getClientIp(c.req.raw);
    const ua = c.req.header('User-Agent') || '';
    await logAccess(
      c.env.DB,
      'passkey_register',
      deviceId || null,
      user.id,
      ip,
      ua,
      {
        username: user.username,
        role: user.role,
      }
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
    return c.json(
      { success: false, error: err.message || 'Registration failed' },
      400
    );
  }
});

// 3. Get Passkey authentication options (POST /api/auth/login-options)
authRoute.post('/login-options', async (c) => {
  const body = await c.req
    .json<{ username?: string }>()
    .catch(() => ({ username: undefined }));
  let user: User | null = null;

  if (body?.username) {
    user = await getUserByUsername(c.env.DB, body.username.trim());
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
  }

  const options = await createAuthOptions(c.env, user || undefined);

  setCookie(
    c,
    'tossa_auth_challenge',
    options.challenge,
    CHALLENGE_COOKIE_OPTIONS
  );

  return c.json({ success: true, options });
});

// 4. Verify Passkey authentication response (POST /api/auth/verify-authentication)
authRoute.post('/verify-authentication', async (c) => {
  const body = await c.req.json<{ username?: string; response: any }>();
  if (!body.response) {
    return c.json(
      { success: false, error: 'Authentication response required' },
      400
    );
  }

  let user: User | null = null;
  if (body.username) {
    user = await getUserByUsername(c.env.DB, body.username.trim());
  } else {
    // Identify user from Passkey Credential ID
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
    return c.json(
      { success: false, error: 'User for credential not found' },
      404
    );
  }

  const cookieChallenge = getCookie(c, 'tossa_auth_challenge');

  try {
    const verification = await verifyAuthResponse(
      c.env,
      user,
      body.response,
      cookieChallenge
    );
    deleteCookie(c, 'tossa_auth_challenge', { path: '/api/auth' });

    const token = await createSessionToken(
      { userId: user.id, username: user.username, role: user.role },
      c.env.JWT_SECRET
    );

    // Link device session to Passkey user (N:N)
    const deviceId: string | undefined = c.get('deviceSessionId');
    if (deviceId) {
      await linkDeviceToUser(c.env.DB, deviceId, user.id);
    }

    // Access log (login event)
    const ip = getClientIp(c.req.raw);
    const ua = c.req.header('User-Agent') || '';
    await logAccess(
      c.env.DB,
      'passkey_login',
      deviceId || null,
      user.id,
      ip,
      ua,
      {
        username: user.username,
        role: user.role,
      }
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
    return c.json(
      { success: false, error: err.message || 'Authentication failed' },
      400
    );
  }
});

// 5. Check session status (GET /api/auth/me)
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

  let freshToken: string | undefined;
  if (user.role !== session.role) {
    freshToken = await createSessionToken(
      {
        userId: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
      c.env.JWT_SECRET
    );
  }

  return c.json({
    success: true,
    authenticated: true,
    token: freshToken,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
  });
});

// Helper: verify admin permission checking both session token and DB
async function getAdminUserFromToken(
  token: string,
  env: Bindings
): Promise<{ user: User; session: any } | null> {
  const session = await verifySessionToken(token, env.JWT_SECRET);
  if (!session) return null;
  const user = await getUserById(env.DB, session.userId);
  if (!user) return null;
  if (session.role === 'admin' || user.role === 'admin') {
    return { user, session };
  }
  return null;
}

// 6. List users (GET /api/auth/users) - Admin only
authRoute.get('/users', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Authorization required' }, 401);
  }

  const auth = await getAdminUserFromToken(token, c.env);
  if (!auth) {
    return c.json({ success: false, error: 'Admin permission required' }, 403);
  }

  const users = await getAllUsers(c.env.DB);
  return c.json({
    success: true,
    users,
  });
});

// 7. Change or delegate user role (PATCH /api/auth/users/:id/role) - Admin only
authRoute.patch('/users/:id/role', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Authorization required' }, 401);
  }

  const auth = await getAdminUserFromToken(token, c.env);
  if (!auth) {
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

  // Prevent demoting the last remaining administrator
  if (targetUser.role === 'admin' && body.role !== 'admin') {
    const adminCount = await countAdmins(c.env.DB);
    if (adminCount <= 1) {
      return c.json(
        {
          success: false,
          error: 'Cannot demote the last remaining administrator',
        },
        400
      );
    }
  }

  await updateUserRole(c.env.DB, targetUserId, body.role);

  return c.json({
    success: true,
    message: `User ${targetUser.username} role updated to ${body.role}`,
  });
});

// 8. Delete user (DELETE /api/auth/users/:id) - Admin only
authRoute.delete('/users/:id', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json({ success: false, error: 'Authorization required' }, 401);
  }

  const auth = await getAdminUserFromToken(token, c.env);
  if (!auth) {
    return c.json({ success: false, error: 'Admin permission required' }, 403);
  }

  const targetUserId = c.req.param('id');
  if (targetUserId === auth.session.userId) {
    return c.json(
      { success: false, error: '自分自身のアカウントは削除できません' },
      400
    );
  }

  const targetUser = await getUserById(c.env.DB, targetUserId);
  if (!targetUser) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }

  // Prevent deleting the last remaining administrator
  if (targetUser.role === 'admin') {
    const adminCount = await countAdmins(c.env.DB);
    if (adminCount <= 1) {
      return c.json(
        {
          success: false,
          error: '最後の管理者は削除できません',
        },
        400
      );
    }
  }

  await deleteUser(c.env.DB, targetUserId);

  return c.json({
    success: true,
    message: `ユーザー「${targetUser.username}」を削除しました`,
  });
});

// 9. Issue API Token for MCP / Agents (POST /api/auth/api-tokens)
authRoute.post('/api-tokens', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return c.json(
      { success: false, error: 'Passkey authentication required' },
      401
    );
  }

  const session = await verifySessionToken(token, c.env.JWT_SECRET);
  if (!session) {
    return c.json({ success: false, error: 'Invalid or expired session' }, 401);
  }

  const user = await getUserById(c.env.DB, session.userId);
  if (!user) {
    return c.json({ success: false, error: 'User not found' }, 404);
  }

  const body = await c.req
    .json<{ name?: string; expiresInDays?: number }>()
    .catch(() => ({}) as { name?: string; expiresInDays?: number });
  const tokenName = body.name?.trim() || 'MCP Agent';
  const days =
    body.expiresInDays && body.expiresInDays > 0 && body.expiresInDays <= 365
      ? body.expiresInDays
      : 365;

  const result = await createApiToken(
    {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
    tokenName,
    c.env.JWT_SECRET,
    days * 24 * 60 * 60
  );

  return c.json({
    success: true,
    token: result.token,
    tokenName: result.tokenName,
    expiresAt: result.expiresAt,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
  });
});
