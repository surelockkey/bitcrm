import type { OutboxRecord, OutboxStore, UploadRecord, UploadStore } from './types';

/**
 * The persistence layer, against a real SQLite engine.
 *
 * Every other queue test runs on `createMemoryStore`, which proves the state
 * machine and nothing about the SQL. These run the actual statements: a column
 * renamed on one side and not the other, a placeholder count that drifts from
 * the value list, a patch naming a column that does not exist — all of it fails
 * here rather than on a technician's phone.
 */

const USER = 'tech-1';

const action = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id: 'r1',
  userId: USER,
  kind: 'arrived',
  dealId: 'd1',
  payload: '{"lat":1}',
  createdAt: 1_000,
  attempts: 0,
  nextAttemptAt: 1_000,
  lastError: null,
  state: 'pending',
  ...over,
});

const upload = (over: Partial<UploadRecord> = {}): UploadRecord => ({
  id: 'u1',
  userId: USER,
  dealId: 'd1',
  localUri: 'file:///photos/u1.jpg',
  fileName: 'u1.jpg',
  contentType: 'image/jpeg',
  size: 2048,
  category: 'after',
  attachmentId: null,
  uploadUrl: null,
  uploadHeaders: null,
  progress: 0,
  attempts: 0,
  nextAttemptAt: 1_000,
  lastError: null,
  state: 'pending',
  createdAt: 1_000,
  ...over,
});

interface DbModule {
  createSqliteOutboxStore: (userId: string) => OutboxStore;
  createSqliteUploadStore: (userId: string) => UploadStore;
}

/** Load a fresh copy of db.ts — the same handle, a fresh module-level cache. */
function loadDb(): DbModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./db') as DbModule;
}

/** What a process relaunch looks like: db.ts forgets its handle, the disk does not. */
function relaunch(): DbModule {
  jest.resetModules();
  return loadDb();
}

beforeEach(() => {
  jest.resetModules();
});

describe('the outbox table', () => {
  it('round-trips every column of a record', async () => {
    const store = loadDb().createSqliteOutboxStore(USER);
    const record = action({ lastError: 'gateway down', attempts: 3 });
    await store.insert(record);

    expect(await store.all()).toEqual([record]);
  });

  it('patches only the columns it is given', async () => {
    const store = loadDb().createSqliteOutboxStore(USER);
    await store.insert(action());

    await store.update('r1', { state: 'failed', lastError: 'Job is already closed' });

    const [row] = await store.all();
    expect(row!.state).toBe('failed');
    expect(row!.lastError).toBe('Job is already closed');
    expect(row!.payload).toBe('{"lat":1}');
  });

  it('keeps rows in the order they were made, so a job’s actions stay in sequence', async () => {
    const store = loadDb().createSqliteOutboxStore(USER);
    await store.insert(action({ id: 'later', createdAt: 2_000 }));
    await store.insert(action({ id: 'earlier', createdAt: 1_000 }));

    expect((await store.all()).map((r) => r.id)).toEqual(['earlier', 'later']);
  });

  it('removes a row for good', async () => {
    const store = loadDb().createSqliteOutboxStore(USER);
    await store.insert(action());
    await store.remove('r1');
    expect(await store.all()).toEqual([]);
  });

  it('survives a relaunch — the whole point of putting it on disk', async () => {
    await loadDb().createSqliteOutboxStore(USER).insert(action({ kind: 'note' }));

    const after = relaunch().createSqliteOutboxStore(USER);
    expect((await after.all()).map((r) => r.kind)).toEqual(['note']);
  });
});

describe('the uploads table', () => {
  it('round-trips every column of a record', async () => {
    const store = loadDb().createSqliteUploadStore(USER);
    const record = upload({
      attachmentId: 'att-1',
      uploadUrl: 'https://s3/put?sig=1',
      uploadHeaders: '{"x-amz-server-side-encryption":"aws:kms"}',
      progress: 0.5,
    });
    await store.insert(record);

    expect(await store.all()).toEqual([record]);
  });

  it('keeps a null size and a null category as null, not as 0 and ""', async () => {
    const store = loadDb().createSqliteUploadStore(USER);
    await store.insert(upload({ size: null, category: null }));

    const [row] = await store.all();
    expect(row!.size).toBeNull();
    expect(row!.category).toBeNull();
  });

  it('survives a relaunch with its presigned ticket intact', async () => {
    await loadDb()
      .createSqliteUploadStore(USER)
      .insert(upload({ attachmentId: 'att-1', uploadUrl: 'https://s3/put' }));

    const [row] = await relaunch().createSqliteUploadStore(USER).all();
    expect(row!.attachmentId).toBe('att-1');
    expect(row!.uploadUrl).toBe('https://s3/put');
  });
});

describe('recovering from a process that was killed mid-flight', () => {
  it('re-arms an idempotent action — the server keeps the first stamp either way', async () => {
    await loadDb()
      .createSqliteOutboxStore(USER)
      .insert(action({ id: 'arrived', kind: 'arrived', state: 'sending' }));

    const [row] = await relaunch().createSqliteOutboxStore(USER).all();
    expect(row!.state).toBe('pending');
  });

  it.each(['note', 'status'] as const)(
    'does NOT re-arm a %s whose outcome nobody knows',
    async (kind) => {
      // POST /deals/:id/notes appends unconditionally and PUT /deals/:id/status
      // writes a second timeline entry and re-fires deal.completed — neither
      // has an idempotency key, so a blind replay is a duplicate the client
      // can see. The row is handed to the technician instead.
      await loadDb()
        .createSqliteOutboxStore(USER)
        .insert(action({ id: kind, kind, state: 'sending' }));

      const [row] = await relaunch().createSqliteOutboxStore(USER).all();
      expect(row!.state).toBe('unknown');
      expect(row!.lastError).toMatch(/may already have been sent/i);
    },
  );

  it.each(['on_my_way', 'late', 'chat'] as const)(
    're-arms a %s — the server dedupes it on the row’s own id',
    async (kind) => {
      await loadDb()
        .createSqliteOutboxStore(USER)
        .insert(action({ id: kind, kind, state: 'sending' }));

      const [row] = await relaunch().createSqliteOutboxStore(USER).all();
      expect(row!.state).toBe('pending');
    },
  );

  it('re-arms a photo: the PUT overwrites the same S3 key', async () => {
    await loadDb()
      .createSqliteUploadStore(USER)
      .insert(upload({ state: 'sending', attachmentId: 'att-1' }));

    const [row] = await relaunch().createSqliteUploadStore(USER).all();
    expect(row!.state).toBe('pending');
  });

  it('leaves a row that had already landed alone', async () => {
    await loadDb()
      .createSqliteOutboxStore(USER)
      .insert(action({ id: 'done', state: 'done' }));

    const [row] = await relaunch().createSqliteOutboxStore(USER).all();
    expect(row!.state).toBe('done');
  });
});

describe('two technicians sharing a van’s phone', () => {
  it('shows one technician nothing the other queued', async () => {
    const db = loadDb();
    await db.createSqliteOutboxStore('tech-a').insert(action({ id: 'a', userId: 'tech-a' }));
    await db.createSqliteOutboxStore('tech-b').insert(action({ id: 'b', userId: 'tech-b' }));

    expect((await db.createSqliteOutboxStore('tech-a').all()).map((r) => r.id)).toEqual(['a']);
    expect((await db.createSqliteOutboxStore('tech-b').all()).map((r) => r.id)).toEqual(['b']);
  });

  it('refuses to patch or remove a row belonging to somebody else', async () => {
    const db = loadDb();
    await db.createSqliteOutboxStore('tech-a').insert(action({ id: 'a', userId: 'tech-a' }));
    const other = db.createSqliteOutboxStore('tech-b');

    await other.update('a', { state: 'done' });
    await other.remove('a');

    const [row] = await db.createSqliteOutboxStore('tech-a').all();
    expect(row!.state).toBe('pending');
  });

  it('keeps photos apart too', async () => {
    const db = loadDb();
    await db.createSqliteUploadStore('tech-a').insert(upload({ id: 'a', userId: 'tech-a' }));
    await db.createSqliteUploadStore('tech-b').insert(upload({ id: 'b', userId: 'tech-b' }));

    expect((await db.createSqliteUploadStore('tech-b').all()).map((r) => r.id)).toEqual(['b']);
  });

  it('never re-arms the other technician’s in-flight row under this one', async () => {
    const db = loadDb();
    await db
      .createSqliteOutboxStore('tech-a')
      .insert(action({ id: 'a', userId: 'tech-a', state: 'sending' }));

    const after = relaunch();
    expect(await after.createSqliteOutboxStore('tech-b').all()).toEqual([]);
    const [mine] = await after.createSqliteOutboxStore('tech-a').all();
    expect(mine!.state).toBe('pending');
  });
});
