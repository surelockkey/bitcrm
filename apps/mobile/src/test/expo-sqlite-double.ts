import { DatabaseSync } from 'node:sqlite';

/**
 * A stand-in for `expo-sqlite` that is a *real* SQLite engine.
 *
 * The other doubles in jest.setup.ts fake a native module's behaviour, which is
 * the right trade for a keychain or a haptic. It is the wrong trade for the
 * queue: what needs proving there is that the SQL itself is correct — that the
 * column list matches the placeholder count, that a patch names columns the
 * table actually has, that reopening the database recovers the states we say it
 * recovers. A hand-written fake would agree with whatever the code did.
 *
 * Node ships SQLite (`node:sqlite`, Node 22.5+), so the tests run the same
 * statements the phone does, against the same engine, in memory.
 *
 * The open databases live on `globalThis` on purpose: a test simulates an app
 * relaunch with `jest.resetModules()`, which throws away `db.ts`'s cached
 * handle — and would throw away this module's too, taking the data with it.
 */

const HANDLES = '__bitcrmSqliteDoubles__';

type Registry = Map<string, DatabaseSync>;

function registry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  if (!g[HANDLES]) g[HANDLES] = new Map();
  return g[HANDLES];
}

type Params = readonly unknown[];

/** expo-sqlite accepts both `run(sql, [a, b])` and `run(sql, a, b)`. */
function flatten(args: unknown[]): Params {
  if (args.length === 1 && Array.isArray(args[0])) return args[0] as Params;
  return args;
}

function bind(params: Params) {
  return params.map((p) => (p === undefined ? null : p)) as never[];
}

export interface SQLiteDatabaseDouble {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  closeAsync(): Promise<void>;
}

function wrap(db: DatabaseSync): SQLiteDatabaseDouble {
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, ...params) {
      const result = db.prepare(sql).run(...bind(flatten(params)));
      return { changes: Number(result.changes) };
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]) {
      return db.prepare(sql).all(...bind(flatten(params))) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]) {
      return (db.prepare(sql).get(...bind(flatten(params))) as T | undefined) ?? null;
    },
    async closeAsync() {
      // A reopen in the same test process must see the same rows, so the
      // handle is kept. `__resetSqlite()` is what empties it.
    },
  };
}

export async function openDatabaseAsync(name: string): Promise<SQLiteDatabaseDouble> {
  const open = registry();
  if (!open.has(name)) open.set(name, new DatabaseSync(':memory:'));
  return wrap(open.get(name)!);
}

/**
 * Empty every table, between tests, so one cannot leak into the next.
 *
 * The rows go, the handle stays. Closing it would strand `db.ts`'s cached
 * promise, which lives as long as the module registry does and would go on
 * handing out a database nobody can talk to.
 */
export function __resetSqlite(): void {
  for (const db of registry().values()) {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as { name: string }[];
    for (const table of tables) db.exec(`DELETE FROM "${table.name}"`);
  }
}

/**
 * Close every handle, once the whole file is done.
 *
 * An open `DatabaseSync` is a live handle on Node's event loop: leave one and
 * Jest finishes the tests and then hangs instead of exiting.
 */
export function __closeSqlite(): void {
  for (const db of registry().values()) db.close();
  registry().clear();
}
