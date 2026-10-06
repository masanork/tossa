// Isolated synthetic-load entrypoint. Never deploy this as the production Worker.
import worker from '../src/index';
import { processWriteQueueBatch } from '../src/services/writeBuffer';
import {
  requestPublicFeedRefresh,
  readPublicFeedSnapshot,
} from '../src/services/feedSnapshot';
import type { Bindings, WriteQueueMessage } from '../src/types';

type LoadEnv = Bindings & {
  LOAD_TOKEN: string;
  LOAD_EXPIRES_AT: string;
  LOAD_MARKER: string;
};
async function authorized(request: Request, env: LoadEnv) {
  const expiry = Number(env.LOAD_EXPIRES_AT);
  if (
    !env.LOAD_TOKEN ||
    !env.LOAD_MARKER?.startsWith('tossa-load-') ||
    !Number.isFinite(expiry) ||
    Date.now() > expiry
  )
    return false;
  const encoder = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest(
      'SHA-256',
      encoder.encode(request.headers.get('Authorization') || '')
    ),
    crypto.subtle.digest('SHA-256', encoder.encode('Bearer ' + env.LOAD_TOKEN)),
  ]);
  return crypto.subtle.timingSafeEqual(provided, expected);
}
export default {
  async fetch(
    request: Request,
    env: LoadEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (!(await authorized(request, env)))
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    const path = new URL(request.url).pathname;
    if (path === '/__load/refresh' && request.method === 'POST') {
      return Response.json(
        await requestPublicFeedRefresh(env, { force: true, strict: true }),
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (path === '/__load/state' && request.method === 'GET') {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN id NOT GLOB 'fixture_*' THEN 1 ELSE 0 END) AS writes FROM posts"
      ).first();
      const snapshot = await readPublicFeedSnapshot(env);
      return Response.json(
        {
          marker: env.LOAD_MARKER,
          counts: row,
          snapshot: snapshot
            ? { total: snapshot.total, generatedAt: snapshot.generatedAt }
            : null,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (!path.startsWith('/api/posts') && path !== '/api/health')
      return new Response('Not found', { status: 404 });
    const forwarded = new Request(request);
    forwarded.headers.delete('Authorization');
    // Rate limit requests are measured with normal anonymous device cookies.
    return worker.fetch(forwarded, env, ctx);
  },
  async queue(batch: MessageBatch<WriteQueueMessage>, env: LoadEnv) {
    await processWriteQueueBatch(batch, env);
  },
} satisfies ExportedHandler<LoadEnv>;
