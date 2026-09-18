import type { Post } from './types';

async function getQRCode() {
  const mod = await import('qrcode');
  return (mod as any).default || mod;
}

async function getJsQR() {
  const mod = await import('jsqr');
  return (mod as any).default || mod;
}

export interface QrPostPayload {
  _t: 'tossa';
  v: 1;
  id: string;
  title: string;
  area: string;
  addr?: string | null;
  lat?: number | null;
  lng?: number | null;
  status: string;
  label: string;
  note?: string | null;
  url?: string | null;
  src?: string | null;
  tags?: string[];
  cat?: string;
  catName?: string;
  catIcon?: string;
  catColor?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Compacts a Post into a lightweight payload suitable for high-density QR encoding.
 */
export function serializePostToPayload(post: Post): QrPostPayload {
  let tagsArray: string[] | undefined;
  if (post.tags) {
    try {
      const parsed = JSON.parse(post.tags);
      if (Array.isArray(parsed) && parsed.length > 0) {
        tagsArray = parsed;
      }
    } catch {
      // Ignore parse failure
    }
  }

  return {
    _t: 'tossa',
    v: 1,
    id: post.id,
    title: post.title,
    area: post.area,
    addr: post.address || undefined,
    lat: post.lat ?? undefined,
    lng: post.lng ?? undefined,
    status: post.current_status,
    label: post.status_label,
    note: post.note || undefined,
    url: post.url || undefined,
    src: post.source_url || undefined,
    tags: tagsArray,
    cat: post.category_id,
    catName: post.category_name,
    catIcon: post.category_icon,
    catColor: post.category_color,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
  };
}

/**
 * Reconstructs a full Post object from a deserialized QR payload.
 */
export function parsePostFromPayload(payload: any): Post | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  // Validate tossa format identifier and required fields
  if (payload._t !== 'tossa' && !payload.title && !payload.id) {
    return null;
  }

  const id = String(payload.id || `peer_${Date.now()}`);
  const title = String(payload.title || '').trim();
  const area = String(payload.area || '').trim();
  const currentStatus = String(payload.status || 'open');
  const statusLabel = String(payload.label || '情報');

  if (!title) {
    return null;
  }

  const createdAt = payload.createdAt || new Date().toISOString();
  const updatedAt = payload.updatedAt || createdAt;

  let tagsString: string | undefined;
  if (Array.isArray(payload.tags) && payload.tags.length > 0) {
    tagsString = JSON.stringify(payload.tags);
  }

  return {
    id,
    category_id: payload.cat || 'general',
    category_name: payload.catName || '一般',
    category_icon: payload.catIcon || '📢',
    category_color: payload.catColor || '#64748b',
    title,
    area: area || '広域',
    address: payload.addr || null,
    lat: typeof payload.lat === 'number' ? payload.lat : null,
    lng: typeof payload.lng === 'number' ? payload.lng : null,
    current_status: currentStatus,
    status_label: statusLabel,
    note: payload.note || null,
    url: payload.url || null,
    source_url: payload.src || null,
    tags: tagsString,
    attributes: '{}',
    is_verified: 0,
    is_peer: true,
    reporter_name: 'Peer Relay (QR)',
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

/**
 * Encodes a post into a shareable offline URL containing the payload in the hash fragment.
 */
export function encodePostToQrUrl(post: Post, origin?: string): string {
  const payload = serializePostToPayload(post);
  const json = JSON.stringify(payload);
  const base =
    origin ||
    (typeof window !== 'undefined'
      ? window.location.origin
      : 'https://tossa.app');
  return `${base}/#post-data=${encodeURIComponent(json)}`;
}

/**
 * Decodes a Post from a QR code string.
 * Supports URL hashes (#post-data=...), query strings (?post-data=...), and raw JSON payloads.
 */
export function decodePostFromQrString(qrString: string): Post | null {
  if (!qrString || typeof qrString !== 'string') {
    return null;
  }

  const trimmed = qrString.trim();

  // 1. Try URL with hash or query containing post-data or qr-import
  const match = trimmed.match(/[#?](?:post-data|qr-import)=([^&]+)/);
  if (match && match[1]) {
    try {
      const decodedJson = decodeURIComponent(match[1]);
      const obj = JSON.parse(decodedJson);
      return parsePostFromPayload(obj);
    } catch {
      // Continue to next attempts
    }
  }

  // 2. Try parsing raw JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      return parsePostFromPayload(obj);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Generates an SVG string representation of a QR code.
 */
export async function generateQrSvg(
  text: string,
  options: { margin?: number; width?: number } = {}
): Promise<string> {
  const QRCode = await getQRCode();
  return await QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: options.margin ?? 2,
    width: options.width ?? 280,
  });
}

/**
 * Generates a PNG Data URL representation of a QR code.
 */
export async function generateQrDataUrl(
  text: string,
  options: { margin?: number; width?: number } = {}
): Promise<string> {
  const QRCode = await getQRCode();
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: options.margin ?? 2,
    width: options.width ?? 280,
  });
}

/**
 * Decodes a QR code from raw pixel ImageData (RGBA).
 * Uses native BarcodeDetector if available in the runtime, otherwise falls back to pure-JS jsQR.
 */
export async function decodeQrFromImageData(imageData: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): Promise<string | null> {
  // 1. Attempt hardware-accelerated BarcodeDetector if available in browser
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const detector = new (window as any).BarcodeDetector({
        formats: ['qr_code'],
      });
      // BarcodeDetector accepts ImageData in supporting browsers
      const nativeImageData = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      );

      const barcodes = await detector.detect(nativeImageData);
      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
        return barcodes[0].rawValue;
      }
    } catch {
      // Fallback to jsQR on any error
    }
  }

  // 2. Pure JS fallback with jsQR (compatible across all browsers and node/test runners)
  try {
    const jsQR = await getJsQR();
    const result = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });
    if (result && result.data) {
      return result.data;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Synthesizes a subtle high-pitch notification beep using Web Audio API.
 */
export function playScanSuccessBeep(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.07); // E6
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    // Audio may be blocked or restricted by browser policy
  }
}

/**
 * Triggers a short vibration pattern on supported mobile devices.
 */
export function vibrateSuccess(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([40, 40, 40]);
    } catch {
      // Ignore vibration errors
    }
  }
}
