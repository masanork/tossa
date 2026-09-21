import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrCreateQrSigningKey,
  keyIdFromJwk,
  signQrPayload,
  verifyQrPayload,
  buildQrSigningInput,
} from '../web/src/lib/qrSignature';
import type { QrPostPayload } from '../web/src/lib/qrCodec';

const mockPayload: QrPostPayload = {
  _t: 'tossa',
  v: 1,
  id: 'post-123',
  title: '第一避難所 開設',
  area: '中央区',
  addr: '本町1-2-3',
  lat: 35.6812,
  lng: 139.7671,
  status: 'open',
  label: '開設・受入中',
  note: '毛布と飲料水を配布中',
  url: 'https://example.com',
  src: 'https://city.example.lg.jp',
  tags: ['避難所', '給水'],
  cat: 'evac',
  catName: '避難所',
  catIcon: '🏕️',
  catColor: '#10b981',
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T11:00:00.000Z',
};

describe('qrSignature', () => {
  beforeEach(() => {
    // Provide an in-memory localStorage for tests
    (globalThis as any).localStorage = {
      store: new Map<string, string>(),
      getItem(key: string) {
        return this.store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.store.set(key, value);
      },
      removeItem(key: string) {
        this.store.delete(key);
      },
      clear() {
        this.store.clear();
      },
    };
  });

  it('generates a stable key id from a JWK', async () => {
    const { publicKeyJwk } = await getOrCreateQrSigningKey();
    const kid1 = await keyIdFromJwk(publicKeyJwk);
    const kid2 = await keyIdFromJwk(publicKeyJwk);
    expect(kid1).toBe(kid2);
    expect(kid1.length).toBeGreaterThan(0);
  });

  it('signs and verifies a QR payload', async () => {
    const signed = await signQrPayload(mockPayload);
    expect(signed.sig).toBeDefined();
    expect(signed.pub).toBeDefined();
    expect(signed.kid).toBeDefined();
    expect(signed.iat).toBeDefined();

    const result = await verifyQrPayload(signed);
    expect(result.hasSignature).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.signerKeyId).toBe(signed.kid);
  });

  it('detects tampered QR payload', async () => {
    const signed = await signQrPayload(mockPayload);
    const tampered = { ...signed, title: '改ざんされたタイトル' };
    const result = await verifyQrPayload(tampered);
    expect(result.hasSignature).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.warning).toContain('改ざん');
  });

  it('reports no signature for unsigned payload', async () => {
    const result = await verifyQrPayload(mockPayload);
    expect(result.hasSignature).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('produces deterministic signing input for the same payload', () => {
    const input1 = buildQrSigningInput(mockPayload);
    const input2 = buildQrSigningInput(mockPayload);
    expect(input1).toEqual(input2);
  });
});
