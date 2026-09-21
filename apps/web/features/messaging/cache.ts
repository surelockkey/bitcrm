import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { InboxCounters, PaginatedResponse, TeamChatCounters } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import type {
  ConversationDetail,
  ConversationListFilter,
  FeedMessage,
  InboxConversation,
  MessagingRealtimeEvent,
} from "./api";
import { upsertConversationInPages, upsertMessageInPages } from "./lib";

type ListData = InfiniteData<PaginatedResponse<InboxConversation>, string | undefined>;
type FeedData = InfiniteData<PaginatedResponse<FeedMessage>, string | undefined>;

/**
 * Put a fresh conversation row everywhere the cache holds one: the detail
 * entry (keeping the viewer's read marker), every loaded inbox tab (moved
 * to the top, or dropped if it no longer belongs there), and the pointer
 * lookups that resolve to it. Used by the stream and by every mutation,
 * so an archive from the header and an archive from another tab look the
 * same to the UI.
 */
export function applyConversation(
  qc: QueryClient,
  conversation: InboxConversation,
  meId?: string,
): void {
  qc.setQueryData<ConversationDetail>(
    queryKeys.messaging.conversation(conversation.id),
    (prev) => ({ ...prev, ...conversation, readMarker: prev?.readMarker }),
  );

  for (const [key, data] of qc.getQueriesData<ListData>({
    queryKey: queryKeys.messaging.conversationLists(),
  })) {
    if (!data) continue;
    const filter = key[3] as ConversationListFilter | undefined;
    if (!filter) continue;
    qc.setQueryData<ListData>(key, {
      ...data,
      pages: upsertConversationInPages(data.pages, conversation, filter, meId),
    });
  }

  // Pointer lookups: refresh the ones already resolved to this thread, so a
  // contact card's embedded feed sees the same unread / flagged state.
  for (const [key, data] of qc.getQueriesData<InboxConversation | null>({
    queryKey: ["messaging", "conversations"],
    predicate: (q) => q.queryKey[2] === "by-party" || q.queryKey[2] === "by-job",
  })) {
    if (data?.id === conversation.id) qc.setQueryData(key, conversation);
  }
}

export function applyMessage(qc: QueryClient, message: FeedMessage): void {
  qc.setQueryData<FeedData>(queryKeys.messaging.messages(message.conversationId), (prev) => {
    // A feed that was never opened is left alone — it loads fresh on open.
    if (!prev) return prev;
    return { ...prev, pages: upsertMessageInPages(prev.pages, message) };
  });
  if (message.dealId) {
    qc.setQueryData<FeedData>(queryKeys.messaging.messagesByJob(message.dealId), (prev) => {
      if (!prev) return prev;
      return { ...prev, pages: upsertMessageInPages(prev.pages, message) };
    });
  }
}

export function applyCounters(qc: QueryClient, counters: InboxCounters): void {
  qc.setQueryData<InboxCounters>(queryKeys.messaging.counters(), counters);
}

export function applyTeamCounters(qc: QueryClient, counters: TeamChatCounters): void {
  qc.setQueryData<TeamChatCounters>(queryKeys.messaging.teamCounters(), counters);
}

/** One stream frame → the query cache. */
export function applyRealtimeEvent(
  qc: QueryClient,
  event: MessagingRealtimeEvent,
  meId?: string,
): void {
  switch (event.type) {
    case "conversation.upserted":
      applyConversation(qc, event.conversation, meId);
      return;
    case "message.upserted":
      applyMessage(qc, event.message);
      if (event.conversation) applyConversation(qc, event.conversation, meId);
      return;
    case "counters.changed":
      applyCounters(qc, event.counters);
      return;
    case "team_counters.changed":
      applyTeamCounters(qc, event.counters);
      return;
    case "opt_out.changed":
      // The banner reads the text-lookup; let it refetch rather than guess
      // which party the (possibly masked) address belongs to.
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.textLookups() });
      // The composer's channel list carries both opt-out ledgers, so a STOP
      // or an unsubscribe must reach the send control too, not just the banner.
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.sendOptionsAll() });
      if (event.address) {
        void qc.invalidateQueries({ queryKey: queryKeys.messaging.optOuts(event.address) });
      }
      return;
  }
}
