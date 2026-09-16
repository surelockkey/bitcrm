import { type ConversationKind } from '../enums/conversation-kind.enum';

/**
 * Badge numbers kept as one item (`INBOX#COUNTERS` / `METADATA`) and moved
 * with atomic `ADD`s, so the header never counts the inbox (design §3.2).
 */
export interface InboxCounters {
  unreadConversations: number;
  flaggedConversations: number;
  unreadByKind: Partial<Record<ConversationKind, number>>;
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
