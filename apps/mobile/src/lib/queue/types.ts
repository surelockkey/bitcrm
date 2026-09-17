/**
 * The offline queues (docs/ARCHITECTURE.md §2.3, §2.4).
 *
 * Two of them, as designed: `outbox` for actions the technician takes, and
 * `uploads` for photo files, which need a three-step dance of their own. One
 * worker drains both.
 */

/** What a queued action does when it reaches the server. */
export type OutboxKind =
  | 'confirm'
  | 'arrived'
  | 'status'
  | 'note'
  | 'on_my_way'
  | 'late'
  /** A line the technician wrote to the office in the team thread (§1.4). */
  | 'chat'
  /**
   * A text the technician wrote to the **client** — their own words, not one
   * of the two templated notices. The biggest channel this account has (§1.5).
   */
  | 'client_sms'
  /** Moving the visit to another day or window — `PUT /deals/:id` (§1.3). */
  | 'reschedule';

export type QueueState =
  /** Waiting to be sent. Possibly waiting out a backoff — see nextAttemptAt. */
  | 'pending'
  /** In flight. Written BEFORE the request, so a crash mid-flight is visible. */
  | 'sending'
  /**
   * The app died mid-request and the server has no idempotency key for this
   * kind, so nobody can say whether it landed. Never replayed automatically —
   * the technician is shown it and decides (§2.3).
   */
  | 'unknown'
  /** Given up on. Shown to the technician with a manual retry. */
  | 'failed'
  /** Accepted by the server. Swept shortly after. */
  | 'done';

/** Columns every queued row carries, whichever queue it is in. */
interface QueueRowBase {
  /**
   * Who queued it. A van's phone is handed between technicians, so every row
   * names its author: the worker drains only the signed-in technician's rows,
   * and the Queue screen shows only theirs. Nobody's arrival or note is ever
   * re-sent under somebody else's credentials (§2.3).
   */
  userId: string;
}

export interface OutboxRecord extends QueueRowBase {
  /**
   * uuid — and the idempotency key. For the two automatic texts it is sent
   * verbatim as `clientMessageId`, so a replay after a dropped connection
   * returns the first message instead of texting the client twice (§1.4).
   */
  id: string;
  kind: OutboxKind;
  /**
   * The job this row is about. Empty for a row that is about no job — a chat
   * line written from the Messages tab rather than from a job — which is why
   * the worker's ordering lane is `laneOf`, not this (policy.ts).
   */
  dealId: string;
  /** JSON. Shape depends on `kind`; see `performOutboxAction`. */
  payload: string;
  createdAt: number;
  attempts: number;
  /** Epoch ms; the worker ignores the record until then. */
  nextAttemptAt: number;
  lastError: string | null;
  state: QueueState;
}

export interface UploadRecord extends QueueRowBase {
  id: string;
  dealId: string;
  /** A file in the app's own documents directory — not the camera cache. */
  localUri: string;
  fileName: string;
  contentType: string;
  size: number | null;
  category: string | null;
  /**
   * Set once the presign has happened. Presign is deliberately LAZY: it writes
   * the attachment's metadata and a timeline entry immediately
   * (deal-attachments.service.ts:72-90), so asking for it before we are ready
   * to send bytes leaves a ghost attachment on the job (§1.3).
   */
  attachmentId: string | null;
  uploadUrl: string | null;
  /** JSON. SSE-KMS headers that must be replayed verbatim on the PUT. */
  uploadHeaders: string | null;
  /** 0…1, for the progress bar. */
  progress: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  state: QueueState;
  createdAt: number;
}

/** One row of either queue, for the "what is waiting" screen. */
export type QueueRecord =
  | ({ queue: 'outbox' } & OutboxRecord)
  | ({ queue: 'uploads' } & UploadRecord);

export interface OutboxStore {
  all(): Promise<OutboxRecord[]>;
  insert(record: OutboxRecord): Promise<void>;
  update(id: string, patch: Partial<OutboxRecord>): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface UploadStore {
  all(): Promise<UploadRecord[]>;
  insert(record: UploadRecord): Promise<void>;
  update(id: string, patch: Partial<UploadRecord>): Promise<void>;
  remove(id: string): Promise<void>;
}
