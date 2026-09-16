import { describe, it, expect } from "vitest";
import type { PaginatedResponse } from "@bitcrm/types";
import type { FeedMessage, InboxConversation } from "./api";
import {
  conversationTitle,
  describeResendError,
  EMPTY_PARTY_NAMES,
  errorText,
  flattenFeed,
  formatDayChip,
  formatDayLabel,
  formatListTime,
  formatMessageStamp,
  groupByDay,
  hasShortCodes,
  initialsOf,
  insertAtCursor,
  looksLikePhoneQuery,
  newClientMessageId,
  matchesFilter,
  matchesSearch,
  messageSk,
  replacePendingMessage,
  statusText,
  statusTick,
  upsertConversationInPages,
  upsertMessageInPages,
} from "./lib";

const msg = (id: string, createdAt: string, extra: Partial<FeedMessage> = {}): FeedMessage => ({
  id,
  conversationId: "c1",
  channel: "sms",
  direction: "outbound",
  body: `body ${id}`,
  status: "sent",
  origin: "user",
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

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

const page = <T,>(data: T[], nextCursor?: string): PaginatedResponse<T> => ({
  success: true,
  data,
  pagination: { nextCursor, count: data.length },
});

describe("statusTick", () => {
  it("maps the delivery lifecycle onto ticks", () => {
    expect(statusTick("queued")).toBe("pending");
    expect(statusTick("sending")).toBe("pending");
    expect(statusTick("sent")).toBe("sent");
    expect(statusTick("delivered")).toBe("delivered");
    expect(statusTick("read")).toBe("read");
    expect(statusTick("failed")).toBe("error");
    expect(statusTick("undelivered")).toBe("error");
    expect(statusTick("canceled")).toBe("error");
  });
});

describe("errorText", () => {
  it("prefers the carrier's own words", () => {
    expect(
      errorText({ errorCode: "21408", errorMessage: "Permission to send an SMS has not been enabled for the region" }),
    ).toBe("Permission to send an SMS has not been enabled for the region");
  });

  it("has a short line for the codes an inbox actually meets", () => {
    expect(errorText({ errorCode: "21408" })).toBe("Texting this country is not enabled on the account");
    expect(errorText({ errorCode: "21610" })).toBe("This number opted out of texts (STOP)");
    expect(errorText({ errorCode: "21211" })).toBe("Invalid phone number");
    expect(errorText({ errorCode: "21614" })).toBe("Not a mobile number");
    expect(errorText({ errorCode: "30034" })).toBe("Sender number is not registered for A2P 10DLC");
    expect(errorText({ errorCode: "30003" })).toBe("Phone unreachable or switched off");
    expect(errorText({ errorCode: "30007" })).toBe("Filtered by the carrier as spam");
  });

  it("falls back to the code, then to a plain 'Not delivered'", () => {
    expect(errorText({ errorCode: "99999" })).toBe("Not delivered (code 99999)");
    expect(errorText({})).toBe("Not delivered");
  });
});

describe("statusText", () => {
  it("spells the lifecycle the Workiz way", () => {
    expect(statusText("queued")).toBe("Sending…");
    expect(statusText("sending")).toBe("Sending…");
    expect(statusText("sent")).toBe("Message sent");
    expect(statusText("delivered")).toBe("Message received");
    expect(statusText("read")).toBe("Message read");
  });

  it("reads 'Failed · <why>' for every terminal failure", () => {
    expect(statusText("failed", { errorCode: "30007" })).toBe("Failed · Filtered by the carrier as spam");
    expect(statusText("undelivered", { errorCode: "30003", errorMessage: "Unreachable destination handset" })).toBe(
      "Failed · Unreachable destination handset",
    );
    expect(statusText("canceled")).toBe("Failed · Not delivered");
  });
});

describe("describeResendError", () => {
  it("names the 409 and defers to the send wording otherwise", () => {
    expect(describeResendError(409, "Conflict")).toBe("Only failed messages can be resent");
    expect(describeResendError(422, "x")).toMatch(/opted out/);
    expect(describeResendError(500, "Boom")).toBe("Boom");
  });
});

describe("messageSk", () => {
  it("builds the sort key the read marker stores", () => {
    expect(messageSk({ id: "m1", createdAt: "2026-09-15T10:00:00.000Z" })).toBe(
      "MSG#2026-09-15T10:00:00.000Z#m1",
    );
  });
});

describe("conversationTitle", () => {
  it("prefers the resolved party name", () => {
    const names = {
      ...EMPTY_PARTY_NAMES,
      contacts: new Map([["contact-c1", "Jane Doe"]]),
    };
    expect(conversationTitle(conv("c1"), names)).toBe("Jane Doe");
  });

  it("falls back to the imported name, then the number", () => {
    expect(conversationTitle(conv("c1", { workizName: "Old Name" }), EMPTY_PARTY_NAMES)).toBe(
      "Old Name",
    );
    expect(conversationTitle(conv("c1"), EMPTY_PARTY_NAMES)).toBe("(404) 555-1234");
  });

  it("names a masked unknown number honestly", () => {
    const c = conv("c1", {
      kind: "unknown",
      partyKind: "none",
      partyId: undefined,
      addresses: { phones: [], emails: [] },
      phonesMasked: true,
    });
    expect(conversationTitle(c, EMPTY_PARTY_NAMES)).toBe("Unknown number");
  });
});

describe("initialsOf", () => {
  it("takes first and last word initials", () => {
    expect(initialsOf("Jane Doe")).toBe("JD");
    expect(initialsOf("Acme")).toBe("AC");
    expect(initialsOf("(404) 555-1234")).toBe("#");
  });
});

describe("day labels", () => {
  const now = new Date(2026, 8, 15, 12, 0, 0);

  it("says Today / Yesterday, then a weekday, then a date", () => {
    expect(formatDayLabel(new Date(2026, 8, 15, 9).toISOString(), now)).toBe("Today");
    expect(formatDayLabel(new Date(2026, 8, 14, 23).toISOString(), now)).toBe("Yesterday");
    expect(formatDayLabel(new Date(2026, 8, 10).toISOString(), now)).toMatch(/Sep 10/);
    expect(formatDayLabel(new Date(2025, 8, 10).toISOString(), now)).toMatch(/2025/);
  });

  it("formats list times relative to now", () => {
    expect(formatListTime(new Date(2026, 8, 15, 9, 5).toISOString(), now)).toMatch(/9:05/);
    expect(formatListTime(new Date(2026, 8, 13, 9).toISOString(), now)).toBe("Sun");
    expect(formatListTime(new Date(2026, 7, 1).toISOString(), now)).toBe("Aug 1");
    expect(formatListTime(undefined, now)).toBe("");
  });
});

describe("feed reducers", () => {
  it("flattens pages newest first without duplicates", () => {
    const pages = [
      page([msg("m3", "2026-09-15T10:03:00.000Z"), msg("m2", "2026-09-15T10:02:00.000Z")]),
      page([msg("m2", "2026-09-15T10:02:00.000Z"), msg("m1", "2026-09-15T10:01:00.000Z")]),
    ];
    expect(flattenFeed(pages).map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
  });

  it("groups by day, oldest first, reading downwards, labelled like Workiz's day chips", () => {
    const feed = [
      msg("m3", new Date(2026, 8, 15, 10).toISOString()),
      msg("m2", new Date(2026, 8, 14, 10).toISOString()),
      msg("m1", new Date(2026, 8, 14, 9).toISOString()),
    ];
    const groups = groupByDay(feed);
    expect(groups.map((g) => g.label)).toEqual(["Monday,September 14 2026", "Tuesday,September 15 2026"]);
    expect(groups[0].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("stamps a message the Workiz way", () => {
    expect(formatMessageStamp(new Date(2026, 8, 15, 12, 10).toISOString())).toBe("Sep 15 2026 12:10 PM");
    expect(formatDayChip(new Date(2026, 8, 15).toISOString())).toBe("Tuesday,September 15 2026");
  });

  it("inserts a new message at the top of page one and replaces a known one in place", () => {
    const pages = [page([msg("m2", "2026-09-15T10:02:00.000Z")], "older")];
    const inserted = upsertMessageInPages(pages, msg("m3", "2026-09-15T10:03:00.000Z"));
    expect(inserted[0].data.map((m) => m.id)).toEqual(["m3", "m2"]);
    expect(inserted[0].pagination.nextCursor).toBe("older");

    const updated = upsertMessageInPages(inserted, msg("m2", "2026-09-15T10:02:00.000Z", { status: "delivered" }));
    expect(updated[0].data.find((m) => m.id === "m2")?.status).toBe("delivered");
    expect(updated[0].data).toHaveLength(2);
  });

  it("swaps the optimistic line for the real message, even if the stream delivered it first", () => {
    const pending = msg("client-uuid", "2026-09-15T10:04:00.000Z", { status: "queued" });
    const real = msg("m4", "2026-09-15T10:04:01.000Z", { status: "queued" });
    const pages = [page([real, pending, msg("m3", "2026-09-15T10:03:00.000Z")])];
    const out = replacePendingMessage(pages, "client-uuid", real);
    expect(out[0].data.map((m) => m.id)).toEqual(["m4", "m3"]);
  });
});

describe("list reducers", () => {
  it("knows which tab a conversation belongs on", () => {
    expect(matchesFilter(conv("c1"), { view: "all" })).toBe(true);
    expect(matchesFilter(conv("c1", { state: "archived" }), { view: "all" })).toBe(false);
    expect(matchesFilter(conv("c1", { state: "archived" }), { view: "archived" })).toBe(true);
    expect(matchesFilter(conv("c1"), { view: "unread" })).toBe(false);
    expect(matchesFilter(conv("c1", { unread: true }), { view: "unread" })).toBe(true);
    expect(matchesFilter(conv("c1", { flagged: true }), { view: "flagged" })).toBe(true);
    expect(matchesFilter(conv("c1", { kind: "team" }), { view: "all", kind: "client" })).toBe(false);
    expect(matchesFilter(conv("c1", { assignedUserId: "me" }), { view: "mine" }, "me")).toBe(true);
    expect(matchesFilter(conv("c1", { assignedUserId: "you" }), { view: "mine" }, "me")).toBe(false);
  });

  it("moves an updated conversation to the top and drops it from tabs it left", () => {
    const pages = [
      page([conv("a", { lastMessageAt: "2026-09-15T10:00:00.000Z" }), conv("b", { lastMessageAt: "2026-09-15T09:00:00.000Z" })]),
    ];
    const bumped = upsertConversationInPages(
      pages,
      conv("b", { lastMessageAt: "2026-09-15T11:00:00.000Z", unread: true }),
      { view: "all" },
    );
    expect(bumped[0].data.map((c) => c.id)).toEqual(["b", "a"]);

    const archived = upsertConversationInPages(bumped, conv("b", { state: "archived" }), { view: "all" });
    expect(archived[0].data.map((c) => c.id)).toEqual(["a"]);
  });

  it("starts a page when the list was empty", () => {
    expect(upsertConversationInPages([], conv("a"), { view: "all" })[0].data).toHaveLength(1);
  });
});

describe("search", () => {
  it("matches names, previews and digits", () => {
    const c = conv("c1", { lastMessagePreview: "On my way to the house" });
    expect(matchesSearch(c, "Jane Doe", "jane")).toBe(true);
    expect(matchesSearch(c, "Jane Doe", "the house")).toBe(true);
    expect(matchesSearch(c, "Jane Doe", "555-12")).toBe(true);
    expect(matchesSearch(c, "Jane Doe", "bob")).toBe(false);
    expect(matchesSearch(c, "Jane Doe", "")).toBe(true);
  });

  it("treats seven or more digits as a number lookup", () => {
    expect(looksLikePhoneQuery("404 555")).toBe(false);
    expect(looksLikePhoneQuery("(404) 555-1234")).toBe(true);
  });
});

describe("composer helpers", () => {
  it("inserts at the caret and replaces a selection", () => {
    expect(insertAtCursor("Hi , bye", "{{first_name}}", 3)).toEqual({
      value: "Hi {{first_name}}, bye",
      caret: 17,
    });
    expect(insertAtCursor("Hi NAME", "Jane", 3, 7)).toEqual({ value: "Hi Jane", caret: 7 });
    expect(insertAtCursor("abc", "x", 99)).toEqual({ value: "abcx", caret: 4 });
  });

  it("spots short codes that still need filling", () => {
    expect(hasShortCodes("See you {{job_date}}")).toBe(true);
    expect(hasShortCodes("See you {{ Manager Note }}")).toBe(true);
    expect(hasShortCodes("Plain text {not a code}")).toBe(false);
  });

  it("mints RFC 4122 ids", () => {
    const a = newClientMessageId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newClientMessageId()).not.toBe(a);
  });
});
