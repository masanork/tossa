// src/routes/images.ts: Cloudflare R2 Image Storage & High-Performance CDN Delivery
import { Hono } from 'hono';
import type { Bindings } from '../types';

export const imagesRoute = new Hono<{ Bindings: Bindings }>();

/**
 * Parses a Data URL (e.g. data:image/webp;base64,...) and saves it to R2.
 * Returns the public image URL pathname, or null if storage failed or bucket not bound.
 */
export async function persistImageToR2(
  bucket: R2Bucket | undefined,
  dataUrl: string | null | undefined,
  postIdPrefix: string = ''
): Promise<string | null> {
  if (!bucket || !dataUrl || !dataUrl.startsWith('data:')) {
    return dataUrl || null;
  }

  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match || !match[1] || !match[2]) return dataUrl;

    const mimeType = match[1] || 'image/webp';
    const base64Data = match[2];

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    let ext = mimeType.split('/')[1] || 'webp';
    if (ext === 'jpeg') ext = 'jpg';
    const prefixPart = postIdPrefix ? `${postIdPrefix}_` : '';
    const key = `img_${prefixPart}${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;

    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    return `/api/images/${key}`;
  } catch (err) {
    console.error('[r2] persistImageToR2 error:', err);
    // Fall back to original dataUrl if R2 write fails
    return dataUrl;
  }
}

// GET /api/images/:key - Serve cached images from R2
imagesRoute.get('/:key', async (c) => {
  const bucket = c.env.IMAGES_BUCKET;
  if (!bucket) {
    return c.text('R2 image storage not configured in this environment.', 404);
  }

  const key = c.req.param('key');
  const object = await bucket.get(key);

  if (!object) {
    return c.text('Image not found', 404);
  }

  const headers = new Headers();
  if (typeof (object as any).writeHttpMetadata === 'function') {
    (object as any).writeHttpMetadata(headers);
  } else if (object.httpMetadata?.contentType) {
    headers.set('content-type', object.httpMetadata.contentType);
  }
  if (object.httpEtag) {
    headers.set('etag', object.httpEtag);
  }
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body as any, {
    headers,
  });
});
