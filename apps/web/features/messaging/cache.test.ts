import { describe, it, expect } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import type { InboxCounters, PaginatedResponse } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import type { ConversationDetail, FeedMessage, InboxConversation } from "./api";
import { applyRealtimeEvent } from "./cache";

const conv = (id: string, extra: Partial<InboxConversation> = {}): InboxConversation => ({
  id,
  kind: "client",
  partyKind: "contact",
  partyId: `contact-${id}`,
  addresses: { phones: ["+14045551234"], emails: [] },
  state: "open",
  unread: false,
  unreadCount: 0,
  flagged: false,
  lastMessageAt: "2026-09-15T10:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
  ...extra,
});

const msg = (id: string, createdAt: string, extra: Partial<FeedMessage> = {}): FeedMessage => ({
  id,
  conversationId: "c1",
  channel: "sms",
  direction: "inbound",
  body: "hello",
  status: "received",
  origin: "contact",
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

type Pages<T> = InfiniteData<PaginatedResponse<T>, string | undefined>;
const pages = <T,>(data: T[]): Pages<T> => ({
  pages: [{ success: true, data, pagination: { nextCursor: undefined, count: data.length } }],
  pageParams: [undefined],
});

describe("applyRealtimeEvent", () => {
  it("patches the detail, every loaded tab, and the pointer lookup on conversation.upserted", () => {
    const qc = new QueryClient();
    qc.setQueryData<ConversationDetail>(queryKeys.messaging.conversation("c1"), {
      ...conv("c1"),
      readMarker: { conversationId: "c1", userId: "me", lastReadAt: "x" },
    });
    qc.setQueryData(queryKeys.messaging.conversationList({ view: "all" }), pages([conv("c1"), conv("c2")]));
    qc.setQueryData(queryKeys.messaging.conversationList({ view: "unread" }), pages<InboxConversation>([]));
    qc.setQueryData(queryKeys.messaging.conversationByParty("contact", "contact-c1"), conv("c1"));

    applyRealtimeEvent(qc, {
      type: "conversation.upserted",
      at: "now",
      conversation: conv("c1", { unread: true, unreadCount: 2, lastMessageAt: "2026-09-15T12:00:00.000Z" }),
    });

    const detail = qc.getQueryData<ConversationDetail>(queryKeys.messaging.conversation("c1"));
    expect(detail?.unread).toBe(true);
    expect(detail?.readMarker?.userId).toBe("me"); // kept

    const all = qc.getQueryData<Pages<InboxConversation>>(queryKeys.messaging.conversationList({ view: "all" }));
    expect(all?.pages[0].data.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(all?.pages[0].data[0].unreadCount).toBe(2);

    const unread = qc.getQueryData<Pages<InboxConversation>>(queryKeys.messaging.conversationList({ view: "unread" }));
    expect(unread?.pages[0].data.map((c) => c.id)).toEqual(["c1"]);

    const pointer = qc.getQueryData<InboxConversation>(queryKeys.messaging.conversationByParty("contact", "contact-c1"));
    expect(pointer?.unread).toBe(true);
  });

  it("appends a message to an open feed and leaves unopened feeds alone", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.messaging.messages("c1"), pages([msg("m1", "2026-09-15T10:00:00.000Z")]));

    applyRealtimeEvent(qc, {
      type: "message.upserted",
      at: "now",
      message: msg("m2", "2026-09-15T10:05:00.000Z"),
    });
    applyRealtimeEvent(qc, {
      type: "message.upserted",
      at: "now",
      message: msg("m9", "2026-09-15T10:05:00.000Z", { conversationId: "c9" }),
    });

    const feed = qc.getQueryData<Pages<FeedMessage>>(queryKeys.messaging.messages("c1"));
    expect(feed?.pages[0].data.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(qc.getQueryData(queryKeys.messaging.messages("c9"))).toBeUndefined();
  });

  it("replaces the badge counters", () => {
    const qc = new QueryClient();
    const counters: InboxCounters = { unreadConversations: 3, flaggedConversations: 1, unreadByKind: { client: 3 } };
    applyRealtimeEvent(qc, { type: "counters.changed", at: "now", counters });
    expect(qc.getQueryData(queryKeys.messaging.counters())).toEqual(counters);
  });
});
