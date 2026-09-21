// web/src/lib/p256.ts: P-256 (secp256r1) compressed point decompression for Web Crypto.
//
// Web Crypto's ECDSA importKey does not accept compressed points (33-byte 0x02/0x03),
// but many C2PA signatures embed compressed public keys. This module decompresses them
// to the 65-byte 0x04 uncompressed form using only BigInt arithmetic.

const P256_P = BigInt(
  '0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF'
);
const P256_A = BigInt(
  '0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC'
);
const P256_B = BigInt(
  '0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B'
);

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1);
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e = e >> BigInt(1);
  }
  return result;
}

function hexToBigInt(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

function bigIntToHex(value: bigint, byteLength: number): string {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  const targetChars = byteLength * 2;
  if (hex.length < targetChars) {
    hex = '0'.repeat(targetChars - hex.length) + hex;
  }
  return hex;
}

/**
 * Decompress a P-256 compressed public key (33 bytes) to uncompressed form (65 bytes).
 *
 * Compressed format: 0x02 || x (even y) or 0x03 || x (odd y)
 * Uncompressed format: 0x04 || x || y
 *
 * Returns null if the input is not a valid compressed point.
 */
export function decompressP256PublicKey(
  compressed: Uint8Array
): Uint8Array | null {
  if (compressed.length !== 33) return null;
  const prefix = compressed[0];
  if (prefix !== 0x02 && prefix !== 0x03) return null;

  const xHex = Array.from(compressed.subarray(1))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const x = hexToBigInt(xHex);

  if (x < BigInt(0) || x >= P256_P) return null;

  // Compute y^2 = x^3 + a*x + b mod p
  const x3 = modPow(x, BigInt(3), P256_P);
  const ax = (P256_A * x) % P256_P;
  const ySquared = (((x3 + ax) % P256_P) + P256_B) % P256_P;

  // P-256 prime satisfies p ≡ 3 (mod 4), so sqrt(y^2) = ±(y^2)^((p+1)/4) mod p
  const sqrtExp = (P256_P + BigInt(1)) >> BigInt(2);
  let y = modPow(ySquared, sqrtExp, P256_P);

  // Verify the square root
  if (modPow(y, BigInt(2), P256_P) !== ySquared) return null;

  // Select the correct parity based on the prefix
  const isOdd = prefix === 0x03;
  const yIsOdd = y % BigInt(2) === BigInt(1);
  if (yIsOdd !== isOdd) {
    y = (P256_P - y) % P256_P;
  }

  const yHex = bigIntToHex(y, 32);
  const result = new Uint8Array(65);
  result[0] = 0x04;
  for (let i = 0; i < 32; i++) {
    result[1 + i] = parseInt(xHex.slice(i * 2, i * 2 + 2), 16);
    result[33 + i] = parseInt(yHex.slice(i * 2, i * 2 + 2), 16);
  }
  return result;
}
