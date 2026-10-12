import { describe, expect, it } from "vitest";
import type { ContactNote } from "./notes-types";
import { groupNotesByMonth, isLongNote, monthLabel, noteStamp, sortNotes } from "./notes-lib";

const note = (id: string, createdAt: string, pinned = false): ContactNote => ({
  id,
  contactId: "c1",
  note: `note ${id}`,
  actorId: "u1",
  actorName: "Betty",
  pinned,
  createdAt,
  updatedAt: createdAt,
});

describe("notes-lib — the order and the headings of the Notes rail", () => {
  it("puts pinned notes first, then the newest, whatever order the server sent", () => {
    const sorted = sortNotes([
      note("old", "2025-07-01T10:00:00"),
      note("new", "2025-09-01T10:00:00"),
      note("pinned-old", "2025-01-01T10:00:00", true),
      note("mid", "2025-08-01T10:00:00"),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["pinned-old", "new", "mid", "old"]);
  });

  it("groups by month, Workiz-style 'July 2025', with a Pinned group on top", () => {
    const groups = groupNotesByMonth([
      note("a", "2025-07-24T18:19:00"),
      note("b", "2025-07-02T09:00:00"),
      note("c", "2025-06-30T09:00:00"),
      note("p", "2025-03-01T09:00:00", true),
    ]);
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ["Pinned", ["p"]],
      ["July 2025", ["a", "b"]],
      ["June 2025", ["c"]],
    ]);
  });

  it("stamps a note the way Workiz does, on Connecticut's clock with its zone: 'Jul 24 2025 • 6:19 PM EDT'", () => {
    expect(noteStamp("2025-07-24T22:19:00.000Z")).toBe("Jul 24 2025 • 6:19 PM EDT");
    expect(noteStamp("2025-12-01T15:00:00.000Z")).toBe("Dec 1 2025 • 10:00 AM EST");
    // 23:30 in Connecticut — already Aug 1 in UTC and in Kyiv.
    expect(noteStamp("2025-08-01T03:30:00.000Z")).toBe("Jul 31 2025 • 11:30 PM EDT");
    expect(monthLabel("2025-07-24T22:19:00.000Z")).toBe("July 2025");
  });

  it("buckets by Connecticut's month, not the browser's", () => {
    expect(monthLabel("2025-08-01T03:30:00.000Z")).toBe("July 2025");
    const groups = groupNotesByMonth([note("late", "2025-08-01T03:30:00.000Z"), note("aug", "2025-08-01T12:00:00.000Z")]);
    expect(groups.map((g) => [g.label, g.notes.map((n) => n.id)])).toEqual([
      ["August 2025", ["aug"]],
      ["July 2025", ["late"]],
    ]);
  });

  it("asks for 'Show more' only on a note that would not fit four lines", () => {
    expect(isLongNote("short")).toBe(false);
    expect(isLongNote("x".repeat(260))).toBe(true);
    expect(isLongNote("one\ntwo\nthree\nfour\nfive")).toBe(true);
  });
});
