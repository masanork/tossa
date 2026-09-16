// src/auth/session.ts: Lightweight signed session token for Cloudflare Workers

interface SessionPayload {
  userId: string;
  username: string;
  displayName?: string;
  role: 'admin' | 'moderator' | 'user';
  exp: number; // Unix timestamp in seconds
}

const DEFAULT_SECRET = 'tossa-development-fallback-secret-change-in-production';

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64UrlEncode(data: Uint8Array): string {
  let str = '';
  for (let i = 0; i < data.byteLength; i++) {
    str += String.fromCharCode(data[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const m = str.length % 4;
  const base64 = (str + (m === 2 ? '==' : m === 3 ? '=' : ''))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function createSessionToken(
  payload: Omit<SessionPayload, 'exp'>,
  secret: string = DEFAULT_SECRET,
  expiresInSeconds: number = 7 * 24 * 60 * 60 // 7 days
): Promise<string> {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };

  const enc = new TextEncoder();
  const payloadJson = JSON.stringify(fullPayload);
  const payloadB64 = base64UrlEncode(enc.encode(payloadJson));

  const key = await getHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(payloadB64)
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuffer));

  return `${payloadB64}.${sigB64}`;
}

export async function verifySessionToken(
  token: string,
  secret: string = DEFAULT_SECRET
): Promise<SessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;
  const key = await getHmacKey(secret);
  const enc = new TextEncoder();

  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlDecode(sigB64),
    enc.encode(payloadB64)
  );

  if (!isValid) return null;

  try {
    const payloadText = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload: SessionPayload = JSON.parse(payloadText);
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}
