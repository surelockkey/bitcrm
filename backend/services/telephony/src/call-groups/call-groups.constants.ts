/**
 * Call-group rows live in their own small table rather than alongside call
 * history: the calls table is an append-only log with three indexes on it, and
 * configuration has a different lifecycle and a different blast radius.
 *
 *   PK = 'GROUP', SK = 'GROUP#<id>'
 *
 * One partition holds every group, so listing is a single Query and reading one
 * is a GetItem — no index, and no scan. Safe because a workspace has tens of
 * groups, not thousands: the partition can never grow into a hot key.
 */
export const CALL_GROUPS_TABLE =
  process.env.CALL_GROUPS_TABLE || 'BitCRM_CallGroups';

export const CALL_GROUP_PK = 'GROUP';
export const callGroupSk = (id: string) => `GROUP#${id}`;
