import { type ConversationKind } from '../enums/conversation-kind.enum';

/**
 * How many conversations there are, by state and category — the numbers the
 * Inbox category column prints ("All 42657", "Clients 42423", "Archived 2").
 * `totalConversations` and `totalByKind` count OPEN conversations only; an
 * archived one leaves them and joins `archivedConversations`, so every
 * conversation is in exactly one of the two.
 */
export interface InboxTotals {
  totalConversations: number;
  totalByKind: Partial<Record<ConversationKind, number>>;
  archivedConversations: number;
}

export const EMPTY_INBOX_TOTALS: InboxTotals = {
  totalConversations: 0,
  totalByKind: {},
  archivedConversations: 0,
};

/**
 * Badge numbers kept as one item (`INBOX#COUNTERS` / `METADATA`) and moved
 * with atomic `ADD`s, so the header never counts the inbox (design §3.2).
 *
 * `unread*` / `flagged*` are the badge; the `total*` fields are the size of
 * each category, which the column shows with a red dot for "has unread"
 * (Workiz). They are OPTIONAL on purpose: a counters row written before
 * totals existed, or one whose totals have never been rebuilt by
 * `POST /api/messaging/internal/counters/recount`, carries none of them and
 * they arrive `undefined`. `undefined` means "not known" — never zero — so a
 * client must fall back to what it has loaded rather than print a wrong 0.
 * `totalsRecountedAt` is the flag: totals are reported only once it is set.
 */
export interface InboxCounters extends Partial<InboxTotals> {
  unreadConversations: number;
  flaggedConversations: number;
  unreadByKind: Partial<Record<ConversationKind, number>>;
  /** When the totals were last rebuilt; absent while they are not trustworthy. */
  totalsRecountedAt?: string;
}

export const EMPTY_INBOX_COUNTERS: InboxCounters = {
  unreadConversations: 0,
  flaggedConversations: 0,
  unreadByKind: {},
};

/**
 * One member's team-chat badge (design §6): their own `team` thread and the
 * `group`s they are in, counted against their `READ#` markers — never the
 * company-wide inbox counters. `GET /team/counters` and the
 * `team_counters.changed` SSE event carry it.
 */
export interface TeamChatCounters {
  unreadConversations: number;
  unreadByKind: Partial<Record<Extract<ConversationKind, 'team' | 'group'>, number>>;
}

export const EMPTY_TEAM_CHAT_COUNTERS: TeamChatCounters = {
  unreadConversations: 0,
  unreadByKind: {},
};
