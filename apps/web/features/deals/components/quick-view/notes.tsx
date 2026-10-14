"use client";

import { useMemo, useState } from "react";
import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import { Loader2 } from "lucide-react";
import { useAddNote, useDealTimeline } from "../../hooks";
import { NOTE_MAX_LENGTH } from "../deal-timeline-panel";
import { NotesArt } from "../job-empty-art";
import { DEFAULT_TZ } from "@/lib/timezone";
import { QvButtons, QvFold, QvIconButton } from "./parts";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: DEFAULT_TZ, month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Workiz's Notes (quickview_wz_add_note): folded at first, "+" at the right
 * is Add note — the box under the title, Cancel / Save; the job's notes
 * listed newest first; the notepad while there are none.
 */
export function NotesBlock({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  return (
    <QvFold
      title="Notes"
      open={open}
      onOpenChange={setOpen}
      action={
        canEdit ? (
          <QvIconButton
            label="Add note"
            icon="plus"
            active={composing}
            onClick={() => {
              setOpen(true);
              setComposing(true);
            }}
          />
        ) : undefined
      }
    >
      <NotesBody dealId={dealId} composing={composing} onComposed={() => setComposing(false)} />
    </QvFold>
  );
}

function NotesBody({ dealId, composing, onComposed }: { dealId: string; composing: boolean; onComposed: () => void }) {
  const timeline = useDealTimeline(dealId);
  const addNote = useAddNote(dealId);
  const [text, setText] = useState("");
  const notes = useMemo(
    () => (timeline.data?.pages ?? []).flatMap((p) => p.data).filter((e: TimelineEntry) => e.eventType === TimelineEventType.NOTE_ADDED),
    [timeline.data],
  );

  const save = () => {
    const note = text.trim();
    if (!note) return;
    addNote.mutate(note, {
      onSuccess: () => {
        setText("");
        onComposed();
      },
    });
  };

  return (
    <div>
      {composing ? (
        <div className="mb-4">
          <textarea
            autoFocus
            aria-label="Add note"
            placeholder="Add note..."
            maxLength={NOTE_MAX_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="block h-[158px] w-full resize-none rounded-[4px] border border-[#9ea6aa] bg-white p-2 text-[14px] leading-4 text-[#666666] outline-none placeholder:text-[#808080] focus:border-[#3b4b52]"
          />
          <QvButtons
            className="mt-3"
            onCancel={() => {
              setText("");
              onComposed();
            }}
            onSave={save}
            saving={addNote.isPending}
            saveDisabled={!text.trim()}
          />
        </div>
      ) : null}
      {timeline.isPending ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-[#768287]" />
        </div>
      ) : notes.length ? (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="text-[14px] leading-4 text-[#404040]">
              <p className="whitespace-pre-wrap">{n.note}</p>
              <p className="mt-1 text-[12px] leading-4 text-[#768287]">
                {n.actorName} · {when(n.timestamp)}
              </p>
            </li>
          ))}
        </ol>
      ) : composing ? null : (
        <div className="flex justify-center py-4">
          <NotesArt />
        </div>
      )}
    </div>
  );
}
