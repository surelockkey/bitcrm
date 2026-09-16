import { ApiError } from '../api/errors';
import {
  isIdempotent,
  isSweepable,
  outcomeAfterFailure,
  selectNextBatch,
  shouldRepresign,
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
  /** Performs the record's actual API call. Throws on failure. */
  send: (record: OutboxRecord) => Promise<void>;
  now?: () => number;
  random?: () => number;
  /** Called after each record settles, so the UI can refresh the job. */
  onSettled?: (record: OutboxRecord, state: 'done' | 'failed' | 'pending') => void;
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
      // Marked in flight BEFORE the request. If the app is killed mid-send we
      // would rather show "sending" than quietly send a note twice.
      await store.update(record.id, { state: 'sending' });
      try {
        await send(record);
        await store.update(record.id, { state: 'done', nextAttemptAt: now() });
        result.sent += 1;
        onSettled?.(record, 'done');
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
  now?: () => number;
  random?: () => number;
  onSettled?: (record: UploadRecord, state: 'done' | 'failed' | 'pending') => void;
}

export async function drainUploads({
  store,
  presign,
  put,
  now = Date.now,
  random = Math.random,
  onSettled,
}: UploadWorkerDeps): Promise<DrainResult> {
  const all = await store.all();
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

        const status = await put(current, ticket, (fraction) => {
          void store.update(current.id, { progress: fraction });
        });

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
          // Almost always an expired signature. Throw the ticket away and ask
          // for a new one rather than burning the budget on a URL that is dead.
          await store.update(current.id, {
            uploadUrl: null,
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
