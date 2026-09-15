// web/src/lib/api.ts: API client and WebAuthn browser logic
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type { Category, Post, StatusUpdate, SystemSettings, User, TagCount } from './types';

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

export async function fetchCategories(mode?: string): Promise<Category[]> {
  const url = mode ? `${API_BASE}/categories?mode=${mode}` : `${API_BASE}/categories`;
  const res = await fetch(url);
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

export async function fetchPosts(params: {
  category?: string;
  area?: string;
  status?: string;
  tag?: string;
  q?: string;
} = {}): Promise<{ posts: Post[]; total: number }> {
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

export async function fetchPostDetail(id: string): Promise<{ post: Post; history: StatusUpdate[] }> {
  const res = await fetch(`${API_BASE}/posts/${id}`);
  const data = await res.json();
  return {
    post: data.post,
    history: data.history || [],
  };
}

export async function createPost(postData: {
  categoryId: string;
  title: string;
  area: string;
  address?: string;
  lat?: number;
  lng?: number;
  currentStatus: string;
  statusLabel: string;
  note?: string;
  url?: string;
  attributes?: Record<string, unknown>;
  tags?: string[];
  reporterName?: string;
}, token?: string | null): Promise<{ success: boolean; id?: string; error?: string }> {
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

// ================= WebAuthn (Passkey) Functions =================

export async function registerPasskey(username: string): Promise<{
  success: boolean;
  token?: string;
  user?: User;
  error?: string;
}> {
  // 1. オプション取得
  const optRes = await fetch(`${API_BASE}/auth/register-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const optData = await optRes.json();
  if (!optData.success) {
    return { success: false, error: optData.error || 'Failed to get registration options' };
  }

  // 2. ブラウザの Passkey プロンプト起動
  let attestationResponse;
  try {
    attestationResponse = await startRegistration({ optionsJSON: optData.options });
  } catch (err: any) {
    return { success: false, error: err.message || 'Passkey registration cancelled' };
  }

  // 3. サーバーでレスポンス検証
  const verifyRes = await fetch(`${API_BASE}/auth/verify-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, response: attestationResponse }),
  });
  return await verifyRes.json();
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
    return { success: false, error: optData.error || 'Failed to get authentication options' };
  }

  // 2. ブラウザの Passkey プロンプト起動
  let assertionResponse;
  try {
    assertionResponse = await startAuthentication({ optionsJSON: optData.options });
  } catch (err: any) {
    return { success: false, error: err.message || 'Passkey login cancelled' };
  }

  // 3. サーバーで検証
  const verifyRes = await fetch(`${API_BASE}/auth/verify-authentication`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, response: assertionResponse }),
  });
  return await verifyRes.json();
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
