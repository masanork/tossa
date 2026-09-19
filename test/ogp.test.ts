// test/ogp.test.ts: Tests for dynamic vector OGP banner SVG generation
import { describe, it, expect } from 'vitest';
import { renderOgpSvg } from '../src/ogp';

describe('OGP SVG Generator', () => {
  it('should render a valid SVG banner with title, area, and status', async () => {
    const svg = await renderOgpSvg(
      {
        id: 'test-123',
        title: '中央避難所（熊本市中央区役所）',
        area: '熊本市中央区',
        status_label: '開設中',
        current_status: 'available',
        address: '熊本市中央区手取本町1-1',
        updated_at: '2026-09-19T12:00:00Z',
      },
      'https://tossa.example.com'
    );

    expect(svg).toBeDefined();
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 1200 630"');
    expect(svg).toContain('中央避難所（熊本市中央区役所）');
    expect(svg).toContain('熊本市中央区');
    expect(svg).toContain('開設中');
    expect(svg).toContain('熊本市中央区手取本町1-1');
    expect(svg).toContain('tossa');
    // Check that QR code SVG is embedded
    expect(svg).toContain('<path');
  });

  it('should correctly escape special XML characters in text', async () => {
    const svg = await renderOgpSvg(
      {
        id: 'escape-test',
        title: '避難所 <テスト> & "特別" \'避難所\'',
        area: '港区 <A>',
        status_label: '混雑 & 順番待ち',
        current_status: 'crowded',
        updated_at: '2026-09-19T12:00:00Z',
      },
      'https://tossa.example.com'
    );

    expect(svg).toContain('&lt;テスト&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;特別&quot;');
    expect(svg).toContain('&apos;避難所&apos;');
    expect(svg).not.toContain('<テスト>');
  });

  it('should apply correct color accents based on status', async () => {
    const dangerSvg = await renderOgpSvg(
      {
        id: 'danger-test',
        title: '危険箇所',
        area: '地区',
        status_label: '閉鎖',
        current_status: 'danger',
        updated_at: '2026-09-19T12:00:00Z',
      },
      'https://tossa.example.com'
    );
    // Red color for danger/closed
    expect(dangerSvg).toContain('#dc2626');

    const availableSvg = await renderOgpSvg(
      {
        id: 'avail-test',
        title: '避難所',
        area: '地区',
        status_label: '開設中',
        current_status: 'available',
        updated_at: '2026-09-19T12:00:00Z',
      },
      'https://tossa.example.com'
    );
    // Emerald color for available
    expect(availableSvg).toContain('#059669');

    const crowdedSvg = await renderOgpSvg(
      {
        id: 'crowded-test',
        title: '避難所',
        area: '地区',
        status_label: '混雑中',
        current_status: 'crowded',
        updated_at: '2026-09-19T12:00:00Z',
      },
      'https://tossa.example.com'
    );
    // Amber color for crowded
    expect(crowdedSvg).toContain('#d97706');
  });
});
