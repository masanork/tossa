// test/images.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { persistImageToR2 } from '../src/routes/images';
import { DEVICE_COOKIE } from '../src/middleware/deviceCookie';

function createMockR2() {
  const store = new Map<string, { body: Uint8Array; contentType: string }>();

  const bucket: any = {
    put: vi.fn(async (key: string, body: Uint8Array, options?: any) => {
      store.set(key, {
        body,
        contentType:
          options?.httpMetadata?.contentType || 'application/octet-stream',
      });
      return { key };
    }),
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        body: item.body,
        httpMetadata: {
          contentType: item.contentType,
        },
        httpEtag: 'mock-etag-123',
        writeHttpMetadata: (headers: Headers) => {
          headers.set('Content-Type', item.contentType);
        },
      };
    }),
    _store: store,
  };

  return bucket;
}

describe('R2 Images API and Storage', () => {
  it('falls back gracefully when R2 is not configured', async () => {
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = await persistImageToR2(undefined, dataUrl);
    expect(result).toBe(dataUrl);
  });

  it('keeps normal URLs unchanged', async () => {
    const bucket = createMockR2();
    const normalUrl = 'https://example.com/photo.jpg';
    const result = await persistImageToR2(bucket, normalUrl);
    expect(result).toBe(normalUrl);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('persists base64 data URL to R2 and returns relative image path', async () => {
    const bucket = createMockR2();
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const imagePath = await persistImageToR2(bucket, dataUrl);
    expect(imagePath).toMatch(/^\/api\/images\/img_[0-9a-zA-Z_]+\.png$/);
    expect(bucket.put).toHaveBeenCalledTimes(1);

    const key = imagePath!.replace('/api/images/', '');
    expect(bucket._store.has(key)).toBe(true);
    const stored = bucket._store.get(key);
    expect(stored.contentType).toBe('image/png');
    expect(stored.body.length).toBeGreaterThan(0);
  });

  it('serves image with 1-year immutable cache header', async () => {
    const { app, db } = createTestContext();
    const bucket = createMockR2();
    const dataUrl =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

    const imagePath = await persistImageToR2(bucket, dataUrl);
    const key = imagePath!.replace('/api/images/', '');

    const envWithR2: any = {
      DB: db,
      IMAGES_BUCKET: bucket,
      JWT_SECRET: 'test',
    };

    const res = await app.request(
      `/api/images/${key}`,
      { method: 'GET' },
      envWithR2
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('Cache-Control')).toContain('max-age=31536000');
  });

  it('returns 404 for non-existent image or when R2 is unconfigured', async () => {
    const { app, db } = createTestContext();
    const envWithoutR2: any = { DB: db };
    const resWithoutR2 = await app.request(
      '/api/images/nonexistent.png',
      { method: 'GET' },
      envWithoutR2
    );
    expect(resWithoutR2.status).toBe(404);

    const bucket = createMockR2();
    const envWithR2: any = { DB: db, IMAGES_BUCKET: bucket };
    const resWithR2 = await app.request(
      '/api/images/nonexistent.png',
      { method: 'GET' },
      envWithR2
    );
    expect(resWithR2.status).toBe(404);
  });

  it('integrates R2 image persistence seamlessly into POST /api/posts', async () => {
    const { app, db } = createTestContext();
    const bucket = createMockR2();
    const envWithR2: any = {
      DB: db,
      IMAGES_BUCKET: bucket,
      JWT_SECRET: 'test',
    };

    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const res = await app.request(
      '/api/posts',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${DEVICE_COOKIE}=device_r2_uploader_123`,
        },
        body: JSON.stringify({
          title: '給水所写真付き',
          area: '中央区',
          currentStatus: 'available',
          statusLabel: '利用可能',
          imageUrl: dataUrl,
        }),
      },
      envWithR2
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify stored post in D1 points to R2 path instead of heavy base64 Data URL
    const post = await db
      .prepare('SELECT image_url FROM posts WHERE id = ?')
      .bind(body.id)
      .first<{ image_url: string }>();

    expect(post!.image_url).toMatch(
      /^\/api\/images\/img_post_[0-9a-zA-Z_]+\.png$/
    );
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });
});
