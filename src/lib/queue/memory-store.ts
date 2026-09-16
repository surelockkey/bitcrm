import type {
  OutboxRecord,
  OutboxStore,
  UploadRecord,
  UploadStore,
} from './types';

/**
 * An in-memory stand-in for the SQLite stores.
 *
 * Used by the worker's tests — the point of those tests is the state machine,
 * not SQLite's ability to store a row — and by any future dry-run tooling.
 * Kept in `src/` rather than a test folder so it type-checks against the real
 * interfaces and cannot drift from them.
 */
function createStore<T extends { id: string }>() {
  let rows: T[] = [];
  return {
    all: async (): Promise<T[]> => rows.map((r) => ({ ...r })),
    insert: async (record: T): Promise<void> => {
      rows = [...rows.filter((r) => r.id !== record.id), { ...record }];
    },
    update: async (id: string, patch: Partial<T>): Promise<void> => {
      rows = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    },
    remove: async (id: string): Promise<void> => {
      rows = rows.filter((r) => r.id !== id);
    },
    /** Test affordance: read the rows without awaiting. */
    peek: (): T[] => rows.map((r) => ({ ...r })),
  };
}

export const createMemoryOutboxStore = (): OutboxStore & {
  peek: () => OutboxRecord[];
} => createStore<OutboxRecord>();

export const createMemoryUploadStore = (): UploadStore & {
  peek: () => UploadRecord[];
} => createStore<UploadRecord>();
