import { describe, expect, it } from "vitest";
import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import {
  JOB_TIMELINE_FILTERS,
  filterOptionLabel,
  notesBadge,
  relativeTime,
  timelineCounts,
} from "./timeline-rail";

const entry = (eventType: TimelineEventType, id: string = eventType): TimelineEntry =>
  ({ id, dealId: "d1", eventType, actorId: "u1", actorName: "U", timestamp: "2026-10-01T10:00:00.000Z" }) as TimelineEntry;

describe("job timeline filters, in Workiz's order", () => {
  it("offers All, Activities, Notes and Calls — no Messages until a feed exists", () => {
    expect(JOB_TIMELINE_FILTERS.map((f) => f.label)).toEqual(["All", "Activities", "Notes", "Calls"]);
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
    expect(counts).toEqual({ all: 6, activities: 3, notes: 2, calls: 1 });
  });

  it("labels an option with its count, marking a count that more pages could raise", () => {
    expect(filterOptionLabel("activities", 58, false)).toBe("Activities (58)");
    expect(filterOptionLabel("notes", 6, true)).toBe("Notes (6+)");
    expect(filterOptionLabel("all", 0, false)).toBe("All (0)");
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
