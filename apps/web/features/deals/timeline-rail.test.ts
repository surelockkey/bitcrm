import { describe, expect, it } from "vitest";
import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import type { FeedMessage } from "@/features/messaging/api";
import {
  JOB_TIMELINE_FILTERS,
  filterOptionLabel,
  matchesFilter,
  messageRowText,
  notesBadge,
  relativeTime,
  timelineCounts,
} from "./timeline-rail";

const entry = (eventType: TimelineEventType, id: string = eventType): TimelineEntry =>
  ({ id, dealId: "d1", eventType, actorId: "u1", actorName: "U", timestamp: "2026-10-01T10:00:00.000Z" }) as TimelineEntry;

describe("job timeline filters, in Workiz's order", () => {
  it("offers All, Activities, Notes, Calls and Messages (rail_chat_dropdown)", () => {
    expect(JOB_TIMELINE_FILTERS.map((f) => f.label)).toEqual(["All", "Activities", "Notes", "Calls", "Messages"]);
  });

  it("counts what each filter would show", () => {
    const counts = timelineCounts([
      entry(TimelineEventType.NOTE_ADDED, "n1"),
      entry(TimelineEventType.NOTE_ADDED, "n2"),
      entry(TimelineEventType.CALL_LINKED),
      entry(TimelineEventType.FIELD_UPDATED),
      entry(TimelineEventType.STATUS_CHANGED),
      entry(TimelineEventType.TECH_ASSIGNED),
    ]);
    expect(counts).toEqual({ all: 6, activities: 3, notes: 2, calls: 1, messages: 0 });
  });

  it("counts the job's messages under Messages, and in All as Workiz does (All 80 = 64 + 7 + 5 + 4)", () => {
    const counts = timelineCounts([entry(TimelineEventType.NOTE_ADDED, "n1"), entry(TimelineEventType.FIELD_UPDATED)], 4);
    expect(counts).toEqual({ all: 6, activities: 1, notes: 1, calls: 0, messages: 4 });
  });

  it("a timeline entry never passes the Messages filter", () => {
    expect(matchesFilter(entry(TimelineEventType.NOTE_ADDED), "messages")).toBe(false);
    expect(matchesFilter(entry(TimelineEventType.FIELD_UPDATED), "messages")).toBe(false);
  });

  it("labels an option with its count, marking a count that more pages could raise", () => {
    expect(filterOptionLabel("activities", 58, false)).toBe("Activities (58)");
    expect(filterOptionLabel("notes", 6, true)).toBe("Notes (6+)");
    expect(filterOptionLabel("all", 0, false)).toBe("All (0)");
  });
});

describe("a message as a Timeline row (rail_chat)", () => {
  const msg = (over: Partial<FeedMessage>): FeedMessage =>
    ({
      id: "m1",
      conversationId: "c1",
      channel: "sms",
      direction: "outbound",
      origin: "user",
      status: "delivered",
      createdAt: "2026-10-08T13:43:00.000Z",
      updatedAt: "2026-10-08T13:43:00.000Z",
      body: "New job #5TU7ZA\nDustin Roselle",
      ...over,
    }) as FeedMessage;
  const ctx = {
    userName: (id: unknown) => (id === "u-mia" ? "Mia Lopez" : null),
    clientName: "Dustin Roselle",
    clientPhones: ["+14693968179", "(203) 769-9944"],
  };

  it("an outbound line is the sender's — by their user name, else the name stored on it", () => {
    expect(messageRowText(msg({ sentByUserId: "u-mia", sentByName: "(1) (Mia) 7 Dispatcher" }), ctx).actor).toBe("Mia Lopez");
    expect(messageRowText(msg({ sentByUserId: "u-gone", sentByName: "(1) (Mia) 7 Dispatcher" }), ctx).actor).toBe(
      "(1) (Mia) 7 Dispatcher",
    );
  });

  it("an automated or system text says so", () => {
    expect(messageRowText(msg({ origin: "automation" }), ctx).actor).toBe("Automation");
    expect(messageRowText(msg({ origin: "system" }), ctx).actor).toBe("System");
  });

  it("an inbound text from the client's number is the client's; another number is shown as the number", () => {
    const inbound = { direction: "inbound" as const, origin: "contact" as const };
    expect(messageRowText(msg({ ...inbound, from: "+12037699944" }), ctx).actor).toBe("Dustin Roselle");
    expect(messageRowText(msg({ ...inbound, from: "+14045551234" }), ctx).actor).toBe("(404) 555-1234");
    // A viewer who may not see numbers gets the line without `from`.
    expect(messageRowText(msg({ ...inbound, fromMasked: true }), ctx).actor).toBe("Dustin Roselle");
  });

  it("a technician's reply is the technician's", () => {
    const reply = msg({ direction: "inbound", origin: "employee", sentByUserId: "u-mia" });
    expect(messageRowText(reply, ctx).actor).toBe("Mia Lopez");
    expect(messageRowText(msg({ direction: "inbound", origin: "employee", from: "+14045551234" }), ctx).actor).toBe(
      "(404) 555-1234",
    );
  });

  it("the text is the body with its line breaks; else the subject; else the attachments", () => {
    expect(messageRowText(msg({}), ctx).text).toBe("New job #5TU7ZA\nDustin Roselle");
    expect(messageRowText(msg({ body: undefined, channel: "note", subject: "Viewed estimate #K4-1" }), ctx).text).toBe(
      "Viewed estimate #K4-1",
    );
    const files = [{ id: "a1" }, { id: "a2" }] as FeedMessage["attachments"];
    expect(messageRowText(msg({ body: undefined, attachments: files }), ctx).text).toBe("2 attachments");
    expect(messageRowText(msg({ channel: "email", subject: "Your estimate", body: "Hi John" }), ctx).text).toBe(
      "Your estimate\nHi John",
    );
  });
});

describe("the notes badge on the rail", () => {
  it("shows nothing when the job has no notes", () => {
    expect(notesBadge(0, false)).toBeNull();
    expect(notesBadge(0, true)).toBeNull();
  });

  it("shows the count, with a plus while older pages are unread", () => {
    expect(notesBadge(6, false)).toBe("6");
    expect(notesBadge(6, true)).toBe("6+");
  });

  it("caps at 99+", () => {
    expect(notesBadge(140, false)).toBe("99+");
  });
});

describe("relative times, worded like Workiz's 'a day ago'", () => {
  const now = new Date("2026-10-08T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;

  it.each([
    [10 * S, "a few seconds ago"],
    [60 * S, "a minute ago"],
    [5 * M, "5 minutes ago"],
    [60 * M, "an hour ago"],
    [7 * H, "7 hours ago"],
    [26 * H, "a day ago"],
    [2 * D, "2 days ago"],
    [30 * D, "a month ago"],
    [90 * D, "3 months ago"],
    [400 * D, "a year ago"],
    [800 * D, "2 years ago"],
  ])("%d ms back reads %s", (ms, text) => {
    expect(relativeTime(ago(ms as number), now)).toBe(text);
  });

  it("leaves an unreadable stamp as it is", () => {
    expect(relativeTime("garbage", now)).toBe("garbage");
  });
});
