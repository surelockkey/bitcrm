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

  /**
   * The chat with the office. Named as the web names the same data
   * (`apps/web/lib/query-keys.ts:197-218`), minus everything an inbox has and
   * a technician does not: one thread, one feed, one badge.
   */
  messaging: {
    all: () => ['messaging'] as const,
    /** The technician's own team thread (`GET /team/conversations?kind=team`). */
    teamThread: () => ['messaging', 'team-thread'] as const,
    /** The caller's own unread badge (`GET /team/counters`). */
    teamCounters: () => ['messaging', 'team-counters'] as const,
    messages: (conversationId: string) =>
      ['messaging', 'messages', 'conversation', conversationId] as const,
    /**
     * A job's thread with its **client** (`GET /conversations/by-job/:dealId`).
     * Keyed by the job, exactly as the endpoint is: the client thread a
     * technician may see is the one their own job leads to.
     */
    clientThread: (dealId: string) => ['messaging', 'client-thread', dealId] as const,
    /** Whether this client can be texted, and whether they said STOP. */
    clientTextLookup: (contactId: string) =>
      ['messaging', 'client-text-lookup', contactId] as const,
  },

  /**
   * The technician's own time clock. `all()` is what a landed clock row
   * invalidates — the running entry and every range on screen move together.
   */
  timeclock: {
    all: () => ['timeclock'] as const,
    /** The entry that is still running, or null. */
    current: () => ['timeclock', 'current'] as const,
    range: (from: string, to: string) => ['timeclock', 'range', from, to] as const,
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
