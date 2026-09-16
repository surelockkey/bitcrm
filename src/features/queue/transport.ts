import { File } from 'expo-file-system';
import type { OutboxRecord, UploadRecord } from '../../lib/queue/types';
import type { UploadTicket } from '../../lib/queue/worker';
import {
  addNote,
  confirmJobReceipt,
  markArrived,
  moveStatus,
  requestAttachmentUpload,
  type MarkArrivedBody,
  type MoveStatusBody,
} from '../jobs/api';
import { sendOnMyWay, sendRunningLate } from '../messaging/api';

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

/**
 * Turn a queued row into the API call it stands for.
 *
 * Note what the two automatic texts do with the row's id: it goes out as
 * `clientMessageId`. The queue's idempotency key and the server's dedup key
 * are then the same value, so a replay after a dropped connection returns the
 * first message instead of texting the client twice — and two *different*
 * taps ("15 minutes", then "45 minutes") are two different ids, so the second
 * is not swallowed by the server's 15-minute bucket (§1.4).
 */
export async function performOutboxAction(record: OutboxRecord): Promise<void> {
  const payload: unknown = JSON.parse(record.payload);

  switch (record.kind) {
    case 'confirm':
      await confirmJobReceipt(record.dealId);
      return;
    case 'arrived':
      await markArrived(record.dealId, payload as ArrivedPayload);
      return;
    case 'status':
      await moveStatus(record.dealId, payload as StatusPayload);
      return;
    case 'note':
      await addNote(record.dealId, (payload as NotePayload).note);
      return;
    case 'on_my_way':
      await sendOnMyWay({
        dealId: record.dealId,
        ...(payload as OnMyWayPayload),
        clientMessageId: record.id,
      });
      return;
    case 'late':
      await sendRunningLate({
        dealId: record.dealId,
        minutes: (payload as LatePayload).minutes,
        clientMessageId: record.id,
      });
      return;
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
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) onProgress(Math.min(1, bytesSent / totalBytes));
    },
  });
  const result = await task.uploadAsync();
  return result.status;
}
