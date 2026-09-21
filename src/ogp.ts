// src/ogp.ts: Dynamic SVG OGP Image Generator for SNS & messaging previews
import QRCode from 'qrcode';

export interface OgpPostData {
  id: string;
  title: string;
  area: string;
  address?: string | null;
  current_status: string;
  status_label?: string | null;
  updated_at: string;
  note?: string | null;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/**
 * Renders a high-resolution 1200x630 vector SVG banner with status badge and embedded QR code.
 */
export async function renderOgpSvg(
  post: OgpPostData,
  origin: string
): Promise<string> {
  const postUrl = `${origin}/posts/${post.id}`;

  // Generate QR code SVG (without outer XML declaration)
  let qrSvgContent: string;
  try {
    const rawQr = await QRCode.toString(postUrl, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
    qrSvgContent = rawQr
      .replace(/<\?xml.*?\?>/i, '')
      .replace(/<!DOCTYPE.*?>/i, '');
  } catch {
    qrSvgContent = '';
  }

  // Format status badge color and text
  let statusBg: string;
  let statusText: string;
  let statusIcon: string;

  switch (post.current_status) {
    case 'available':
    case 'open':
      statusBg = '#059669';
      statusText = post.status_label || '受付中 / 利用可能';
      statusIcon = '●';
      break;
    case 'crowded':
    case 'few':
    case 'low_stock':
      statusBg = '#d97706'; // amber-600
      statusText = post.status_label || '混雑中 / 残りわずか';
      statusIcon = '▲';
      break;
    case 'closed':
    case 'danger':
    case 'out_of_stock':
      statusBg = '#dc2626'; // red-600
      statusText = post.status_label || '終了 / 休止中';
      statusIcon = '✕';
      break;
    default:
      statusBg = '#2563eb'; // blue-600
      statusText = post.status_label || '確認中';
      statusIcon = '？';
      break;
  }

  const truncatedTitle =
    post.title.length > 28 ? post.title.slice(0, 27) + '…' : post.title;
  const safeTitle = escapeXml(truncatedTitle);
  const safeArea = escapeXml(post.area || '地域');
  const safeAddress = escapeXml(post.address || '');
  const safeStatus = escapeXml(statusText);
  const safeUpdatedAt = escapeXml(
    post.updated_at ? post.updated_at.replace('T', ' ').slice(0, 16) : ''
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/>
      <stop offset="50%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Subtle glow accent circles -->
  <circle cx="150" cy="100" r="300" fill="#2563eb" opacity="0.12" filter="blur(80px)"/>
  <circle cx="1050" cy="500" r="280" fill="#06b6d4" opacity="0.1" filter="blur(70px)"/>

  <!-- Main Container Card -->
  <rect x="50" y="45" width="1100" height="540" rx="28" fill="url(#cardGrad)" stroke="#334155" stroke-width="1.5" filter="url(#shadow)"/>

  <!-- Header Branding -->
  <g transform="translate(90, 95)">
    <!-- App Logo / Badge -->
    <rect width="40" height="40" rx="10" fill="#2563eb"/>
    <text x="20" y="27" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900" fill="#ffffff" text-anchor="middle">t</text>
    <text x="52" y="27" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900" fill="#ffffff" letter-spacing="-0.5">tossa</text>
    <text x="126" y="27" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="600" fill="#94a3b8">地域の生活情報・防災速報</text>

    <!-- Area Badge -->
    <rect x="680" y="4" width="240" height="32" rx="16" fill="#1e293b" stroke="#475569" stroke-width="1"/>
    <text x="800" y="25" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="700" fill="#38bdf8" text-anchor="middle">📍 ${safeArea}</text>
  </g>

  <!-- Main Content Area -->
  <g transform="translate(90, 190)">
    <!-- Status Pill Badge -->
    <rect width="320" height="46" rx="23" fill="${statusBg}"/>
    <text x="20" y="30" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="900" fill="#ffffff">${statusIcon}</text>
    <text x="44" y="30" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="800" fill="#ffffff">${safeStatus}</text>

    <!-- Facility Title -->
    <text x="0" y="115" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="900" fill="#ffffff" letter-spacing="-0.5">
      ${safeTitle}
    </text>

    <!-- Address / Location -->
    ${
      safeAddress
        ? `
    <text x="0" y="165" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="500" fill="#cbd5e1">
      ${safeAddress.length > 34 ? safeAddress.slice(0, 33) + '…' : safeAddress}
    </text>
    `
        : ''
    }

    <!-- Timestamp -->
    <text x="0" y="280" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="600" fill="#64748b">
      最終確認: ${safeUpdatedAt}
    </text>
  </g>

  <!-- Right Side: QR Code Container -->
  <g transform="translate(860, 200)">
    <rect width="210" height="250" rx="20" fill="#ffffff" filter="url(#shadow)"/>
    <g transform="translate(15, 15) scale(0.68)">
      ${qrSvgContent}
    </g>
    <text x="105" y="218" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="800" fill="#0f172a" text-anchor="middle">
      スマホで現地の
    </text>
    <text x="105" y="236" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="800" fill="#2563eb" text-anchor="middle">
      最新状況を確認・報告
    </text>
  </g>

  <!-- Bottom Notice -->
  <text x="600" y="550" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="500" fill="#475569" text-anchor="middle">
    tossa は電波途絶時もオフライン動作する超軽量・地域生活情報システムです
  </text>
</svg>`;
}
