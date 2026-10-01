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

  it("stamps a note the way Workiz does: 'Jul 24 2025 • 6:19 PM'", () => {
    expect(noteStamp("2025-07-24T18:19:00")).toBe("Jul 24 2025 • 6:19 PM");
    expect(monthLabel("2025-07-24T18:19:00")).toBe("July 2025");
  });

  it("asks for 'Show more' only on a note that would not fit four lines", () => {
    expect(isLongNote("short")).toBe(false);
    expect(isLongNote("x".repeat(260))).toBe(true);
    expect(isLongNote("one\ntwo\nthree\nfour\nfive")).toBe(true);
  });
});
