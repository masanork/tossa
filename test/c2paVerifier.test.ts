import { describe, it, expect } from 'vitest';
import { verifyC2PA, detectC2PA } from '../web/src/lib/c2paVerifier';

function buildJumbfBox(type: string, payload: Uint8Array): Uint8Array {
  const length = 8 + payload.length;
  const box = new Uint8Array(length);
  box[0] = (length >> 24) & 0xff;
  box[1] = (length >> 16) & 0xff;
  box[2] = (length >> 8) & 0xff;
  box[3] = length & 0xff;
  box[4] = type.charCodeAt(0);
  box[5] = type.charCodeAt(1);
  box[6] = type.charCodeAt(2);
  box[7] = type.charCodeAt(3);
  box.set(payload, 8);
  return box;
}

function buildC2paManifestStore(): Uint8Array {
  // Build a minimal C2PA manifest store superbox (jumb) with a jumd description
  // containing the C2PA UUID, plus a child manifest (c2ma) containing claim/signature.
  const c2paUuid = new Uint8Array(16);
  // UUID bytes for "c2pa" manifest store: 6332706100110010800000aa00389b71
  const hex = '6332706100110010800000aa00389b71';
  for (let i = 0; i < hex.length; i += 2) {
    c2paUuid[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }

  // Manifest store description box (jumd) with C2PA UUID
  const storeDescPayload = new Uint8Array([
    0x02,
    0x00,
    0x00,
    0x00,
    ...c2paUuid,
  ]);
  const storeDescBox = buildJumbfBox('jumd', storeDescPayload);

  // Manifest (c2ma) description box (same UUID identifies it as a C2PA manifest)
  const manifestDescPayload = new Uint8Array([
    0x02,
    0x00,
    0x00,
    0x00,
    ...c2paUuid,
  ]);
  const manifestDescBox = buildJumbfBox('jumd', manifestDescPayload);

  const claimBox = buildJumbfBox('c2cl', new TextEncoder().encode('claim'));
  const sigBox = buildJumbfBox('c2cs', new TextEncoder().encode('signature'));
  const manifestPayload = concat(manifestDescBox, claimBox, sigBox);
  const manifestBox = buildJumbfBox('c2ma', manifestPayload);

  const storePayload = concat(storeDescBox, manifestBox);
  const storeBox = buildJumbfBox('jumb', storePayload);
  return storeBox;
}

function concat(a: Uint8Array, b: Uint8Array, c?: Uint8Array): Uint8Array {
  const total = a.length + b.length + (c?.length ?? 0);
  const out = new Uint8Array(total);
  out.set(a, 0);
  out.set(b, a.length);
  if (c) out.set(c, a.length + b.length);
  return out;
}

describe('c2paVerifier', () => {
  it('detects C2PA manifest store in synthetic bytes', () => {
    const bytes = buildC2paManifestStore();
    const result = detectC2PA(bytes);
    expect(result.hasC2pa).toBe(true);
    expect(result.isSigned).toBe(true);
    expect(result.format).toBe('JUMBF/C2PA');
  });

  it('returns no C2PA for random bytes', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(256));
    const result = await verifyC2PA(bytes);
    expect(result.hasC2pa).toBe(false);
    expect(result.hasManifestStore).toBe(false);
    expect(result.hasSignature).toBe(false);
  });

  it('verifies manifest store structure but not signature without real crypto material', async () => {
    const bytes = buildC2paManifestStore();
    const result = await verifyC2PA(bytes);
    expect(result.hasC2pa).toBe(true);
    expect(result.hasManifestStore).toBe(true);
    expect(result.hasSignature).toBe(true);
    // Synthetic bytes do not contain a valid COSE signature, so cryptographic checks fail.
    expect(result.signatureValid).toBe(false);
    expect(result.claimBindingValid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles empty input gracefully', async () => {
    const result = await verifyC2PA(new Uint8Array(0));
    expect(result.hasC2pa).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});
