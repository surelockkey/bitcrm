/**
 * Centralised React Query key factory, mirroring the web app's
 * `apps/web/lib/query-keys.ts` so invalidation stays precise and the two
 * clients name the same data the same way.
 *
 * Convention: `[resource, scope, ...params]`.
 */
export const queryKeys = {
  me: () => ['me'] as const,

  deals: {
    all: () => ['deals'] as const,
    /** Every filtered list — the prefix to invalidate after any job action. */
    lists: () => ['deals', 'list'] as const,
    list: (filters?: unknown) => ['deals', 'list', filters] as const,
    detail: (id: string) => ['deals', 'detail', id] as const,
    timeline: (id: string) => ['deals', id, 'timeline'] as const,
    attachments: (id: string) => ['deals', id, 'attachments'] as const,
  },

  contacts: {
    detail: (id: string) => ['contacts', 'detail', id] as const,
  },

  inventory: {
    containers: {
      /** The signed-in technician's own van. */
      mine: () => ['inventory', 'containers', 'mine'] as const,
      stock: (id: string) => ['inventory', 'containers', id, 'stock'] as const,
    },
  },

  /** The technician's own outbox — read from SQLite, not the network. */
  outbox: {
    all: () => ['outbox'] as const,
  },
} as const;
