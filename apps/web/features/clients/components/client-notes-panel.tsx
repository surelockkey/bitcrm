"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WzRailPanel } from "@/components/workiz/rail";
import { cn } from "@/lib/utils";
import { useUserMap } from "@/features/deals/hooks";
import { initials } from "@/features/users/lib";
import { useAddContactNote, useContactNotes, useDeleteContactNote, useUpdateContactNote } from "../notes-hooks";
import { groupNotesByMonth, isLongNote, noteStamp } from "../notes-lib";
import type { ContactNote } from "../notes-types";
import { EmptyNotesArt } from "./client-rail-art";

/** Workiz's blue words-buttons in the panels ("+ Add note", "Show more"): #3589e9. */
const BLUE = "inline-flex items-center gap-1.5 text-brand outline-none hover:underline focus-visible:underline";
/** Workiz's small icon buttons on a note: 24px, 4px corners, #f3f6f7 under the pointer. */
const NOTE_ICON = "grid size-6 place-items-center rounded-[4px] text-foreground hover:bg-wz-secondary-hover";

/**
 * Workiz's Notes panel on the client page (pg_contact_wz_269669_11/_15): the
 * panel over the right of the page, "+ Add note" (13px/19px 600 #3589e9) and
 * its composer ("Add note here", Cancel / Save), then the notes as cards
 * under month headings, pinned ones first under "Pinned". The client form's
 * old free-text notes field stays visible as a "Description" card so nothing
 * the office wrote before the rail goes missing.
 */
export function ClientNotesPanel({
  contactId,
  description,
  canEdit,
  open,
  onOpenChange,
}: {
  contactId: string;
  /** The legacy `contact.notes` string, shown first and never deletable here. */
  description?: string;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return (
    <WzRailPanel variant="plain" aria-label="Notes" title="Notes" onClose={() => onOpenChange(false)} className="max-md:w-full">
      <NotesBody contactId={contactId} description={description} canEdit={canEdit} />
    </WzRailPanel>
  );
}

function NotesBody({ contactId, description, canEdit }: { contactId: string; description?: string; canEdit: boolean }) {
  const query = useContactNotes(contactId);
  const add = useAddContactNote(contactId);
  const update = useUpdateContactNote(contactId);
  const remove = useDeleteContactNote(contactId);
  const { map: userMap } = useUserMap();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<ContactNote | null>(null);

  const notes = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const groups = useMemo(() => groupNotesByMonth(notes), [notes]);

  const author = (n: ContactNote) => {
    const u = userMap.get(n.actorId);
    const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
    if (name) return { name, initials: initials(u?.firstName, u?.lastName) };
    const [first = "", last = ""] = n.actorName.split(/\s+/);
    return { name: n.actorName, initials: initials(first, last) };
  };

  const save = () => {
    const v = draft.trim();
    if (!v) return;
    add.mutate(v, {
      onSuccess: () => {
        setDraft("");
        setComposing(false);
      },
    });
  };

  const empty = !query.isLoading && groups.length === 0 && !description;

  return (
    <div className="px-4 pt-4 pb-6 text-sm leading-[21px] tracking-[0.4px] text-foreground">
      {canEdit ? (
        <button type="button" onClick={() => setComposing(true)} className={cn(BLUE, "text-[13px] leading-[19px] font-semibold")}>
          <Plus className="size-4" strokeWidth={1.75} /> Add note
        </button>
      ) : null}
      {canEdit && composing ? (
        <div className="mt-2.5">
          {/* pg_contact_wz_269669_15: 318×96, 1px #ddd, 4px corners, 16px 12px in, 13px/21px. */}
          <textarea
            aria-label="New note"
            placeholder="Add note here"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="block h-24 w-full resize-none rounded-[4px] border border-wz-frame bg-[#fefefe] px-3 py-4 text-[13px] leading-[21px] text-wz-strong outline-none placeholder:text-[#8e8e8e] focus:border-wz-focus"
          />
          <div className="mt-2.5 flex justify-end gap-[18px]">
            <Button variant="ghost" className="h-8 rounded-pill px-3" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button variant="brand" className="h-8 gap-1.5 rounded-pill px-3" disabled={!draft.trim() || add.isPending} onClick={save}>
              {add.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </div>
      ) : null}

      {query.isLoading ? (
        <Skeleton className="mt-6 h-40 w-full" />
      ) : empty ? (
        <div className="mt-[180px] flex flex-col items-center text-center">
          <EmptyNotesArt />
          <p className="mt-6">No notes yet. Add one to keep your team aligned.</p>
        </div>
      ) : (
        <>
          {description ? (
            <section className="mt-6">
              <DescriptionCard text={description} />
            </section>
          ) : null}
          {groups.map((g) => (
            <section key={g.label} className="mt-6">
              <h3 className="font-medium text-wz-outline-label">{g.label}</h3>
              <div className="mt-4 space-y-4">
                {g.notes.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    author={author(n)}
                    canEdit={canEdit}
                    onPin={(pinned) => update.mutate({ noteId: n.id, pinned })}
                    onSave={(text, done) => update.mutate({ noteId: n.id, note: text }, { onSuccess: done })}
                    onDelete={() => setDeleting(n)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {query.hasNextPage ? (
        <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
        </Button>
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>&ldquo;{deleting?.note}&rdquo; will be removed from the client.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) remove.mutate(deleting.id);
                setDeleting(null);
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The note's text, 14px/21px ink, four lines at a time until "Show more". */
function NoteText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = isLongNote(text);
  return (
    <>
      {/* Clamped, Workiz runs the lines together; opened, they keep their breaks. */}
      <p data-testid="note-text" className={cn("mt-3 break-words", long && !expanded ? "line-clamp-4" : "whitespace-pre-wrap")}>
        {text}
      </p>
      {long ? (
        <button type="button" onClick={() => setExpanded((e) => !e)} className={cn(BLUE, "mt-3")}>
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

/** A note card (`clientNotes-module__noteWrapper`): 1px #dfe2e3, 5px corners, 16px in. */
const CARD = "rounded-[5px] border border-border bg-white p-4";
/** Workiz's avatar: a 31px #5e5e5e disc, white letters. */
const AVATAR = "grid size-[31px] flex-none place-items-center rounded-full bg-muted-foreground text-xs font-medium text-white";

function DescriptionCard({ text }: { text: string }) {
  return (
    <div data-testid="note-card" className={CARD}>
      <div className="flex items-start gap-2">
        <span className={AVATAR} aria-hidden>
          D
        </span>
        <div className="min-w-0 flex-1">
          <div>Description</div>
          <div className="text-[11px] leading-4 text-wz-outline">From the client form</div>
        </div>
      </div>
      <NoteText text={text} />
    </div>
  );
}

function NoteCard({
  note,
  author,
  canEdit,
  onPin,
  onSave,
  onDelete,
}: {
  note: ContactNote;
  author: { name: string; initials: string };
  canEdit: boolean;
  onPin: (pinned: boolean) => void;
  onSave: (text: string, done: () => void) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.note);

  return (
    <div data-testid="note-card" className={cn(CARD, "group")}>
      <div className="flex items-start gap-2">
        <span className={AVATAR}>{author.initials}</span>
        <div className="min-w-0 flex-1">
          <div className="break-words">{author.name}</div>
          <div className="text-[11px] leading-4 text-wz-outline">{noteStamp(note.createdAt)}</div>
        </div>
        {canEdit ? (
          <div className="flex flex-none items-center gap-0.5 self-center">
            {!editing ? (
              <>
                <button
                  type="button"
                  aria-label="Edit note"
                  onClick={() => {
                    setDraft(note.note);
                    setEditing(true);
                  }}
                  className={cn(NOTE_ICON, "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100")}
                >
                  <Pencil className="size-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label="Delete note"
                  onClick={onDelete}
                  className={cn(NOTE_ICON, "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-wz-danger")}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.5} />
                </button>
              </>
            ) : null}
            {/* Workiz's pin: "Pin" / "Unpin", the glyph crossed out once pinned. */}
            <button
              type="button"
              aria-label={note.pinned ? "Unpin note" : "Pin note"}
              title={note.pinned ? "Unpin" : "Pin"}
              aria-pressed={note.pinned}
              onClick={() => onPin(!note.pinned)}
              className={NOTE_ICON}
            >
              {note.pinned ? <PinOff className="size-[18px]" strokeWidth={1.25} /> : <Pin className="size-[18px]" strokeWidth={1.25} />}
            </button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <textarea
            aria-label="Edit note"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="block h-24 w-full resize-none rounded-[4px] border border-wz-frame px-3 py-2 text-[13px] leading-[21px] text-wz-strong outline-none focus:border-wz-focus"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-8 rounded-pill px-3" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="brand" className="h-8 rounded-pill px-3" disabled={!draft.trim()} onClick={() => onSave(draft.trim(), () => setEditing(false))}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <NoteText text={note.note} />
      )}
    </div>
  );
}
