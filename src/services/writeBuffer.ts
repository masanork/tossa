// src/services/writeBuffer.ts: Asynchronous write buffer and write-smoothing queue
import type { Bindings, WriteQueueMessage } from '../types';
import { createPost, updatePostStatus } from '../db/queries';
import { logAccess } from '../middleware/deviceCookie';
import { broadcastPushNotification } from './push';
import { refreshPublicFeedSnapshot } from './feedSnapshot';
import { sendErrorAlert } from './alert';

export type WriteQueueEnqueueResult = 'queued' | 'sync' | 'unavailable';

/**
 * Attempts to enqueue a post creation task to Cloudflare Queues for smoothing high-traffic write spikes.
 * A configured queue rejection must not fall back to synchronous D1 writes:
 * doing so removes the smoothing protection exactly when the queue is unhealthy.
 */
export async function enqueuePostCreation(
  env: Bindings,
  message: Extract<WriteQueueMessage, { type: 'create_post' }>
): Promise<WriteQueueEnqueueResult> {
  if (!env.WRITE_QUEUE || env.DISABLE_WRITE_BUFFER === 'true') {
    return 'sync';
  }

  try {
    await env.WRITE_QUEUE.send(message);
    return 'queued';
  } catch (err) {
    console.warn(
      '[writeBuffer] Failed to enqueue create_post; refusing synchronous D1 fallback:',
      err
    );
    return 'unavailable';
  }
}

/**
 * Attempts to enqueue a status update task to Cloudflare Queues.
 * Returns `unavailable` on a configured queue failure so callers can preserve
 * the request for retry without sending an unbuffered D1 write.
 */
export async function enqueueStatusUpdate(
  env: Bindings,
  message: Extract<WriteQueueMessage, { type: 'update_status' }>
): Promise<WriteQueueEnqueueResult> {
  if (!env.WRITE_QUEUE || env.DISABLE_WRITE_BUFFER === 'true') {
    return 'sync';
  }

  try {
    await env.WRITE_QUEUE.send(message);
    return 'queued';
  } catch (err) {
    console.warn(
      '[writeBuffer] Failed to enqueue update_status; refusing synchronous D1 fallback:',
      err
    );
    return 'unavailable';
  }
}

/**
 * Cloudflare Queues Consumer batch processor.
 * Drains buffered write operations to D1 safely in sequence or batches, preventing SQLite lock timeouts.
 */
export async function processWriteQueueBatch(
  batch: MessageBatch<WriteQueueMessage>,
  env: Bindings
): Promise<void> {
  let wrote = false;
  let failedMessages = 0;
  const feedMessages: Message<WriteQueueMessage>[] = [];
  let forceFeed = false;
  for (const message of batch.messages) {
    try {
      const msg = message.body;

      if (msg.type === 'refresh_public_feed') {
        feedMessages.push(message);
        forceFeed ||= msg.force;
        continue;
      }

      if (msg.type === 'create_post') {
        let imageMetaObj: Record<string, unknown> | undefined;
        if (msg.post.imageMeta) {
          try {
            imageMetaObj = JSON.parse(msg.post.imageMeta);
          } catch {
            // Ignore parse failure
          }
        }

        let attrObj: Record<string, unknown> | undefined;
        if (msg.post.attributes) {
          try {
            attrObj = JSON.parse(msg.post.attributes);
          } catch {
            // Ignore parse failure
          }
        }

        wrote = true;
        const created = await createPost(env.DB, {
          id: msg.post.id,
          authorId: msg.post.authorId,
          authorCookieId: msg.post.authorCookieId,
          categoryId: msg.post.categoryId,
          title: msg.post.title,
          area: msg.post.area,
          address: msg.post.address ?? undefined,
          lat: msg.post.lat ?? undefined,
          lng: msg.post.lng ?? undefined,
          currentStatus: msg.post.currentStatus,
          statusLabel: msg.post.statusLabel,
          note: msg.post.note ?? undefined,
          url: msg.post.url ?? undefined,
          sourceUrl: msg.post.sourceUrl ?? undefined,
          imageUrl: msg.post.imageUrl ?? undefined,
          imageMeta: imageMetaObj,
          attributes: attrObj,
          tags: msg.post.tags,
          isVerified: msg.post.isVerified,
          reporterName: msg.post.reporterName,
          operation: msg.post.operation,
          observedAt: msg.post.observedAt,
        });

        if (!created) {
          message.ack();
          continue;
        }

        if (msg.accessLog) {
          await logAccess(
            env.DB,
            'post_created',
            msg.accessLog.deviceId || null,
            msg.accessLog.userId || null,
            msg.accessLog.ip || '',
            msg.accessLog.ua || '',
            { postId: msg.post.id }
          );
        }

        if (msg.pushBroadcast) {
          await broadcastPushNotification(env, msg.pushBroadcast).catch((err) =>
            console.error('[writeBuffer] Async push broadcast error:', err)
          );
        }
      } else if (msg.type === 'update_status') {
        wrote = true;
        const result = await updatePostStatus(
          env.DB,
          msg.postId,
          msg.status,
          msg.statusLabel,
          msg.note,
          msg.ipHash,
          {
            operationId: msg.operationId || `queue_${message.id}`,
            payloadHash: msg.payloadHash,
            observedAt: msg.observedAt,
            expectedUpdatedAt: msg.expectedUpdatedAt,
            noteOnly: msg.noteOnly,
          }
        );

        if (result === 'conflict')
          console.warn('[writeBuffer] obsolete status update discarded', {
            postId: msg.postId,
          });
        if (result === 'applied' && msg.pushBroadcast) {
          await broadcastPushNotification(env, msg.pushBroadcast).catch((err) =>
            console.error('[writeBuffer] Async push broadcast error:', err)
          );
        }
      }

      message.ack();
    } catch (error) {
      console.error(
        `[writeBuffer] Error processing write queue message (${message.id}):`,
        error
      );
      failedMessages++;
      message.retry();
    }
  }

  if (wrote || feedMessages.length > 0) {
    try {
      await refreshPublicFeedSnapshot(env, {
        force: forceFeed,
        strict: true,
      });
      if (wrote && !forceFeed && env.WRITE_QUEUE)
        await env.WRITE_QUEUE.send(
          { type: 'refresh_public_feed', force: true },
          { delaySeconds: 3 }
        );
      for (const message of feedMessages) message.ack();
    } catch (err) {
      console.error('[writeBuffer] feed snapshot refresh failed:', err);
      for (const message of feedMessages) message.retry({ delaySeconds: 5 });
      // Mutation messages are already committed and acknowledged. Preserve a
      // separate refresh job when their derived snapshot cannot be published.
      if (wrote && feedMessages.length === 0 && env.WRITE_QUEUE)
        await env.WRITE_QUEUE.send(
          { type: 'refresh_public_feed', force: true },
          { delaySeconds: 5 }
        );
      failedMessages++;
    }
  }
  if (failedMessages > 0) {
    await sendErrorAlert(
      env,
      new Error(`${failedMessages} queued write message(s) failed`),
      {
        source: 'write_queue',
        additionalInfo: { failedMessages },
      }
    );
  }
}
