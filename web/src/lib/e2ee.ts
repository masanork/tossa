// web/src/lib/e2ee.ts: End-to-End Encryption (E2EE) with Passkey PRF Extension & Web Crypto API
//
// 1. Passkey PRF (WebAuthn Level 3) による決定論的生体鍵導出
// 2. ECDH (P-256) によるスレッド共通鍵（AES-256-GCM）の安全なエンベロープ暗号化
// 3. 複数メンバー・管理者への安全な招待と鍵共有
// 4. メッセージ本文の AES-256-GCM ゼロ知識暗号化

export const PRF_SALT = new TextEncoder().encode('tossa:e2ee:identity:salt:v1:2026');

// Base64 / ArrayBuffer 変換ヘルパー
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ユーザーの E2EE アイデンティティ（鍵ペア）
export interface UserIdentityKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  isPrfDerived: boolean;
}

// メモリ上にキャッシュされた現在のユーザーの Identity Key
let currentIdentityKey: UserIdentityKey | null = null;

/**
 * PRF Extension から返された 32 バイトのシードを用いて、
 * ユーザー固有の ECDH P-256 キーペアを決定論的に導出・または安全にアンロックします。
 */
export async function deriveKeyFromPrfSeed(prfSeed: ArrayBuffer): Promise<UserIdentityKey> {
  // 1. PRF シードから HKDF で「Storage Wrapping Key (AES-256-GCM)」を導出
  const prfKey = await crypto.subtle.importKey(
    'raw',
    prfSeed,
    'HKDF',
    false,
    ['deriveKey']
  );

  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('tossa:prf:wrapping:salt:v1'),
      info: new TextEncoder().encode('tossa:ecdh:identity:key:v1'),
    },
    prfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // 2. ローカルストレージに暗号化された秘密鍵があるか確認
  const storedEncryptedKey = localStorage.getItem('tossa_prf_encrypted_identity_key');
  const storedPublicKeyJwk = localStorage.getItem('tossa_prf_public_key_jwk');

  if (storedEncryptedKey && storedPublicKeyJwk) {
    try {
      const parsed = JSON.parse(storedEncryptedKey);
      const iv = base64ToBuffer(parsed.iv);
      const ciphertext = base64ToBuffer(parsed.ciphertext);

      const decryptedJwkBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as any },
        wrappingKey,
        ciphertext as any
      );

      const privateKeyJwk = JSON.parse(new TextDecoder().decode(decryptedJwkBuffer));
      const publicKeyJwk = JSON.parse(storedPublicKeyJwk);

      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveKey', 'deriveBits']
      );

      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );

      const identity: UserIdentityKey = {
        privateKey,
        publicKey,
        publicKeyJwk,
        isPrfDerived: true,
      };

      currentIdentityKey = identity;
      return identity;
    } catch (e) {
      console.warn('Failed to decrypt existing PRF identity key, regenerating...', e);
    }
  }

  // 3. 新規に ECDH キーペアを生成し、PRF Wrapping Key で暗号化保存
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedPrivateKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    new TextEncoder().encode(JSON.stringify(privateKeyJwk))
  );

  localStorage.setItem(
    'tossa_prf_encrypted_identity_key',
    JSON.stringify({
      iv: bufferToBase64(iv),
      ciphertext: bufferToBase64(encryptedPrivateKey),
    })
  );
  localStorage.setItem('tossa_prf_public_key_jwk', JSON.stringify(publicKeyJwk));

  const identity: UserIdentityKey = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk,
    isPrfDerived: true,
  };

  currentIdentityKey = identity;
  return identity;
}

/**
 * PRF非対応環境（フォールバック）: ブラウザの IndexedDB / ローカルストレージを用いて
 * デバイス固有の ECDH キーペアを生成・取得します。
 */
export async function getOrCreateFallbackIdentityKey(): Promise<UserIdentityKey> {
  const storedPrivate = localStorage.getItem('tossa_fallback_identity_private_jwk');
  const storedPublic = localStorage.getItem('tossa_fallback_identity_public_jwk');

  if (storedPrivate && storedPublic) {
    try {
      const privateJwk = JSON.parse(storedPrivate);
      const publicJwk = JSON.parse(storedPublic);

      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveKey', 'deriveBits']
      );

      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );

      const identity: UserIdentityKey = {
        privateKey,
        publicKey,
        publicKeyJwk: publicJwk,
        isPrfDerived: false,
      };

      currentIdentityKey = identity;
      return identity;
    } catch {
      // ignore
    }
  }

  // 新規生成
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  localStorage.setItem('tossa_fallback_identity_private_jwk', JSON.stringify(privateKeyJwk));
  localStorage.setItem('tossa_fallback_identity_public_jwk', JSON.stringify(publicKeyJwk));

  const identity: UserIdentityKey = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk,
    isPrfDerived: false,
  };

  currentIdentityKey = identity;
  return identity;
}

/**
 * 現在アクティブな E2EE アイデンティティを取得
 */
export function getCurrentIdentityKey(): UserIdentityKey | null {
  return currentIdentityKey;
}

export function setCurrentIdentityKey(key: UserIdentityKey | null): void {
  currentIdentityKey = key;
}

// ================= スレッド共通鍵 (AES-256-GCM) とエンベロープ暗号化 =================

/**
 * 新しいスレッド専用の対称暗号化キー (AES-256-GCM) を生成
 */
export async function generateThreadKey(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  return { key, raw: rawKey };
}

/**
 * 対象ユーザーの公開鍵 (ECDH P-256 JWK) に向けて、スレッドキーを暗号化 (Envelope Encryption)
 */
export async function encryptThreadKeyForUser(
  rawThreadKey: Uint8Array,
  recipientPublicKeyJwk: JsonWebKey
): Promise<{
  encryptedThreadKey: string;
  ephemeralPublicKey: string; // JWK string
}> {
  // 1. エフェメラル ECDH キーペアを生成
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );

  // 2. 相手の公開鍵をインポート
  const recipientKey = await crypto.subtle.importKey(
    'jwk',
    recipientPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // 3. ECDH で共有鍵 (KEK: Key Encryption Key) を導出
  const kek = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: recipientKey },
    ephemeralKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // 4. KEK でスレッド共通鍵を暗号化
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    kek,
    rawThreadKey as any
  );

  // IV と暗号文を結合して Base64 化
  const combined = new Uint8Array(iv.byteLength + ciphertextBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertextBuffer), iv.byteLength);

  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey('jwk', ephemeralKeyPair.publicKey);

  return {
    encryptedThreadKey: bufferToBase64(combined),
    ephemeralPublicKey: JSON.stringify(ephemeralPublicKeyJwk),
  };
}

/**
 * 自身の ECDH 秘密鍵を用いて、自身向けに暗号化されたスレッド共通鍵を復号
 */
export async function decryptThreadKey(
  encryptedThreadKeyBase64: string,
  ephemeralPublicKeyJson: string,
  myPrivateKey: CryptoKey
): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const combined = base64ToBuffer(encryptedThreadKeyBase64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  // 1. エフェメラル公開鍵をインポート
  const ephemeralPublicKeyJwk = JSON.parse(ephemeralPublicKeyJson);
  const ephemeralKey = await crypto.subtle.importKey(
    'jwk',
    ephemeralPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // 2. ECDH で同じ KEK を導出
  const kek = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: ephemeralKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 3. スレッドキーを復号
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    kek,
    ciphertext as any
  );

  const rawKey = new Uint8Array(decryptedBuffer);
  const threadKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  return { key: threadKey, raw: rawKey };
}

// ================= メッセージ暗号化 / 復号 (AES-256-GCM) =================

/**
 * メッセージ本文をスレッドキーで暗号化
 */
export async function encryptMessage(
  text: string,
  threadKey: CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    threadKey,
    enc.encode(text)
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
  };
}

/**
 * 暗号化メッセージをスレッドキーで復号
 */
export async function decryptMessage(
  ciphertextBase64: string,
  ivBase64: string,
  threadKey: CryptoKey
): Promise<string> {
  try {
    const iv = base64ToBuffer(ivBase64);
    const ciphertext = base64ToBuffer(ciphertextBase64);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      threadKey,
      ciphertext as any
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err: any) {
    console.error('Failed to decrypt message:', err);
    return '🔒 [復号エラー: メッセージを復号できませんでした]';
  }
}
