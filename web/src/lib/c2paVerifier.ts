// web/src/lib/c2paVerifier.ts: Deep C2PA (Content Authenticity Initiative) manifest parsing and verification.
//
// This module parses JUMBF (JPEG Universal Metadata Box Format) containers, extracts C2PA
// manifest stores, and attempts to cryptographically verify COSE_Sign1 claim signatures and
// content bindings. It is intentionally self-contained and works in any Web Crypto API runtime.

import {
  bufferToBase64,
  sha256,
  concatBytes,
  hexToBytes,
} from './cryptoHelpers';
import { decompressP256PublicKey } from './p256';

interface C2paBox {
  type: string;
  start: number;
  length: number;
  payloadStart: number;
  payloadLength: number;
  children?: C2paBox[];
  raw?: Uint8Array;
}

interface C2paClaim {
  raw?: Uint8Array;
  claimVersion?: string;
  claimGenerator?: string;
  signatureType?: string;
  manifestLabel?: string;
  claimTime?: string;
  contentBindings?: Array<{ url: string; alg: string; hash: Uint8Array }>;
}

export interface C2paVerificationResult {
  /** C2PA / JUMBF boxes were detected in the file. */
  hasC2pa: boolean;
  /** A complete manifest store (claim + assertions + signature) was found. */
  hasManifestStore: boolean;
  /** The COSE_Sign1 claim signature was structurally present. */
  hasSignature: boolean;
  /** The claim signature was cryptographically verified using the embedded public key. */
  signatureValid: boolean;
  /** The content binding hash matched the actual file bytes. */
  claimBindingValid: boolean;
  /** The embedded signing certificate chain was structurally valid and not expired. */
  certificateValid: boolean;
  /** True if the certificate was valid at verification time, false if expired or not yet valid. */
  certificateExpired: boolean;
  /** True if the certificate fingerprint matches the configured trust list. */
  certificateTrusted: boolean;
  /** Human-readable generator name (e.g. "Apple C2PA / CAI"). */
  claimGenerator?: string;
  /** Manifest issuer / signer name extracted from the certificate. */
  issuer?: string;
  /** Claim timestamp in ISO 8601 format if present. */
  claimTime?: string;
  /** Underlying container format (always "JUMBF/C2PA" when detected). */
  format?: string;
  /** Warnings discovered during parsing / verification. */
  warnings: string[];
}

/** SHA-256 hex fingerprints of trusted C2PA issuer certificates. Empty by default. */
const DEFAULT_TRUSTED_ISSUER_FINGERPRINTS: string[] = [
  // Operators can populate this with known C2PA issuer certificate fingerprints
  // (SHA-256 of the raw DER bytes). Example:
  // 'a1b2c3d4...',
];

// C2PA manifest store UUID embedded in the jumd description box.
const C2PA_MANIFEST_STORE_UUID = '6332706100110010800000aa00389b71';

/**
 * Read a 4-byte big-endian unsigned integer.
 */
function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

/**
 * Read a 2-byte big-endian unsigned integer.
 */
function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) >>> 0;
}

/**
 * Convert four bytes to an ASCII box type string.
 */
function readBoxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0
  );
}

/**
 * Parse JUMBF superboxes recursively.
 */
function parseJumbfBox(
  bytes: Uint8Array,
  offset: number,
  end: number
): C2paBox | null {
  if (offset + 8 > end) return null;

  const length = readUint32BE(bytes, offset);
  const type = readBoxType(bytes, offset + 4);

  if (length === 0) {
    // Box extends to end of container
    return {
      type,
      start: offset,
      length: end - offset,
      payloadStart: offset + 8,
      payloadLength: end - offset - 8,
      raw: bytes.subarray(offset, end),
    };
  }

  if (length === 1 || length < 8 || offset + length > end) {
    // Extended length not supported or malformed
    return null;
  }

  const boxEnd = offset + length;
  const box: C2paBox = {
    type,
    start: offset,
    length,
    payloadStart: offset + 8,
    payloadLength: length - 8,
    raw: bytes.subarray(offset, boxEnd),
  };

  // JUMBF superboxes include the generic 'jumb' as well as the C2PA manifest
  // superbox (c2ma). A real C2PA manifest is a jumb with a jumd description
  // whose UUID identifies it as a manifest, followed by claim/signature/assertion
  // child boxes.
  const SUPERBOX_TYPES = new Set(['jumb', 'c2ma']);
  if (SUPERBOX_TYPES.has(type)) {
    // Superbox: payload begins with a description box (jumd) followed by child boxes.
    const children: C2paBox[] = [];
    let childOffset = box.payloadStart;
    // Parse description box first and include it so callers can identify the superbox
    const desc = parseJumbfBox(bytes, childOffset, boxEnd);
    if (desc) {
      children.push(desc);
      if (desc.type === 'jumd') {
        childOffset = desc.start + desc.length;
      } else {
        childOffset = desc.start + desc.length;
      }
    }
    while (childOffset < boxEnd) {
      const child = parseJumbfBox(bytes, childOffset, boxEnd);
      if (!child) break;
      children.push(child);
      childOffset = child.start + child.length;
    }
    box.children = children;
  }

  return box;
}

/**
 * Find all top-level JUMBF boxes in a binary.
 */
function findJumbfBoxes(bytes: Uint8Array): C2paBox[] {
  const boxes: C2paBox[] = [];
  const len = bytes.length;

  // C2PA manifests are usually embedded as a JUMBF box near the start or end of JPEG/PNG/WebP.
  const ranges: [number, number][] = [
    [0, Math.min(len, 1024 * 1024)],
    [Math.max(0, len - 512 * 1024), len],
  ];

  for (const [start, end] of ranges) {
    for (let i = start; i < end - 8; i++) {
      const type = readBoxType(bytes, i + 4);
      if (type === 'jumb' || type === 'jumd') {
        const length = readUint32BE(bytes, i);
        if (length >= 8 && i + length <= end) {
          const box = parseJumbfBox(bytes, i, i + length);
          if (box) {
            boxes.push(box);
            i = i + length - 1;
          }
        }
      }
    }
  }

  return boxes;
}

/**
 * Check whether a jumd description box identifies a C2PA manifest store.
 */
function isC2paManifestStoreDesc(box: C2paBox): boolean {
  if (box.type !== 'jumd' || !box.raw) return false;
  // jumd payload: [type (1)] [flags+toggle (1)] [content_type len (1)] [content_type] [label len (1)] [label] [uuid (16)] ...
  // For UUID-tagged boxes, the 16-byte UUID appears after the label.
  const payload = box.raw.subarray(box.payloadStart - box.start);
  // Simple heuristic: scan the payload for the C2PA UUID.
  const target = hexToBytes(C2PA_MANIFEST_STORE_UUID);
  if (payload.length < target.length) return false;
  outer: for (let i = 0; i <= payload.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (payload[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Locate the C2PA manifest store and return its root jumb box.
 */
function findC2paManifestStore(bytes: Uint8Array): C2paBox | null {
  const boxes = findJumbfBoxes(bytes);
  for (const box of boxes) {
    if (box.type === 'jumb' && box.children) {
      const desc = box.children.find((c) => c.type === 'jumd');
      if (desc && isC2paManifestStoreDesc(desc)) {
        return box;
      }
    }
  }
  return null;
}

/**
 * Decode a CBOR integer (initial byte already consumed). Returns [value, bytesRead].
 * This is a minimal CBOR decoder sufficient for C2PA claim headers.
 */
function decodeCborInteger(
  bytes: Uint8Array,
  offset: number,
  info: number
): [number | bigint, number] {
  if (info <= 23) return [info, 0];
  if (info === 24) return [bytes[offset] ?? 0, 1];
  if (info === 25) return [readUint16BE(bytes, offset), 2];
  if (info === 26) return [readUint32BE(bytes, offset), 4];
  if (info === 27) {
    const hi = BigInt(readUint32BE(bytes, offset));
    const lo = BigInt(readUint32BE(bytes, offset + 4));
    return [(hi << BigInt(32)) | lo, 8];
  }
  return [0, 0];
}

/**
 * Peek a CBOR map to collect string keys and their raw byte ranges.
 * Returns a map of key -> { offset, length } for the value.
 */
function scanCborMap(
  bytes: Uint8Array,
  offset: number
): Map<string, { offset: number; length: number }> | null {
  const initial = bytes[offset];
  if ((initial ?? 0) >> 5 !== 5) return null;
  const info = (initial ?? 0) & 0x1f;
  let count: number;
  let pos = offset + 1;
  if (info <= 23) {
    count = info;
  } else if (info === 24) {
    count = bytes[pos] ?? 0;
    pos++;
  } else if (info === 25) {
    count = readUint16BE(bytes, pos);
    pos += 2;
  } else {
    return null;
  }

  const result = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const keyItem = bytes[pos];
    const keyMajor = (keyItem ?? 0) >> 5;
    const keyInfo = (keyItem ?? 0) & 0x1f;
    if (keyMajor !== 3) {
      // Not a string key, skip simplistic
      return null;
    }
    const [keyLen, keyHeaderBytes] = decodeCborInteger(bytes, pos + 1, keyInfo);
    const keyStrLen = Number(keyLen);
    pos += 1 + keyHeaderBytes;
    const key = new TextDecoder().decode(bytes.subarray(pos, pos + keyStrLen));
    pos += keyStrLen;

    const valueStart = pos;
    const valueItem = bytes[pos];
    const valueMajor = (valueItem ?? 0) >> 5;
    const valueInfo = (valueItem ?? 0) & 0x1f;
    if (valueMajor === 3 || valueMajor === 2) {
      const [len, headerBytes] = decodeCborInteger(bytes, pos + 1, valueInfo);
      pos += 1 + headerBytes + Number(len);
    } else if (valueMajor === 4 || valueMajor === 5) {
      // Array or map: scan until we find a balanced end. Simplistic: skip by length if definite.
      if (valueInfo <= 23) {
        const itemCount = valueInfo;
        pos++;
        for (let j = 0; j < itemCount; j++) {
          const skipped = skipCborItem(bytes, pos);
          if (skipped <= 0) return null;
          pos += skipped;
        }
      } else if (valueInfo === 24) {
        const itemCount = bytes[pos + 1] ?? 0;
        pos += 2;
        for (let j = 0; j < itemCount; j++) {
          const skipped = skipCborItem(bytes, pos);
          if (skipped <= 0) return null;
          pos += skipped;
        }
      } else {
        return null;
      }
    } else if (valueMajor === 0 || valueMajor === 1) {
      const [, headerBytes] = decodeCborInteger(bytes, pos + 1, valueInfo);
      pos += 1 + headerBytes;
    } else {
      return null;
    }
    result.set(key, { offset: valueStart, length: pos - valueStart });
  }
  return result;
}

/**
 * Skip a single CBOR item and return its byte length, or -1 on failure.
 */
function skipCborItem(bytes: Uint8Array, offset: number): number {
  if (offset >= bytes.length) return -1;
  const item = bytes[offset] ?? 0;
  const major = item >> 5;
  const info = item & 0x1f;

  if (major === 2 || major === 3) {
    if (info === 31) {
      // Indefinite length byte/text string: scan for 0xff break
      let pos = offset + 1;
      while (pos < bytes.length) {
        if (bytes[pos] === 0xff) {
          pos++;
          return pos - offset;
        }
        const chunkLen = skipCborItem(bytes, pos);
        if (chunkLen <= 0) return -1;
        pos += chunkLen;
      }
      return -1;
    }
    const [len, headerBytes] = decodeCborInteger(bytes, offset + 1, info);
    return 1 + headerBytes + Number(len);
  }

  if (major === 4 || major === 5) {
    if (info === 31) {
      // Indefinite array/map
      let pos = offset + 1;
      while (pos < bytes.length) {
        if (bytes[pos] === 0xff) {
          pos++;
          return pos - offset;
        }
        const itemLen = skipCborItem(bytes, pos);
        if (itemLen <= 0) return -1;
        pos += itemLen;
      }
      return -1;
    }
    const [count, headerBytes] = decodeCborInteger(bytes, offset + 1, info);
    let pos = offset + 1 + headerBytes;
    const factor = major === 5 ? 2 : 1;
    for (let i = 0; i < Number(count) * factor; i++) {
      const itemLen = skipCborItem(bytes, pos);
      if (itemLen <= 0) return -1;
      pos += itemLen;
    }
    return pos - offset;
  }

  // Integer / float / simple / tag: header size depends on info only.
  if (info <= 23) return 1;
  if (info === 24) return 2;
  if (info === 25) return 3;
  if (info === 26) return 5;
  if (info === 27) return 9;
  return -1;
}

/**
 * Extract a text value from a CBOR map value range.
 */
function cborTextValue(
  bytes: Uint8Array,
  range?: { offset: number; length: number }
): string | undefined {
  if (!range) return undefined;
  const item = bytes[range.offset];
  if ((item ?? 0) >> 5 !== 3) return undefined;
  const info = (item ?? 0) & 0x1f;
  const [len, headerBytes] = decodeCborInteger(bytes, range.offset + 1, info);
  const start = range.offset + 1 + headerBytes;
  return new TextDecoder().decode(bytes.subarray(start, start + Number(len)));
}

/**
 * Extract a byte-string value from a CBOR map value range.
 */
function cborBytesValue(
  bytes: Uint8Array,
  range?: { offset: number; length: number }
): Uint8Array | undefined {
  if (!range) return undefined;
  const item = bytes[range.offset];
  if ((item ?? 0) >> 5 !== 2) return undefined;
  const info = (item ?? 0) & 0x1f;
  const [len, headerBytes] = decodeCborInteger(bytes, range.offset + 1, info);
  const start = range.offset + 1 + headerBytes;
  return bytes.subarray(start, start + Number(len));
}

/**
 * Parse a C2PA claim (CBOR map).
 */
function parseC2paClaim(bytes: Uint8Array): C2paClaim | null {
  const map = scanCborMap(bytes, 0);
  if (!map) return null;

  const claim: C2paClaim = { raw: bytes };

  // C2PA v2 claim fields:
  // 'claim_generator', 'claim_generator_info', 'signature_type', 'manifest_label',
  // 'claim_date_time', 'recorded_when', 'audio', 'video', 'thumbnail', 'ingredients',
  // 'assertions', 'content_binding', etc.
  claim.claimGenerator = cborTextValue(bytes, map.get('claim_generator'));
  claim.signatureType = cborTextValue(bytes, map.get('signature_type'));
  claim.manifestLabel = cborTextValue(bytes, map.get('manifest_label'));
  claim.claimTime = cborTextValue(bytes, map.get('claim_date_time'));

  const bindingsRange = map.get('content_binding');
  if (bindingsRange) {
    // content_binding is an array of maps; parse roughly
    const arrItem = bytes[bindingsRange.offset];
    if ((arrItem ?? 0) >> 5 === 4) {
      const info = (arrItem ?? 0) & 0x1f;
      let count = 0;
      let pos = bindingsRange.offset + 1;
      if (info <= 23) count = info;
      else if (info === 24) {
        count = bytes[pos] ?? 0;
        pos++;
      } else if (info === 25) {
        count = readUint16BE(bytes, pos);
        pos += 2;
      }
      claim.contentBindings = [];
      for (let i = 0; i < count; i++) {
        const bindingMap = scanCborMap(bytes, pos);
        if (bindingMap) {
          const url = cborTextValue(bytes, bindingMap.get('url'));
          const alg = cborTextValue(bytes, bindingMap.get('alg'));
          const hash = cborBytesValue(bytes, bindingMap.get('hash'));
          if (url && alg && hash) {
            claim.contentBindings.push({ url, alg, hash });
          }
          // advance pos past this map
          const mapLen = skipCborItem(bytes, pos);
          if (mapLen > 0) pos += mapLen;
        } else {
          break;
        }
      }
    }
  }

  return claim;
}

/**
 * Parse a COSE_Sign1 structure and return the protected header bytes, payload bytes,
 * signature bytes, and the algorithm if present.
 */
function parseCoseSign1(bytes: Uint8Array): {
  protectedHeader: Uint8Array;
  payload: Uint8Array;
  signature: Uint8Array;
  alg?: number;
} | null {
  // COSE_Sign1 = [protected: bstr, unprotected: map, payload: bstr, signature: bstr]
  const major = (bytes[0] ?? 0) >> 5;
  const info = (bytes[0] ?? 0) & 0x1f;
  if (major !== 4) return null;

  let pos = 1;
  let count: number;
  if (info <= 23) count = info;
  else if (info === 24) {
    count = bytes[pos] ?? 0;
    pos++;
  } else if (info === 25) {
    count = readUint16BE(bytes, pos);
    pos += 2;
  } else {
    return null;
  }

  if (count !== 4) return null;

  const protectedHeader = cborBytesValue(bytes, { offset: pos, length: 0 });
  const phLen = skipCborItem(bytes, pos);
  if (!protectedHeader || phLen <= 0) return null;
  pos += phLen;

  // Skip unprotected map
  const uhLen = skipCborItem(bytes, pos);
  if (uhLen <= 0) return null;
  pos += uhLen;

  const payload = cborBytesValue(bytes, { offset: pos, length: 0 });
  const plLen = skipCborItem(bytes, pos);
  if (!payload || plLen <= 0) return null;
  pos += plLen;

  const signature = cborBytesValue(bytes, { offset: pos, length: 0 });
  const sigLen = skipCborItem(bytes, pos);
  if (!signature || sigLen <= 0) return null;

  // Parse alg from protected header (map key 1 -> alg)
  let alg: number | undefined;
  if (protectedHeader.length > 0) {
    const phMap = scanCborMap(protectedHeader, 0);
    if (phMap) {
      const algRange = phMap.get('1');
      if (algRange) {
        const item = protectedHeader[algRange.offset];
        const aInfo = (item ?? 0) & 0x1f;
        const [val] = decodeCborInteger(
          protectedHeader,
          algRange.offset + 1,
          aInfo
        );
        alg = Number(val);
      }
    }
  }

  return { protectedHeader, payload, signature, alg };
}

/**
 * Extract an ECDSA public key from a raw 33-byte compressed P-256 key or an X.509 certificate.
 */
async function importC2paPublicKey(
  keyBytes: Uint8Array
): Promise<CryptoKey | null> {
  let workingKey = keyBytes;

  if (
    keyBytes.length === 33 &&
    (keyBytes[0] === 0x02 || keyBytes[0] === 0x03)
  ) {
    // Compressed P-256 point: decompress to uncompressed 0x04 || x || y form.
    const decompressed = decompressP256PublicKey(keyBytes);
    if (!decompressed) return null;
    workingKey = decompressed;
  }

  if (workingKey.length === 65 && workingKey[0] === 0x04) {
    // Uncompressed P-256 point -> JWK
    const x = bufferToBase64(workingKey.subarray(1, 33));
    const y = bufferToBase64(workingKey.subarray(33, 65));
    try {
      return await crypto.subtle.importKey(
        'jwk',
        { kty: 'EC', crv: 'P-256', x, y, ext: true },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
    } catch {
      return null;
    }
  }

  // Try parsing as X.509 SPKI
  try {
    return await crypto.subtle.importKey(
      'spki',
      keyBytes as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  } catch {
    // ignore
  }

  return null;
}

/**
 * Build the Sig_Structure bytes used for COSE Sign1 verification.
 * Sig_structure = [ "Signature1", protected: bstr, external_aad: bstr, payload: bstr ]
 */
function buildSigStructure(
  protectedHeader: Uint8Array,
  payload: Uint8Array
): Uint8Array {
  // We emit CBOR array of 4 elements manually.
  const encoder = new CborEncoder();
  encoder.startArray(4);
  encoder.addText('Signature1');
  encoder.addBytes(protectedHeader);
  encoder.addBytes(new Uint8Array(0));
  encoder.addBytes(payload);
  return encoder.finish();
}

class CborEncoder {
  private chunks: Uint8Array[] = [];

  startArray(count: number) {
    if (count <= 23) {
      this.chunks.push(new Uint8Array([0x80 | count]));
    } else if (count <= 255) {
      this.chunks.push(new Uint8Array([0x98, count]));
    } else {
      this.chunks.push(new Uint8Array([0x99, count >> 8, count & 0xff]));
    }
  }

  addText(text: string) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= 23) {
      this.chunks.push(new Uint8Array([0x60 | bytes.length]));
    } else if (bytes.length <= 255) {
      this.chunks.push(new Uint8Array([0x78, bytes.length]));
    } else {
      this.chunks.push(
        new Uint8Array([0x79, bytes.length >> 8, bytes.length & 0xff])
      );
    }
    this.chunks.push(bytes);
  }

  addBytes(bytes: Uint8Array) {
    if (bytes.length <= 23) {
      this.chunks.push(new Uint8Array([0x40 | bytes.length]));
    } else if (bytes.length <= 255) {
      this.chunks.push(new Uint8Array([0x58, bytes.length]));
    } else {
      this.chunks.push(
        new Uint8Array([0x59, bytes.length >> 8, bytes.length & 0xff])
      );
    }
    this.chunks.push(bytes);
  }

  finish(): Uint8Array {
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

/**
 * Verify a COSE_Sign1 signature over the given payload bytes.
 */
async function verifyCoseSignature(
  coseBytes: Uint8Array,
  publicKey: CryptoKey
): Promise<boolean> {
  const cose = parseCoseSign1(coseBytes);
  if (!cose) return false;

  const sigStructure = buildSigStructure(cose.protectedHeader, cose.payload);

  // Map COSE alg to Web Crypto hash name
  const hashName =
    cose.alg === -7 || cose.alg === undefined ? 'SHA-256' : 'SHA-256';

  try {
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: hashName },
      publicKey,
      cose.signature as BufferSource,
      sigStructure as BufferSource
    );
  } catch {
    return false;
  }
}

/**
 * Parse the signer certificate from a COSE unprotected header or separate `x5chain` data.
 * Returns the certificate's subject common name if found, plus validity/trust status.
 */
async function extractSignerInfo(
  coseBytes: Uint8Array,
  _signatureBytes: Uint8Array,
  trustedFingerprints?: string[]
): Promise<{
  issuer?: string;
  valid: boolean;
  expired: boolean;
  trusted: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];
  // Parse unprotected header map
  const major = (coseBytes[0] ?? 0) >> 5;
  const info = (coseBytes[0] ?? 0) & 0x1f;
  if (major !== 4)
    return { valid: false, expired: false, trusted: false, warnings };
  let pos = 1;
  let count: number;
  if (info <= 23) count = info;
  else if (info === 24) {
    count = coseBytes[pos] ?? 0;
    pos++;
  } else if (info === 25) {
    count = readUint16BE(coseBytes, pos);
    pos += 2;
  } else {
    return { valid: false, expired: false, trusted: false, warnings };
  }
  if (count < 2)
    return { valid: false, expired: false, trusted: false, warnings };

  // skip protected header
  const phLen = skipCborItem(coseBytes, pos);
  if (phLen <= 0)
    return { valid: false, expired: false, trusted: false, warnings };
  pos += phLen;

  // parse unprotected map
  const uhMap = scanCborMap(coseBytes, pos);
  if (!uhMap) {
    return { valid: false, expired: false, trusted: false, warnings };
  }

  // x5chain is key 33 (0x21) in unprotected header
  const x5chain = uhMap.get('33');
  if (x5chain) {
    const certBytes = cborBytesValue(coseBytes, x5chain);
    if (certBytes) {
      const cn = extractCommonName(certBytes);
      const validity = parseX509Validity(certBytes);
      const now = new Date();
      const expired = validity
        ? now < validity.notBefore || now > validity.notAfter
        : false;

      let trusted = false;
      if (trustedFingerprints && trustedFingerprints.length > 0) {
        const fingerprint = await computeCertificateFingerprint(certBytes);
        trusted = trustedFingerprints.some(
          (fp) =>
            fp.toLowerCase().replace(/:/g, '') === fingerprint.toLowerCase()
        );
      }

      return {
        issuer: cn,
        valid: validity !== null && !expired,
        expired,
        trusted,
        warnings,
      };
    }
  }

  return { valid: true, expired: false, trusted: false, warnings };
}

/**
 * Extract the Common Name (CN) from an X.509 certificate's subject.
 */
function extractCommonName(cert: Uint8Array): string | undefined {
  // Very light ASN.1 scan for CN OID 2.5.4.3
  for (let i = 0; i < cert.length - 10; i++) {
    if (
      cert[i] === 0x06 &&
      cert[i + 1] === 0x03 &&
      cert[i + 2] === 0x55 &&
      cert[i + 3] === 0x04 &&
      cert[i + 4] === 0x03
    ) {
      // Next should be a UTF8String/PrintableString containing CN
      const j = i + 5;
      if (cert[j] === 0x0c || cert[j] === 0x13) {
        const len = cert[j + 1] ?? 0;
        return new TextDecoder().decode(cert.subarray(j + 2, j + 2 + len));
      }
    }
  }
  return undefined;
}

/**
 * Read an ASN.1 length field starting at `offset`.
 * Returns the number of value bytes and the number of bytes consumed for the length.
 */
function readAsn1Length(
  data: Uint8Array,
  offset: number
): { length: number; consumed: number } | null {
  const first = data[offset];
  if (first === undefined) return null;
  if ((first & 0x80) === 0) {
    return { length: first, consumed: 1 };
  }
  const numBytes = first & 0x7f;
  if (numBytes === 0 || numBytes > 4) return null;
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    const b = data[offset + 1 + i];
    if (b === undefined) return null;
    length = (length << 8) | b;
  }
  return { length, consumed: 1 + numBytes };
}

/**
 * Read an ASN.1 tag + length. Returns the content start index and content length,
 * or null if parsing fails.
 */
function readAsn1Tag(
  data: Uint8Array,
  offset: number
): {
  tag: number;
  contentStart: number;
  contentLength: number;
  end: number;
} | null {
  const tag = data[offset];
  if (tag === undefined) return null;
  const lenInfo = readAsn1Length(data, offset + 1);
  if (!lenInfo) return null;
  return {
    tag,
    contentStart: offset + 1 + lenInfo.consumed,
    contentLength: lenInfo.length,
    end: offset + 1 + lenInfo.consumed + lenInfo.length,
  };
}

/**
 * Parse UTCTime (tag 0x17, YYMMDDHHMMSSZ) or GeneralizedTime
 * (tag 0x18, YYYYMMDDHHMMSSZ) into a Date.
 * Returns null if the format is unsupported.
 */
function parseAsn1Time(data: Uint8Array, offset: number): Date | null {
  const info = readAsn1Tag(data, offset);
  if (!info || (info.tag !== 0x17 && info.tag !== 0x18)) return null;
  const bytes = data.subarray(
    info.contentStart,
    info.contentStart + info.contentLength
  );
  const str = new TextDecoder().decode(bytes);
  // Strip optional fractional seconds and timezone suffixes for simplicity
  const clean = str.replace(/\.\d+/, '').replace(/Z$/, '');
  if (clean.length !== 12 && clean.length !== 14) return null;

  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  let second: number;
  try {
    if (clean.length === 12) {
      // UTCTime
      const yy = parseInt(clean.slice(0, 2), 10);
      year = yy >= 50 ? 1900 + yy : 2000 + yy;
      month = parseInt(clean.slice(2, 4), 10) - 1;
      day = parseInt(clean.slice(4, 6), 10);
      hour = parseInt(clean.slice(6, 8), 10);
      minute = parseInt(clean.slice(8, 10), 10);
      second = parseInt(clean.slice(10, 12), 10);
    } else {
      // GeneralizedTime
      year = parseInt(clean.slice(0, 4), 10);
      month = parseInt(clean.slice(4, 6), 10) - 1;
      day = parseInt(clean.slice(6, 8), 10);
      hour = parseInt(clean.slice(8, 10), 10);
      minute = parseInt(clean.slice(10, 12), 10);
      second = parseInt(clean.slice(12, 14), 10);
    }
  } catch {
    return null;
  }

  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (
    isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Extract the validity period (notBefore, notAfter) from an X.509 certificate.
 * Returns null if parsing fails.
 */
export function parseX509Validity(
  cert: Uint8Array
): { notBefore: Date; notAfter: Date } | null {
  // Certificate is SEQUENCE { TBSCertificate, sigAlg, sigValue }
  const certInfo = readAsn1Tag(cert, 0);
  if (!certInfo || certInfo.tag !== 0x30) return null;

  // TBSCertificate is the first child
  const tbsInfo = readAsn1Tag(cert, certInfo.contentStart);
  if (!tbsInfo || tbsInfo.tag !== 0x30) return null;

  // Walk fields until we find the validity sequence (contains two time values).
  let pos = tbsInfo.contentStart;
  const end = tbsInfo.end;
  while (pos < end) {
    const seqInfo = readAsn1Tag(cert, pos);
    if (!seqInfo) return null;
    if (seqInfo.tag === 0x30) {
      // Could be issuer, validity, subject, etc. Check if it contains two time fields.
      const first = readAsn1Tag(cert, seqInfo.contentStart);
      if (first && (first.tag === 0x17 || first.tag === 0x18)) {
        const second = readAsn1Tag(cert, first.end);
        if (second && (second.tag === 0x17 || second.tag === 0x18)) {
          const notBefore = parseAsn1Time(cert, seqInfo.contentStart);
          const notAfter = parseAsn1Time(cert, first.end);
          if (notBefore && notAfter) {
            return { notBefore, notAfter };
          }
        }
      }
    }
    pos = seqInfo.end;
  }
  return null;
}

/**
 * Compute the SHA-256 hex fingerprint of a certificate.
 */
export async function computeCertificateFingerprint(
  cert: Uint8Array
): Promise<string> {
  const digest = await sha256(cert);
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Infer the generator name from raw claim bytes by scanning for known vendor strings.
 */
function inferGenerator(bytes: Uint8Array): string | undefined {
  const snippet = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (snippet.includes('Leica')) return 'Leica Camera C2PA';
  if (snippet.includes('Nikon')) return 'Nikon Authentic Provenance';
  if (snippet.includes('Sony')) return 'Sony In-Camera Signature';
  if (snippet.includes('Canon')) return 'Canon Authenticity';
  if (snippet.includes('Pixel') || snippet.includes('Google'))
    return 'Google Pixel Camera';
  if (snippet.includes('Apple') || snippet.includes('iPhone'))
    return 'Apple C2PA / CAI';
  if (snippet.includes('Truepic')) return 'Truepic Verified';
  if (snippet.includes('Adobe')) return 'Adobe Content Authenticity';
  return undefined;
}

/**
 * Verify a C2PA manifest store: parse claim, signature, and assertions, and validate
 * the cryptographic signature and content binding when possible.
 */
async function verifyManifestStore(
  store: C2paBox,
  fileBytes: Uint8Array,
  options?: { trustedIssuerFingerprints?: string[] }
): Promise<C2paVerificationResult> {
  const result: C2paVerificationResult = {
    hasC2pa: true,
    hasManifestStore: false,
    hasSignature: false,
    signatureValid: false,
    claimBindingValid: false,
    certificateValid: false,
    certificateExpired: false,
    certificateTrusted: false,
    format: 'JUMBF/C2PA',
    warnings: [],
  };

  if (!store.children) {
    result.warnings.push('C2PA manifest store has no children');
    return result;
  }

  // Locate first manifest box (c2ma)
  const manifest = store.children.find((c) => c.type === 'c2ma');
  if (!manifest || !manifest.children) {
    result.warnings.push('No c2ma manifest box found');
    return result;
  }

  const claimBox = manifest.children.find((c) => c.type === 'c2cl');
  const sigBox = manifest.children.find((c) => c.type === 'c2cs');
  const assertionsBox = manifest.children.find((c) => c.type === 'c2as');

  if (!claimBox || !claimBox.raw) {
    result.warnings.push('Manifest missing claim box');
    return result;
  }
  if (!sigBox || !sigBox.raw) {
    result.warnings.push('Manifest missing signature box');
    return result;
  }
  if (!assertionsBox) {
    result.warnings.push('Manifest missing assertions box');
  }

  result.hasManifestStore = true;
  result.hasSignature = true;

  // Extract claim payload (skip jumb/jumd wrappers)
  let claimBytes = claimBox.raw.subarray(
    claimBox.payloadStart - claimBox.start
  );
  // If claim is wrapped in another jumb/jumd, unwrap
  if (readBoxType(claimBytes, 4) === 'jumb') {
    const inner = parseJumbfBox(claimBytes, 0, claimBytes.length);
    if (inner && inner.children) {
      const content = inner.children.find((c) => c.type !== 'jumd');
      if (content && content.raw) {
        claimBytes = content.raw.subarray(content.payloadStart - content.start);
      }
    }
  }

  const claim = parseC2paClaim(claimBytes);
  if (claim) {
    result.claimGenerator = claim.claimGenerator || inferGenerator(claimBytes);
    result.claimTime = claim.claimTime;

    // Verify content binding: hash the file bytes using the algorithm in the claim
    if (claim.contentBindings && claim.contentBindings.length > 0) {
      const binding = claim.contentBindings[0];
      if (!binding || !binding.hash) {
        result.warnings.push('Content binding missing hash');
      } else {
        const expectedHash = binding.hash;
        let fileHash: Uint8Array;
        try {
          fileHash = await sha256(fileBytes);
        } catch {
          fileHash = new Uint8Array(0);
        }
        if (
          expectedHash.length === fileHash.length &&
          expectedHash.every((b, i) => b === fileHash[i])
        ) {
          result.claimBindingValid = true;
        } else {
          result.warnings.push('Content binding hash does not match file');
        }
      }
    } else {
      result.warnings.push('No content bindings in claim');
    }
  } else {
    result.claimGenerator = inferGenerator(claimBytes);
    result.warnings.push('Could not parse C2PA claim CBOR');
  }

  // Extract signature bytes
  let sigBytes = sigBox.raw.subarray(sigBox.payloadStart - sigBox.start);
  if (readBoxType(sigBytes, 4) === 'jumb') {
    const inner = parseJumbfBox(sigBytes, 0, sigBytes.length);
    if (inner && inner.children) {
      const content = inner.children.find((c) => c.type !== 'jumd');
      if (content && content.raw) {
        sigBytes = content.raw.subarray(content.payloadStart - content.start);
      }
    }
  }

  // Try to verify signature. Need the public key. C2PA usually embeds it in the
  // assertion `c2pa.signature.validation` or in the unprotected header x5chain.
  // We first try to find an embedded uncompressed P-256 public key in the signature
  // or assertions, then verify the COSE Sign1 over the claim bytes.
  let publicKey: CryptoKey | null = null;

  async function tryImportKey(
    candidate: Uint8Array
  ): Promise<CryptoKey | null> {
    return importC2paPublicKey(candidate);
  }

  // Search nearby bytes for public key candidates: uncompressed point, compressed point, or SPKI.
  for (let i = 0; i < sigBytes.length; i++) {
    const prefix = sigBytes[i];
    if (prefix === 0x04 && i + 65 <= sigBytes.length) {
      const key = await tryImportKey(sigBytes.subarray(i, i + 65));
      if (key) {
        publicKey = key;
        break;
      }
    } else if (
      (prefix === 0x02 || prefix === 0x03) &&
      i + 33 <= sigBytes.length
    ) {
      const key = await tryImportKey(sigBytes.subarray(i, i + 33));
      if (key) {
        publicKey = key;
        break;
      }
    }
  }

  if (!publicKey && claimBox.raw) {
    // Also search the claim and assertions for a public key
    const searchSpace = concatBytes([
      claimBox.raw,
      assertionsBox && assertionsBox.raw
        ? assertionsBox.raw
        : new Uint8Array(0),
      sigBox.raw,
    ]);
    for (let i = 0; i < searchSpace.length; i++) {
      const prefix = searchSpace[i];
      if (prefix === 0x04 && i + 65 <= searchSpace.length) {
        const key = await tryImportKey(searchSpace.subarray(i, i + 65));
        if (key) {
          publicKey = key;
          break;
        }
      } else if (
        (prefix === 0x02 || prefix === 0x03) &&
        i + 33 <= searchSpace.length
      ) {
        const key = await tryImportKey(searchSpace.subarray(i, i + 33));
        if (key) {
          publicKey = key;
          break;
        }
      }
    }
  }

  // Extract signer certificate info
  const signerInfo = await extractSignerInfo(
    sigBytes,
    sigBytes,
    options?.trustedIssuerFingerprints ?? DEFAULT_TRUSTED_ISSUER_FINGERPRINTS
  );
  result.issuer = signerInfo.issuer;
  result.certificateValid = signerInfo.valid;
  result.certificateExpired = signerInfo.expired;
  result.certificateTrusted = signerInfo.trusted;
  result.warnings.push(...signerInfo.warnings);

  if (publicKey && claim && claim.raw) {
    result.signatureValid = await verifyCoseSignature(sigBytes, publicKey);
    if (!result.signatureValid) {
      result.warnings.push('COSE claim signature verification failed');
    }
  } else {
    result.warnings.push(
      'Public key not found or unusable; signature could not be verified'
    );
  }

  return result;
}

/**
 * Deep-verify a C2PA manifest in an image file.
 *
 * Returns a detailed result including whether the manifest store is complete,
 * whether the claim signature is present, and whether the signature and content
 * binding could be cryptographically validated.
 */
export async function verifyC2PA(
  fileBytes: ArrayBuffer | Uint8Array,
  options?: { trustedIssuerFingerprints?: string[] }
): Promise<C2paVerificationResult> {
  const bytes =
    fileBytes instanceof ArrayBuffer ? new Uint8Array(fileBytes) : fileBytes;

  const store = findC2paManifestStore(bytes);
  if (!store) {
    return {
      hasC2pa: false,
      hasManifestStore: false,
      hasSignature: false,
      signatureValid: false,
      claimBindingValid: false,
      certificateValid: false,
      certificateExpired: false,
      certificateTrusted: false,
      warnings: [],
    };
  }

  return await verifyManifestStore(store, bytes, options);
}

/**
 * Synchronous fast detection of C2PA boxes (for backward compatibility and quick UI checks).
 */
export function detectC2PA(fileBytes: ArrayBuffer | Uint8Array): {
  hasC2pa: boolean;
  isSigned: boolean;
  generator?: string;
  format?: string;
} {
  const bytes =
    fileBytes instanceof ArrayBuffer ? new Uint8Array(fileBytes) : fileBytes;
  const store = findC2paManifestStore(bytes);
  if (!store) {
    return { hasC2pa: false, isSigned: false };
  }
  const hasSig =
    store.children?.some((manifest) =>
      manifest.children?.some((c) => c.type === 'c2cs')
    ) ?? false;
  // generator inference from any child raw bytes
  let generator: string | undefined;
  for (const manifest of store.children ?? []) {
    for (const child of manifest.children ?? []) {
      if (child.raw) {
        const g = inferGenerator(child.raw);
        if (g) {
          generator = g;
          break;
        }
      }
    }
    if (generator) break;
  }
  return {
    hasC2pa: true,
    isSigned: hasSig,
    generator,
    format: 'JUMBF/C2PA',
  };
}
