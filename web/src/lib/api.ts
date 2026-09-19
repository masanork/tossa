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
  BackupRecord,
  BackupResult,
  DisasterEvent,
} from './types';
import {
  deriveKeyFromPrfSeed,
  getOrCreateFallbackIdentityKey,
  PRF_SALT,
  base64ToBuffer,
} from './e2ee';

const API_BASE = '/api';

export async function fetchSettings(): Promise<SystemSettings> {
  const res = await fetch(`${API_BASE}/settings`);
  const data = await res.json();
  const settings = data.settings || {};
  if (data.active_disasters) {
    settings.active_disasters = data.active_disasters;
  }
  return settings;
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

// Disaster Events API Client
export async function fetchDisasters(
  status?: string
): Promise<DisasterEvent[]> {
  const url = status
    ? `${API_BASE}/disasters?status=${encodeURIComponent(status)}`
    : `${API_BASE}/disasters`;
  const res = await fetch(url);
  const data: any = await res.json();
  return data.disasters || [];
}

export async function createDisasterApi(
  disaster: Partial<DisasterEvent>,
  token?: string | null
): Promise<{ success: boolean; disaster?: DisasterEvent; error?: string }> {
  const res = await fetch(`${API_BASE}/disasters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(disaster),
  });
  return await res.json();
}

export async function updateDisasterApi(
  id: string,
  disaster: Partial<DisasterEvent>,
  token?: string | null
): Promise<{ success: boolean; disaster?: DisasterEvent; error?: string }> {
  const res = await fetch(`${API_BASE}/disasters/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(disaster),
  });
  return await res.json();
}

export async function archiveDisasterApi(
  id: string,
  token?: string | null
): Promise<{ success: boolean; disaster?: DisasterEvent; error?: string }> {
  const res = await fetch(
    `${API_BASE}/disasters/${encodeURIComponent(id)}/archive`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );
  return await res.json();
}

export async function activateDisasterApi(
  id: string,
  token?: string | null
): Promise<{ success: boolean; disaster?: DisasterEvent; error?: string }> {
  const res = await fetch(
    `${API_BASE}/disasters/${encodeURIComponent(id)}/activate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );
  return await res.json();
}

export async function deleteDisasterApi(
  id: string,
  token?: string | null
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/disasters/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
    mine?: boolean;
    ids?: string[];
    bypassCache?: boolean;
  } = {}
): Promise<{ posts: Post[]; total: number }> {
  const query = new URLSearchParams();
  if (params.category) query.set('category', params.category);
  if (params.area) query.set('area', params.area);
  if (params.status) query.set('status', params.status);
  if (params.tag) query.set('tag', params.tag);
  if (params.q) query.set('q', params.q);
  if (params.mine) query.set('mine', 'true');
  if (params.ids && params.ids.length > 0)
    query.set('ids', params.ids.join(','));
  if (params.bypassCache) query.set('_t', String(Date.now()));

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
  status?: string,
  statusLabel?: string,
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
  // 1. Fetch registration options
  const optRes = await fetch(`${API_BASE}/auth/register-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username, displayName }),
  });
  const optData = await optRes.json();
  if (!optData.success) {
    return {
      success: false,
      error: optData.error || 'Failed to get registration options',
    };
  }

  // 2. Launch browser Passkey prompt (request PRF Extension)
  let attestationResponse;
  try {
    const regOptions = {
      ...optData.options,
      extensions: {
        ...optData.options?.extensions,
        prf: {},
      },
    };
    attestationResponse = await startRegistration({
      optionsJSON: regOptions as any,
    });
  } catch (err: any) {
    if (
      err.name === 'NotAllowedError' &&
      (err.message?.includes('cancel') || err.message?.includes('abort'))
    ) {
      return {
        success: false,
        error: err.message || 'Passkey registration cancelled',
      };
    }
    console.warn(
      'Registration with PRF extension failed, retrying without PRF:',
      err
    );
    try {
      attestationResponse = await startRegistration({
        optionsJSON: optData.options,
      });
    } catch (retryErr: any) {
      return {
        success: false,
        error: retryErr.message || 'Passkey registration cancelled',
      };
    }
  }

  // 3. Verify attestation response on server
  const verifyRes = await fetch(`${API_BASE}/auth/verify-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username, response: attestationResponse }),
  });
  const verifyData = await verifyRes.json();

  // 4. Initialize E2EE keys & register public key on server
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
  // 1. Fetch authentication options
  const optRes = await fetch(`${API_BASE}/auth/login-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username }),
  });
  const optData = await optRes.json();
  if (!optData.success) {
    return {
      success: false,
      error: optData.error || 'Failed to get authentication options',
    };
  }

  // 2. Launch browser Passkey prompt (eval PRF Extension to obtain biometric key seed)
  let assertionResponse;
  try {
    const authOptions = {
      ...optData.options,
      extensions: {
        ...optData.options?.extensions,
        prf: {
          eval: {
            first: PRF_SALT,
          },
        },
      },
    };
    assertionResponse = await startAuthentication({
      optionsJSON: authOptions as any,
    });
  } catch (err: any) {
    if (
      err.name === 'NotAllowedError' &&
      (err.message?.includes('cancel') || err.message?.includes('abort'))
    ) {
      return {
        success: false,
        error: err.message || 'Passkey login cancelled',
      };
    }
    console.warn(
      'Authentication with PRF extension failed, retrying without PRF:',
      err
    );
    try {
      assertionResponse = await startAuthentication({
        optionsJSON: optData.options,
      });
    } catch (retryErr: any) {
      return {
        success: false,
        error: retryErr.message || 'Passkey login cancelled',
      };
    }
  }

  // 3. Verify assertion response on server
  const verifyRes = await fetch(`${API_BASE}/auth/verify-authentication`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username, response: assertionResponse }),
  });
  const verifyData = await verifyRes.json();

  // 4. Derive E2EE keys from PRF seed and update public key
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
  token?: string;
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

export async function deleteUserApi(
  userId: string,
  token: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/auth/users/${userId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to delete user',
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

export async function issueApiTokenApi(
  name: string,
  token: string,
  expiresInDays: number = 365
): Promise<{
  success: boolean;
  token?: string;
  tokenName?: string;
  expiresAt?: string;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/auth/api-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, expiresInDays }),
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

// ================= Web Push API Client =================

export async function fetchVapidPublicKey(): Promise<{
  success: boolean;
  publicKey?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${API_BASE}/push/vapid-public-key`);
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to fetch VAPID public key',
    };
  }
}

export async function subscribePushApi(
  subscription: PushSubscriptionJSON,
  area?: string,
  alertTypes?: string[],
  token?: string | null
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/push/subscribe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subscription,
        area: area || null,
        alertTypes: alertTypes || ['emergency', 'evacuation', 'messages'],
      }),
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to register push subscription',
    };
  }
}

export async function unsubscribePushApi(
  endpoint: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to unsubscribe push',
    };
  }
}

export async function sendTestPushApi(
  subscription?: PushSubscriptionJSON,
  token?: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const bodyPayload = subscription
      ? {
          endpoint: subscription.endpoint,
          p256dh: subscription.keys?.p256dh,
          auth: subscription.keys?.auth,
        }
      : {};

    const res = await fetch(`${API_BASE}/push/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to send test push',
    };
  }
}

export async function broadcastPushApi(
  params: {
    title: string;
    body: string;
    url?: string;
    area?: string;
    alertType?: 'emergency' | 'evacuation' | 'status' | 'messages';
  },
  token: string
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/push/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to broadcast push',
    };
  }
}

export async function triggerBackupApi(token: string): Promise<BackupResult> {
  try {
    const res = await fetch(`${API_BASE}/settings/backup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to trigger database backup',
    };
  }
}

export async function fetchBackupsApi(
  token: string
): Promise<{ success: boolean; backups?: BackupRecord[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/settings/backups`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to fetch database backups',
    };
  }
}

export interface ImportCsvParams {
  posts?: import('./csvHelper').NormalizedImportPost[];
  rawCsv?: string;
  updateDuplicates?: boolean;
  defaultCategoryId?: string;
}

export interface ImportCsvResponse {
  success: boolean;
  message?: string;
  stats?: {
    added: number;
    updated: number;
    skipped: number;
    errors: string[];
  };
  error?: string;
}

export async function importCsvApi(
  params: ImportCsvParams,
  token: string
): Promise<ImportCsvResponse> {
  try {
    const res = await fetch(`${API_BASE}/settings/import-csv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to import CSV dataset',
    };
  }
}
