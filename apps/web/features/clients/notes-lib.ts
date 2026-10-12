import { DEFAULT_TZ, withZone } from "@/lib/timezone";
import type { ContactNote } from "./notes-types";

/** Pinned first, then the newest — whatever order the pages came in. */
export function sortNotes(notes: ContactNote[]): ContactNote[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * Workiz's month heading: "July 2025" — Connecticut's month, never the
 * browser's (a note at 23:30 on Jul 31 in Connecticut is July's).
 */
export function monthLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { timeZone: DEFAULT_TZ, month: "long", year: "numeric" });
}

/** Workiz's stamp under the author, on Connecticut's clock and saying so: "Jul 24 2025 • 6:19 PM EDT". */
export function noteStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-US", { timeZone: DEFAULT_TZ, month: "short", day: "numeric", year: "numeric" }).replace(",", "");
  const time = d.toLocaleTimeString("en-US", { timeZone: DEFAULT_TZ, hour: "numeric", minute: "2-digit" });
  return withZone(`${date} • ${time}`, d);
}

export interface NoteGroup {
  label: string;
  notes: ContactNote[];
}

/** A "Pinned" group on top, then one group per month, newest month first. */
export function groupNotesByMonth(notes: ContactNote[]): NoteGroup[] {
  const groups: NoteGroup[] = [];
  for (const n of sortNotes(notes)) {
    const label = n.pinned ? "Pinned" : monthLabel(n.createdAt);
    const last = groups.at(-1);
    if (last && last.label === label) last.notes.push(n);
    else groups.push({ label, notes: [n] });
  }
  return groups;
}

const CLAMP_CHARS = 220;
const CLAMP_LINES = 4;

/** Would the text spill past the four lines the card shows before "Show more"? */
export function isLongNote(text: string): boolean {
  return text.length > CLAMP_CHARS || text.split("\n").length > CLAMP_LINES;
}
