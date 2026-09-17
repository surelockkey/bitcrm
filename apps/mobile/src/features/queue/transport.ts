import { Directory, File, Paths } from 'expo-file-system';
import { ApiError } from '../../lib/api/errors';
import { allQueuedLocalUris } from '../../lib/queue/db';
import type { OutboxRecord, UploadRecord } from '../../lib/queue/types';
import type { UploadTicket } from '../../lib/queue/worker';
import { PHOTO_DIRECTORY } from '../photos/capture';
import {
  addNote,
  confirmJobReceipt,
  deleteAttachment,
  markArrived,
  moveStatus,
  requestAttachmentUpload,
  type MarkArrivedBody,
  type MoveStatusBody,
} from '../jobs/api';
import type { Deal } from '../jobs/types';
import {
  openOfficeThread,
  sendChatMessage,
  sendOnMyWay,
  sendRunningLate,
} from '../messaging/api';

/** The JSON each queued action carries. */
export type ArrivedPayload = MarkArrivedBody;
export type StatusPayload = MoveStatusBody;
export interface NotePayload {
  note: string;
}
export interface OnMyWayPayload {
  etaMinutes?: number;
}
export interface LatePayload {
  minutes: number;
}
export interface ChatPayload {
  /**
   * The office thread. Absent when the technician wrote their first line on a
   * phone that has never seen it — resolved at send time below.
   */
  conversationId?: string;
  body: string;
}

/**
 * Turn a queued row into the API call it stands for.
 *
 * Note what the two automatic texts do with the row's id: it goes out as
 * `clientMessageId`. The queue's idempotency key and the server's dedup key
 * are then the same value, so a replay after a dropped connection returns the
 * first message instead of texting the client twice — and two *different*
 * taps ("15 minutes", then "45 minutes") are two different ids, so the second
 * is not swallowed by the server's 15-minute bucket (§1.4).
 *
 * Resolves with the updated `Deal` where the endpoint returns one — confirm,
 * arrived and the status move all do. That copy is written straight into the
 * cache when the row lands, which is what spares the technician a re-download
 * of their entire job history after every tap (§2.2).
 */
export async function performOutboxAction(
  record: OutboxRecord,
): Promise<Deal | undefined> {
  const payload: unknown = JSON.parse(record.payload);

  switch (record.kind) {
    case 'confirm':
      return confirmJobReceipt(record.dealId);
    case 'arrived':
      return markArrived(record.dealId, payload as ArrivedPayload);
    case 'status':
      return moveStatus(record.dealId, payload as StatusPayload);
    case 'note':
      await addNote(record.dealId, (payload as NotePayload).note);
      return undefined;
    case 'on_my_way':
      await sendOnMyWay({
        dealId: record.dealId,
        ...(payload as OnMyWayPayload),
        clientMessageId: record.id,
      });
      return undefined;
    case 'late':
      await sendRunningLate({
        dealId: record.dealId,
        minutes: (payload as LatePayload).minutes,
        clientMessageId: record.id,
      });
      return undefined;
    case 'chat': {
      const chat = payload as ChatPayload;
      // The thread is resolved here rather than at the tap. A technician who
      // has never opened the chat with a signal has no id to queue, and
      // `POST /conversations` is find-or-create — so the first line costs one
      // extra request and every line after it costs none. Doing it at the tap
      // instead would mean no message could be written underground at all.
      const conversationId =
        chat.conversationId ?? (await openOfficeThread(record.userId)).conversation.id;
      await sendChatMessage(conversationId, {
        // The queue row's id IS the idempotency key: a replay after a dropped
        // connection returns the first message rather than writing a second.
        clientMessageId: record.id,
        channel: 'in_app',
        body: chat.body,
        ...(record.dealId ? { dealId: record.dealId } : {}),
      });
      return undefined;
    }
  }
}

/** Ask for a presigned PUT. Called by the worker, lazily, never up front. */
export async function presignUpload(record: UploadRecord): Promise<UploadTicket> {
  const ticket = await requestAttachmentUpload(record.dealId, {
    fileName: record.fileName,
    contentType: record.contentType,
    ...(record.size ? { size: record.size } : {}),
    ...(record.category ? { category: record.category } : {}),
  });
  return { id: ticket.id, uploadUrl: ticket.uploadUrl, headers: ticket.headers };
}

/**
 * Send the bytes.
 *
 * Every header from the presign response is replayed verbatim: the SSE-KMS
 * headers are part of what S3 signed, and dropping one gets a 403 rather than
 * an upload (deal-attachments.service.ts:65-70).
 *
 * Resolves with S3's status rather than throwing on a 4xx, because the worker
 * treats "403, your signature expired" differently from "the request failed".
 *
 * `sessionType` is stated rather than left to the default. In expo-file-system
 * 57 that default is `'background'` on iOS, and a background transfer does not
 * restore its JS promise or progress callbacks after a relaunch — the app
 * would think a completed upload never finished, on one platform only. The
 * durable queue is the mechanism that works on both, so the foreground session
 * is the deliberate choice (docs/STACK.md §2.1, ARCHITECTURE.md §2.4).
 */
export async function putUpload(
  record: UploadRecord,
  ticket: UploadTicket,
  onProgress: (fraction: number) => void,
): Promise<number> {
  const file = new File(record.localUri);
  const task = file.createUploadTask(ticket.uploadUrl, {
    httpMethod: 'PUT',
    headers: ticket.headers,
    mimeType: record.contentType,
    sessionType: 'foreground',
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) onProgress(Math.min(1, bytesSent / totalBytes));
    },
  });
  const result = await task.uploadAsync();
  return result.status;
}

/**
 * Remove the attachment row a ticket created but no bytes ever filled.
 *
 * A 404 means somebody — or an earlier pass of this queue — already removed
 * it, which is the state we were asking for; anything else has to propagate,
 * or the next presign would mint a second row and leave this one behind
 * (deal-attachments.service.ts:148-158).
 */
export async function discardAttachment(
  record: UploadRecord,
  attachmentId: string,
): Promise<void> {
  try {
    await deleteAttachment(record.dealId, attachmentId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}

/** Throw away the copy the app made of a capture. Never throws. */
export async function deleteLocalPhoto(record: UploadRecord): Promise<void> {
  try {
    const file = new File(record.localUri);
    if (file.exists) file.delete();
  } catch {
    // A file that will not delete is a few hundred kilobytes, not a reason to
    // fail the drain that just uploaded it successfully.
  }
}

/**
 * Delete captures no queue row points at any more.
 *
 * The sweep above covers the normal path. This covers the rest: a row
 * discarded from the Queue screen, a crash between the copy and the insert, a
 * database reset. Run once at startup, across every technician's rows — the
 * other tech on this van's phone may still be waiting to upload a file this
 * session cannot see (§2.4).
 */
export async function sweepOrphanedPhotos(): Promise<number> {
  try {
    const directory = new Directory(Paths.document, PHOTO_DIRECTORY);
    if (!directory.exists) return 0;
    const queued = new Set(await allQueuedLocalUris());
    let removed = 0;
    for (const entry of directory.list()) {
      if (entry instanceof File && !queued.has(entry.uri)) {
        entry.delete();
        removed += 1;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
