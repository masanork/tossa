// web/src/lib/qrSignature.ts: Offline QR-code post signing with device-bound ECDSA keys.
//
// Each device generates a persistent P-256 ECDSA key pair. When a post is shared via QR code,
// the device signs the canonical post payload. Recipients can verify the signature offline
// to confirm the post was relayed by a specific device and was not tampered with in transit.

import {
  bufferToBase64,
  base64ToBuffer,
  sha256,
  stringToBytes,
} from './cryptoHelpers';
import * as m from '../paraglide/messages.js';
import type { Post } from './types';
import type { QrPostPayload } from './qrCodec';

const QR_SIGN_STORAGE_KEY = 'tossa_qr_sign_key_v1';
const QR_SIGN_PUB_KEY = 'tossa_qr_sign_pub_v1';

export interface QrSignatureBundle {
  /** Base64-encoded ECDSA P-256 signature. */
  sig: string;
  /** Public key JWK thumbprint / key id. */
  kid: string;
  /** ISO 8601 timestamp when the signature was created. */
  iat: string;
}

export interface QrVerificationResult {
  /** The signature was structurally present. */
  hasSignature: boolean;
  /** The signature cryptographically verified. */
  valid: boolean;
  /** The post payload was signed by the embedded public key. */
  signerKeyId?: string;
  /** ISO 8601 timestamp when the signature was created. */
  signedAt?: string;
  /** Human-readable warning / reason when verification failed. */
  warning?: string;
}

/**
 * Generate or retrieve the device's persistent ECDSA P-256 signing key pair.
 */
export async function getOrCreateQrSigningKey(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}> {
  const storedPrivate = localStorage.getItem(QR_SIGN_STORAGE_KEY);
  const storedPublic = localStorage.getItem(QR_SIGN_PUB_KEY);

  if (storedPrivate && storedPublic) {
    try {
      const privateJwk = JSON.parse(storedPrivate);
      const publicJwk = JSON.parse(storedPublic);

      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
      );
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );
      return { privateKey, publicKey, publicKeyJwk: publicJwk };
    } catch (err) {
      console.warn('Failed to load stored QR signing key, regenerating:', err);
    }
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  localStorage.setItem(QR_SIGN_STORAGE_KEY, JSON.stringify(privateJwk));
  localStorage.setItem(QR_SIGN_PUB_KEY, JSON.stringify(publicJwk));

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk: publicJwk,
  };
}

/**
 * Compute a stable key id (thumbprint) from a public key JWK.
 */
export async function keyIdFromJwk(jwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const hash = await sha256(canonical);
  return bufferToBase64(hash).slice(0, 16);
}

/**
 * Build a canonical signing input for a QR payload.
 * The signature covers all meaningful fields so that any tampering invalidates it.
 */
export function buildQrSigningInput(payload: QrPostPayload): Uint8Array {
  const canonical = {
    _t: payload._t,
    v: payload.v,
    id: payload.id,
    title: payload.title,
    area: payload.area,
    addr: payload.addr ?? null,
    lat: payload.lat ?? null,
    lng: payload.lng ?? null,
    status: payload.status,
    label: payload.label,
    note: payload.note ?? null,
    url: payload.url ?? null,
    src: payload.src ?? null,
    tags: payload.tags ?? null,
    cat: payload.cat,
    catName: payload.catName,
    catIcon: payload.catIcon,
    catColor: payload.catColor,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
  return stringToBytes(JSON.stringify(canonical));
}

/**
 * Sign a QR payload with the device key.
 */
export async function signQrPayload(
  payload: QrPostPayload
): Promise<QrPostPayload> {
  const { privateKey, publicKeyJwk } = await getOrCreateQrSigningKey();
  const kid = await keyIdFromJwk(publicKeyJwk);
  const input = buildQrSigningInput(payload);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    input as BufferSource
  );

  return {
    ...payload,
    sig: bufferToBase64(new Uint8Array(signature)),
    kid,
    iat: new Date().toISOString(),
    pub: JSON.stringify(publicKeyJwk),
  };
}

/**
 * Verify a signed QR payload.
 */
export async function verifyQrPayload(
  payload: QrPostPayload
): Promise<QrVerificationResult> {
  if (!payload.sig || !payload.pub) {
    return { hasSignature: false, valid: false };
  }

  let publicKeyJwk: JsonWebKey;
  try {
    publicKeyJwk = JSON.parse(payload.pub);
  } catch {
    return {
      hasSignature: true,
      valid: false,
      warning: m.qr_signature_invalid(),
    };
  }

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );
  } catch {
    return {
      hasSignature: true,
      valid: false,
      warning: m.qr_signature_invalid(),
    };
  }

  const input = buildQrSigningInput(payload);
  const signature = base64ToBuffer(payload.sig);

  try {
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature as BufferSource,
      input as BufferSource
    );
    return {
      hasSignature: true,
      valid,
      signerKeyId: payload.kid,
      signedAt: payload.iat,
      warning: valid ? undefined : m.qr_signature_invalid_detail(),
    };
  } catch {
    return {
      hasSignature: true,
      valid: false,
      warning: '署名の検証中にエラーが発生しました',
    };
  }
}

/**
 * Re-sign an existing Post into a signed QR payload in one step.
 */
export async function signPostForQr(
  serialize: (post: Post) => QrPostPayload,
  post: Post
): Promise<QrPostPayload> {
  const payload = serialize(post);
  return await signQrPayload(payload);
}
