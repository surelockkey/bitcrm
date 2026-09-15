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
