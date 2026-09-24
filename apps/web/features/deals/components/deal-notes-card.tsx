"use client";

import { JobNoteEditor } from "./job-note-editor";
import { noteToText } from "../note-html";
import { cn } from "@/lib/utils";

/**
 * The job's note: one field called Notes, inside the Job section, written the
 * way Workiz writes it — a toolbar with the block format, undo and redo, bold
 * and italic, the two lists and a link.
 *
 * It used to be a card titled "Notes" holding a field titled "Job note", next
 * to a second "dispatcher note" box that was ours alone. What Workiz's teams
 * use for that second one is a custom field they made themselves ("Manager
 * Note", in their Dispatchers group), and ours was empty on all 80,034
 * imported jobs.
 */
export function DealNotesCard({
  notes,
  editable,
  onNotesChange,
}: {
  notes: string;
  editable: boolean;
  onNotesChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground">Notes</span>
      {editable ? (
        <JobNoteEditor value={notes} onChange={onNotesChange} ariaLabel="Notes" />
      ) : (
        <p
          className={cn(
            "whitespace-pre-wrap text-sm",
            notes.trim() ? "text-foreground/90" : "italic text-muted-foreground/60",
          )}
        >
          {notes.trim() ? noteToText(notes) : "\u2014"}
        </p>
      )}
    </div>
  );
}
