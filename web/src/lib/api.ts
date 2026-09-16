// web/src/lib/api.ts: API client and WebAuthn browser logic
import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';
import type {
  Category,
  Post,
  StatusUpdate,
  SystemSettings,
  User,
  TagCount,
  Thread,
  ThreadMember,
  EncryptedMessage,
  ThreadType,
} from './types';
import {
  deriveKeyFromPrfSeed,
  getOrCreateFallbackIdentityKey,
  PRF_SALT,
  bufferToBase64,
  base64ToBuffer,
} from './e2ee';

const API_BASE = '/api';

export async function fetchSettings(): Promise<SystemSettings> {
  const res = await fetch(`${API_BASE}/settings`);
  const data = await res.json();
  return data.settings || {};
}

export async function updateSettings(
  settings: Record<string, string>,
  token: string
): Promise<{ success: boolean; settings?: SystemSettings; error?: string }> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(settings),
  });
  return await res.json();
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/categories`);
  const data = await res.json();
  return data.categories || [];
}

export async function fetchVocabularyTags(): Promise<TagCount[]> {
  try {
    const res = await fetch(`${API_BASE}/posts/tags/vocabulary`);
    const data = await res.json();
    return data.tags || [];
  } catch {
    return [];
  }
}

export async function fetchPosts(
  params: {
    category?: string;
    area?: string;
    status?: string;
    tag?: string;
    q?: string;
  } = {}
): Promise<{ posts: Post[]; total: number }> {
  const query = new URLSearchParams();
  if (params.category) query.set('category', params.category);
  if (params.area) query.set('area', params.area);
  if (params.status) query.set('status', params.status);
  if (params.tag) query.set('tag', params.tag);
  if (params.q) query.set('q', params.q);

  const res = await fetch(`${API_BASE}/posts?${query.toString()}`);
  const data = await res.json();
  return {
    posts: data.posts || [],
    total: data.total || 0,
  };
}

export async function fetchPostDetail(
  id: string
): Promise<{ post: Post; history: StatusUpdate[] }> {
  const res = await fetch(`${API_BASE}/posts/${id}`);
  const data = await res.json();
  return {
    post: data.post,
    history: data.history || [],
  };
}

export async function createPost(
  postData: {
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
    reporterName?: string;
  },
  token?: string | null
): Promise<{ success: boolean; id?: string; error?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/posts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(postData),
  });
  return await res.json();
}

export async function updatePost(
  id: string,
  postData: {
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
  },
  token?: string | null
): Promise<{ success: boolean; message?: string; error?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/posts/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(postData),
  });
  return await res.json();
}

export async function deletePost(
  id: string,
  token?: string | null
): Promise<{ success: boolean; message?: string; error?: string }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/posts/${id}`, {
    method: 'DELETE',
    headers,
  });
  return await res.json();
}

export async function updatePostStatus(
  postId: string,
  status: string,
  statusLabel: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/posts/${postId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, statusLabel, note }),
  });
  return await res.json();
}

export async function verifyPost(postId: string): Promise<{
  success: boolean;
  verificationCount?: number;
  lastVerifiedAt?: string;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/posts/${postId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return await res.json();
}

// ================= WebAuthn (Passkey) Functions =================

export async function fetchAuthStatus(): Promise<{
  success: boolean;
  totalUsers: number;
  adminCount: number;
  isFirstUserSetup: boolean;
}> {
  try {
    const res = await fetch(`${API_BASE}/auth/status`);
    return await res.json();
  } catch {
    return {
      success: false,
      totalUsers: 0,
      adminCount: 0,
      isFirstUserSetup: false,
    };
  }
}

export async function registerPasskey(
  username: string,
  displayName?: string
): Promise<{
  success: boolean;
  token?: string;
  user?: User;
  isFirstAdmin?: boolean;
  error?: string;
}> {
  // 1. オプション取得
  const optRes = await fetch(`${API_BASE}/auth/register-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName }),
  });
  const optData = await optRes.json();
  if (!optData.success) {
    return {
      success: false,
      error: optData.error || 'Failed to get registration options',
    };
  }

  // 2. ブラウザの Passkey プロンプト起動（PRF Extension 要求）
  let attestationResponse;
  try {
    const regOptions = {
      ...optData.options,
      extensions: {
        ...optData.options?.extensions,
        prf: {},
      },
    };
    attestationResponse = await startRegistration({ optionsJSON: regOptions });
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Passkey registration cancelled',
    };
  }

  // 3. サーバーでレスポンス検証
  const verifyRes = await fetch(`${API_BASE}/auth/verify-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, response: attestationResponse }),
  });
  const verifyData = await verifyRes.json();

  // 4. E2EE 鍵の初期化 & 公開鍵のサーバー登録
  if (verifyData.success && verifyData.token) {
    try {
      await initializeE2eeKeys(
        attestationResponse?.clientExtensionResults?.prf,
        verifyData.token
      );
    } catch (e) {
      console.warn('Failed to auto-initialize E2EE key:', e);
    }
  }

  return verifyData;
}

export async function loginPasskey(username?: string): Promise<{
  success: boolean;
  token?: string;
  user?: User;
  error?: string;
}> {
  // 1. オプション取得
  const optRes = await fetch(`${API_BASE}/auth/login-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const optData = await optRes.json();
  if (!optData.success) {
    return {
      success: false,
      error: optData.error || 'Failed to get authentication options',
    };
  }

  // 2. ブラウザの Passkey プロンプト起動（PRF Extension eval で生体鍵シードを取得）
  let assertionResponse;
  try {
    const prfSaltBase64 = bufferToBase64(PRF_SALT)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const authOptions = {
      ...optData.options,
      extensions: {
        ...optData.options?.extensions,
        prf: {
          eval: {
            first: prfSaltBase64,
          },
        },
      },
    };
    assertionResponse = await startAuthentication({ optionsJSON: authOptions });
  } catch (err: any) {
    return { success: false, error: err.message || 'Passkey login cancelled' };
  }

  // 3. サーバーで検証
  const verifyRes = await fetch(`${API_BASE}/auth/verify-authentication`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, response: assertionResponse }),
  });
  const verifyData = await verifyRes.json();

  // 4. PRF シードから E2EE 鍵を復元・初期化
  if (verifyData.success && verifyData.token) {
    try {
      await initializeE2eeKeys(
        assertionResponse?.clientExtensionResults?.prf,
        verifyData.token
      );
    } catch (e) {
      console.warn('Failed to initialize E2EE key on login:', e);
    }
  }

  return verifyData;
}

/**
 * ログイン中ユーザーの E2EE 鍵を初期化・取得し、サーバーに公開鍵を同期
 */
export async function initializeE2eeKeys(
  prfResult?: any,
  token?: string
): Promise<any> {
  let identity;
  let prfSeed: ArrayBuffer | null = null;

  if (prfResult?.results?.first) {
    const firstVal = prfResult.results.first;
    if (firstVal instanceof ArrayBuffer) {
      prfSeed = firstVal;
    } else if (typeof firstVal === 'string') {
      prfSeed = base64ToBuffer(firstVal).buffer as ArrayBuffer;
    }
  }

  if (prfSeed) {
    try {
      identity = await deriveKeyFromPrfSeed(prfSeed);
    } catch {
      identity = await getOrCreateFallbackIdentityKey();
    }
  } else {
    identity = await getOrCreateFallbackIdentityKey();
  }

  if (token && identity.publicKeyJwk) {
    try {
      await updateMyPublicKey(JSON.stringify(identity.publicKeyJwk), token);
    } catch (e) {
      console.error('Failed to sync public key to server:', e);
    }
  }

  return identity;
}

export async function checkAuth(token: string): Promise<{
  authenticated: boolean;
  user?: User;
}> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await res.json();
  } catch {
    return { authenticated: false };
  }
}

export async function fetchUsers(token: string): Promise<{
  success: boolean;
  users?: User[];
  error?: string;
}> {
  try {
    const res = await fetch(`${API_BASE}/auth/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to fetch users' };
  }
}

export async function updateUserRole(
  userId: string,
  role: 'admin' | 'moderator' | 'user',
  token: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/auth/users/${userId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role }),
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to update user role',
    };
  }
}

// ================= Federation & Migration Functions =================

export async function importFederationFromUrl(
  remoteUrl: string,
  token: string
): Promise<{
  success: boolean;
  message?: string;
  stats?: { added: number; updated: number; skipped: number };
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/federation/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ remoteUrl }),
  });
  return await res.json();
}

export async function importFederationFromFeatures(
  features: any[],
  token: string
): Promise<{
  success: boolean;
  message?: string;
  stats?: { added: number; updated: number; skipped: number };
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/federation/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ features }),
  });
  return await res.json();
}

// ================= E2EE Messaging API Functions =================

export async function updateMyPublicKey(
  publicKey: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/threads/public-key`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ publicKey }),
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to update public key',
    };
  }
}

export async function fetchPublicKeys(
  token: string,
  options?: { role?: string; ids?: string[] }
): Promise<{
  success: boolean;
  users?: Array<
    Pick<User, 'id' | 'username' | 'displayName' | 'role' | 'e2ee_public_key'>
  >;
  error?: string;
}> {
  try {
    const params = new URLSearchParams();
    if (options?.role) params.set('role', options.role);
    if (options?.ids && options.ids.length > 0)
      params.set('ids', options.ids.join(','));

    const res = await fetch(
      `${API_BASE}/threads/public-keys?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to fetch public keys',
    };
  }
}

export async function fetchThreads(
  token: string
): Promise<{ success: boolean; threads?: Thread[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/threads`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to fetch threads' };
  }
}

export async function createThreadApi(
  data: {
    title: string;
    type: ThreadType;
    postId?: string;
    members: Array<{
      userId: string;
      encryptedThreadKey: string;
      ephemeralPublicKey: string;
      role?: 'owner' | 'member';
    }>;
  },
  token: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to create thread' };
  }
}

export async function fetchThreadDetail(
  threadId: string,
  token: string
): Promise<{
  success: boolean;
  thread?: Thread;
  members?: ThreadMember[];
  messages?: EncryptedMessage[];
  error?: string;
}> {
  try {
    const res = await fetch(`${API_BASE}/threads/${threadId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to fetch thread detail',
    };
  }
}

export async function sendMessageApi(
  threadId: string,
  ciphertext: string,
  iv: string,
  token: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ciphertext, iv }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to send message' };
  }
}

export async function inviteMemberApi(
  threadId: string,
  memberData: {
    userId: string;
    encryptedThreadKey: string;
    ephemeralPublicKey: string;
    role?: 'owner' | 'member';
  },
  token: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/threads/${threadId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(memberData),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to invite member' };
  }
}
