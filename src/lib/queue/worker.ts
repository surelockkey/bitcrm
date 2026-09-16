import { ApiError } from '../api/errors';
import {
  isIdempotent,
  isSweepable,
  isTooOldToSend,
  outcomeAfterFailure,
  selectNextBatch,
  shouldRepresign,
  TOO_OLD_MESSAGE,
} from './policy';
import type {
  OutboxRecord,
  OutboxStore,
  UploadRecord,
  UploadStore,
} from './types';

/**
 * The worker that empties both queues.
 *
 * Everything it depends on is injected — the stores, the network calls, the
 * clock, the jitter — so the whole of it is testable with no SQLite, no fetch
 * and no waiting (docs/ARCHITECTURE.md §2.4).
 *
 * It is woken by: app start, returning to the foreground, connectivity coming
 * back, and each `enqueue`. It is never relied on to run in the background —
 * Android has no equivalent of iOS's background upload session, so a durable
 * queue drained on launch is the only mechanism that works on both platforms
 * (docs/STACK.md §2.1).
 */

const errorMessage = (error: unknown): string =>
  error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'Unknown error';

export interface DrainResult {
  sent: number;
  failed: number;
  retrying: number;
}

const empty = (): DrainResult => ({ sent: 0, failed: 0, retrying: 0 });

export interface OutboxWorkerDeps {
  store: OutboxStore;
  /**
   * Performs the record's actual API call. Throws on failure. What it resolves
   * with is handed straight back through `onSettled` — the tech endpoints
   * answer with the updated `Deal`, which is how the job screen refreshes
   * without re-downloading the technician's whole history (§2.4).
   */
  send: (record: OutboxRecord) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
  /** Called after each record settles, so the UI can refresh the job. */
  onSettled?: (
    record: OutboxRecord,
    state: 'done' | 'failed' | 'pending',
    result?: unknown,
  ) => void;
}

export async function drainOutbox({
  store,
  send,
  now = Date.now,
  random = Math.random,
  onSettled,
}: OutboxWorkerDeps): Promise<DrainResult> {
  const all = await store.all();

  // Sweep what has already landed before doing anything else, so a long shift
  // does not grow the table without bound.
  for (const record of all) {
    if (isSweepable(record, now())) await store.remove(record.id);
  }

  const batch = selectNextBatch(all, now());
  const result = empty();

  await Promise.all(
    batch.map(async (record) => {
      // A text to the client that has sat in the queue past its shelf life is
      // parked, not sent: "I'm on my way" arriving after the visit is worse
      // than never arriving at all.
      if (isTooOldToSend(record, now())) {
        await store.update(record.id, {
          state: 'failed',
          nextAttemptAt: now(),
          lastError: TOO_OLD_MESSAGE,
        });
        result.failed += 1;
        onSettled?.(record, 'failed');
        return;
      }

      // Marked in flight BEFORE the request. If the app is killed mid-send we
      // would rather show "sending" than quietly send a note twice.
      await store.update(record.id, { state: 'sending' });
      try {
        const sent = await send(record);
        await store.update(record.id, { state: 'done', nextAttemptAt: now() });
        result.sent += 1;
        onSettled?.(record, 'done', sent);
      } catch (error) {
        const outcome = outcomeAfterFailure(
          record,
          error,
          errorMessage(error),
          now(),
          random,
          isIdempotent(record.kind),
        );
        await store.update(record.id, outcome);
        if (outcome.state === 'failed') result.failed += 1;
        else result.retrying += 1;
        onSettled?.(record, outcome.state === 'failed' ? 'failed' : 'pending');
      }
    }),
  );

  return result;
}

export interface UploadTicket {
  id: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface UploadWorkerDeps {
  store: UploadStore;
  /**
   * Asks the server for a presigned PUT. Called lazily, immediately before the
   * bytes go — presign writes the attachment's metadata and a timeline entry
   * on the spot, so a ticket taken early and never used leaves a ghost
   * attachment on the job (§1.3).
   */
  presign: (record: UploadRecord) => Promise<UploadTicket>;
  /** PUTs the file. Resolves with the HTTP status S3 answered. */
  put: (
    record: UploadRecord,
    ticket: UploadTicket,
    onProgress: (fraction: number) => void,
  ) => Promise<number>;
  /**
   * Removes an attachment the server has a row for but no bytes behind.
   *
   * `DELETE /deals/:id/attachments/:attachmentId` needs only `deals.edit`,
   * which `role-technician` has (default-roles.ts:290), and deletes the
   * metadata row plus the (absent) S3 object. A repeat delete answers 404,
   * which the transport treats as success.
   */
  discardAttachment: (record: UploadRecord, attachmentId: string) => Promise<void>;
  /** Removes the copy the app made of the capture. Never throws. */
  deleteLocalFile?: (record: UploadRecord) => Promise<void>;
  now?: () => number;
  random?: () => number;
  onSettled?: (record: UploadRecord, state: 'done' | 'failed' | 'pending') => void;
}

export async function drainUploads({
  store,
  presign,
  put,
  discardAttachment,
  deleteLocalFile,
  now = Date.now,
  random = Math.random,
  onSettled,
}: UploadWorkerDeps): Promise<DrainResult> {
  const all = await store.all();

  // The same sweep the outbox gets. Without it every photo a technician ever
  // sent stays in the table — and its copy stays in the app's documents
  // directory — until the app is reinstalled (§2.4).
  for (const record of all) {
    if (isSweepable(record, now())) {
      await deleteLocalFile?.(record);
      await store.remove(record.id);
    }
  }

  const batch = selectNextBatch(all, now());
  const result = empty();

  await Promise.all(
    batch.map(async (record) => {
      await store.update(record.id, { state: 'sending', progress: 0 });
      let current = record;
      try {
        if (!current.uploadUrl || !current.attachmentId) {
          const ticket = await presign(current);
          const patch = {
            attachmentId: ticket.id,
            uploadUrl: ticket.uploadUrl,
            uploadHeaders: JSON.stringify(ticket.headers),
          };
          await store.update(current.id, patch);
          current = { ...current, ...patch };
        }

        const ticket: UploadTicket = {
          id: current.attachmentId!,
          uploadUrl: current.uploadUrl!,
          headers: JSON.parse(current.uploadHeaders ?? '{}') as Record<string, string>,
        };

        const status = await put(current, ticket, reportProgress(store, current));

        if (status >= 200 && status < 300) {
          await store.update(current.id, {
            state: 'done',
            progress: 1,
            nextAttemptAt: now(),
          });
          result.sent += 1;
          onSettled?.(current, 'done');
          return;
        }

        if (shouldRepresign(status)) {
          // Almost always an expired signature — the upload URL lives 300 s
          // (s3.service.ts:71) while the backoff reaches 15 min, so this is the
          // normal path for a photo taken underground, not an edge case.
          //
          // There is no endpoint that re-signs an existing attachment id: the
          // attachments controller mints a new one on every POST. So the row
          // the first ticket created has to go, or the job collects one ghost
          // attachment per expiry, each with its own ATTACHMENT_ADDED entry
          // that dispatch can see (§1.3).
          await discardAttachment(current, current.attachmentId!);
          await store.update(current.id, {
            attachmentId: null,
            uploadUrl: null,
            uploadHeaders: null,
            attempts: current.attempts + 1,
            nextAttemptAt: now(),
            state: 'pending',
            lastError: `Upload link expired (${status})`,
          });
          result.retrying += 1;
          onSettled?.(current, 'pending');
          return;
        }

        throw new ApiError(status, `S3 refused the upload (${status})`);
      } catch (error) {
        const outcome = outcomeAfterFailure(
          current,
          error,
          errorMessage(error),
          now(),
          random,
          // A photo PUT is idempotent: the same key, overwritten.
          true,
        );
        await store.update(current.id, outcome);
        if (outcome.state === 'failed') result.failed += 1;
        else result.retrying += 1;
        onSettled?.(current, outcome.state === 'failed' ? 'failed' : 'pending');
      }
    }),
  );

  return result;
}

/** Progress writes are throttled: see PROGRESS_STEP. */
export const PROGRESS_STEP = 0.05;

/**
 * One SQLite write per progress callback is one write per network packet. The
 * bar is 200 px wide; 5% is the smallest change anybody can see, and a
 * rejection here must not take the upload down with it.
 */
function reportProgress(
  store: UploadStore,
  record: UploadRecord,
): (fraction: number) => void {
  let written = record.progress;
  return (fraction) => {
    if (fraction < 1 && fraction - written < PROGRESS_STEP) return;
    written = fraction;
    void store.update(record.id, { progress: fraction }).catch(() => {});
  };
}
