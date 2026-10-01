"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Pin, PinOff, Plus, StickyNote, Trash2 } from "lucide-react";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useUserMap } from "@/features/deals/hooks";
import { initials } from "@/features/users/lib";
import { useAddContactNote, useContactNotes, useDeleteContactNote, useUpdateContactNote } from "../notes-hooks";
import { groupNotesByMonth, isLongNote, noteStamp } from "../notes-lib";
import type { ContactNote } from "../notes-types";

/**
 * Workiz's Notes rail on the client card: "+ Add note" on top, then the
 * notes as cards under month headings, pinned ones first. The client form's
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[400px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Notes</SheetTitle>
          <SheetDescription className="sr-only">What the office keeps on this client.</SheetDescription>
        </SheetHeader>
        {open ? <NotesBody contactId={contactId} description={description} canEdit={canEdit} /> : null}
      </SheetContent>
    </Sheet>
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

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
      {canEdit ? (
        composing ? (
          <div className="space-y-2">
            <Textarea rows={3} aria-label="New note" placeholder="Write a note…" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <div className="flex gap-1.5">
              <Button size="sm" variant="brand" className="gap-1.5" disabled={!draft.trim() || add.isPending} onClick={save}>
                {add.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setComposing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setComposing(true)} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
            <Plus className="size-4" /> Add note
          </button>
        )
      ) : null}

      {query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {description ? <DescriptionCard text={description} /> : null}
          {groups.length === 0 && !description ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No notes yet.</p>
          ) : null}
          {groups.map((g) => (
            <section key={g.label} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{g.label}</h3>
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
            </section>
          ))}
        </>
      )}

      {query.hasNextPage ? (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
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

/** The note's text, four lines at a time until "Show more". */
function NoteText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = isLongNote(text);
  return (
    <>
      <p data-testid="note-text" className={cn("whitespace-pre-wrap text-sm", long && !expanded && "line-clamp-4")}>
        {text}
      </p>
      {long ? (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="text-sm font-medium text-brand hover:underline">
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

function DescriptionCard({ text }: { text: string }) {
  return (
    <div data-testid="note-card" className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
          <StickyNote className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Description</div>
          <div className="text-xs text-muted-foreground">From the client form</div>
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
    <div data-testid="note-card" className="group space-y-2 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <span className="grid size-9 flex-none place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{author.initials}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{author.name}</div>
          <div className="text-xs text-muted-foreground">{noteStamp(note.createdAt)}</div>
        </div>
        {canEdit ? (
          <div className="flex flex-none items-center gap-0.5">
            {!editing ? (
              <>
                <button
                  type="button"
                  aria-label="Edit note"
                  onClick={() => {
                    setDraft(note.note);
                    setEditing(true);
                  }}
                  className="grid size-7 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Delete note"
                  onClick={onDelete}
                  className="grid size-7 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-label={note.pinned ? "Unpin note" : "Pin note"}
              aria-pressed={note.pinned}
              onClick={() => onPin(!note.pinned)}
              className={cn("grid size-7 place-items-center rounded hover:bg-muted", note.pinned ? "text-brand" : "text-muted-foreground hover:text-foreground")}
            >
              {note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-1.5">
          <Textarea rows={3} aria-label="Edit note" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex gap-1.5">
            <Button size="sm" variant="brand" className="h-7 text-xs" disabled={!draft.trim()} onClick={() => onSave(draft.trim(), () => setEditing(false))}>
              Save
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <NoteText text={note.note} />
      )}
    </div>
  );
}
