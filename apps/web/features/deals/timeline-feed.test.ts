import { describe, it, expect } from "vitest";
import { mergeTimelineFeed, type FeedRow } from "./timeline-feed";

/**
 * A job's history should read as one story. The calls and the messages about a
 * job live in telephony and messaging, so the activity panel showed neither —
 * a dispatcher reading it saw the job edited and assigned, and no sign that
 * anyone had ever phoned or written.
 *
 * They are merged at read time rather than copied into the timeline: the data
 * is already indexed by job, and a million imported calls have no business
 * being written twice.
 */
const entry = (id: string, at: string) => ({ id, timestamp: at, eventType: "field_updated" }) as never;
const call = (sid: string, at: string, over = {}) =>
  ({ callSid: sid, startedAt: at, dealId: "d1", direction: "inbound", status: "completed", ...over }) as never;
const message = (id: string, at: string, over = {}) =>
  ({ id, createdAt: at, body: "on my way", direction: "outbound", ...over }) as never;

const ids = (rows: FeedRow[]) => rows.map((r) => r.id);

describe("mergeTimelineFeed", () => {
  it("tells one story, newest first", () => {
    const rows = mergeTimelineFeed({
      dealId: "d1",
      entries: [entry("e1", "2026-09-24T10:00:00.000Z")],
      calls: [call("CA1", "2026-09-24T11:00:00.000Z")],
      messages: [message("m1", "2026-09-24T09:00:00.000Z")],
    });

    expect(ids(rows)).toEqual(["call:CA1", "e1", "message:m1"]);
  });

  it("keeps only the calls that belong to this job", () => {
    const rows = mergeTimelineFeed({
      dealId: "d1",
      entries: [],
      calls: [call("CA1", "2026-09-24T11:00:00.000Z"), call("CA2", "2026-09-24T12:00:00.000Z", { dealId: "d2" })],
      messages: [],
    });

    expect(ids(rows)).toEqual(["call:CA1"]);
  });

  it("marks what each row is, so the panel can filter and draw it", () => {
    const rows = mergeTimelineFeed({
      dealId: "d1",
      entries: [entry("e1", "2026-09-24T10:00:00.000Z")],
      calls: [call("CA1", "2026-09-24T11:00:00.000Z")],
      messages: [message("m1", "2026-09-24T09:00:00.000Z")],
    });

    expect(rows.map((r) => r.kind)).toEqual(["call", "entry", "message"]);
  });

  it("survives a row with no time on it rather than dropping the feed", () => {
    const rows = mergeTimelineFeed({
      dealId: "d1",
      entries: [entry("e1", "2026-09-24T10:00:00.000Z")],
      calls: [call("CA1", "")],
      messages: [],
    });

    expect(ids(rows)).toContain("e1");
    expect(ids(rows)).toContain("call:CA1");
    expect(ids(rows)[0]).toBe("e1");
  });

  it("does not collide a call and an entry that share an id", () => {
    const rows = mergeTimelineFeed({
      dealId: "d1",
      entries: [entry("x", "2026-09-24T10:00:00.000Z")],
      calls: [call("x", "2026-09-24T11:00:00.000Z")],
      messages: [message("x", "2026-09-24T09:00:00.000Z")],
    });

    expect(new Set(ids(rows)).size).toBe(3);
  });

  it("has nothing to say about a job with no history", () => {
    expect(mergeTimelineFeed({ dealId: "d1", entries: [], calls: [], messages: [] })).toEqual([]);
  });
});
