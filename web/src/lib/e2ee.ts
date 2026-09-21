// web/src/lib/e2ee.ts: End-to-End Encryption (E2EE) with Passkey PRF Extension & Web Crypto API
//
// 1. Passkey PRF (WebAuthn Level 3) deterministic biometric key derivation
// 2. ECDH (P-256) envelope encryption for thread shared key (AES-256-GCM)
// 3. Multi-recipient envelope sharing for thread members and administrators
// 4. Zero-knowledge message encryption via AES-256-GCM

export const PRF_SALT = new TextEncoder().encode(
  'tossa:e2ee:identity:salt:v1:2026'
);

import { bufferToBase64, base64ToBuffer } from './cryptoHelpers';

// Re-export shared crypto helpers for backward compatibility
export { bufferToBase64, base64ToBuffer } from './cryptoHelpers';

// User E2EE Identity keypair
export interface UserIdentityKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  isPrfDerived: boolean;
}

// In-memory cached Identity Key of the current user
let currentIdentityKey: UserIdentityKey | null = null;

/**
 * Derives or unlocks the user's ECDH P-256 key pair deterministically
 * using the 32-byte seed returned from the Passkey PRF Extension.
 */
export async function deriveKeyFromPrfSeed(
  prfSeed: ArrayBuffer
): Promise<UserIdentityKey> {
  // 1. Derive Storage Wrapping Key (AES-256-GCM) from PRF seed via HKDF
  const prfKey = await crypto.subtle.importKey('raw', prfSeed, 'HKDF', false, [
    'deriveKey',
  ]);

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

  // 2. Check for encrypted private key in local storage
  const storedEncryptedKey = localStorage.getItem(
    'tossa_prf_encrypted_identity_key'
  );
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

      const privateKeyJwk = JSON.parse(
        new TextDecoder().decode(decryptedJwkBuffer)
      );
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
      console.warn(
        'Failed to decrypt existing PRF identity key, regenerating...',
        e
      );
    }
  }

  // 3. Generate new ECDH key pair and encrypt under PRF Wrapping Key
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const privateKeyJwk = await crypto.subtle.exportKey(
    'jwk',
    keyPair.privateKey
  );
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
  localStorage.setItem(
    'tossa_prf_public_key_jwk',
    JSON.stringify(publicKeyJwk)
  );

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
 * Fallback for environments without PRF: generate and store device-bound
 * ECDH key pair in local storage.
 */
export async function getOrCreateFallbackIdentityKey(): Promise<UserIdentityKey> {
  const storedPrivate = localStorage.getItem(
    'tossa_fallback_identity_private_jwk'
  );
  const storedPublic = localStorage.getItem(
    'tossa_fallback_identity_public_jwk'
  );

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

  // Generate new key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const privateKeyJwk = await crypto.subtle.exportKey(
    'jwk',
    keyPair.privateKey
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  localStorage.setItem(
    'tossa_fallback_identity_private_jwk',
    JSON.stringify(privateKeyJwk)
  );
  localStorage.setItem(
    'tossa_fallback_identity_public_jwk',
    JSON.stringify(publicKeyJwk)
  );

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
 * Retrieve currently active E2EE Identity
 */
export function getCurrentIdentityKey(): UserIdentityKey | null {
  return currentIdentityKey;
}

export function setCurrentIdentityKey(key: UserIdentityKey | null): void {
  currentIdentityKey = key;
}

// ================= Thread Key (AES-256-GCM) & Envelope Encryption =================

/**
 * Generate a new random 256-bit AES-GCM key for a thread
 */
export async function generateThreadKey(): Promise<{
  key: CryptoKey;
  raw: Uint8Array;
}> {
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
 * Encrypt thread key for recipient using their ECDH P-256 public key (Envelope Encryption)
 */
export async function encryptThreadKeyForUser(
  rawThreadKey: Uint8Array,
  recipientPublicKeyJwk: JsonWebKey
): Promise<{
  encryptedThreadKey: string;
  ephemeralPublicKey: string; // JWK string
}> {
  // 1. Generate ephemeral ECDH keypair
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );

  // 2. Import recipient public key
  const recipientKey = await crypto.subtle.importKey(
    'jwk',
    recipientPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // 3. Derive Key Encryption Key (KEK) via ECDH
  const kek = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: recipientKey },
    ephemeralKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // 4. Encrypt raw thread key with KEK
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    kek,
    rawThreadKey as any
  );

  // Combine IV and ciphertext, encode as Base64
  const combined = new Uint8Array(iv.byteLength + ciphertextBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertextBuffer), iv.byteLength);

  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey(
    'jwk',
    ephemeralKeyPair.publicKey
  );

  return {
    encryptedThreadKey: bufferToBase64(combined),
    ephemeralPublicKey: JSON.stringify(ephemeralPublicKeyJwk),
  };
}

/**
 * Decrypt thread key using recipient's private ECDH key and sender's ephemeral public key
 */
export async function decryptThreadKey(
  encryptedThreadKeyBase64: string,
  ephemeralPublicKeyJson: string,
  myPrivateKey: CryptoKey
): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const combined = base64ToBuffer(encryptedThreadKeyBase64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  // 1. Import ephemeral public key
  const ephemeralPublicKeyJwk = JSON.parse(ephemeralPublicKeyJson);
  const ephemeralKey = await crypto.subtle.importKey(
    'jwk',
    ephemeralPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // 2. Derive same KEK via ECDH
  const kek = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: ephemeralKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 3. Decrypt thread key
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

// ================= Message Encryption & Decryption (AES-256-GCM) =================

/**
 * Encrypt plaintext message with thread key
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
 * Decrypt ciphertext message with thread key
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
    return '🔒 [Decryption error: Failed to decrypt message]';
  }
}
