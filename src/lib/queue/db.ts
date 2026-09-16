import * as SQLite from 'expo-sqlite';
import type {
  OutboxRecord,
  OutboxStore,
  UploadRecord,
  UploadStore,
} from './types';

/**
 * The queues on disk.
 *
 * SQLite rather than AsyncStorage, deliberately (docs/ARCHITECTURE.md §2.3): a
 * queue is a table with ordering, states and an attempt counter, and answering
 * "what is ready to send?" by rewriting one big JSON blob loses rows the moment
 * two screens enqueue at once. The react-query cache is the opposite shape —
 * one blob — and lives in AsyncStorage for exactly that reason.
 */

const DB_NAME = 'bitcrm-queue.db';

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY NOT NULL,
  user_id         TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL,
  deal_id         TEXT NOT NULL,
  payload         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  state           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id              TEXT PRIMARY KEY NOT NULL,
  user_id         TEXT NOT NULL DEFAULT '',
  deal_id         TEXT NOT NULL,
  local_uri       TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  size            INTEGER,
  category        TEXT,
  attachment_id   TEXT,
  upload_url      TEXT,
  upload_headers  TEXT,
  progress        REAL NOT NULL DEFAULT 0,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  state           TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS outbox_ready ON outbox (user_id, state, next_attempt_at);
CREATE INDEX IF NOT EXISTS uploads_ready ON uploads (user_id, state, next_attempt_at);
`;

/**
 * Kinds the server will absorb a second time without a client-visible trace,
 * and only those. `tech/confirm` returns early on `techConfirmedAt`
 * (deals.service.ts:1023-1041) and `tech/arrived` on `arrivedAt` (:1096), both
 * before the timeline entry; the two automatic texts dedupe on the
 * `clientMessageId` we send, which is the row's own id
 * (messages.repository.ts:277-284). Kept as a SQL literal list because the
 * recovery below runs before any of our TypeScript touches a row.
 */
const REPLAYABLE_KINDS = `('confirm', 'arrived', 'on_my_way', 'late')`;

export const UNKNOWN_OUTCOME_MESSAGE =
  'The app closed while this was being sent, so it may already have been sent. Open the job to check.';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function openQueueDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(SCHEMA);
      await recoverInFlightRows(db);
      return db;
    })();
  }
  return dbPromise;
}

/**
 * What to do with rows left `sending` by a process that no longer exists.
 *
 * The old answer — put every one of them back to `pending` — re-armed exactly
 * the rows whose outcome nobody knows, and for two kinds that is a duplicate
 * the client can see. `POST /deals/:id/notes` appends a timeline entry
 * unconditionally and carries no idempotency key at all
 * (add-note.dto.ts:4-9, deals.service.ts:773-776); `PUT /deals/:id/status`
 * writes a second `STATUS_CHANGED` entry, re-stamps `closedAt` and re-fires
 * `deal.completed` even when the status is already the requested one
 * (deals.service.ts:700-736). So those two are parked in `unknown` and handed
 * to the technician, who can see the job and decide. Everything else is
 * genuinely idempotent server-side and goes straight back in the queue.
 *
 * A photo is re-armed too: the PUT overwrites the same S3 key
 * (`deals/<dealId>/attachments/<attachmentId>`), so re-sending the bytes
 * changes nothing anybody can observe.
 */
async function recoverInFlightRows(
  db: SQLite.SQLiteDatabase,
  userId?: string,
): Promise<void> {
  const scope = userId ? ' AND user_id = ?' : '';
  const owner = userId ? [userId] : [];
  await db.runAsync(
    `UPDATE outbox SET state = 'pending'
      WHERE state = 'sending' AND kind IN ${REPLAYABLE_KINDS}${scope}`,
    owner,
  );
  await db.runAsync(
    `UPDATE outbox SET state = 'unknown', last_error = ?
      WHERE state = 'sending'${scope}`,
    [UNKNOWN_OUTCOME_MESSAGE, ...owner],
  );
  await db.runAsync(
    `UPDATE uploads SET state = 'pending' WHERE state = 'sending'${scope}`,
    owner,
  );
}

/**
 * The same recovery, for one technician, without a relaunch.
 *
 * Signing out abandons whatever was in flight — the request's outcome is as
 * unknowable as after a crash — and signing back in on the same phone would
 * otherwise find those rows stuck in `sending`, which nothing moves out of.
 */
export async function recoverQueuesForUser(userId: string): Promise<void> {
  const db = await openQueueDatabase();
  await recoverInFlightRows(db, userId);
}

/** Column names, so a patch can be written without an `any` in sight. */
const OUTBOX_COLUMNS: Record<keyof OutboxRecord, string> = {
  id: 'id',
  userId: 'user_id',
  kind: 'kind',
  dealId: 'deal_id',
  payload: 'payload',
  createdAt: 'created_at',
  attempts: 'attempts',
  nextAttemptAt: 'next_attempt_at',
  lastError: 'last_error',
  state: 'state',
};

const UPLOAD_COLUMNS: Record<keyof UploadRecord, string> = {
  id: 'id',
  userId: 'user_id',
  dealId: 'deal_id',
  localUri: 'local_uri',
  fileName: 'file_name',
  contentType: 'content_type',
  size: 'size',
  category: 'category',
  attachmentId: 'attachment_id',
  uploadUrl: 'upload_url',
  uploadHeaders: 'upload_headers',
  progress: 'progress',
  attempts: 'attempts',
  nextAttemptAt: 'next_attempt_at',
  lastError: 'last_error',
  state: 'state',
  createdAt: 'created_at',
};

type SqlValue = string | number | null;

/**
 * A patch is scoped by owner as well as by id. The id is a uuid, so a
 * collision across technicians is not the risk — writing to a row this session
 * has no business touching is, and the cheapest way not to is never to name it.
 */
function buildUpdate<T>(
  table: string,
  columns: Record<keyof T, string>,
  userId: string,
  id: string,
  patch: Partial<T>,
): { sql: string; params: SqlValue[] } | null {
  const entries = Object.entries(patch).filter(([key]) => key in columns);
  if (!entries.length) return null;
  const sets = entries.map(([key]) => `${columns[key as keyof T]} = ?`).join(', ');
  const params = entries.map(([, value]) => value as SqlValue);
  return {
    sql: `UPDATE ${table} SET ${sets} WHERE id = ? AND user_id = ?`,
    params: [...params, id, userId],
  };
}

interface OutboxRow {
  id: string;
  user_id: string;
  kind: string;
  deal_id: string;
  payload: string;
  created_at: number;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  state: string;
}

interface UploadRow {
  id: string;
  user_id: string;
  deal_id: string;
  local_uri: string;
  file_name: string;
  content_type: string;
  size: number | null;
  category: string | null;
  attachment_id: string | null;
  upload_url: string | null;
  upload_headers: string | null;
  progress: number;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  state: string;
  created_at: number;
}

/**
 * Both stores are bound to one technician.
 *
 * A van's phone is handed over mid-shift. Scoping every read, patch and delete
 * by `user_id` means the incoming technician cannot see, retry or discard the
 * outgoing one's rows — and cannot re-send their arrival or their note under
 * their own credentials — while nothing the outgoing technician queued is
 * thrown away: it is still there, waiting, when they sign back in (§2.3).
 */
export function createSqliteOutboxStore(userId: string): OutboxStore {
  return {
    async all() {
      const db = await openQueueDatabase();
      const rows = await db.getAllAsync<OutboxRow>(
        'SELECT * FROM outbox WHERE user_id = ? ORDER BY created_at ASC',
        [userId],
      );
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        kind: r.kind as OutboxRecord['kind'],
        dealId: r.deal_id,
        payload: r.payload,
        createdAt: r.created_at,
        attempts: r.attempts,
        nextAttemptAt: r.next_attempt_at,
        lastError: r.last_error,
        state: r.state as OutboxRecord['state'],
      }));
    },
    async insert(record) {
      const db = await openQueueDatabase();
      await db.runAsync(
        `INSERT OR REPLACE INTO outbox
           (id, user_id, kind, deal_id, payload, created_at, attempts,
            next_attempt_at, last_error, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          userId,
          record.kind,
          record.dealId,
          record.payload,
          record.createdAt,
          record.attempts,
          record.nextAttemptAt,
          record.lastError,
          record.state,
        ],
      );
    },
    async update(id, patch) {
      const statement = buildUpdate('outbox', OUTBOX_COLUMNS, userId, id, patch);
      if (!statement) return;
      const db = await openQueueDatabase();
      await db.runAsync(statement.sql, statement.params);
    },
    async remove(id) {
      const db = await openQueueDatabase();
      await db.runAsync('DELETE FROM outbox WHERE id = ? AND user_id = ?', [id, userId]);
    },
  };
}

export function createSqliteUploadStore(userId: string): UploadStore {
  return {
    async all() {
      const db = await openQueueDatabase();
      const rows = await db.getAllAsync<UploadRow>(
        'SELECT * FROM uploads WHERE user_id = ? ORDER BY created_at ASC',
        [userId],
      );
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        dealId: r.deal_id,
        localUri: r.local_uri,
        fileName: r.file_name,
        contentType: r.content_type,
        size: r.size,
        category: r.category,
        attachmentId: r.attachment_id,
        uploadUrl: r.upload_url,
        uploadHeaders: r.upload_headers,
        progress: r.progress,
        attempts: r.attempts,
        nextAttemptAt: r.next_attempt_at,
        lastError: r.last_error,
        state: r.state as UploadRecord['state'],
        createdAt: r.created_at,
      }));
    },
    async insert(record) {
      const db = await openQueueDatabase();
      await db.runAsync(
        `INSERT OR REPLACE INTO uploads
           (id, user_id, deal_id, local_uri, file_name, content_type, size, category,
            attachment_id, upload_url, upload_headers, progress, attempts,
            next_attempt_at, last_error, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          userId,
          record.dealId,
          record.localUri,
          record.fileName,
          record.contentType,
          record.size,
          record.category,
          record.attachmentId,
          record.uploadUrl,
          record.uploadHeaders,
          record.progress,
          record.attempts,
          record.nextAttemptAt,
          record.lastError,
          record.state,
          record.createdAt,
        ],
      );
    },
    async update(id, patch) {
      const statement = buildUpdate('uploads', UPLOAD_COLUMNS, userId, id, patch);
      if (!statement) return;
      const db = await openQueueDatabase();
      await db.runAsync(statement.sql, statement.params);
    },
    async remove(id) {
      const db = await openQueueDatabase();
      await db.runAsync('DELETE FROM uploads WHERE id = ? AND user_id = ?', [id, userId]);
    },
  };
}

/**
 * Every local photo path the queue still needs, across all technicians.
 *
 * Unscoped on purpose: the startup sweep that deletes orphaned files must not
 * delete a file the *other* technician on this phone is still waiting to
 * upload (§2.4).
 */
export async function allQueuedLocalUris(): Promise<string[]> {
  const db = await openQueueDatabase();
  const rows = await db.getAllAsync<{ local_uri: string }>(
    'SELECT local_uri FROM uploads',
  );
  return rows.map((r) => r.local_uri);
}
