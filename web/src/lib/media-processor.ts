// web/src/lib/media-processor.ts: EXIF extraction, C2PA verification & image optimization
import type { ImageMeta } from './types';
import { verifyC2PA, detectC2PA } from './c2paVerifier';

async function getExifr() {
  const mod = await import('exifr');
  return (mod as any).default || mod;
}

export interface ProcessedMedia {
  dataUrl: string;
  meta: ImageMeta;
  gpsCoordinates: { lat: number; lng: number } | null;
  dateTime: Date | null;
  c2paDetected: boolean;
  c2paDetails?: {
    generator?: string;
    isSigned?: boolean;
    format?: string;
    verified?: boolean;
    signatureValid?: boolean;
    claimBindingValid?: boolean;
    certificateValid?: boolean;
    certificateExpired?: boolean;
    certificateTrusted?: boolean;
    issuer?: string;
    warnings?: string[];
  };
}

/**
 * Parse photo file and extract EXIF, C2PA, and client-resized WebP data URL
 */
export async function processImageFile(file: File): Promise<ProcessedMedia> {
  const arrayBuffer = await file.arrayBuffer();

  // 1. Extract EXIF metadata
  let gpsCoordinates: { lat: number; lng: number } | null = null;
  let dateTime: Date | null = null;
  let make: string | undefined;
  let model: string | undefined;

  try {
    const exifr = await getExifr();
    const exifData = await exifr.parse(arrayBuffer, {
      gps: true,
      tiff: true,
      xmp: true,
    });

    if (exifData) {
      if (
        typeof exifData.latitude === 'number' &&
        typeof exifData.longitude === 'number'
      ) {
        gpsCoordinates = {
          lat: Math.round(exifData.latitude * 1000000) / 1000000,
          lng: Math.round(exifData.longitude * 1000000) / 1000000,
        };
      }

      if (exifData.DateTimeOriginal instanceof Date) {
        dateTime = exifData.DateTimeOriginal;
      } else if (exifData.DateTimeOriginal) {
        dateTime = new Date(exifData.DateTimeOriginal);
      } else if (exifData.CreateDate) {
        dateTime = new Date(exifData.CreateDate);
      }

      make = exifData.Make;
      model = exifData.Model;
    }
  } catch (err) {
    console.warn('Failed to parse EXIF metadata:', err);
  }

  // 2. C2PA (Content Authenticity) deep verification
  let c2paResult;
  let c2paVerifiedResult;
  try {
    c2paResult = detectC2PA(new Uint8Array(arrayBuffer));
    c2paVerifiedResult = await verifyC2PA(new Uint8Array(arrayBuffer));
  } catch (err) {
    console.warn('C2PA verification failed:', err);
    c2paResult = { hasC2pa: false, isSigned: false };
    c2paVerifiedResult = {
      hasC2pa: false,
      hasManifestStore: false,
      hasSignature: false,
      signatureValid: false,
      claimBindingValid: false,
      certificateValid: false,
      warnings: [
        `Verification error: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  // 3. Client-side image optimization (max 1200px / WebP compression)
  const dataUrl = await resizeAndCompressImage(file, 1200, 0.82);

  const meta: ImageMeta = {
    exif: {
      dateTimeOriginal: dateTime ? dateTime.toISOString() : undefined,
      make,
      model,
      latitude: gpsCoordinates?.lat,
      longitude: gpsCoordinates?.lng,
    },
    c2pa: {
      hasC2pa: c2paResult.hasC2pa,
      isSigned: c2paResult.isSigned,
      claimGenerator: c2paVerifiedResult.claimGenerator || c2paResult.generator,
      format: c2paResult.format,
      issuer: c2paVerifiedResult.issuer,
      verified:
        c2paVerifiedResult.signatureValid &&
        c2paVerifiedResult.claimBindingValid,
      signatureValid: c2paVerifiedResult.signatureValid,
      claimBindingValid: c2paVerifiedResult.claimBindingValid,
      certificateValid: c2paVerifiedResult.certificateValid,
      certificateExpired: c2paVerifiedResult.certificateExpired,
      certificateTrusted: c2paVerifiedResult.certificateTrusted,
      time:
        c2paVerifiedResult.claimTime ||
        (dateTime ? dateTime.toISOString() : undefined),
    },
  };

  return {
    dataUrl,
    meta,
    gpsCoordinates,
    dateTime,
    c2paDetected: c2paResult.hasC2pa,
    c2paDetails: c2paResult.hasC2pa
      ? {
          generator: c2paVerifiedResult.claimGenerator || c2paResult.generator,
          isSigned: c2paResult.isSigned,
          format: c2paResult.format,
          verified:
            c2paVerifiedResult.signatureValid &&
            c2paVerifiedResult.claimBindingValid,
          signatureValid: c2paVerifiedResult.signatureValid,
          claimBindingValid: c2paVerifiedResult.claimBindingValid,
          certificateValid: c2paVerifiedResult.certificateValid,
          certificateExpired: c2paVerifiedResult.certificateExpired,
          certificateTrusted: c2paVerifiedResult.certificateTrusted,
          issuer: c2paVerifiedResult.issuer,
          warnings: c2paVerifiedResult.warnings,
        }
      : undefined,
  };
}

/**
 * Resize image to maxDimension and compress to WebP or JPEG via Canvas
 */
async function resizeAndCompressImage(
  file: File,
  maxDimension: number,
  quality: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to create canvas context'));
        return;
      }

      // Draw image to canvas
      ctx.drawImage(img, 0, 0, width, height);

      // Try WebP, fallback to JPEG
      try {
        const webpData = canvas.toDataURL('image/webp', quality);
        if (webpData.startsWith('data:image/webp')) {
          resolve(webpData);
          return;
        }
      } catch {
        // Fallback
      }

      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for resizing'));
    };

    img.src = url;
  });
}
