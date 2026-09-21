// web/src/lib/mediaTrust.ts: Client-side media trust analysis for disaster information.
//
// Provides lightweight, offline-capable checks for:
//   - AI-generated / synthetic image heuristics
//   - Perceptual duplicate detection
//   - Metadata contradictions (same image, different time/location)
//
// These are heuristic defences intended to flag suspicious content for human review,
// not to provide absolute proof of authenticity. They complement C2PA by covering images
// that lack cryptographic provenance.

import * as m from '../paraglide/messages.js';

export interface MediaTrustAnalysis {
  /** Aggregate score from 0 (untrusted) to 100 (highly trustworthy). */
  trustScore: number;
  /** Per-check details. */
  checks: {
    c2paVerified: boolean;
    exifPresent: boolean;
    exifConsistent: boolean;
    hasGps: boolean;
    aiGeneratedRisk: 'low' | 'medium' | 'high';
    editRisk: 'low' | 'medium' | 'high';
    duplicateRisk: 'low' | 'medium' | 'high';
    contradictionRisk: 'low' | 'medium' | 'high';
  };
  /** Human-readable warnings in Japanese. */
  warnings: string[];
  /** Technical notes for developers / advanced users. */
  details: string[];
}

export interface ImageRecord {
  id: string;
  dataUrl: string;
  pHash?: string;
  takenAt?: string;
  lat?: number | null;
  lng?: number | null;
}

const DB_NAME = 'tossa_media_trust';
const DB_VERSION = 1;
const STORE_NAME = 'image_records';

/**
 * Compute a 64-bit average perceptual hash (aHash) for an image.
 * Returns a hex string. Works on any ImageBitmap/Image element via canvas.
 */
async function computeAverageHash(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined') {
    return '';
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 8;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      const gray: number[] = [];
      let total = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i] ?? 0;
        const g = imageData.data[i + 1] ?? 0;
        const b = imageData.data[i + 2] ?? 0;
        const value = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        gray.push(value);
        total += value;
      }
      const avg = total / gray.length;
      let bits = 0n;
      for (let i = 0; i < gray.length; i++) {
        if (gray[i]! > avg) {
          bits |= 1n << BigInt(i);
        }
      }
      resolve(bits.toString(16).padStart(16, '0'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Compute Hamming distance between two 64-bit hex hashes.
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64;
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    const x = parseInt(a[i]!, 16);
    const y = parseInt(b[i]!, 16);
    let diff = x ^ y;
    while (diff) {
      dist += diff & 1;
      diff >>= 1;
    }
  }
  return dist;
}

/**
 * Lightweight Error Level Analysis: re-compress the image and compare pixel differences.
 * Returns a normalised score (0-100) where higher means more likely edited.
 */
async function analyzeEditLevel(dataUrl: string): Promise<number> {
  if (typeof document === 'undefined') return 0;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = Math.min(img.width, 256);
      const height = Math.round((img.height * width) / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const originalData = ctx.getImageData(0, 0, width, height);

      // Re-compress as medium-quality JPEG
      const recompressed = canvas.toDataURL('image/jpeg', 0.7);
      const img2 = new Image();
      img2.onload = () => {
        ctx.drawImage(img2, 0, 0, width, height);
        const recompressedData = ctx.getImageData(0, 0, width, height);
        let diffSum = 0;
        for (let i = 0; i < originalData.data.length; i += 4) {
          const dr =
            (originalData.data[i] ?? 0) - (recompressedData.data[i] ?? 0);
          const dg =
            (originalData.data[i + 1] ?? 0) -
            (recompressedData.data[i + 1] ?? 0);
          const db =
            (originalData.data[i + 2] ?? 0) -
            (recompressedData.data[i + 2] ?? 0);
          diffSum += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
        }
        const pixelCount = width * height;
        const avgDiff = diffSum / (pixelCount * 3);
        // Normalise to 0-100; typical ELA differences > 30 are unusual for a single-generation photo
        resolve(Math.min(100, Math.round((avgDiff / 30) * 100)));
      };
      img2.onerror = () =>
        reject(new Error('Failed to load recompressed image'));
      img2.src = recompressed;
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Heuristic risk assessment for AI-generated or heavily synthetic images.
 */
export function assessAiGenerationRisk(
  hasC2pa: boolean,
  hasExif: boolean,
  editScore: number,
  dimensions?: { width: number; height: number }
): 'low' | 'medium' | 'high' {
  if (hasC2pa) return 'low';
  let risk = 0;
  if (!hasExif) risk += 2;
  if (editScore > 60) risk += 2;
  if (editScore > 30) risk += 1;
  if (dimensions) {
    // Common AI generator aspect ratios / suspicious square dimensions
    const isSquare = dimensions.width === dimensions.height;
    const isRoundDimension =
      dimensions.width % 64 === 0 && dimensions.height % 64 === 0;
    if (isSquare && isRoundDimension) risk += 1;
  }
  if (risk >= 4) return 'high';
  if (risk >= 2) return 'medium';
  return 'low';
}

/**
 * IndexedDB helper to open the media trust database.
 */
function openMediaTrustDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Persist an image record for duplicate/contradiction detection.
 */
async function recordImageForTrust(record: ImageRecord): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openMediaTrustDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
  } catch (err) {
    console.warn('Failed to record image for trust analysis:', err);
  }
}

/**
 * Find similar images already recorded (perceptual hash within threshold).
 */
async function findSimilarImages(
  pHash: string,
  threshold = 8
): Promise<ImageRecord[]> {
  if (typeof indexedDB === 'undefined' || !pHash) return [];
  try {
    const db = await openMediaTrustDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    const records: ImageRecord[] = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as ImageRecord[]);
      request.onerror = () => reject(request.error);
    });
    return records.filter((r) => {
      if (!r.pHash) return false;
      return hammingDistance(pHash, r.pHash) <= threshold;
    });
  } catch (err) {
    console.warn('Failed to find similar images:', err);
    return [];
  }
}

/**
 * Check for contradictions: same/similar image used with different metadata.
 */
export function detectContradictions(
  record: ImageRecord,
  similar: ImageRecord[]
): string[] {
  const warnings: string[] = [];
  for (const other of similar) {
    if (other.id === record.id) continue;
    if (record.takenAt && other.takenAt && record.takenAt !== other.takenAt) {
      warnings.push(
        m.media_trust_warning_contradiction_time({ time: other.takenAt })
      );
    }
    if (
      record.lat != null &&
      record.lng != null &&
      other.lat != null &&
      other.lng != null &&
      (record.lat !== other.lat || record.lng !== other.lng)
    ) {
      warnings.push(
        m.media_trust_warning_contradiction_location({
          lat: String(other.lat),
          lng: String(other.lng),
        })
      );
    }
  }
  return warnings;
}

/**
 * Analyse a photo for trust indicators.
 */
export async function analyseMediaTrust(options: {
  dataUrl: string;
  hasC2pa: boolean;
  c2paVerified: boolean;
  hasExif: boolean;
  exifDateTime?: string;
  latitude?: number | null;
  longitude?: number | null;
  postId: string;
}): Promise<MediaTrustAnalysis> {
  const checks = {
    c2paVerified: options.hasC2pa && options.c2paVerified,
    exifPresent: options.hasExif,
    exifConsistent: true,
    hasGps:
      options.latitude != null &&
      options.longitude != null &&
      !Number.isNaN(options.latitude) &&
      !Number.isNaN(options.longitude),
    aiGeneratedRisk: 'low' as 'low' | 'medium' | 'high',
    editRisk: 'low' as 'low' | 'medium' | 'high',
    duplicateRisk: 'low' as 'low' | 'medium' | 'high',
    contradictionRisk: 'low' as 'low' | 'medium' | 'high',
  };

  const warnings: string[] = [];
  const details: string[] = [];

  // C2PA / EXIF sanity
  if (options.hasC2pa && options.c2paVerified) {
    details.push(m.media_trust_detail_c2pa_verified());
  } else if (options.hasC2pa) {
    warnings.push(m.media_trust_warning_c2pa_unverified());
  }

  if (!options.hasExif) {
    warnings.push(m.media_trust_warning_no_exif());
  }

  if (options.exifDateTime) {
    const taken = new Date(options.exifDateTime);
    const now = new Date();
    if (taken > now) {
      checks.exifConsistent = false;
      warnings.push(m.media_trust_warning_future_time());
    }
    if (now.getTime() - taken.getTime() > 365 * 24 * 60 * 60 * 1000) {
      warnings.push(m.media_trust_warning_old_photo());
    }
  }

  // ELA / AI heuristics
  let editScore = 0;
  try {
    editScore = await analyzeEditLevel(options.dataUrl);
    checks.editRisk =
      editScore > 60 ? 'high' : editScore > 30 ? 'medium' : 'low';
    if (checks.editRisk === 'high') {
      warnings.push(m.media_trust_warning_high_edit());
    } else if (checks.editRisk === 'medium') {
      details.push(m.media_trust_detail_light_edit());
    }
  } catch {
    // Ignore ELA failures
  }

  checks.aiGeneratedRisk = assessAiGenerationRisk(
    options.hasC2pa,
    options.hasExif,
    editScore
  );
  if (checks.aiGeneratedRisk === 'high') {
    warnings.push(m.media_trust_warning_ai_high());
  } else if (checks.aiGeneratedRisk === 'medium') {
    details.push(m.media_trust_detail_ai_medium());
  }

  // Duplicate / contradiction detection
  try {
    const pHash = await computeAverageHash(options.dataUrl);
    if (pHash) {
      const similar = await findSimilarImages(pHash);
      const similarWithoutSelf = similar.filter((s) => s.id !== options.postId);
      if (similarWithoutSelf.length > 0) {
        checks.duplicateRisk = 'high';
        warnings.push(m.media_trust_warning_duplicate());
      }

      const contradictionWarnings = detectContradictions(
        {
          id: options.postId,
          dataUrl: options.dataUrl,
          pHash,
          takenAt: options.exifDateTime,
          lat: options.latitude,
          lng: options.longitude,
        },
        similarWithoutSelf
      );
      if (contradictionWarnings.length > 0) {
        checks.contradictionRisk = 'high';
        warnings.push(...contradictionWarnings);
      }

      // Record the current image for future comparison
      void recordImageForTrust({
        id: options.postId,
        dataUrl: options.dataUrl,
        pHash,
        takenAt: options.exifDateTime,
        lat: options.latitude,
        lng: options.longitude,
      });
    }
  } catch {
    // Ignore duplicate detection failures
  }

  // Compute aggregate trust score
  let score = 50;
  if (checks.c2paVerified) score += 35;
  else if (options.hasC2pa) score += 10;
  if (checks.exifPresent) score += 10;
  if (checks.hasGps) score += 5;
  if (checks.exifConsistent) score += 5;
  if (checks.aiGeneratedRisk === 'high') score -= 40;
  else if (checks.aiGeneratedRisk === 'medium') score -= 15;
  if (checks.editRisk === 'high') score -= 20;
  else if (checks.editRisk === 'medium') score -= 5;
  if (checks.duplicateRisk === 'high') score -= 20;
  if (checks.contradictionRisk === 'high') score -= 20;

  score = Math.max(0, Math.min(100, score));

  return {
    trustScore: score,
    checks,
    warnings,
    details,
  };
}
