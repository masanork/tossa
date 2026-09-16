// test/e2ee.test.ts
import { describe, it, expect } from 'vitest';
import {
  bufferToBase64,
  base64ToBuffer,
  generateThreadKey,
  encryptThreadKeyForUser,
  decryptThreadKey,
  encryptMessage,
  decryptMessage,
} from '../web/src/lib/e2ee';

describe('Web Crypto E2EE Engine', () => {
  it('encodes and decodes base64 buffers correctly', () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const b64 = bufferToBase64(original);
    const decoded = base64ToBuffer(b64);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('generates a 256-bit AES-GCM thread key', async () => {
    const { key, raw } = await generateThreadKey();
    expect(raw.byteLength).toBe(32);
    expect(key.algorithm.name).toBe('AES-GCM');
    // @ts-expect-error KeyAlgorithm length property typing
    expect(key.algorithm.length).toBe(256);
  });

  it('performs ECDH envelope encryption & decryption between Alice and Bob', async () => {
    // 1. Bob creates an ECDH key pair (his E2EE Identity)
    const bobKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const bobPublicKeyJwk = await crypto.subtle.exportKey(
      'jwk',
      bobKeyPair.publicKey
    );

    // 2. Alice generates a random thread key
    const { key: originalKey, raw: originalRaw } = await generateThreadKey();

    // 3. Alice encrypts the thread key for Bob using Bob's public JWK
    const envelope = await encryptThreadKeyForUser(
      originalRaw,
      bobPublicKeyJwk
    );
    expect(envelope.encryptedThreadKey).toBeDefined();
    expect(envelope.ephemeralPublicKey).toBeDefined();

    // 4. Bob decrypts the thread key using his private key and Alice's ephemeral public key
    const bobDecrypted = await decryptThreadKey(
      envelope.encryptedThreadKey,
      envelope.ephemeralPublicKey,
      bobKeyPair.privateKey
    );

    // 5. Verify the decrypted raw key matches the original
    expect(Array.from(bobDecrypted.raw)).toEqual(Array.from(originalRaw));

    // 6. Alice encrypts a message with the thread key
    const secretMessage = 'こんにちは、E2EE安全通信テストです！ 🛡️';
    const encrypted = await encryptMessage(secretMessage, originalKey);

    // 7. Bob decrypts the message using his decrypted thread key
    const decryptedText = await decryptMessage(
      encrypted.ciphertext,
      encrypted.iv,
      bobDecrypted.key
    );
    expect(decryptedText).toBe(secretMessage);
  });

  it('fails safely when decrypting with an incorrect key or tampered ciphertext', async () => {
    const { key: key1 } = await generateThreadKey();
    const { key: key2 } = await generateThreadKey();

    const encrypted = await encryptMessage('機密情報', key1);

    // Attempt decryption with wrong key
    const failedDecryption = await decryptMessage(
      encrypted.ciphertext,
      encrypted.iv,
      key2
    );
    expect(failedDecryption).toContain('🔒');

    // Attempt decryption with tampered ciphertext
    const tampered = bufferToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const failedTampered = await decryptMessage(tampered, encrypted.iv, key1);
    expect(failedTampered).toContain('🔒');
  });
});
