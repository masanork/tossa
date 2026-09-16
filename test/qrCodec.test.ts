import { describe, it, expect } from 'vitest';

import {
  serializePostToPayload,
  parsePostFromPayload,
  encodePostToQrUrl,
  decodePostFromQrString,
  generateQrSvg,
  generateQrDataUrl,
  decodeQrFromImageData,
  playScanSuccessBeep,
  vibrateSuccess,
} from '../web/src/lib/qrCodec';
import type { Post } from '../web/src/lib/types';

const mockPost: Post = {
  id: 'post-1234-uuid',
  category_id: 'evac',
  category_name: '避難所',
  category_icon: '🏕️',
  category_color: '#10b981',
  title: '第一市民センター 避難所開設',
  area: '中央区',
  address: '中央区本町1-2-3',
  lat: 35.6812,
  lng: 139.7671,
  current_status: 'open',
  status_label: '開設・受入中',
  note: '体育館にて毛布と飲料水の配布を行っています。',
  url: 'https://example.com/info',
  source_url: 'https://city.example.lg.jp/evac',
  tags: JSON.stringify(['避難所', '給水', '毛布']),
  attributes: '{"capacity": 300}',
  is_verified: 1,
  reporter_name: '自治会担当者',
  created_at: '2026-09-16T10:00:00.000Z',
  updated_at: '2026-09-16T11:00:00.000Z',
};

describe('qrCodec', () => {
  describe('serializePostToPayload & parsePostFromPayload', () => {
    it('compacts post into lightweight QR payload', () => {
      const payload = serializePostToPayload(mockPost);
      expect(payload._t).toBe('tossa');
      expect(payload.v).toBe(1);
      expect(payload.id).toBe('post-1234-uuid');
      expect(payload.title).toBe('第一市民センター 避難所開設');
      expect(payload.area).toBe('中央区');
      expect(payload.addr).toBe('中央区本町1-2-3');
      expect(payload.lat).toBe(35.6812);
      expect(payload.lng).toBe(139.7671);
      expect(payload.status).toBe('open');
      expect(payload.label).toBe('開設・受入中');
      expect(payload.tags).toEqual(['避難所', '給水', '毛布']);
      expect(payload.cat).toBe('evac');
    });

    it('round-trips full post through payload parsing', () => {
      const payload = serializePostToPayload(mockPost);
      const restored = parsePostFromPayload(payload);
      expect(restored).not.toBeNull();
      expect(restored?.id).toBe(mockPost.id);
      expect(restored?.title).toBe(mockPost.title);
      expect(restored?.area).toBe(mockPost.area);
      expect(restored?.lat).toBe(mockPost.lat);
      expect(restored?.lng).toBe(mockPost.lng);
      expect(restored?.current_status).toBe(mockPost.current_status);
      expect(restored?.status_label).toBe(mockPost.status_label);
      expect(restored?.note).toBe(mockPost.note);
      expect(restored?.source_url).toBe(mockPost.source_url);
      expect(restored?.tags).toBe(mockPost.tags);
    });

    it('rejects invalid or empty payloads gracefully', () => {
      expect(parsePostFromPayload(null)).toBeNull();
      expect(parsePostFromPayload(undefined)).toBeNull();
      expect(parsePostFromPayload('not-an-object')).toBeNull();
      expect(parsePostFromPayload({ random: 'data' })).toBeNull();
      expect(parsePostFromPayload({ _t: 'other', title: '' })).toBeNull();
    });

    it('provides sensible fallbacks for missing non-essential fields', () => {
      const minimalPayload = {
        _t: 'tossa',
        v: 1,
        id: 'min-1',
        title: '給水車到着',
        area: '東町',
        status: 'open',
        label: '給水中',
      };
      const post = parsePostFromPayload(minimalPayload);
      expect(post).not.toBeNull();
      expect(post?.title).toBe('給水車到着');
      expect(post?.lat).toBeNull();
      expect(post?.lng).toBeNull();
      expect(post?.note).toBeNull();
      expect(post?.reporter_name).toContain('Peer Relay');
    });
  });

  describe('encodePostToQrUrl & decodePostFromQrString', () => {
    it('encodes post into an offline URL with hash data', () => {
      const url = encodePostToQrUrl(mockPost, 'https://test.tossa.app');
      expect(url).toContain('https://test.tossa.app/#post-data=');

      const decoded = decodePostFromQrString(url);
      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe(mockPost.id);
      expect(decoded?.title).toBe(mockPost.title);
      expect(decoded?.lat).toBe(mockPost.lat);
    });

    it('decodes hash fragment directly without full URL origin', () => {
      const url = encodePostToQrUrl(mockPost, '');
      const hashPart = url.substring(url.indexOf('#'));
      const decoded = decodePostFromQrString(hashPart);
      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe(mockPost.id);
    });

    it('decodes raw JSON string directly', () => {
      const payload = serializePostToPayload(mockPost);
      const jsonStr = JSON.stringify(payload);
      const decoded = decodePostFromQrString(jsonStr);
      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe(mockPost.id);
      expect(decoded?.title).toBe(mockPost.title);
    });

    it('returns null for corrupted or non-tossa URLs', () => {
      expect(decodePostFromQrString('https://example.com/other')).toBeNull();
      expect(
        decodePostFromQrString('#post-data=invalid-json-content')
      ).toBeNull();
      expect(decodePostFromQrString('')).toBeNull();
    });
  });

  describe('generateQrSvg & generateQrDataUrl', () => {
    it('generates valid SVG markup string', async () => {
      const svg = await generateQrSvg('https://tossa.app/test', {
        width: 250,
        margin: 2,
      });
      expect(typeof svg).toBe('string');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('viewBox');
    });

    it('generates PNG Data URL string', async () => {
      const dataUrl = await generateQrDataUrl('https://tossa.app/test', {
        width: 250,
      });
      expect(typeof dataUrl).toBe('string');
      expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  describe('decodeQrFromImageData', () => {
    it('returns null when given blank/empty image buffer', async () => {
      // 50x50 empty RGBA buffer
      const width = 50;
      const height = 50;
      const data = new Uint8ClampedArray(width * height * 4);
      const decoded = await decodeQrFromImageData({ data, width, height });
      expect(decoded).toBeNull();
    });
  });

  describe('haptic & audio feedback', () => {
    it('does not throw when playScanSuccessBeep is called', () => {
      expect(() => playScanSuccessBeep()).not.toThrow();
    });

    it('does not throw when vibrateSuccess is called', () => {
      expect(() => vibrateSuccess()).not.toThrow();
    });
  });
});
