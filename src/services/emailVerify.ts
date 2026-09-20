// src/services/emailVerify.ts: 6-digit code + link confirmation for optional email
import type { Bindings, User } from '../types';

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const FROM_EMAIL = 'noreply@tossa.app';
const FROM_NAME = 'tossa';

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function publicUserFields(user: User) {
  const verified = Boolean(user.email_verified_at && user.email);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    email: verified ? user.email : null,
    emailVerified: verified,
    pendingEmail: user.pending_email || null,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hashPayload(
  secret: string,
  userId: string,
  email: string,
  value: string
): Promise<string> {
  return sha256Hex(`${secret}:${userId}:${email}:${value}`);
}

function randomDigits(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + ((buf[0] ?? 0) % 900000));
}

function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function requestEmailVerification(
  env: Bindings,
  user: User,
  rawEmail: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return {
      ok: false,
      error: 'メールアドレスの形式が正しくありません',
      status: 400,
    };
  }
  if (user.email && user.email_verified_at && user.email === email) {
    return {
      ok: false,
      error: 'このメールアドレスは確認済みです',
      status: 400,
    };
  }

  const taken = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND id != ?'
  )
    .bind(email, user.id)
    .first<{ id: string }>();
  if (taken) {
    return {
      ok: false,
      error: 'このメールアドレスは別のアカウントで使われています',
      status: 409,
    };
  }

  if (user.email_verify_sent_at) {
    const sent = Date.parse(user.email_verify_sent_at);
    if (!Number.isNaN(sent) && Date.now() - sent < RESEND_MS) {
      return {
        ok: false,
        error: '少し待ってから再送信してください',
        status: 429,
      };
    }
  }

  if (!env.EMAIL) {
    return {
      ok: false,
      error: 'メール送信がまだ有効になっていません',
      status: 503,
    };
  }

  const code = randomDigits();
  const token = randomToken();
  if (!env.JWT_SECRET) {
    return {
      ok: false,
      error: 'システムエラー: JWT_SECRETが設定されていません',
      status: 500,
    };
  }
  const secret = env.JWT_SECRET;
  const codeHash = await hashPayload(secret, user.id, email, code);
  const tokenHash = await hashPayload(secret, user.id, email, token);
  const now = new Date();
  const expires = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  await env.DB.prepare(
    `UPDATE users SET
      pending_email = ?,
      email_verify_code_hash = ?,
      email_verify_token_hash = ?,
      email_verify_expires_at = ?,
      email_verify_sent_at = ?
     WHERE id = ?`
  )
    .bind(email, codeHash, tokenHash, expires, now.toISOString(), user.id)
    .run();

  const origin = (env.EXPECTED_ORIGIN || 'https://tossa.app').replace(
    /\/+$/,
    ''
  );
  const verifyUrl = `${origin}/?verify=${token}`;
  const text = [
    'tossa のメール確認です。',
    '',
    `確認番号: ${code}`,
    '',
    '番号が打てないときは、次のリンクを開いてください。',
    verifyUrl,
    '',
    'この番号とリンクは15分で無効になります。覚えのないメールなら無視してください。',
  ].join('\n');
  const html = `<p>tossa のメール確認です。</p>
<p style="font-size:28px;font-weight:700;letter-spacing:0.2em">${code}</p>
<p>番号が打てないときは <a href="${verifyUrl}">こちらのリンク</a> を開いてください。</p>
<p>15分で無効になります。覚えのないメールなら無視してください。</p>`;

  try {
    await env.EMAIL.send({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: `tossa 確認番号 ${code}`,
      text,
      html,
    });
  } catch (err: any) {
    console.error('[emailVerify] send failed:', err);
    return {
      ok: false,
      error:
        err?.code === 'E_SENDER_NOT_VERIFIED'
          ? '送信元ドメインの設定がまだ完了していません'
          : 'メールを送れませんでした',
      status: 502,
    };
  }

  return { ok: true };
}

export async function confirmEmailCode(
  env: Bindings,
  user: User,
  code: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const cleaned = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) {
    return { ok: false, error: '6桁の番号を入力してください', status: 400 };
  }
  return finishConfirm(env, user, cleaned, 'code');
}

export async function confirmEmailToken(
  env: Bindings,
  user: User,
  token: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const cleaned = token.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleaned)) {
    return { ok: false, error: 'リンクが無効です', status: 400 };
  }
  return finishConfirm(env, user, cleaned, 'token');
}

async function finishConfirm(
  env: Bindings,
  user: User,
  value: string,
  kind: 'code' | 'token'
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!user.pending_email || !user.email_verify_expires_at) {
    return { ok: false, error: '確認待ちのメールがありません', status: 400 };
  }
  const exp = Date.parse(user.email_verify_expires_at);
  if (Number.isNaN(exp) || exp < Date.now()) {
    return {
      ok: false,
      error: '番号の期限が切れています。再送信してください',
      status: 400,
    };
  }

  if (!env.JWT_SECRET) {
    return {
      ok: false,
      error: 'システムエラー: JWT_SECRETが設定されていません',
      status: 500,
    };
  }
  const secret = env.JWT_SECRET;
  const expected =
    kind === 'code'
      ? user.email_verify_code_hash
      : user.email_verify_token_hash;
  const actual = await hashPayload(secret, user.id, user.pending_email, value);
  if (!expected || actual !== expected) {
    return { ok: false, error: '番号またはリンクが違います', status: 400 };
  }

  const taken = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND id != ?'
  )
    .bind(user.pending_email, user.id)
    .first<{ id: string }>();
  if (taken) {
    return {
      ok: false,
      error: 'このメールアドレスは別のアカウントで使われています',
      status: 409,
    };
  }

  await env.DB.prepare(
    `UPDATE users SET
      email = ?,
      email_verified_at = datetime('now'),
      pending_email = NULL,
      email_verify_code_hash = NULL,
      email_verify_token_hash = NULL,
      email_verify_expires_at = NULL
     WHERE id = ?`
  )
    .bind(user.pending_email, user.id)
    .run();

  return { ok: true };
}
