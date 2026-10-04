const mode = process.env.SMOKE_FIXTURE_MODE;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  process.stderr.write(
    `FIXTURE_REQUEST ${method} ${url.pathname}${url.search}\n`
  );
  const authorization = new Headers(init.headers).get('Authorization');

  if (url.pathname === '/api/auth/me' && method === 'GET') {
    const primary = authorization === 'Bearer synthetic-primary-token';
    return Response.json({
      success: true,
      authenticated: true,
      user: {
        id: primary ? 'synthetic-admin-1' : 'synthetic-admin-2',
        role: 'admin',
      },
    });
  }
  if (
    url.pathname === '/api/posts/reports/moderation' &&
    url.searchParams.get('offset') === '0' &&
    method === 'GET'
  ) {
    return Response.json({ success: true, reports: [], total: 0 });
  }
  if (url.pathname === '/api/settings/backups' && method === 'GET') {
    const now = Date.now();
    return Response.json({
      success: true,
      checkedAt:
        mode === 'unknown-backup-time'
          ? 'not-a-timestamp'
          : new Date(now).toISOString(),
      backups: [
        {
          key: 'backups/tossa_backup_2026-10-05T03-00-00-000Z.json',
          size: 512,
          uploaded: new Date(now - 60 * 60 * 1000).toISOString(),
          // Old archive fixture intentionally has no snapshotAt.
        },
      ],
      notifications: {
        emailConfigured: true,
        adminEmailRecipients: 1,
        webhookConfigured: false,
      },
    });
  }
  return Response.json({ success: false }, { status: 404 });
};
