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

CREATE INDEX IF NOT EXISTS outbox_ready ON outbox (state, next_attempt_at);
CREATE INDEX IF NOT EXISTS uploads_ready ON uploads (state, next_attempt_at);
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function openQueueDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(SCHEMA);
      // A row left "sending" belongs to a process that no longer exists — the
      // app was killed mid-request. Put it back in the queue rather than
      // letting it sit in a state nothing will ever move it out of.
      await db.runAsync(`UPDATE outbox SET state = 'pending' WHERE state = 'sending'`);
      await db.runAsync(`UPDATE uploads SET state = 'pending' WHERE state = 'sending'`);
      return db;
    })();
  }
  return dbPromise;
}

/** Column names, so a patch can be written without an `any` in sight. */
const OUTBOX_COLUMNS: Record<keyof OutboxRecord, string> = {
  id: 'id',
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

function buildUpdate<T>(
  table: string,
  columns: Record<keyof T, string>,
  id: string,
  patch: Partial<T>,
): { sql: string; params: SqlValue[] } | null {
  const entries = Object.entries(patch).filter(([key]) => key in columns);
  if (!entries.length) return null;
  const sets = entries.map(([key]) => `${columns[key as keyof T]} = ?`).join(', ');
  const params = entries.map(([, value]) => value as SqlValue);
  return { sql: `UPDATE ${table} SET ${sets} WHERE id = ?`, params: [...params, id] };
}

interface OutboxRow {
  id: string;
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

export function createSqliteOutboxStore(): OutboxStore {
  return {
    async all() {
      const db = await openQueueDatabase();
      const rows = await db.getAllAsync<OutboxRow>(
        'SELECT * FROM outbox ORDER BY created_at ASC',
      );
      return rows.map((r) => ({
        id: r.id,
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
           (id, kind, deal_id, payload, created_at, attempts, next_attempt_at, last_error, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
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
      const statement = buildUpdate('outbox', OUTBOX_COLUMNS, id, patch);
      if (!statement) return;
      const db = await openQueueDatabase();
      await db.runAsync(statement.sql, statement.params);
    },
    async remove(id) {
      const db = await openQueueDatabase();
      await db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
    },
  };
}

export function createSqliteUploadStore(): UploadStore {
  return {
    async all() {
      const db = await openQueueDatabase();
      const rows = await db.getAllAsync<UploadRow>(
        'SELECT * FROM uploads ORDER BY created_at ASC',
      );
      return rows.map((r) => ({
        id: r.id,
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
           (id, deal_id, local_uri, file_name, content_type, size, category,
            attachment_id, upload_url, upload_headers, progress, attempts,
            next_attempt_at, last_error, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
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
      const statement = buildUpdate('uploads', UPLOAD_COLUMNS, id, patch);
      if (!statement) return;
      const db = await openQueueDatabase();
      await db.runAsync(statement.sql, statement.params);
    },
    async remove(id) {
      const db = await openQueueDatabase();
      await db.runAsync('DELETE FROM uploads WHERE id = ?', [id]);
    },
  };
}
