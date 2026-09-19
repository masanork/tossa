// src/services/writeBuffer.ts: Asynchronous write buffer and write-smoothing queue
import type { Bindings, WriteQueueMessage } from '../types';
import { createPost, updatePostStatus } from '../db/queries';
import { logAccess } from '../middleware/deviceCookie';
import { broadcastPushNotification } from './push';
import { refreshPublicFeedSnapshot } from './feedSnapshot';

/**
 * Attempts to enqueue a post creation task to Cloudflare Queues for smoothing high-traffic write spikes.
 * Returns true if enqueued into WRITE_QUEUE, false if WRITE_QUEUE is not available (caller should fall back to sync write).
 */
export async function enqueuePostCreation(
  env: Bindings,
  message: Extract<WriteQueueMessage, { type: 'create_post' }>
): Promise<boolean> {
  if (!env.WRITE_QUEUE || env.DISABLE_WRITE_BUFFER === 'true') {
    return false;
  }

  try {
    await env.WRITE_QUEUE.send(message);
    return true;
  } catch (err) {
    console.warn(
      '[writeBuffer] Failed to enqueue create_post, falling back to sync write:',
      err
    );
    return false;
  }
}

/**
 * Attempts to enqueue a status update task to Cloudflare Queues.
 * Returns true if enqueued into WRITE_QUEUE, false if WRITE_QUEUE is not available.
 */
export async function enqueueStatusUpdate(
  env: Bindings,
  message: Extract<WriteQueueMessage, { type: 'update_status' }>
): Promise<boolean> {
  if (!env.WRITE_QUEUE || env.DISABLE_WRITE_BUFFER === 'true') {
    return false;
  }

  try {
    await env.WRITE_QUEUE.send(message);
    return true;
  } catch (err) {
    console.warn(
      '[writeBuffer] Failed to enqueue update_status, falling back to sync write:',
      err
    );
    return false;
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
  for (const message of batch.messages) {
    try {
      const msg = message.body;

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
        await createPost(env.DB, {
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
        });

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
          broadcastPushNotification(env, msg.pushBroadcast).catch((err) =>
            console.error('[writeBuffer] Async push broadcast error:', err)
          );
        }
      } else if (msg.type === 'update_status') {
        wrote = true;
        await updatePostStatus(
          env.DB,
          msg.postId,
          msg.status,
          msg.statusLabel,
          msg.note,
          msg.ipHash
        );

        if (msg.pushBroadcast) {
          broadcastPushNotification(env, msg.pushBroadcast).catch((err) =>
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
      message.retry();
    }
  }

  if (wrote) {
    await refreshPublicFeedSnapshot(env).catch((err) =>
      console.error('[writeBuffer] feed snapshot refresh failed:', err)
    );
  }
}
