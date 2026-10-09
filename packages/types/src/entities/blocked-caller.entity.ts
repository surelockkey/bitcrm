/**
 * A phone number the workspace refuses — Workiz Phone → "Blocked callers"
 * ("Define numbers you wish to block like sales calls and other spam
 * callers"). An inbound call from it is rejected before any call flow runs,
 * and an inbound text from it is dropped before it is stored.
 *
 * Kept by telephony in the calls table as one item collection keyed by the
 * number (`BLOCKED#ALL` / `<E.164>`), which is also the shape the Workiz
 * import writes. There is no edit: a number is blocked with a comment, or
 * unblocked (the row is deleted).
 */
export interface BlockedCaller {
  id: string;
  /** E.164 — the key, and what an inbound `From` is matched against. */
  number: string;
  /** Why ("I am blocking this number because…"). Absent when none was given. */
  comment?: string;
  /** `workiz:blocked_caller:<id>` on an imported row; absent on one blocked here. */
  externalId?: string;
  /** The user who blocked it, or the import. */
  createdBy: string;
  createdAt: string;
}

/** Bounds shared by the API's validation and the UI's affordances. */
export const BLOCKED_CALLER_LIMITS = {
  commentMaxLength: 500,
  /** The most rows one `GET /blocked-callers` page may carry. */
  listMaxLimit: 1000,
  listDefaultLimit: 50,
} as const;
