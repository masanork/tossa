import { describe, it, expect } from 'vitest';
import { decompressP256PublicKey } from '../web/src/lib/p256';

// Generate a test P-256 uncompressed point (0x04 || x || y) and compress it manually
// based on y parity, then verify our decompressor recovers the original point.
describe('p256', () => {
  it('decompresses a P-256 compressed point to the original uncompressed point', () => {
    // SPKI uncompressed public key generated with Node crypto
    const spkiHex =
      '3059301306072a8648ce3d020106082a8648ce3d03010703420004' +
      'bf1e4f3e1b808ceaf4f1ae30679de2daa3cc9936e498353fd74793da0fc180b4' +
      '7c007cadfd7a7934ec0facb1f1534691fd583c55c3aabe57339ced73c5b21d83';
    const spki = new Uint8Array(
      spkiHex.match(/.{2}/g)!.map((b) => parseInt(b, 16))
    );

    // Raw uncompressed point starts at offset 26 in the SPKI above.
    const rawUncompressed = spki.subarray(26, 26 + 65);
    const x = rawUncompressed.subarray(1, 33);
    const y = rawUncompressed.subarray(33, 65);

    // Build compressed point: prefix depends on parity of y
    const yLastByte = y[y.length - 1] ?? 0;
    const prefix = yLastByte % 2 === 0 ? 0x02 : 0x03;
    const compressed = new Uint8Array(33);
    compressed[0] = prefix;
    compressed.set(x, 1);

    const decompressed = decompressP256PublicKey(compressed);
    expect(decompressed).not.toBeNull();
    expect(decompressed).toEqual(rawUncompressed);
  });

  it('returns null for invalid compressed input', () => {
    expect(decompressP256PublicKey(new Uint8Array(32))).toBeNull();
    expect(decompressP256PublicKey(new Uint8Array(33))).toBeNull();
    expect(decompressP256PublicKey(new Uint8Array(34))).toBeNull();
  });
});
