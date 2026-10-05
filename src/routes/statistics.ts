import { Hono } from 'hono';
import type { Bindings } from '../types';
import { verifyCurrentSession } from '../auth/session';
import {
  StatisticsFeedValidationError,
  validateStatisticsFeed,
  type StatisticsEntityKind,
} from '../services/statisticsFeed';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_MAPPINGS = 100;
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

interface Mapping {
  kind: StatisticsEntityKind;
  externalId: string;
  postId: string;
}

class PreviewRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400
  ) {
    super(message);
  }
}

function object(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function entityKey(kind: string, id: string): string {
  return JSON.stringify([kind, id]);
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get('Content-Length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_REQUEST_BYTES)
    throw new PreviewRequestError('統計データは1MiB以内にしてください。', 413);
  if (!request.body) throw new PreviewRequestError('統計データが必要です。');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        throw new PreviewRequestError(
          '統計データは1MiB以内にしてください。',
          413
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    );
  } catch {
    throw new PreviewRequestError('UTF-8の正しいJSONを指定してください。');
  }
}

function readMappings(input: unknown): Mapping[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_MAPPINGS)
    throw new PreviewRequestError(
      '対象の対応付けは100件以内の配列で指定してください。'
    );
  const seenEntities = new Set<string>();
  const seenPosts = new Set<string>();
  return input.map((entry) => {
    if (
      !object(entry) ||
      Object.keys(entry).some(
        (key) => !['kind', 'externalId', 'postId'].includes(key)
      ) ||
      (entry.kind !== 'event' && entry.kind !== 'shelter') ||
      typeof entry.externalId !== 'string' ||
      !EXTERNAL_ID.test(entry.externalId) ||
      typeof entry.postId !== 'string' ||
      !EXTERNAL_ID.test(entry.postId)
    )
      throw new PreviewRequestError('対象の対応付けの形式が正しくありません。');
    const key = entityKey(entry.kind, entry.externalId);
    if (seenEntities.has(key) || seenPosts.has(entry.postId))
      throw new PreviewRequestError(
        '同じ対象や投稿を重複して対応付けることはできません。'
      );
    seenEntities.add(key);
    seenPosts.add(entry.postId);
    return {
      kind: entry.kind,
      externalId: entry.externalId,
      postId: entry.postId,
    };
  });
}

export const statisticsRoute = new Hono<{ Bindings: Bindings }>();

statisticsRoute.post('/preview', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const token = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const session = await verifyCurrentSession(token, c.env);
  if (!session || session.role !== 'admin')
    return c.json({ success: false, error: 'Forbidden' }, 403);
  if (
    c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    return c.json(
      { success: false, error: 'JSON形式で送信してください。' },
      415
    );

  try {
    const body = await readBoundedJson(c.req.raw);
    if (
      !object(body) ||
      Object.keys(body).some((key) => !['feed', 'mappings'].includes(key))
    )
      throw new PreviewRequestError('統計プレビューの形式が正しくありません。');
    const now = Date.now();
    const feed = validateStatisticsFeed(body.feed, now);
    const mappings = readMappings(body.mappings);
    const entities = new Set(
      feed.records.map((record) =>
        entityKey(record.entity.kind, record.entity.id)
      )
    );
    if (
      mappings.some(
        (mapping) => !entities.has(entityKey(mapping.kind, mapping.externalId))
      )
    )
      throw new PreviewRequestError(
        '統計に含まれない対象が対応付けに指定されています。'
      );

    const posts = new Map<string, { id: string; title: string }>();
    // A bounded, parameterized read. The preview performs no writes or external fetches.
    for (let offset = 0; offset < mappings.length; offset += 50) {
      const chunk = mappings.slice(offset, offset + 50);
      const result = await c.env.DB.prepare(
        `SELECT id, title FROM posts WHERE id IN (${chunk.map(() => '?').join(',')})`
      )
        .bind(...chunk.map((mapping) => mapping.postId))
        .all<{ id: string; title: string }>();
      if (!result.success)
        throw new Error('Statistics preview target lookup failed');
      for (const post of result.results) posts.set(post.id, post);
    }
    if (mappings.some((mapping) => !posts.has(mapping.postId)))
      throw new PreviewRequestError(
        '対応先の投稿が見つかりません。投稿IDを確認してください。'
      );
    const byEntity = new Map(
      mappings.map((mapping) => [
        entityKey(mapping.kind, mapping.externalId),
        posts.get(mapping.postId)!,
      ])
    );
    const unmappedEntityCount = entities.size - byEntity.size;
    return c.json({
      success: true,
      preview: {
        checkedAt: new Date(now).toISOString(),
        generatedAt: feed.generatedAt,
        source: feed.source,
        recordCount: feed.records.length,
        entityCount: entities.size,
        unmappedEntityCount,
        records: feed.records.map((record) => ({
          ...record,
          targetPost:
            byEntity.get(entityKey(record.entity.kind, record.entity.id)) ??
            null,
        })),
        warnings:
          unmappedEntityCount > 0
            ? [
                '対応先が未指定の対象があります。公開前に対象を確認してください。',
              ]
            : [],
      },
    });
  } catch (error) {
    if (error instanceof PreviewRequestError)
      return c.json({ success: false, error: error.message }, error.status);
    if (error instanceof StatisticsFeedValidationError)
      return c.json({ success: false, error: error.message }, 400);
    throw error;
  }
});
